#!/usr/bin/env python3
"""Fail-closed production release runner for questions-game-v1.

This file intentionally uses only the Python 3.6 standard library.  It is both
the small RPC endpoint used by the SSH bootstrap and the immutable worker copied
into every release bundle.  It never opens SSH itself and never performs a
database down migration or an automatic database restore.

RPC stdout is a single, machine-readable line.  All subprocess output stays in
memory or in the systemd journal and is never forwarded to the caller.
"""

from __future__ import print_function

import argparse
import contextlib
import copy
import datetime
import fcntl
import hashlib
import io
import json
import os
import platform
import re
import secrets
import shutil
import signal
import sqlite3
import ssl
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


if "BOOTSTRAP_REQUEST" not in globals():
    BOOTSTRAP_REQUEST = None


RPC_PREFIX = "QUESTIONS_RELEASE_RPC/1 "
PROTOCOL = 1
STATE_SCHEMA = 1
INPUT_PLAN_SCHEMA = 1
FROZEN_PLAN_SCHEMA = 2
DELTA_SCHEMA = 1
DELTA_VERIFIER = "additive-empty-collections-v1"
CONTEXT_VERIFIER = "personal-journey-context-v1"
CONTEXT_MIGRATION = "1795075320_push_personal_journey_notices.js"
CONTEXT_TABLE = "game_push_notice_contexts"
CONTEXT_EVOLUTION = {"collection": CONTEXT_TABLE, "sessionRequired": False,
                     "kindValues": ["session", "account"], "legacyKind": "session"}
PUSH_SECRET_HOST = "/opt/1panel/secrets/questions-game-v1/starward-harmony-push.json"
PUSH_SECRET_CONTAINER = "/run/secrets/starward-harmony-push.json"
SOURCE_MANIFEST_ALGORITHM = "sha256"
RELEASE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{7,63}$")
SAFE_FILE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
IMAGE_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
IMAGE_TAG_RE = re.compile(r"^questions-pocketbase:[a-z0-9][a-z0-9._-]*-amd64$")
DOCKER_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
MIGRATION_FILE_RE = re.compile(r"^[0-9]{10,}_[A-Za-z0-9._-]+\.js$")
SQLITE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
MAX_RPC_BYTES = 2 * 1024 * 1024
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024
MAX_COMMAND_OUTPUT = 64 * 1024 * 1024
MAX_BUNDLE_MEMBER_BYTES = 16 * 1024 * 1024 * 1024
MAX_DOCKER_COPY_BYTES = 128 * 1024 * 1024
MIN_HEALTH_TIMEOUT_SECONDS = 90
GLOBAL_LOCK_ROOT = "/var/lib/questions-pocketbase-release-locks"

BUNDLE_MEMBERS = (
    "pocketbase-image.tar",
    "README.md",
    "release.json",
    "deployment-plan.json",
    "allowed-delta.json",
    "release-runner.py",
    "compose.candidate.yaml",
    "SHA256SUMS",
)
CHECKSUM_MEMBERS = tuple(x for x in BUNDLE_MEMBERS if x != "SHA256SUMS")
OPERATIONS = ("backup", "migrate", "no_migration", "switch", "finalize")
TERMINAL_PHASES = ("recorded", "blocked")
NEXT_BY_PHASE = {
    "prepared": "backup",
    "production-migrated": "switch",
    "migration-not-required": "switch",
    "verified": "finalize",
    "recorded": None,
    "blocked": None,
}
WORKER_TRANSITIONS = {
    "backup": ("prepared", "backup-verified", "backup"),
    "migrate": ("production-migrating", "production-migrated", "migration"),
    "no_migration": ("backup-verified", "migration-not-required", "noMigration"),
    "switch": ("switching", "verified", "switch"),
    "finalize": ("verified", "recorded", "finalize"),
}


def _strict_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _json_loads_strict(value):
    return json.loads(value, object_pairs_hook=_strict_json_object)


class ReleaseError(Exception):
    """A known, redacted failure that must stop the release."""

    def __init__(self, code, message, details=None):
        Exception.__init__(self, message)
        self.code = code
        self.message = message
        self.details = details or {}


class ResultUnknown(ReleaseError):
    """A mutating command may have completed after the local observer left."""

    def __init__(self, message, details=None):
        ReleaseError.__init__(self, "result_unknown", message, details)


def _utc_now():
    return datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _canonical_bytes(value):
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path, maximum=None):
    digest = hashlib.sha256()
    total = 0
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if maximum is not None and total > maximum:
                raise ReleaseError("file_too_large", "A validated file exceeds its size limit.")
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_json(value):
    return _sha256_bytes(_canonical_bytes(value))


def _redacted_exception(exc):
    if isinstance(exc, ReleaseError):
        return {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
    return {
        "code": "internal_error",
        "message": "The release runner failed closed; inspect the private worker journal.",
        "details": {"exceptionType": exc.__class__.__name__},
    }


def _require(condition, code, message, details=None):
    if not condition:
        raise ReleaseError(code, message, details)


def _require_exact_keys(value, keys, label):
    _require(isinstance(value, dict), "invalid_schema", label + " must be an object.")
    expected = set(keys)
    actual = set(value.keys())
    _require(
        actual == expected,
        "invalid_schema",
        label + " has missing or unknown fields.",
        {"missing": sorted(expected - actual), "unknown": sorted(actual - expected)},
    )


def _require_string(value, label, minimum=1, maximum=4096):
    _require(isinstance(value, str), "invalid_schema", label + " must be a string.")
    encoded = value.encode("utf-8")
    _require(
        minimum <= len(encoded) <= maximum,
        "invalid_schema",
        label + " has an invalid length.",
    )
    _require("\x00" not in value, "invalid_schema", label + " contains a NUL byte.")
    return value


def _require_int(value, label, minimum=0, maximum=None):
    _require(
        isinstance(value, int) and not isinstance(value, bool),
        "invalid_schema",
        label + " must be an integer.",
    )
    _require(value >= minimum, "invalid_schema", label + " is below its minimum.")
    if maximum is not None:
        _require(value <= maximum, "invalid_schema", label + " exceeds its maximum.")
    return value


def _require_bool(value, label):
    _require(isinstance(value, bool), "invalid_schema", label + " must be a boolean.")
    return value


def _require_sha(value, label):
    _require_string(value, label, 64, 64)
    _require(bool(SHA256_RE.match(value)), "invalid_schema", label + " is not a SHA256 digest.")
    return value


def _require_image_digest(value, label):
    _require_string(value, label, 71, 71)
    _require(
        bool(IMAGE_DIGEST_RE.match(value)),
        "invalid_schema",
        label + " is not a sha256 image digest.",
    )
    return value


def _require_absolute_path(value, label):
    _require_string(value, label)
    _require(os.path.isabs(value), "invalid_schema", label + " must be absolute.")
    normalized = os.path.normpath(value)
    _require(normalized == value, "invalid_schema", label + " must already be normalized.")
    _require(value != "/", "invalid_schema", label + " cannot be the filesystem root.")
    return value


def _require_relative_path(value, label):
    _require_string(value, label)
    _require(not os.path.isabs(value), "invalid_schema", label + " must be relative.")
    normalized = value.replace("\\", "/")
    parts = normalized.split("/")
    _require(
        normalized == value and all(part not in ("", ".", "..") for part in parts),
        "invalid_schema",
        label + " is not a safe relative path.",
    )
    return value


def _require_string_list(value, label, item_validator=None):
    _require(isinstance(value, list), "invalid_schema", label + " must be an array.")
    result = []
    for index, item in enumerate(value):
        item = _require_string(item, "%s[%d]" % (label, index))
        if item_validator is not None:
            item_validator(item, "%s[%d]" % (label, index))
        result.append(item)
    _require(len(result) == len(set(result)), "invalid_schema", label + " contains duplicates.")
    return result


def _migration_name(value, label):
    _require(
        bool(MIGRATION_FILE_RE.match(value)),
        "invalid_schema",
        label + " is not a versioned migration filename.",
    )


def _validate_url(value, label, require_https=True):
    value = _require_string(value, label)
    parsed = urllib.parse.urlsplit(value)
    _require(
        parsed.scheme == ("https" if require_https else parsed.scheme)
        and bool(parsed.hostname)
        and not parsed.username
        and not parsed.password
        and not parsed.fragment,
        "invalid_schema",
        label + " is not an allowed URL.",
    )
    if require_https:
        _require(parsed.scheme == "https", "invalid_schema", label + " must use HTTPS.")
    return value


def _validate_input_plan(plan, expected_status="pending"):
    top_keys = (
        "schemaVersion",
        "status",
        "releaseId",
        "transport",
        "server",
        "production",
        "source",
        "target",
        "migration",
        "verification",
        "activation",
    )
    _require_exact_keys(plan, top_keys, "plan")
    _require(plan["schemaVersion"] == INPUT_PLAN_SCHEMA, "invalid_schema", "plan.schemaVersion must be 1.")
    _require(plan["status"] == expected_status, "invalid_schema", "plan.status is not valid for this phase.")
    release_id = _require_string(plan["releaseId"], "plan.releaseId", 8, 64)
    _require(bool(RELEASE_ID_RE.match(release_id)), "invalid_schema", "plan.releaseId has an invalid format.")

    transport = plan["transport"]
    _require_exact_keys(transport, ("sshTarget", "sshPort"), "plan.transport")
    _require_string(transport["sshTarget"], "plan.transport.sshTarget", 1, 512)
    _require(
        transport["sshTarget"].startswith("root@")
        and len(transport["sshTarget"]) > len("root@")
        and not any(character.isspace() for character in transport["sshTarget"]),
        "invalid_schema",
        "Production transport.sshTarget must identify a root SSH target.",
    )
    _require_int(transport["sshPort"], "plan.transport.sshPort", 1, 65535)

    server = plan["server"]
    _require_exact_keys(
        server,
        (
            "expectedHostname",
            "expectedMachineIdSha256",
            "releaseRoot",
            "backupRoot",
            "uploadRoot",
            "minimumFreeBytes",
        ),
        "plan.server",
    )
    _require_string(server["expectedHostname"], "plan.server.expectedHostname", 1, 255)
    _require_sha(server["expectedMachineIdSha256"], "plan.server.expectedMachineIdSha256")
    for key in ("releaseRoot", "backupRoot", "uploadRoot"):
        _require_absolute_path(server[key], "plan.server." + key)
    roots = [os.path.normcase(os.path.realpath(server[key])) for key in ("releaseRoot", "backupRoot", "uploadRoot")]
    _require(len(set(roots)) == 3, "invalid_schema", "Release, backup and upload roots must be distinct.")
    _require_int(server["minimumFreeBytes"], "plan.server.minimumFreeBytes", 1)

    production = plan["production"]
    _require_exact_keys(
        production,
        (
            "projectDirectory",
            "composePath",
            "composeService",
            "containerName",
            "dataHostPath",
            "dataContainerPath",
            "databaseRelativePath",
            "hostIp",
            "hostPort",
            "containerPort",
            "rootReleasePath",
            "rootChecksumsPath",
        ) + (("pushRuntime",) if "pushRuntime" in production else ()),
        "plan.production",
    )
    if "pushRuntime" in production:
        push = production["pushRuntime"]
        _require_exact_keys(push, ("profile", "projectId", "secretHostPath", "secretContainerPath", "recordedComposeSha256"), "plan.production.pushRuntime")
        _require(push["profile"] == "harmony-push-production-v1", "invalid_schema", "Unsupported existing Push runtime profile.")
        _require(isinstance(push["projectId"], str) and bool(re.match(r"^[0-9]{10,32}$", push["projectId"])), "invalid_schema", "Push project ID is invalid.")
        _require(production["projectDirectory"] == "/opt/1panel/apps/questions-game-v1"
                 and push["secretHostPath"] == PUSH_SECRET_HOST and push["secretContainerPath"] == PUSH_SECRET_CONTAINER,
                 "invalid_schema", "Only the existing dedicated Push secret mount is supported.")
        _require_sha(push["recordedComposeSha256"], "plan.production.pushRuntime.recordedComposeSha256")
    for key in (
        "projectDirectory",
        "composePath",
        "dataHostPath",
        "dataContainerPath",
        "rootReleasePath",
        "rootChecksumsPath",
    ):
        _require_absolute_path(production[key], "plan.production." + key)
    _require_string(production["composeService"], "plan.production.composeService", 1, 128)
    _require_string(production["containerName"], "plan.production.containerName", 1, 128)
    _require(bool(DOCKER_NAME_RE.match(production["composeService"])), "invalid_schema", "Compose service name is unsafe.")
    _require(bool(DOCKER_NAME_RE.match(production["containerName"])), "invalid_schema", "Container name is unsafe.")
    _require_relative_path(production["databaseRelativePath"], "plan.production.databaseRelativePath")
    _require(production["databaseRelativePath"] == "data.db", "invalid_schema", "PocketBase databaseRelativePath must be data.db.")
    _require(production["dataContainerPath"] == "/pb/pb_data", "invalid_schema", "PocketBase dataContainerPath must be /pb/pb_data.")
    _require(production["hostIp"] == "127.0.0.1", "invalid_schema", "Production must remain bound to 127.0.0.1.")
    for key in ("hostPort", "containerPort"):
        _require_int(production[key], "plan.production." + key, 1, 65535)
    _require(
        server["releaseRoot"] == os.path.join(production["projectDirectory"], "releases"),
        "invalid_schema",
        "plan.server.releaseRoot must be the fixed releases directory inside projectDirectory.",
    )
    project_real = os.path.normcase(os.path.realpath(production["projectDirectory"]))
    for key in ("composePath", "dataHostPath", "rootReleasePath", "rootChecksumsPath"):
        candidate = os.path.normcase(os.path.realpath(production[key]))
        _require(
            candidate == project_real or candidate.startswith(project_real + os.sep),
            "invalid_schema",
            "plan.production.%s must remain inside projectDirectory." % key,
        )
    db_path = os.path.realpath(os.path.join(production["dataHostPath"], production["databaseRelativePath"]))
    data_root = os.path.realpath(production["dataHostPath"])
    _require(db_path.startswith(data_root + os.sep), "invalid_schema", "Database path escapes dataHostPath.")
    data_real = os.path.normcase(data_root)
    release_real = os.path.normcase(os.path.realpath(server["releaseRoot"]))
    _require(
        not (
            release_real == data_real
            or release_real.startswith(data_real + os.sep)
            or data_real.startswith(release_real + os.sep)
        ),
        "invalid_schema",
        "Release root must be isolated from the production data tree.",
    )
    for key in ("backupRoot", "uploadRoot"):
        root_real = os.path.normcase(os.path.realpath(server[key]))
        _require(
            not (
                root_real == project_real
                or root_real.startswith(project_real + os.sep)
                or project_real.startswith(root_real + os.sep)
                or root_real == data_real
                or root_real.startswith(data_real + os.sep)
                or data_real.startswith(root_real + os.sep)
            ),
            "invalid_schema",
            "plan.server.%s must be isolated from the application and production data trees." % key,
        )

    source = plan["source"]
    _require_exact_keys(
        source,
        (
            "imageTag",
            "imageId",
            "composeSha256",
            "releaseJsonSha256",
            "migrationLedgerSha256",
            "requiredMigrationFiles",
        ),
        "plan.source",
    )
    _require_string(source["imageTag"], "plan.source.imageTag", 1, 512)
    _require(bool(IMAGE_TAG_RE.match(source["imageTag"])), "invalid_schema", "Source image tag is outside the questions-pocketbase namespace.")
    _require_image_digest(source["imageId"], "plan.source.imageId")
    for key in ("composeSha256", "releaseJsonSha256", "migrationLedgerSha256"):
        _require_sha(source[key], "plan.source." + key)
    required_migration_files = _require_string_list(
        source["requiredMigrationFiles"],
        "plan.source.requiredMigrationFiles",
        _migration_name,
    )
    _require(
        required_migration_files == sorted(required_migration_files),
        "invalid_schema",
        "plan.source.requiredMigrationFiles must be sorted.",
    )

    target = plan["target"]
    _require_exact_keys(target, ("imageTag", "pocketbaseVersion", "platform"), "plan.target")
    _require_string(target["imageTag"], "plan.target.imageTag", 1, 512)
    _require(bool(IMAGE_TAG_RE.match(target["imageTag"])), "invalid_schema", "Target image tag is outside the questions-pocketbase namespace.")
    _require(target["imageTag"] != source["imageTag"], "invalid_schema", "Source and target image tags must differ.")
    _require_string(target["pocketbaseVersion"], "plan.target.pocketbaseVersion", 1, 64)
    _require(bool(re.match(r"^[0-9]+\.[0-9]+\.[0-9]+$", target["pocketbaseVersion"])), "invalid_schema", "PocketBase target version has an invalid format.")
    expected_target_tag = "questions-pocketbase:%s-%s-amd64" % (
        target["pocketbaseVersion"],
        release_id,
    )
    _require(target["imageTag"] == expected_target_tag, "invalid_schema", "Target image tag must bind PocketBase version and releaseId exactly.")
    _require(target["platform"] == "linux/amd64", "invalid_schema", "Target platform must be linux/amd64.")

    migration = plan["migration"]
    _require_exact_keys(migration, ("mode", "newFiles", "verifier"), "plan.migration")
    _require(migration["mode"] in ("required", "none"), "invalid_schema", "Migration mode is invalid.")
    new_files = _require_string_list(migration["newFiles"], "plan.migration.newFiles", _migration_name)
    _require(migration["verifier"] in (DELTA_VERIFIER, CONTEXT_VERIFIER), "invalid_schema", "Migration verifier is unsupported.")
    if migration["verifier"] == CONTEXT_VERIFIER:
        _require(migration["mode"] == "required" and new_files == [CONTEXT_MIGRATION], "invalid_schema", "Context evolution supports only its reviewed migration.")
    if migration["mode"] == "required":
        _require(bool(new_files), "invalid_schema", "Required migration mode needs newFiles.")
    else:
        _require(not new_files, "invalid_schema", "No-migration mode cannot include newFiles.")
    _require(
        not set(new_files).intersection(source["requiredMigrationFiles"]),
        "invalid_schema",
        "New migration files overlap the source baseline.",
    )

    verification = plan["verification"]
    _require_exact_keys(
        verification,
        ("healthUrl", "probes", "healthTimeoutSeconds"),
        "plan.verification",
    )
    _validate_url(verification["healthUrl"], "plan.verification.healthUrl")
    _require(isinstance(verification["probes"], list), "invalid_schema", "plan.verification.probes must be an array.")
    health_origin = urllib.parse.urlsplit(verification["healthUrl"])
    has_authentication_boundary = False
    for index, probe in enumerate(verification["probes"]):
        label = "plan.verification.probes[%d]" % index
        _require_exact_keys(probe, ("path", "expectedStatus"), label)
        path = _require_string(probe["path"], label + ".path", 1, 2048)
        _require(path.startswith("/") and not path.startswith("//"), "invalid_schema", label + ".path must be absolute-path only.")
        parsed_path = urllib.parse.urlsplit(path)
        _require(not parsed_path.scheme and not parsed_path.netloc and not parsed_path.fragment, "invalid_schema", label + ".path is invalid.")
        _require_int(probe["expectedStatus"], label + ".expectedStatus", 100, 599)
        if probe["expectedStatus"] == 401 and path != (health_origin.path or "/"):
            has_authentication_boundary = True
    _require(
        has_authentication_boundary,
        "invalid_schema",
        "At least one non-health authentication-boundary probe must expect 401.",
    )
    _require_int(
        verification["healthTimeoutSeconds"],
        "plan.verification.healthTimeoutSeconds",
        MIN_HEALTH_TIMEOUT_SECONDS,
        1800,
    )

    activation = plan["activation"]
    _require_exact_keys(activation, ("executorMayActivate",), "plan.activation")
    _require_bool(activation["executorMayActivate"], "plan.activation.executorMayActivate")
    _require(activation["executorMayActivate"] is False, "invalid_schema", "The executor may not activate business features.")
    return copy.deepcopy(plan)


def _input_projection(frozen_plan):
    keys = (
        "schemaVersion",
        "status",
        "releaseId",
        "transport",
        "server",
        "production",
        "source",
        "target",
        "migration",
        "verification",
        "activation",
    )
    result = {key: copy.deepcopy(frozen_plan[key]) for key in keys}
    result["schemaVersion"] = INPUT_PLAN_SCHEMA
    result["status"] = "pending"
    return result


def _validate_source_manifest(value):
    _require_exact_keys(value, ("algorithm", "files"), "plan.sourceManifest")
    _require(value["algorithm"] == SOURCE_MANIFEST_ALGORITHM, "invalid_schema", "Unsupported source manifest algorithm.")
    _require(isinstance(value["files"], list) and value["files"], "invalid_schema", "Source manifest files must be non-empty.")
    paths = []
    for index, item in enumerate(value["files"]):
        label = "plan.sourceManifest.files[%d]" % index
        _require_exact_keys(item, ("path", "size", "sha256"), label)
        path = _require_relative_path(item["path"], label + ".path")
        _require(
            path == "deploy/Dockerfile"
            or path == "deploy/runtime/pocketbase"
            or path.startswith("pb_hooks/")
            or path.startswith("pb_migrations/"),
            "invalid_schema",
            "Source manifest contains a path outside the frozen backend runtime inputs.",
        )
        _require_int(item["size"], label + ".size", 0, MAX_SOURCE_FILE_BYTES)
        _require_sha(item["sha256"], label + ".sha256")
        paths.append(path)
    _require(paths == sorted(paths), "invalid_schema", "Source manifest files must be sorted.")
    _require(len(paths) == len(set(paths)), "invalid_schema", "Source manifest contains duplicate paths.")
    return value


def _validate_frozen_plan(plan):
    keys = (
        "schemaVersion",
        "status",
        "releaseId",
        "transport",
        "server",
        "production",
        "source",
        "target",
        "migration",
        "verification",
        "activation",
        "releasePlanSchemaVersion",
        "sourceManifest",
        "artifact",
    )
    _require_exact_keys(plan, keys, "deployment-plan")
    _require(plan["schemaVersion"] == FROZEN_PLAN_SCHEMA, "invalid_schema", "Frozen plan schemaVersion must be 2.")
    _require(plan["releasePlanSchemaVersion"] == INPUT_PLAN_SCHEMA, "invalid_schema", "Frozen release plan schema is invalid.")
    projected = _input_projection(plan)
    _validate_input_plan(projected, "pending")
    _require(plan["status"] == "ready", "invalid_schema", "Frozen deployment plan status must be ready.")
    _validate_source_manifest(plan["sourceManifest"])
    artifact = plan["artifact"]
    _require_exact_keys(
        artifact,
        (
            "createdAt",
            "operationSheetSha256",
            "allowedDeltaSha256",
            "executorSha256",
            "sourceManifestSha256",
            "targetImageConfigDigest",
            "targetComposeSha256",
            "maximumExpandedBytes",
            "bundleMembers",
        ),
        "plan.artifact",
    )
    _require_string(artifact["createdAt"], "plan.artifact.createdAt", 1, 128)
    for key in (
        "operationSheetSha256",
        "allowedDeltaSha256",
        "executorSha256",
        "sourceManifestSha256",
        "targetComposeSha256",
    ):
        _require_sha(artifact[key], "plan.artifact." + key)
    _require_image_digest(artifact["targetImageConfigDigest"], "plan.artifact.targetImageConfigDigest")
    _require_int(
        artifact["maximumExpandedBytes"],
        "plan.artifact.maximumExpandedBytes",
        1,
        MAX_BUNDLE_MEMBER_BYTES,
    )
    members = _require_string_list(artifact["bundleMembers"], "plan.artifact.bundleMembers")
    _require(sorted(members) == sorted(BUNDLE_MEMBERS), "invalid_schema", "Frozen bundle member list is invalid.")
    _require(
        artifact["sourceManifestSha256"] == _sha256_json(plan["sourceManifest"]),
        "hash_mismatch",
        "Frozen source manifest hash does not match its content.",
    )
    return copy.deepcopy(plan)


def _validate_delta(delta, plan):
    _require_exact_keys(
        delta,
        (
            "schemaVersion",
            "verifier",
            "newMigrationFiles",
            "newCollections",
            "newSchemaObjects",
            "emptyTables",
        ) + (("contextEvolution",) if delta.get("verifier") == CONTEXT_VERIFIER else ()),
        "allowed-delta",
    )
    _require(delta["schemaVersion"] == DELTA_SCHEMA, "invalid_schema", "Allowed delta schemaVersion must be 1.")
    _require(delta["verifier"] in (DELTA_VERIFIER, CONTEXT_VERIFIER) and delta["verifier"] == plan["migration"]["verifier"], "invalid_schema", "Allowed delta verifier is unsupported or mismatched.")
    if delta["verifier"] == CONTEXT_VERIFIER:
        _require(_canonical_bytes(delta["contextEvolution"]) == _canonical_bytes(CONTEXT_EVOLUTION)
                 and delta["newMigrationFiles"] == [CONTEXT_MIGRATION]
                 and delta["newCollections"] == [] and delta["newSchemaObjects"] == [] and delta["emptyTables"] == [],
                 "invalid_schema", "Context evolution cannot permit any additional schema or migration change.")
    new_files = _require_string_list(delta["newMigrationFiles"], "allowed-delta.newMigrationFiles", _migration_name)
    _require(new_files == plan["migration"]["newFiles"], "invalid_schema", "Allowed delta migrations do not match the plan.")
    _require(isinstance(delta["newCollections"], list), "invalid_schema", "allowed-delta.newCollections must be an array.")
    collection_names = []
    for index, item in enumerate(delta["newCollections"]):
        label = "allowed-delta.newCollections[%d]" % index
        _require_exact_keys(item, ("name", "requirePrivate"), label)
        name = _require_string(item["name"], label + ".name", 1, 255)
        _require(bool(SQLITE_NAME_RE.match(name)), "invalid_schema", label + ".name is not a safe SQLite name.")
        _require_bool(item["requirePrivate"], label + ".requirePrivate")
        _require(item["requirePrivate"] is True, "invalid_schema", label + ".requirePrivate must be true.")
        collection_names.append(name)
    _require(collection_names == sorted(collection_names), "invalid_schema", "New collections must be sorted.")
    _require(len(collection_names) == len(set(collection_names)), "invalid_schema", "New collections contain duplicates.")
    _require(isinstance(delta["newSchemaObjects"], list), "invalid_schema", "allowed-delta.newSchemaObjects must be an array.")
    schema_keys = []
    for index, item in enumerate(delta["newSchemaObjects"]):
        label = "allowed-delta.newSchemaObjects[%d]" % index
        _require_exact_keys(item, ("type", "name", "table"), label)
        _require(item["type"] in ("table", "index", "trigger", "view"), "invalid_schema", label + ".type is invalid.")
        name = _require_string(item["name"], label + ".name", 1, 255)
        table = _require_string(item["table"], label + ".table", 1, 255)
        _require(bool(SQLITE_NAME_RE.match(name)), "invalid_schema", label + ".name is not a safe SQLite name.")
        _require(bool(SQLITE_NAME_RE.match(table)), "invalid_schema", label + ".table is not a safe SQLite name.")
        schema_keys.append((item["type"], item["name"]))
    _require(schema_keys == sorted(schema_keys), "invalid_schema", "New schema objects must be sorted by type and name.")
    _require(len(schema_keys) == len(set(schema_keys)), "invalid_schema", "New schema objects contain duplicates.")
    empty_tables = _require_string_list(
        delta["emptyTables"],
        "allowed-delta.emptyTables",
        lambda value, label: _require(bool(SQLITE_NAME_RE.match(value)), "invalid_schema", label + " is not a safe SQLite name."),
    )
    _require(empty_tables == sorted(empty_tables), "invalid_schema", "Empty tables must be sorted.")
    declared_tables = set(
        item["name"] for item in delta["newSchemaObjects"] if item["type"] == "table"
    )
    for item in delta["newSchemaObjects"]:
        if item["type"] == "table":
            _require(item["name"] == item["table"], "invalid_schema", "A declared table must name itself as its table.")
        _require(item["table"] in empty_tables, "invalid_schema", "Every new schema object must target a required-empty table.")
    for table in empty_tables:
        _require(table in declared_tables, "invalid_schema", "Every required-empty table must be explicitly declared.")
    for collection in collection_names:
        _require(
            collection in declared_tables and collection in empty_tables,
            "invalid_schema",
            "Every new collection must have a declared required-empty table.",
        )
    _require(
        set(collection_names) == declared_tables == set(empty_tables),
        "invalid_schema",
        "Every declared table must be exactly one reviewed private collection table.",
    )
    if plan["migration"]["mode"] == "none":
        _require(
            not new_files and not collection_names and not schema_keys and not empty_tables,
            "invalid_schema",
            "No-migration releases require an empty allowed delta.",
        )
    elif delta["verifier"] == DELTA_VERIFIER:
        _require(bool(collection_names), "invalid_schema", "A required additive migration must declare a new private collection.")
    return copy.deepcopy(delta)


def _validate_bundle(bundle):
    _require_exact_keys(bundle, ("fileName", "sha256", "size"), "bundle")
    name = _require_string(bundle["fileName"], "bundle.fileName", 1, 255)
    _require(bool(SAFE_FILE_RE.match(name)), "invalid_schema", "bundle.fileName contains unsafe characters.")
    _require(name not in (".", ".."), "invalid_schema", "bundle.fileName is invalid.")
    _require_sha(bundle["sha256"], "bundle.sha256")
    _require_int(bundle["size"], "bundle.size", 1, MAX_BUNDLE_MEMBER_BYTES)
    return copy.deepcopy(bundle)


def _read_json_file(path, maximum=MAX_JSON_BYTES):
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode), "unsafe_path", "Expected a regular JSON file.")
    _require(st.st_size <= maximum, "file_too_large", "JSON file exceeds its size limit.")
    with open(path, "rb") as handle:
        raw = handle.read(maximum + 1)
    _require(len(raw) <= maximum, "file_too_large", "JSON file exceeds its size limit.")
    try:
        return _json_loads_strict(raw.decode("utf-8")), raw
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_json", "A required JSON file is invalid.")


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write_bytes(path, payload, mode=0o600, require_absent=False):
    parent = os.path.dirname(path)
    _require(parent and os.path.isdir(parent), "unsafe_path", "Atomic write parent does not exist.")
    if os.path.lexists(path):
        _require(not require_absent, "already_exists", "Refusing to overwrite an existing release artifact.")
        _require(not os.path.islink(path), "unsafe_path", "Refusing to replace a symbolic link.")
    temporary = os.path.join(parent, ".%s.tmp.%s" % (os.path.basename(path), secrets.token_hex(12)))
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(temporary, flags, mode)
    try:
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fsync(descriptor)
        os.fchmod(descriptor, mode)
    finally:
        os.close(descriptor)
    try:
        if require_absent:
            # `exists(); replace()` is not an exclusive create: two workers can
            # both pass the check and the later rename silently wins. A hard
            # link publishes the already-fsynced inode atomically and fails
            # with EEXIST when another worker won the name first.
            try:
                os.link(temporary, path)
            except FileExistsError:
                raise ReleaseError(
                    "already_exists",
                    "Refusing to overwrite an existing release artifact.",
                )
            _fsync_directory(parent)
            os.unlink(temporary)
            _fsync_directory(parent)
        else:
            os.replace(temporary, path)
            _fsync_directory(parent)
    except Exception:
        try:
            if os.path.lexists(temporary):
                os.unlink(temporary)
        except OSError:
            pass
        raise


def _atomic_write_json(path, value, mode=0o600, require_absent=False):
    _atomic_write_bytes(path, _canonical_bytes(value) + b"\n", mode, require_absent)


def _mkdir_private(path, parents=False):
    if parents:
        current = os.path.sep
        for part in path.strip(os.path.sep).split(os.path.sep):
            current = os.path.join(current, part)
            if os.path.lexists(current):
                _require(os.path.isdir(current) and not os.path.islink(current), "unsafe_path", "A private path component is unsafe.")
            else:
                os.mkdir(current, 0o700)
                _fsync_directory(os.path.dirname(current) or os.path.sep)
    else:
        os.mkdir(path, 0o700)
        _fsync_directory(os.path.dirname(path))
    os.chmod(path, 0o700)


def _secure_directory_chain(path, label, require_private_leaf=False):
    """Require a root-owned, non-link path with no writable ancestors."""
    _require(os.path.isabs(path) and os.path.normpath(path) == path, "unsafe_path", label + " is not normalized.")
    current = os.path.sep
    parts = path.strip(os.path.sep).split(os.path.sep)
    for index, part in enumerate(parts):
        current = os.path.join(current, part)
        if not os.path.lexists(current):
            return False
        st = os.lstat(current)
        _require(
            stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode),
            "unsafe_path",
            label + " contains a non-directory or symbolic-link component.",
        )
        _require(st.st_uid == 0, "unsafe_path", label + " contains a directory not owned by root.")
        _require(
            stat.S_IMODE(st.st_mode) & 0o022 == 0,
            "unsafe_path",
            label + " contains a group- or world-writable directory.",
        )
        if require_private_leaf and index == len(parts) - 1:
            _require(
                stat.S_IMODE(st.st_mode) & 0o077 == 0,
                "unsafe_path",
                label + " must be private to root.",
            )
    _require(os.path.realpath(path) == path, "unsafe_path", label + " resolves through an unexpected path.")
    return True


def _ensure_private_root_directory(path, label):
    _require(os.geteuid() == 0, "permission_denied", label + " can only be prepared by root.")
    current = os.path.sep
    for part in path.strip(os.path.sep).split(os.path.sep):
        current = os.path.join(current, part)
        if os.path.lexists(current):
            _secure_directory_chain(current, label)
        else:
            try:
                os.mkdir(current, 0o700)
                _fsync_directory(os.path.dirname(current) or os.path.sep)
            except FileExistsError:
                # A competing release may create the fixed lock root first;
                # validate the winning inode instead of treating this as safe.
                pass
            _secure_directory_chain(current, label)
    st = os.lstat(path)
    _require(st.st_uid == 0, "unsafe_path", label + " must be owned by root.")
    os.chmod(path, 0o700)
    _secure_directory_chain(path, label, require_private_leaf=True)
    return path


def _require_private_root_file(path, label, expected_sha256=None):
    _secure_directory_chain(os.path.dirname(path), label + " parent", require_private_leaf=True)
    st = os.lstat(path)
    _require(
        stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode),
        "unsafe_path",
        label + " must be a regular non-link file.",
    )
    _require(st.st_uid == 0, "unsafe_path", label + " must be owned by root.")
    _require(stat.S_IMODE(st.st_mode) & 0o077 == 0, "unsafe_path", label + " must be private to root.")
    if expected_sha256 is not None:
        _require(_sha256_file(path) == expected_sha256, "hash_mismatch", label + " hash differs from the frozen plan.")
    return st


def _require_trusted_production_paths(plan):
    """Reject lexical aliases and writable path ancestors before production use."""
    production = plan["production"]
    for key in ("projectDirectory", "dataHostPath"):
        path = production[key]
        _require(
            _secure_directory_chain(path, "plan.production." + key),
            "path_mismatch",
            "A required production directory is missing.",
        )
    for key in ("composePath", "rootReleasePath", "rootChecksumsPath"):
        path = production[key]
        _secure_directory_chain(os.path.dirname(path), "plan.production." + key + " parent")
        _require(
            os.path.lexists(path) and os.path.realpath(path) == path,
            "path_mismatch",
            "A production metadata path is missing or resolves through an alias.",
        )
        st = os.lstat(path)
        _require(
            stat.S_ISREG(st.st_mode)
            and not stat.S_ISLNK(st.st_mode)
            and st.st_uid == 0
            and stat.S_IMODE(st.st_mode) & 0o022 == 0,
            "unsafe_path",
            "Production metadata must be a root-owned regular file that is not group- or world-writable.",
        )
    if production.get("pushRuntime"):
        secret_stat = _require_private_root_file(PUSH_SECRET_HOST, "Existing Push secret")
        _require(stat.S_IMODE(secret_stat.st_mode) == 0o600 and secret_stat.st_nlink == 1,
                 "unsafe_path", "Existing Push secret must remain a single-link root-only file.")
    database_path = os.path.join(
        production["dataHostPath"],
        production["databaseRelativePath"],
    )
    _require(
        os.path.lexists(database_path) and os.path.realpath(database_path) == database_path,
        "database_missing",
        "Production database is missing or resolves through an alias.",
    )
    database_stat = os.lstat(database_path)
    _require(
        stat.S_ISREG(database_stat.st_mode)
        and not stat.S_ISLNK(database_stat.st_mode)
        and database_stat.st_uid == 0
        and stat.S_IMODE(database_stat.st_mode) & 0o022 == 0,
        "unsafe_path",
        "Production database must be a root-owned regular file that is not group- or world-writable.",
    )
    return True


@contextlib.contextmanager
def _file_lock(path, exclusive=True):
    parent = os.path.dirname(path)
    _require(os.path.isdir(parent), "unsafe_path", "Lock parent directory does not exist.")
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    try:
        opened = os.fstat(descriptor)
        _require(stat.S_ISREG(opened.st_mode) and opened.st_uid == 0, "unsafe_path", "Lock file is unsafe.")
        os.fchmod(descriptor, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield
    finally:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
        finally:
            os.close(descriptor)


def _safe_unlink(path):
    if not os.path.lexists(path):
        return
    _require(not os.path.islink(path), "unsafe_path", "Refusing to unlink a symbolic link marker.")
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode), "unsafe_path", "Refusing to unlink a non-file marker.")
    os.unlink(path)
    _fsync_directory(os.path.dirname(path))


def _decode_output(value, maximum=8192):
    if value is None:
        return ""
    if not isinstance(value, bytes):
        value = str(value).encode("utf-8", "replace")
    value = value[:maximum]
    return value.decode("utf-8", "replace").strip()


def _run(argv, timeout=60, ok_codes=(0,), maximum_output=MAX_COMMAND_OUTPUT, unknown_on_timeout=False):
    _require(isinstance(argv, list) and argv, "internal_error", "Subprocess argv must be a non-empty list.")
    for item in argv:
        _require(isinstance(item, str) and "\x00" not in item, "internal_error", "Subprocess argv is invalid.")
    lowered = [item.lower() for item in argv]
    _require("--force" not in lowered and "down" not in lowered, "forbidden_command", "A forbidden command token was requested.")
    process = subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        close_fds=True,
        start_new_session=True,
    )
    stdout_buffer = bytearray()
    stderr_buffer = bytearray()
    overflow = []
    reader_errors = []
    termination_requested = threading.Event()

    def kill_process_group():
        termination_requested.set()
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            try:
                process.kill()
            except OSError:
                pass

    def drain(stream, destination, label):
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    return
                if len(destination) + len(chunk) > maximum_output:
                    overflow.append(label)
                    kill_process_group()
                    return
                destination.extend(chunk)
        except Exception as exc:
            if not termination_requested.is_set():
                reader_errors.append(exc)
            kill_process_group()

    readers = [
        threading.Thread(target=drain, args=(process.stdout, stdout_buffer, "stdout")),
        threading.Thread(target=drain, args=(process.stderr, stderr_buffer, "stderr")),
    ]
    for reader in readers:
        reader.daemon = True
        reader.start()
    timed_out = False
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_process_group()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            reader_errors.append(RuntimeError("subprocess group did not terminate"))
    reader_grace = min(max(float(timeout) * 0.1, 1.0), 5.0)
    for reader in readers:
        reader.join(reader_grace)
    if any(reader.is_alive() for reader in readers):
        # A descendant retained an inherited pipe after the direct child
        # exited. Treat this as an observation timeout, kill the whole session,
        # then close our descriptors so reader cleanup itself stays bounded.
        timed_out = True
        kill_process_group()
        for stream in (process.stdout, process.stderr):
            try:
                os.close(stream.fileno())
            except OSError:
                pass
        for reader in readers:
            reader.join(1.0)
        if any(reader.is_alive() for reader in readers):
            reader_errors.append(RuntimeError("subprocess output reader did not terminate"))
    stdout = bytes(stdout_buffer)
    stderr = bytes(stderr_buffer)
    if timed_out:
        details = {"program": os.path.basename(argv[0]), "timeoutSeconds": timeout}
        if unknown_on_timeout:
            raise ResultUnknown("A mutating command exceeded its observation timeout.", details)
        raise ReleaseError("command_timeout", "A read-only or reversible command timed out.", details)
    if overflow:
        details = {"program": os.path.basename(argv[0]), "stream": overflow[0], "maximumBytes": maximum_output}
        if unknown_on_timeout:
            raise ResultUnknown("A mutating command exceeded its bounded output budget.", details)
        raise ReleaseError("command_output_too_large", "A command produced unexpectedly large output.", details)
    if reader_errors:
        raise ReleaseError("command_output_failed", "A command output stream could not be read safely.")
    if process.returncode not in ok_codes:
        raise ReleaseError(
            "command_failed",
            "A required command failed.",
            {
                "program": os.path.basename(argv[0]),
                "exitCode": process.returncode,
                "stderrSha256": _sha256_bytes(stderr),
            },
        )
    return stdout, stderr, process.returncode


def _docker_json(args, timeout=60):
    stdout, _stderr, _code = _run(["docker"] + list(args), timeout=timeout)
    try:
        return _json_loads_strict(stdout.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_command_output", "Docker returned invalid JSON.")


def _compose_command(plan, compose_path, args):
    project = plan["production"]["projectDirectory"]
    return [
        "docker",
        "compose",
        "--project-directory",
        project,
        "--env-file",
        "/dev/null",
        "-f",
        compose_path,
    ] + list(args)


def _compose_config(plan, compose_path):
    stdout, _stderr, _code = _run(
        _compose_command(plan, compose_path, ["config", "--format", "json"]),
        timeout=60,
    )
    try:
        config = _json_loads_strict(stdout.decode("utf-8"))
        _verify_compose_push_contract(plan, config)
        return config
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_compose", "Docker Compose returned invalid configuration JSON.")


def _path_facts(path, include_hash=True):
    result = {"path": path, "exists": os.path.lexists(path)}
    if not result["exists"]:
        return result
    st = os.lstat(path)
    result.update(
        {
            "mode": stat.S_IMODE(st.st_mode),
            "uid": st.st_uid,
            "gid": st.st_gid,
            "size": st.st_size,
            "isSymlink": stat.S_ISLNK(st.st_mode),
            "type": (
                "file"
                if stat.S_ISREG(st.st_mode)
                else "directory"
                if stat.S_ISDIR(st.st_mode)
                else "other"
            ),
        }
    )
    if include_hash and stat.S_ISREG(st.st_mode) and st.st_size <= MAX_JSON_BYTES:
        result["sha256"] = _sha256_file(path)
    return result


def _nearest_existing_directory(path):
    current = path
    while not os.path.exists(current):
        parent = os.path.dirname(current)
        _require(parent != current, "unsafe_path", "No existing ancestor for a planned directory.")
        current = parent
    _require(os.path.isdir(current), "unsafe_path", "The nearest existing ancestor is not a directory.")
    return current


def _free_bytes(path):
    existing = _nearest_existing_directory(path)
    values = os.statvfs(existing)
    return values.f_bavail * values.f_frsize


def _space_budget(plan, allocations):
    """Aggregate projected writes by filesystem and preserve a hard reserve."""
    reserve = plan["server"]["minimumFreeBytes"]
    groups = {}
    for label, path, projected_bytes in allocations:
        _require(
            isinstance(projected_bytes, int)
            and not isinstance(projected_bytes, bool)
            and projected_bytes >= 0,
            "internal_error",
            "A release space projection is invalid.",
        )
        existing = _nearest_existing_directory(path)
        device = os.stat(existing).st_dev
        values = os.statvfs(existing)
        free = values.f_bavail * values.f_frsize
        group = groups.setdefault(
            device,
            {
                "device": str(device),
                "freeBytes": free,
                "reserveBytes": reserve,
                "projectedWriteBytes": 0,
                "labels": [],
            },
        )
        group["freeBytes"] = min(group["freeBytes"], free)
        group["projectedWriteBytes"] += projected_bytes
        group["labels"].append(label)
    result = []
    for device in sorted(groups):
        group = groups[device]
        group["labels"] = sorted(group["labels"])
        group["requiredFreeBytes"] = (
            group["reserveBytes"] + group["projectedWriteBytes"]
        )
        _require(
            group["freeBytes"] >= group["requiredFreeBytes"],
            "insufficient_space",
            "A release filesystem lacks projected write space plus the frozen reserve.",
            group,
        )
        result.append(group)
    return result


def _docker_root_path():
    stdout, _stderr, _code = _run(
        ["docker", "info", "--format", "{{json .DockerRootDir}}"],
        timeout=30,
    )
    try:
        value = _json_loads_strict(stdout.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_command_output", "Docker returned an invalid data-root path.")
    _require_absolute_path(value, "Docker data-root")
    _require(
        os.path.isdir(value) and not os.path.islink(value),
        "unsafe_path",
        "Docker data-root is missing or unsafe.",
    )
    return value


def _estimate_tree_logical_usage(path):
    total = 0
    entries = 0
    _require(os.path.isdir(path) and not os.path.islink(path), "unsafe_backup_source", "Production data directory is unsafe.")
    for current, directories, files in os.walk(path, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        entries += 1
        for name in directories:
            item = os.path.join(current, name)
            _require(not os.path.islink(item), "unsafe_backup_source", "Production data contains a symbolic-link directory.")
        for name in files:
            item = os.path.join(current, name)
            st = os.lstat(item)
            _require(stat.S_ISREG(st.st_mode), "unsafe_backup_source", "Production data contains a non-regular file.")
            total += st.st_size
            entries += 1
    return total, entries


def _backup_projected_write_bytes(source_bytes, entry_count):
    # Worst-case incompressible archive + full restore + one full-size SQLite
    # migration/WAL working allowance, plus tar headers and fixed metadata.
    overhead = 16 * 1024 * 1024 + max(entry_count, 1) * 4096
    return source_bytes * 3 + overhead


def _base_space_allocations(plan):
    return [
        (key, plan["server"][key], 0)
        for key in ("releaseRoot", "backupRoot", "uploadRoot")
    ]


def _pre_stage_space_allocations(plan, bundle, bundle_already_present=False):
    allocations = _base_space_allocations(plan)
    if not bundle_already_present:
        allocations.append(("uploadedBundle", plan["server"]["uploadRoot"], bundle["size"]))
    expanded = plan["artifact"]["maximumExpandedBytes"]
    allocations.extend(
        [
            ("expandedRelease", plan["server"]["releaseRoot"], expanded),
            # Docker load may retain the archive/layer representation while
            # materializing snapshot content. Budget three times the entire
            # reviewed package expansion, which is deliberately larger than
            # the image archive alone.
            ("dockerImageImport", _docker_root_path(), expanded * 3),
        ]
    )
    data_bytes, data_entries = _estimate_tree_logical_usage(
        plan["production"]["dataHostPath"]
    )
    allocations.append(
        (
            "backupArchiveRestoreAndMigration",
            plan["server"]["backupRoot"],
            _backup_projected_write_bytes(data_bytes, data_entries),
        )
    )
    return allocations


def _machine_id_sha256():
    with open("/etc/machine-id", "rb") as handle:
        value = handle.read(4096).strip()
    _require(bool(value), "host_mismatch", "Machine ID is empty.")
    return _sha256_bytes(value)


def _json_digest(value):
    return _sha256_bytes(_canonical_bytes(value))


def _typed_value_bytes(value):
    if value is None:
        tag, payload = b"n", b""
    elif isinstance(value, bytes):
        tag, payload = b"b", value
    elif isinstance(value, str):
        tag, payload = b"s", value.encode("utf-8")
    elif isinstance(value, int):
        tag, payload = b"i", str(value).encode("ascii")
    elif isinstance(value, float):
        tag, payload = b"f", repr(value).encode("ascii")
    else:
        tag, payload = b"x", repr(value).encode("utf-8", "replace")
    return tag + str(len(payload)).encode("ascii") + b":" + payload


def _quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def _table_digest(connection, table, excluded_columns=()):
    info = list(connection.execute("PRAGMA table_info(%s)" % _quote_identifier(table)))
    columns = [row[1] for row in info if row[1] not in excluded_columns]
    _require(bool(columns), "sqlite_schema_error", "A SQLite table has no columns.")
    order_columns = [row[1] for row in sorted(info, key=lambda item: item[5]) if row[5]]
    if not order_columns:
        order_columns = columns
    sql = "SELECT %s FROM %s ORDER BY %s" % (
        ",".join(_quote_identifier(column) for column in columns),
        _quote_identifier(table),
        ",".join(_quote_identifier(column) for column in order_columns),
    )
    digest = hashlib.sha256()
    count = 0
    for row in connection.execute(sql):
        digest.update(b"R")
        for value in row:
            encoded = _typed_value_bytes(value)
            digest.update(str(len(encoded)).encode("ascii") + b":" + encoded)
        count += 1
    return {"rowCount": count, "rowDigest": digest.hexdigest(), "columns": columns}


def _migration_rows(connection):
    info = list(connection.execute("PRAGMA table_info(\"_migrations\")"))
    columns = [row[1] for row in info]
    _require("file" in columns, "migration_ledger_missing", "PocketBase migration ledger has no file column.")
    file_index = columns.index("file")
    result = {}
    sql = "SELECT %s FROM \"_migrations\" ORDER BY file" % ",".join(
        _quote_identifier(column) for column in columns
    )
    for row in connection.execute(sql):
        filename = row[file_index]
        _require(isinstance(filename, str), "migration_ledger_missing", "PocketBase migration ledger contains an invalid filename.")
        _require(filename not in result, "migration_ledger_missing", "PocketBase migration ledger contains duplicate filenames.")
        digest = hashlib.sha256()
        digest.update(b"R")
        for value in row:
            encoded = _typed_value_bytes(value)
            digest.update(str(len(encoded)).encode("ascii") + b":" + encoded)
        result[filename] = digest.hexdigest()
    return result


def _collection_summaries(connection):
    info = list(connection.execute("PRAGMA table_info(\"_collections\")"))
    columns = [row[1] for row in info]
    if not columns:
        return {}
    _require("name" in columns and "type" in columns, "sqlite_schema_error", "PocketBase collections table is missing identity columns.")
    name_index = columns.index("name")
    type_index = columns.index("type")
    rule_indexes = [index for index, name in enumerate(columns) if name.lower().endswith("rule")]
    result = {}
    sql = "SELECT %s FROM \"_collections\" ORDER BY name" % ",".join(_quote_identifier(column) for column in columns)
    for row in connection.execute(sql):
        name = row[name_index]
        _require(isinstance(name, str) and name, "sqlite_schema_error", "PocketBase collection has an invalid name.")
        digest = hashlib.sha256()
        for value in row:
            encoded = _typed_value_bytes(value)
            digest.update(str(len(encoded)).encode("ascii") + b":" + encoded)
        result[name] = {
            "type": row[type_index],
            "private": all(row[index] is None for index in rule_indexes),
            "rowDigest": digest.hexdigest(),
        }
    return result


def _sqlite_stat1_summaries(connection, table_names):
    if "sqlite_stat1" not in table_names:
        return []
    result = []
    seen = set()
    for table_name, index_name, statistic in connection.execute(
        "SELECT tbl,idx,stat FROM sqlite_stat1 ORDER BY tbl,idx"
    ):
        _require(
            isinstance(table_name, str) and table_name,
            "sqlite_schema_error",
            "SQLite statistics contain an invalid table name.",
        )
        _require(
            index_name is None or (isinstance(index_name, str) and index_name),
            "sqlite_schema_error",
            "SQLite statistics contain an invalid index name.",
        )
        key = (table_name, index_name)
        _require(
            key not in seen,
            "sqlite_schema_error",
            "SQLite statistics contain a duplicate table/index key.",
        )
        seen.add(key)
        result.append(
            {
                "table": table_name,
                "index": index_name,
                "statSha256": _sha256_bytes(_typed_value_bytes(statistic)),
            }
        )
    return result


def _context_evolution_summary(connection, table_names):
    """Hash only the reviewed projection; never expose notification/session rows."""
    if CONTEXT_TABLE not in table_names:
        return None
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute("SELECT * FROM _collections WHERE name=?", (CONTEXT_TABLE,)).fetchone()
        _require(row is not None, "sqlite_schema_error", "Context collection metadata is missing.")
        collection = dict(row)
        fields = _json_loads_strict(collection["fields"])
        sessions = [field for field in fields if field.get("name") == "session"]
        kinds = [field for field in fields if field.get("name") == "kind"]
        _require(len(sessions) == 1 and len(kinds) <= 1, "sqlite_schema_error", "Context field identity is ambiguous.")
        session = sessions[0]
        kind = kinds[0] if kinds else None
        if kind is not None:
            expected_kind = {"help": "", "hidden": False, "id": "select1002749145", "maxSelect": 1,
                             "name": "kind", "presentable": False, "required": True, "system": False,
                             "type": "select", "values": ["session", "account"]}
            valid_fields = kind == expected_kind and fields[-1] == kind and session.get("required") is False
        else:
            valid_fields = session.get("required") is True
        normalized_fields = [copy.deepcopy(field) for field in fields if field.get("name") != "kind"]
        for field in normalized_fields:
            if field.get("name") == "session":
                field["required"] = True
        collection["fields"] = normalized_fields
        updated = collection.pop("updated")
        sql = connection.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (CONTEXT_TABLE,)).fetchone()[0]
        columns = [list(item) for item in connection.execute("PRAGMA table_info(%s)" % _quote_identifier(CONTEXT_TABLE))]
        missing_session = connection.execute("SELECT COUNT(*) FROM game_push_notice_contexts WHERE session='' OR session IS NULL").fetchone()[0]
        invalid_kind = connection.execute("SELECT COUNT(*) FROM game_push_notice_contexts WHERE kind IS NULL OR kind!='session'").fetchone()[0] if kind else 0
        return {"hasKind": kind is not None, "validFields": valid_fields,
                "normalizedCollectionSha256": _sha256_json(collection), "updated": updated,
                "columnInfo": columns, "legacyRows": _table_digest(connection, CONTEXT_TABLE, ("kind",)),
                "missingSessionCount": missing_session, "nonSessionKindCount": invalid_kind,
                "expectedAddedKindSqlSha256": _sha256_bytes((sql[:-1] + ', "kind" TEXT DEFAULT \'\' NOT NULL)').encode("utf-8")) if kind is None and sql.endswith(")") else None}
    finally:
        connection.row_factory = None


def _sqlite_summary(database_path):
    _require(os.path.isfile(database_path) and not os.path.islink(database_path), "database_missing", "The PocketBase database file is missing or unsafe.")
    uri = "file:%s?mode=ro" % urllib.parse.quote(os.path.abspath(database_path), safe="/")
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=10)
    except sqlite3.Error:
        raise ReleaseError("sqlite_open_failed", "The production SQLite database could not be opened read-only.")
    try:
        connection.execute("PRAGMA query_only=ON")
        integrity = [row[0] for row in connection.execute("PRAGMA integrity_check")]
        _require(integrity == ["ok"], "sqlite_integrity_failed", "SQLite integrity_check failed.", {"resultSha256": _sha256_json(integrity)})
        objects = []
        for object_type, name, table_name, sql in connection.execute(
            "SELECT type,name,tbl_name,COALESCE(sql,'') FROM sqlite_master "
            "WHERE type IN ('table','index','trigger','view') ORDER BY type,name"
        ):
            objects.append(
                {
                    "type": object_type,
                    "name": name,
                    "table": table_name,
                    "sqlSha256": _sha256_bytes(sql.encode("utf-8")),
                }
            )
        tables = {}
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        for table in table_names:
            tables[table] = _table_digest(connection, table)
        ledger = tables.get("_migrations")
        _require(ledger is not None, "migration_ledger_missing", "PocketBase migration ledger is missing.")
        migration_rows = _migration_rows(connection)
        result = {
            "algorithm": "typed-length-prefixed-sha256-v1",
            "integrity": "ok",
            "schemaObjects": objects,
            "schemaDigest": _sha256_json(objects),
            "tables": tables,
            "migrationLedgerSha256": ledger["rowDigest"],
            "migrationFiles": sorted(migration_rows),
            "migrationRows": migration_rows,
            "collections": _collection_summaries(connection),
            "sqliteStat1": _sqlite_stat1_summaries(connection, table_names),
            "contextEvolution": _context_evolution_summary(connection, table_names),
        }
        result["summarySha256"] = _sha256_json(result)
        return result
    except sqlite3.Error:
        raise ReleaseError("sqlite_query_failed", "A read-only SQLite verification query failed.")
    finally:
        connection.close()


def _parse_checksum_file(path, expected_names, exact=True):
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode), "unsafe_path", "Checksum manifest must be a regular file.")
    _require(st.st_size <= 1024 * 1024, "file_too_large", "Checksum manifest is too large.")
    with open(path, "rb") as handle:
        raw = handle.read(1024 * 1024 + 1)
    try:
        text_value = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ReleaseError("invalid_checksums", "Checksum manifest is not UTF-8.")
    _require(text_value.endswith("\n"), "invalid_checksums", "Checksum manifest must end with a newline.")
    result = {}
    for line in text_value.splitlines():
        _require(line and "  " in line, "invalid_checksums", "Checksum manifest has an invalid line.")
        digest, name = line.split("  ", 1)
        _require(bool(SHA256_RE.match(digest)), "invalid_checksums", "Checksum manifest has an invalid digest.")
        _require(bool(SAFE_FILE_RE.match(name)), "invalid_checksums", "Checksum manifest contains an unsafe filename.")
        if exact:
            _require(name in expected_names, "invalid_checksums", "Checksum manifest contains an unexpected filename.")
        _require(name not in result, "invalid_checksums", "Checksum manifest contains a duplicate filename.")
        result[name] = digest
    if exact:
        _require(set(result.keys()) == set(expected_names), "invalid_checksums", "Checksum manifest member set is incomplete.")
    else:
        _require(set(expected_names).issubset(set(result.keys())), "invalid_checksums", "Checksum manifest is missing a required filename.")
    return result


def _safe_tar_members(archive, allowed_names, maximum_total=MAX_BUNDLE_MEMBER_BYTES):
    members = archive.getmembers()
    names = []
    total = 0
    for member in members:
        name = member.name.replace("\\", "/")
        _require(name == member.name, "unsafe_archive", "Archive member uses a non-portable path.")
        _require_relative_path(name, "archive member")
        _require(name in allowed_names, "unsafe_archive", "Archive contains an unexpected member.")
        _require(member.isfile(), "unsafe_archive", "Release archives may contain only regular files.")
        _require(not member.issym() and not member.islnk(), "unsafe_archive", "Release archive links are forbidden.")
        _require(member.size >= 0, "unsafe_archive", "Archive member size is invalid.")
        total += member.size
        _require(total <= maximum_total, "file_too_large", "Release archive expands beyond its limit.")
        names.append(name)
    _require(len(names) == len(set(names)), "unsafe_archive", "Archive contains duplicate members.")
    _require(set(names) == set(allowed_names), "unsafe_archive", "Release archive member set is incomplete.")
    return members


def _extract_release_bundle(archive_path, destination, maximum_expanded_bytes):
    _require(os.path.isdir(destination) and not os.path.islink(destination), "unsafe_path", "Release extraction directory is unsafe.")
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = _safe_tar_members(
                archive,
                BUNDLE_MEMBERS,
                maximum_total=maximum_expanded_bytes,
            )
            for member in members:
                source = archive.extractfile(member)
                _require(source is not None, "unsafe_archive", "Archive member could not be read.")
                target = os.path.join(destination, member.name)
                descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    remaining = member.size
                    while remaining:
                        chunk = source.read(min(1024 * 1024, remaining))
                        _require(bool(chunk), "unsafe_archive", "Archive member ended early.")
                        os.write(descriptor, chunk)
                        remaining -= len(chunk)
                    _require(not source.read(1), "unsafe_archive", "Archive member exceeds its declared size.")
                    os.fsync(descriptor)
                    os.fchmod(descriptor, 0o600)
                finally:
                    os.close(descriptor)
    except (tarfile.TarError, OSError) as exc:
        if isinstance(exc, ReleaseError):
            raise
        raise ReleaseError("invalid_archive", "Release bundle could not be safely extracted.")
    _fsync_directory(destination)


def _inspect_docker_save_archive(path, target_tag, expected_config_digest):
    try:
        with tarfile.open(path, "r:") as archive:
            members = archive.getmembers()
            safe = {}
            for member in members:
                original_name = member.name.replace("\\", "/")
                _require(original_name == member.name, "unsafe_image_archive", "Docker image archive path is not portable.")
                name = original_name.rstrip("/") if member.isdir() else original_name
                _require_relative_path(name, "docker image archive member")
                _require(not member.issym() and not member.islnk(), "unsafe_image_archive", "Docker image archive links are forbidden.")
                _require(member.isfile() or member.isdir(), "unsafe_image_archive", "Docker image archive has an unsafe member type.")
                _require(name not in safe, "unsafe_image_archive", "Docker image archive contains duplicate members.")
                safe[name] = member
            _require("manifest.json" in safe and safe["manifest.json"].isfile(), "invalid_image_archive", "Docker image manifest.json is missing.")
            manifest_source = archive.extractfile(safe["manifest.json"])
            manifest_raw = manifest_source.read(MAX_JSON_BYTES + 1)
            _require(len(manifest_raw) <= MAX_JSON_BYTES, "file_too_large", "Docker image manifest is too large.")
            try:
                manifest = _json_loads_strict(manifest_raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ReleaseError("invalid_image_archive", "Docker image manifest is invalid.")
            _require(isinstance(manifest, list) and len(manifest) == 1, "invalid_image_archive", "Expected exactly one image in the archive.")
            entry = manifest[0]
            _require(isinstance(entry, dict), "invalid_image_archive", "Docker image manifest entry is invalid.")
            config_name = entry.get("Config")
            _require(isinstance(config_name, str) and config_name in safe and safe[config_name].isfile(), "invalid_image_archive", "Docker image config is missing.")
            tags = entry.get("RepoTags")
            _require(isinstance(tags, list) and tags == [target_tag], "invalid_image_archive", "Docker archive contains an unexpected tag set.")
            config_source = archive.extractfile(safe[config_name])
            config_raw = config_source.read(MAX_JSON_BYTES + 1)
            _require(len(config_raw) <= MAX_JSON_BYTES, "file_too_large", "Docker image config is too large.")
            actual_digest = "sha256:" + _sha256_bytes(config_raw)
            _require(actual_digest == expected_config_digest, "hash_mismatch", "Docker archive config digest does not match the plan.")
            try:
                config = _json_loads_strict(config_raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ReleaseError("invalid_image_archive", "Docker image config JSON is invalid.")
            architecture = config.get("architecture") or config.get("Architecture")
            operating_system = config.get("os") or config.get("Os")
            _require(architecture == "amd64" and operating_system == "linux", "image_platform_mismatch", "Docker image is not Linux AMD64.")
            _require_image_runtime_config(config.get("config") or config.get("Config"))
            layers = entry.get("Layers")
            _require(isinstance(layers, list) and layers, "invalid_image_archive", "Docker image has no layers.")
            for layer in layers:
                _require(isinstance(layer, str) and layer in safe and safe[layer].isfile(), "invalid_image_archive", "Docker image layer is missing.")
            return {"configDigest": actual_digest, "layerCount": len(layers)}
    except (tarfile.TarError, OSError):
        raise ReleaseError("invalid_image_archive", "Docker image archive could not be inspected safely.")


def _docker_inspect_container(name):
    value = _docker_json(["container", "inspect", name], timeout=60)
    _require(isinstance(value, list) and len(value) == 1, "container_mismatch", "Target container inspect result is invalid.")
    return value[0]


def _docker_inspect_image(tag):
    value = _docker_json(["image", "inspect", tag], timeout=60)
    _require(isinstance(value, list) and len(value) == 1, "image_mismatch", "Target image inspect result is invalid.")
    return value[0]


def _require_image_runtime_config(config):
    _require(isinstance(config, dict) and not [item for item in config.get("Env", []) if item.startswith("STARWARD_PUSH_")],
             "image_mismatch", "Runtime image must not bake in Push environment; production configuration is explicitly preserved only by Compose.")
    expected_command = [
        "serve",
        "--http=0.0.0.0:8090",
        "--dir=/pb/pb_data",
        "--hooksDir=/pb/pb_hooks",
        "--migrationsDir=/pb/pb_migrations",
        "--automigrate=false",
    ]
    _require(isinstance(config, dict), "image_mismatch", "Target image runtime config is missing.")
    _require(config.get("Entrypoint") == ["/pb/pocketbase"], "image_mismatch", "Target image entrypoint differs from the reviewed runtime contract.")
    _require(config.get("Cmd") == expected_command, "image_mismatch", "Target image command differs from the reviewed runtime contract.")
    _require(config.get("WorkingDir") == "/pb", "image_mismatch", "Target image working directory differs from the reviewed runtime contract.")
    _require(config.get("User") in (None, "", "0", "root"), "image_mismatch", "Target image user differs from the reviewed runtime contract.")
    _require(config.get("ExposedPorts") == {"8090/tcp": {}}, "image_mismatch", "Target image exposed-port contract differs.")
    _require(not (config.get("Healthcheck") or {}), "image_mismatch", "Target image unexpectedly embeds a healthcheck override.")


def _verify_frozen_target_image(plan):
    """Bind a mutable Docker tag back to the frozen config digest."""
    image = _docker_inspect_image(plan["target"]["imageTag"])
    _require(
        image.get("Id") == plan["artifact"]["targetImageConfigDigest"],
        "image_mismatch",
        "Target image tag no longer points at the frozen image ID.",
    )
    _require(
        image.get("Os") == "linux" and image.get("Architecture") == "amd64",
        "image_platform_mismatch",
        "Target image platform differs from the frozen plan.",
    )
    _require_image_runtime_config(image.get("Config"))
    return image


def _optional_image_id(tag):
    stdout, _stderr, code = _run(
        ["docker", "image", "inspect", tag],
        timeout=60,
        ok_codes=(0, 1),
    )
    if code == 1:
        try:
            missing = _json_loads_strict(stdout.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ReleaseError("docker_inspect_failed", "Docker could not establish that the target image tag is absent.")
        _require(missing == [], "docker_inspect_failed", "Docker could not establish that the target image tag is absent.")
        return None
    try:
        value = _json_loads_strict(stdout.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_command_output", "Docker returned invalid image inspect JSON.")
    _require(isinstance(value, list) and len(value) == 1, "image_mismatch", "Existing target image inspect result is invalid.")
    return value[0].get("Id")


def _container_exists(name):
    stdout, _stderr, _code = _run(
        ["docker", "container", "inspect", name],
        timeout=30,
        ok_codes=(0, 1),
    )
    if not stdout:
        return False
    try:
        value = _json_loads_strict(stdout.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return False
    return isinstance(value, list) and bool(value)


def _push_runtime_environment(push):
    if not push:
        return {}
    return {"STARWARD_PUSH_ENABLED": "1", "STARWARD_PUSH_TEST_MODE": "0",
            "STARWARD_PUSH_SUBSCRIPTION_APPROVED": "0", "STARWARD_PUSH_PROJECT_ID": push["projectId"],
            "STARWARD_PUSH_SERVICE_ACCOUNT_FILE": PUSH_SECRET_CONTAINER}


def _verify_compose_push_contract(plan, config):
    push = plan["production"].get("pushRuntime")
    if not push:
        return
    production = plan["production"]
    service = (config.get("services") or {}).get(production["composeService"]) or {}
    environment = service.get("environment") or {}
    _require(isinstance(environment, dict)
             and {key: value for key, value in environment.items() if key.startswith("STARWARD_PUSH_")} == _push_runtime_environment(push),
             "invalid_compose", "Compose Push environment differs from the existing frozen profile.")
    volumes = service.get("volumes") or []
    expected = [(production["dataHostPath"], production["dataContainerPath"], False),
                (PUSH_SECRET_HOST, PUSH_SECRET_CONTAINER, True)]
    _require(len(volumes) == 2, "invalid_compose", "Compose must retain exactly data and the dedicated read-only Push secret.")
    for source, target, read_only in expected:
        matches = [item for item in volumes if isinstance(item, dict) and item.get("target") == target]
        _require(len(matches) == 1 and matches[0].get("type") == "bind" and matches[0].get("source") == source
                 and matches[0].get("read_only", False) is read_only
                 # Compose versions using Go omitempty drop an explicit false.
                 # Source/candidate raw bytes remain independently SHA-anchored;
                 # only an absent field in an actual bind object equals false.
                 and isinstance(matches[0].get("bind"), dict)
                 and ("create_host_path" not in matches[0]["bind"]
                      or matches[0]["bind"]["create_host_path"] is False),
                 "invalid_compose", "Compose bind source/target/mode/create-host-path differs from its frozen contract.")


def _recorded_source_compose_sha(plan):
    push = plan["production"].get("pushRuntime")
    return push["recordedComposeSha256"] if push else plan["source"]["composeSha256"]


def _container_mount_matches(container, source, destination, push_runtime=None):
    expected_source = os.path.realpath(source)
    all_mounts = container.get("Mounts") or []
    _require(
        len(all_mounts) == (2 if push_runtime else 1),
        "mount_mismatch",
        "Target container has an unexpected extra mount.",
    )
    if push_runtime:
        secret = [item for item in all_mounts if item.get("Destination") == PUSH_SECRET_CONTAINER]
        _require(len(secret) == 1 and secret[0].get("Type") == "bind"
                 and secret[0].get("Source") == PUSH_SECRET_HOST and secret[0].get("RW") is False,
                 "mount_mismatch", "The dedicated Push secret mount must retain its exact source, target and read-only mode.")
    matches = []
    for mount in all_mounts:
        if mount.get("Destination") == destination:
            matches.append(mount)
    _require(len(matches) == 1, "mount_mismatch", "Target container data mount is missing or duplicated.")
    mount = matches[0]
    _require(mount.get("Type") == "bind", "mount_mismatch", "Target data mount is not a bind mount.")
    _require(os.path.realpath(mount.get("Source", "")) == expected_source, "mount_mismatch", "Target data mount source differs from the plan.")
    _require((mount.get("RW") is True if push_runtime else mount.get("RW") is not False), "mount_mismatch", "Target data mount must remain writable.")


def _verify_container_runtime_contract(plan, container):
    """Verify the project-specific runtime and Docker hardening contract."""
    config = container.get("Config") or {}
    host = container.get("HostConfig") or {}
    push = plan["production"].get("pushRuntime")
    environment = config.get("Env") or []
    push_env = [item for item in environment if item.startswith("STARWARD_PUSH_")]
    expected_push = _push_runtime_environment(push)
    _require(len(push_env) == len(expected_push) and sorted(push_env) == sorted(key + "=" + value for key, value in expected_push.items()),
             "container_mismatch", "Push environment differs from the reviewed runtime profile.")
    expected_command = [
        "serve",
        "--http=0.0.0.0:8090",
        "--dir=/pb/pb_data",
        "--hooksDir=/pb/pb_hooks",
        "--migrationsDir=/pb/pb_migrations",
        "--automigrate=false",
    ]
    _require(config.get("Entrypoint") == ["/pb/pocketbase"], "container_mismatch", "Target container entrypoint drifted.")
    _require(config.get("Cmd") == expected_command, "container_mismatch", "Target container command drifted.")
    _require(config.get("WorkingDir") == "/pb", "container_mismatch", "Target container working directory drifted.")
    _require(config.get("User") in (None, "", "0", "root"), "container_mismatch", "Target container runtime user drifted.")
    _require(host.get("Privileged") is False, "container_mismatch", "Target container is unexpectedly privileged.")
    _require(not (host.get("CapAdd") or []), "container_mismatch", "Target container has unexpected added capabilities.")
    _require(sorted(host.get("CapDrop") or []) == ["ALL"], "container_mismatch", "Target container must drop all capabilities.")
    _require(
        sorted(host.get("SecurityOpt") or []) in (["no-new-privileges"], ["no-new-privileges:true"]),
        "container_mismatch",
        "Target container no-new-privileges policy drifted.",
    )
    restart = host.get("RestartPolicy") or {}
    _require(restart.get("Name") == "unless-stopped", "container_mismatch", "Target container restart policy drifted.")
    _require(not host.get("ReadonlyRootfs"), "container_mismatch", "Target container root filesystem mode drifted.")
    _require(not (host.get("Devices") or []), "container_mismatch", "Target container has unexpected devices.")
    _require(host.get("PidMode") not in ("host",), "container_mismatch", "Target container shares the host PID namespace.")
    _require(host.get("IpcMode") not in ("host",), "container_mismatch", "Target container shares the host IPC namespace.")
    networks = (container.get("NetworkSettings") or {}).get("Networks") or {}
    _require(isinstance(networks, dict) and len(networks) == 1, "container_mismatch", "Target container network attachment drifted.")
    labels = config.get("Labels") or {}
    _require(labels.get("com.docker.compose.service") == plan["production"]["composeService"], "container_mismatch", "Target container Compose service label drifted.")
    _require(labels.get("com.docker.compose.oneoff") == "False", "container_mismatch", "Target container is not a normal Compose service container.")
    health = config.get("Healthcheck") or {}
    _require(
        health.get("Test") == [
            "CMD",
            "wget",
            "-q",
            "-O",
            "/dev/null",
            "http://127.0.0.1:8090/api/health",
        ]
        and health.get("Interval") == 15000000000
        and health.get("Timeout") == 5000000000
        and health.get("StartPeriod") == 15000000000
        and health.get("Retries") == 3,
        "container_mismatch",
        "Target container healthcheck drifted.",
    )
    log_config = host.get("LogConfig") or {}
    _require(
        log_config.get("Type") == "json-file"
        and log_config.get("Config") == {"max-file": "3", "max-size": "10m"},
        "container_mismatch",
        "Target container logging policy drifted.",
    )


def _container_port_matches(container, host_ip, host_port, container_port):
    state = container.get("State") or {}
    if state.get("Running"):
        ports = (container.get("NetworkSettings") or {}).get("Ports") or {}
    else:
        # Docker clears NetworkSettings.Ports after a Compose stop even though
        # the reviewed binding remains frozen in HostConfig.PortBindings.
        # Backup and pre-switch gates intentionally inspect the stopped
        # production container, so validate its durable configuration there.
        ports = (container.get("HostConfig") or {}).get("PortBindings") or {}
    key = "%d/tcp" % container_port
    bindings = ports.get(key)
    _require(isinstance(bindings, list) and len(bindings) == 1, "port_mismatch", "Target container port binding is missing or duplicated.")
    binding = bindings[0]
    _require(binding.get("HostIp") == host_ip and binding.get("HostPort") == str(host_port), "port_mismatch", "Target container port binding differs from the plan.")
    unexpected = [name for name, value in ports.items() if name != key and value]
    _require(not unexpected, "port_mismatch", "Target container exposes an unexpected published port.")


def _docker_copy_members(container_name, remote_path, prefix, single_file=False):
    stdout, _stderr, _code = _run(
        ["docker", "cp", container_name + ":" + remote_path, "-"],
        timeout=120,
        maximum_output=MAX_DOCKER_COPY_BYTES,
    )
    files = {}
    try:
        with tarfile.open(fileobj=io.BytesIO(stdout), mode="r:*") as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                name = member.name.replace("\\", "/")
                _require(not name.startswith("/"), "invalid_image_content", "Docker copy archive contains an absolute path.")
                while name.startswith("./"):
                    name = name[2:]
                _require_relative_path(name, "docker copy member")
                if not single_file:
                    base = prefix.rsplit("/", 1)[-1]
                    if name.startswith(base + "/"):
                        name = name[len(base) + 1 :]
                        _require_relative_path(name, "docker copy normalized member")
                source = archive.extractfile(member)
                raw = source.read(MAX_SOURCE_FILE_BYTES + 1)
                _require(len(raw) <= MAX_SOURCE_FILE_BYTES, "file_too_large", "An image source file exceeds its verification limit.")
                mapped = prefix if single_file else prefix + "/" + name
                _require(mapped not in files, "invalid_image_content", "Image source tree contains duplicate paths.")
                files[mapped] = {"size": len(raw), "sha256": _sha256_bytes(raw)}
    except (tarfile.TarError, OSError):
        raise ReleaseError("invalid_image_content", "Image source tree could not be inspected.")
    return files


def _docker_copy_tree(container_name):
    files = {}
    sources = (
        ("/pb/pocketbase", "deploy/runtime/pocketbase", True),
        ("/pb/pb_hooks/.", "pb_hooks", False),
        ("/pb/pb_migrations/.", "pb_migrations", False),
    )
    for remote_path, prefix, single_file in sources:
        partial = _docker_copy_members(container_name, remote_path, prefix, single_file)
        _require(not set(files).intersection(partial), "invalid_image_content", "Image source copy produced duplicate paths.")
        files.update(partial)
    return files


def _verify_image_source_manifest(container_name, source_manifest):
    actual = _docker_copy_tree(container_name)
    verified = []
    build_only = []
    for item in source_manifest["files"]:
        path = item["path"]
        if path == "deploy/Dockerfile":
            build_only.append(path)
            continue
        _require(path in actual, "image_source_mismatch", "A frozen runtime source file is missing from the image.", {"path": path})
        _require(
            actual[path]["size"] == item["size"] and actual[path]["sha256"] == item["sha256"],
            "image_source_mismatch",
            "A frozen runtime source file differs from the image.",
            {"path": path},
        )
        verified.append(path)
    manifest_runtime = set(
        item["path"] for item in source_manifest["files"] if item["path"] != "deploy/Dockerfile"
    )
    actual_relevant = set(actual.keys())
    _require(actual_relevant == manifest_runtime, "image_source_mismatch", "Image runtime source member set differs from the frozen manifest.", {"missingCount": len(manifest_runtime - actual_relevant), "extraCount": len(actual_relevant - manifest_runtime)})
    _require(build_only == ["deploy/Dockerfile"], "image_source_mismatch", "Frozen source manifest must contain the build-only Dockerfile marker exactly once.")
    return {
        "verifiedRuntimeFiles": len(verified),
        "buildOnlyFiles": build_only,
        "runtimeDigest": _sha256_json(sorted((path, actual[path]["size"], actual[path]["sha256"]) for path in actual_relevant)),
    }


def _image_version_with_named_container(image, name, expected_version, timeout):
    _require(not _container_exists(name), "container_name_conflict", "A persistent validation container already exists.", {"container": name})
    _run(
        [
            "docker",
            "create",
            "--name",
            name,
            "--network",
            "none",
            "--platform",
            "linux/amd64",
            image,
            "--version",
        ],
        timeout=timeout,
    )
    stdout, _stderr, _code = _run(["docker", "start", "--attach", name], timeout=timeout, unknown_on_timeout=True)
    version = _decode_output(stdout, 4096)
    _require(version == "pocketbase version " + expected_version, "version_mismatch", "PocketBase runtime version differs from the plan.")
    inspected = _docker_inspect_container(name)
    _require((inspected.get("State") or {}).get("ExitCode") == 0, "version_mismatch", "PocketBase version container did not exit cleanly.")
    return inspected


def _remove_stopped_container(name):
    container = _docker_inspect_container(name)
    _require(not (container.get("State") or {}).get("Running"), "container_cleanup_refused", "Refusing to remove a running validation container.")
    _run(["docker", "container", "rm", name], timeout=60, unknown_on_timeout=True)


def _migration_file_names_from_container(container_name):
    actual = _docker_copy_tree(container_name)
    return sorted(path.split("/", 1)[1] for path in actual if path.startswith("pb_migrations/") and "/" in path)


def _compose_without_target_image(config, service):
    value = copy.deepcopy(config)
    services = value.get("services")
    _require(isinstance(services, dict) and service in services, "invalid_compose", "Target Compose service is missing.")
    target = services[service]
    _require(isinstance(target, dict) and isinstance(target.get("image"), str), "invalid_compose", "Target Compose image is missing.")
    image = target.pop("image")
    return value, image


def _current_facts(plan, require_running=True, full_database=True, enforce_source_ledger=True):
    production = plan["production"]
    source = plan["source"]
    _require_trusted_production_paths(plan)
    _require(platform.machine() == "x86_64", "host_mismatch", "Server architecture is not x86_64.")
    _require(platform.node() == plan["server"]["expectedHostname"], "host_mismatch", "Server hostname differs from the plan.")
    _require(_machine_id_sha256() == plan["server"]["expectedMachineIdSha256"], "host_mismatch", "Server machine ID differs from the plan.")
    for path in (
        production["composePath"],
        production["dataHostPath"],
        production["rootReleasePath"],
        production["rootChecksumsPath"],
    ):
        _require(os.path.exists(path) and not os.path.islink(path), "path_mismatch", "A production path is missing or is a symbolic link.", {"path": path})
    _require(_sha256_file(production["composePath"]) == source["composeSha256"], "source_drift", "Production Compose hash differs from the plan.")
    _require(_sha256_file(production["rootReleasePath"]) == source["releaseJsonSha256"], "source_drift", "Production release.json hash differs from the plan.")
    root_release, _root_release_raw = _read_json_file(production["rootReleasePath"])
    _require(isinstance(root_release, dict) and isinstance(root_release.get("pocketbaseVersion"), str), "source_drift", "Production release.json has no PocketBase version.")
    root_checksums = _parse_checksum_file(
        production["rootChecksumsPath"],
        [
            os.path.basename(production["composePath"]),
            os.path.basename(production["rootReleasePath"]),
        ],
        exact=False,
    )
    _require(
        root_checksums[os.path.basename(production["composePath"])] == _recorded_source_compose_sha(plan),
        "source_drift",
        "Production root checksum manifest does not anchor Compose.",
    )
    _require(
        root_checksums[os.path.basename(production["rootReleasePath"])] == source["releaseJsonSha256"],
        "source_drift",
        "Production root checksum manifest does not anchor release.json.",
    )
    checksum_root = os.path.dirname(production["rootChecksumsPath"])
    for name, digest in root_checksums.items():
        member = os.path.join(checksum_root, name)
        _require(os.path.isfile(member) and not os.path.islink(member), "source_drift", "A production root checksum member is missing or unsafe.", {"member": name})
        expected_digest = source["composeSha256"] if member == production["composePath"] else digest
        _require(_sha256_file(member) == expected_digest, "source_drift", "A production root checksum member failed verification.", {"member": name})
    container = _docker_inspect_container(production["containerName"])
    state = container.get("State") or {}
    running = bool(state.get("Running"))
    if require_running:
        _require(running, "container_mismatch", "Target production container is not running.")
    config = container.get("Config") or {}
    _require(config.get("Image") == source["imageTag"], "source_drift", "Production container image tag differs from the plan.")
    _require(container.get("Image") == source["imageId"], "source_drift", "Production container image ID differs from the plan.")
    _container_mount_matches(container, production["dataHostPath"], production["dataContainerPath"], production.get("pushRuntime"))
    _container_port_matches(
        container,
        production["hostIp"],
        production["hostPort"],
        production["containerPort"],
    )
    _verify_container_runtime_contract(plan, container)
    compose_config = _compose_config(plan, production["composePath"])
    _without, compose_image = _compose_without_target_image(compose_config, production["composeService"])
    _require(compose_image == source["imageTag"], "source_drift", "Resolved Compose source image differs from the plan.")
    database_path = os.path.join(production["dataHostPath"], production["databaseRelativePath"])
    database = _sqlite_summary(database_path) if full_database else None
    if database is not None and enforce_source_ledger:
        _require(database["migrationLedgerSha256"] == source["migrationLedgerSha256"], "source_drift", "Migration ledger digest differs from the plan.")
        _require(
            set(source["requiredMigrationFiles"]).issubset(set(database["migrationFiles"])),
            "source_drift",
            "Production migration ledger is missing a required project migration.",
        )
    runtime_version = root_release["pocketbaseVersion"]
    if running:
        stdout, _stderr, _code = _run(
            ["docker", "exec", production["containerName"], "/pb/pocketbase", "--version"],
            timeout=30,
        )
        observed = _decode_output(stdout)
        _require(observed == "pocketbase version " + runtime_version, "version_mismatch", "Running PocketBase version differs from production release.json.")
    return {
        "hostname": platform.node(),
        "machineIdSha256": _machine_id_sha256(),
        "architecture": platform.machine(),
        "containerRunning": running,
        "containerHealth": state.get("Health", {}).get("Status"),
        "containerRestartCount": container.get("RestartCount"),
        "imageTag": config.get("Image"),
        "imageId": container.get("Image"),
        "composeSha256": _sha256_file(production["composePath"]),
        "releaseJsonSha256": _sha256_file(production["rootReleasePath"]),
        "pocketbaseVersion": runtime_version,
        "composeConfigSha256": _sha256_json(compose_config),
        "database": database,
    }


def _inventory(request):
    paths = request.get("paths", [])
    _require(isinstance(paths, list), "invalid_request", "inventory.paths must be an array.")
    bootstrap_paths = request.get("bootstrapPaths", [])
    _require(isinstance(bootstrap_paths, list), "invalid_request", "inventory.bootstrapPaths must be an array.")
    all_paths = []
    for index, value in enumerate(paths + bootstrap_paths):
        all_paths.append(_require_absolute_path(value, "inventory path[%d]" % index))
    _require(len(all_paths) <= 64, "invalid_request", "Too many inventory paths were requested.")
    result = {
        "pythonVersion": platform.python_version(),
        "pythonExecutable": os.path.realpath(sys.executable),
        "hostname": platform.node(),
        "architecture": platform.machine(),
        "effectiveUid": os.geteuid(),
        "dockerAvailable": shutil.which("docker") is not None,
        "systemdRunAvailable": shutil.which("systemd-run") is not None,
        "paths": [_path_facts(path) for path in all_paths],
    }
    if os.path.isfile("/etc/machine-id"):
        result["machineIdSha256"] = _machine_id_sha256()
    if request.get("plan") is not None:
        draft = _validate_input_plan(request.get("plan"), "pending")
        production = draft["production"]
        compose_path = production["composePath"]
        release_path = production["rootReleasePath"]
        database_path = os.path.join(production["dataHostPath"], production["databaseRelativePath"])
        _require(os.path.isfile(compose_path) and not os.path.islink(compose_path), "path_mismatch", "Inventory Compose path is missing or unsafe.")
        _require(os.path.isfile(release_path) and not os.path.islink(release_path), "path_mismatch", "Inventory release.json path is missing or unsafe.")
        container = _docker_inspect_container(production["containerName"])
        database = _sqlite_summary(database_path)
        current_release, _current_release_raw = _read_json_file(release_path)
        result["draftPlanSha256"] = _sha256_json(draft)
        result["observed"] = {
            "hostname": platform.node(),
            "machineIdSha256": _machine_id_sha256(),
            "architecture": platform.machine(),
            "composeSha256": _sha256_file(compose_path),
            "releaseJsonSha256": _sha256_file(release_path),
            "pocketbaseVersion": current_release.get("pocketbaseVersion") if isinstance(current_release, dict) else None,
            "migrationLedgerSha256": database["migrationLedgerSha256"],
            "migrationFiles": database["migrationFiles"],
            "databaseSummarySha256": database["summarySha256"],
            "imageTag": (container.get("Config") or {}).get("Image"),
            "imageId": container.get("Image"),
            "containerRunning": bool((container.get("State") or {}).get("Running")),
            "containerHealth": ((container.get("State") or {}).get("Health") or {}).get("Status"),
            "requiredMigrationFiles": _migration_file_names_from_container(production["containerName"]),
            "freeBytes": {
                key: _free_bytes(draft["server"][key])
                for key in ("releaseRoot", "backupRoot", "uploadRoot")
            },
        }
    return result


def _preflight(request, bundle_already_present=False):
    plan = _validate_frozen_plan(request.get("plan"))
    bundle = _validate_bundle(request.get("bundle"))
    _require(os.geteuid() == 0, "permission_denied", "Production preflight must run as root.")
    _require(shutil.which("docker") is not None, "dependency_missing", "Docker is unavailable.")
    _require(shutil.which("systemd-run") is not None, "dependency_missing", "systemd-run is unavailable.")
    _require(shutil.which("fuser") is not None, "dependency_missing", "fuser is unavailable for the host data-owner gate.")
    for key in ("releaseRoot", "backupRoot", "uploadRoot"):
        root = plan["server"][key]
        _secure_directory_chain(
            root,
            "plan.server." + key,
            require_private_leaf=os.path.exists(root),
        )
    free = {
        key: _free_bytes(plan["server"][key])
        for key in ("releaseRoot", "backupRoot", "uploadRoot")
    }
    paths = _release_paths(plan)
    _require(not os.path.lexists(paths["stageMarker"]), "stage_result_unknown", "A stage-attempt marker exists; do not create or replay an upload automatically.")
    state = None
    if os.path.exists(paths["state"]):
        _require(os.path.exists(paths["lock"]), "state_corrupt", "Release lock file is missing.")
        with _file_lock(paths["lock"], exclusive=False):
            state, stored_plan = _load_state(paths, verify_bundle=True)
            _require(stored_plan == plan, "plan_mismatch", "Preflight plan differs from the staged frozen plan.")
            _require(
                state["bundleSha256"] == bundle["sha256"]
                and state["bundleSize"] == bundle["size"],
                "bundle_mismatch",
                "Preflight bundle metadata differs from staged state.",
            )
            _require(state["phase"] != "blocked", "release_blocked", "Blocked releases require manual read-only diagnosis.")
            _require(state["inFlight"] is None, "operation_in_flight", "Preflight refuses while a release operation is in flight.")
            _require(_read_active_marker(paths) is None, "global_operation_active", "Preflight found a global active marker; do not retry automatically.")
    else:
        _require(not os.path.exists(paths["releaseDir"]), "incomplete_stage", "Release directory exists without a valid prepared state.")
        _require(_read_active_marker(paths) is None, "global_operation_active", "Preflight found a global active marker; do not begin another release.")

    phase = state["phase"] if state is not None else "not-staged"
    if state is None:
        space_budget = _space_budget(
            plan,
            _pre_stage_space_allocations(
                plan,
                bundle,
                bundle_already_present=bundle_already_present,
            ),
        )
    else:
        allocations = _base_space_allocations(plan)
        if phase == "prepared":
            data_bytes, data_entries = _estimate_tree_logical_usage(
                plan["production"]["dataHostPath"]
            )
            allocations.append(
                (
                    "backupArchiveRestoreAndMigration",
                    plan["server"]["backupRoot"],
                    _backup_projected_write_bytes(data_bytes, data_entries),
                )
            )
        space_budget = _space_budget(plan, allocations)
    if phase in ("not-staged", "prepared"):
        facts = _current_facts(plan, require_running=True, full_database=True)
        required = sorted(plan["source"]["requiredMigrationFiles"])
        container_files = _migration_file_names_from_container(plan["production"]["containerName"])
        _require(container_files == required, "source_drift", "Source container migration files differ from the exact inventoried baseline.")
    elif phase == "backup-verified":
        facts = _current_facts(plan, require_running=False, full_database=True)
        _require(not facts["containerRunning"], "container_mismatch", "Production container must remain stopped after backup verification.")
        backup = _backup_verification_path(plan, state)
        _require(facts["database"] == backup["productionBefore"], "source_drift", "Stopped production database differs from verified backup baseline.")
        container_files = _migration_file_names_from_container(plan["production"]["containerName"])
    elif phase in ("production-migrated", "migration-not-required"):
        facts = _current_facts(plan, require_running=False, full_database=True, enforce_source_ledger=False)
        _require(not facts["containerRunning"], "container_mismatch", "Production container must remain stopped before switch.")
        expected_database = _expected_pre_switch_database(plan, state)
        _require(facts["database"] == expected_database, "source_drift", "Stopped production database differs from its verified migration gate.")
        container_files = _migration_file_names_from_container(plan["production"]["containerName"])
    elif phase in ("verified", "recorded"):
        facts = _preflight_target_phase(plan, paths, state, recorded=(phase == "recorded"))
        container_files = sorted(plan["source"]["requiredMigrationFiles"] + plan["migration"]["newFiles"])
    else:
        raise ReleaseError("invalid_transition", "Preflight encountered an intermediate or unknown phase.", {"phase": phase})
    return {
        "releaseId": plan["releaseId"],
        "planSha256": _sha256_json(plan),
        "freeBytes": free,
        "spaceBudget": space_budget,
        "phase": phase,
        "sourceFacts": facts,
        "sourceMigrationFileCount": len(container_files),
        "ready": True,
        "blocked": False,
        "blockers": [],
    }


def _preflight_target_phase(plan, paths, state, recorded=False):
    production = plan["production"]
    _require_trusted_production_paths(plan)
    _verify_frozen_target_image(plan)
    _require(platform.machine() == "x86_64", "host_mismatch", "Server architecture is not x86_64.")
    _require(platform.node() == plan["server"]["expectedHostname"], "host_mismatch", "Server hostname differs from the plan.")
    _require(_machine_id_sha256() == plan["server"]["expectedMachineIdSha256"], "host_mismatch", "Server machine ID differs from the plan.")
    container = _docker_inspect_container(production["containerName"])
    _verify_target_container(plan, container)
    compose_sha = _sha256_file(production["composePath"])
    _require(compose_sha == plan["artifact"]["targetComposeSha256"], "source_drift", "Target Compose hash differs from the frozen plan.")
    config = _compose_config(plan, production["composePath"])
    _without, image = _compose_without_target_image(config, production["composeService"])
    _require(image == plan["target"]["imageTag"], "source_drift", "Resolved target Compose image differs from the frozen plan.")
    database = _sqlite_summary(os.path.join(production["dataHostPath"], production["databaseRelativePath"]))
    structural_baseline = _expected_pre_switch_database(plan, state)
    _require(database["migrationFiles"] == structural_baseline["migrationFiles"], "data_verification_failed", "Target migration ledger filenames differ from the verified migration baseline.")
    switch = (state.get("evidence") or {}).get("switch")
    _require(isinstance(switch, dict), "state_corrupt", "Switch evidence is missing.")
    _require_switch_container_continuity(plan, container, switch)
    delta, _delta_raw = _read_json_file(paths["delta"])
    delta = _validate_delta(delta, plan)
    structural_evidence = _validate_post_switch_structure(
        structural_baseline,
        database,
        delta,
    )
    if not recorded:
        _require(_sha256_file(production["rootReleasePath"]) == plan["source"]["releaseJsonSha256"], "source_drift", "Root release metadata changed before finalize.")
        _raw, lines = _read_root_checksum_lines(production["rootChecksumsPath"])
        mapping = {name: digest for digest, name in lines}
        _require(mapping.get(os.path.basename(production["composePath"])) == _recorded_source_compose_sha(plan), "source_drift", "Root checksum manifest no longer retains the source Compose anchor before finalize.")
        _require(mapping.get(os.path.basename(production["rootReleasePath"])) == plan["source"]["releaseJsonSha256"], "source_drift", "Root checksum manifest release anchor changed before finalize.")
        checksum_root = os.path.dirname(production["rootChecksumsPath"])
        compose_name = os.path.basename(production["composePath"])
        for digest, name in lines:
            if name == compose_name:
                continue
            member = os.path.join(checksum_root, name)
            _require(os.path.isfile(member) and not os.path.islink(member) and _sha256_file(member) == digest, "source_drift", "A pre-finalize root checksum member failed verification.", {"member": name})
    else:
        final_evidence = (state.get("evidence") or {}).get("finalize")
        _require(isinstance(final_evidence, dict), "state_corrupt", "Finalize evidence is missing from a recorded release.")
        _verify_recorded_artifacts(plan, paths, state)
        _require(_sha256_file(production["rootReleasePath"]) == final_evidence["rootReleaseSha256"], "source_drift", "Recorded root release metadata hash differs from state.")
        _require(_sha256_file(production["rootChecksumsPath"]) == final_evidence["rootChecksumsSha256"], "source_drift", "Recorded root checksum manifest hash differs from state.")
        _raw, lines = _read_root_checksum_lines(production["rootChecksumsPath"])
        checksum_root = os.path.dirname(production["rootChecksumsPath"])
        for digest, name in lines:
            member = os.path.join(checksum_root, name)
            _require(os.path.isfile(member) and not os.path.islink(member) and _sha256_file(member) == digest, "source_drift", "A recorded root checksum member failed verification.", {"member": name})
    probes = _verify_external_probes(plan)
    return {
        "hostname": platform.node(),
        "machineIdSha256": _machine_id_sha256(),
        "architecture": platform.machine(),
        "containerRunning": True,
        "containerHealth": ((container.get("State") or {}).get("Health") or {}).get("Status"),
        "containerRestartCount": container.get("RestartCount"),
        "imageTag": (container.get("Config") or {}).get("Image"),
        "imageId": container.get("Image"),
        "composeSha256": compose_sha,
        "releaseJsonSha256": _sha256_file(production["rootReleasePath"]),
        "composeConfigSha256": _sha256_json(config),
        "database": database,
        "postSwitchStructure": structural_evidence,
        "probes": probes,
    }


def _release_paths(plan):
    release_dir = os.path.join(plan["server"]["releaseRoot"], plan["releaseId"])
    production_identity = _sha256_bytes(
        os.path.normcase(os.path.realpath(plan["production"]["dataHostPath"])).encode("utf-8")
    )
    return {
        "releaseDir": release_dir,
        "state": os.path.join(release_dir, "release-state.json"),
        "events": os.path.join(release_dir, "release-events.jsonl"),
        "lock": os.path.join(release_dir, ".release.lock"),
        # These paths are deliberately outside every plan-controlled release
        # root. Two reviewed plans that point at the same production data path
        # therefore share one host-level mutex even if other fields are wrong.
        "globalLock": os.path.join(GLOBAL_LOCK_ROOT, production_identity + ".lock"),
        "activeMarker": os.path.join(GLOBAL_LOCK_ROOT, production_identity + ".json"),
        "plan": os.path.join(release_dir, "deployment-plan.json"),
        "delta": os.path.join(release_dir, "allowed-delta.json"),
        "runner": os.path.join(release_dir, "release-runner.py"),
        "candidateCompose": os.path.join(release_dir, "compose.candidate.yaml"),
        "internalChecksums": os.path.join(release_dir, "SHA256SUMS"),
        "finalizeIntent": os.path.join(release_dir, "root-metadata-finalize-intent.json"),
        "finalizeCommit": os.path.join(release_dir, "root-metadata-finalize-commit.json"),
        "stageMarker": os.path.join(
            plan["server"]["uploadRoot"],
            ".stage-%s.json" % plan["releaseId"],
        ),
    }


def _verify_recorded_artifacts(plan, paths, state):
    final_evidence = (state.get("evidence") or {}).get("finalize")
    _require(isinstance(final_evidence, dict), "state_corrupt", "Finalize evidence is missing from a recorded release.")
    _require_trusted_production_paths(plan)
    _require_private_root_file(
        paths["finalizeIntent"],
        "Recorded root metadata finalize intent",
        final_evidence.get("rootMetadataIntentSha256"),
    )
    _require_private_root_file(
        paths["finalizeCommit"],
        "Recorded root metadata finalize commit",
        final_evidence.get("rootMetadataCommitSha256"),
    )
    intent, _intent_raw = _read_json_file(paths["finalizeIntent"])
    commit, _commit_raw = _read_json_file(paths["finalizeCommit"])
    _require(isinstance(intent, dict) and isinstance(commit, dict), "state_corrupt", "Recorded root metadata transaction evidence is invalid.")
    _require_exact_keys(
        intent,
        (
            "schemaVersion",
            "releaseId",
            "operationId",
            "sourceRootReleaseSha256",
            "sourceRootChecksumsSha256",
            "targetRootReleaseSha256",
            "targetRootChecksumsSha256",
            "reportSha256",
            "verifiedStateSnapshotSha256",
            "createdAt",
        ),
        "root metadata finalize intent",
    )
    _require_exact_keys(
        commit,
        (
            "schemaVersion",
            "releaseId",
            "operationId",
            "intentSha256",
            "rootReleaseSha256",
            "rootChecksumsSha256",
            "committedAt",
        ),
        "root metadata finalize commit",
    )
    _require(
        intent.get("releaseId") == plan["releaseId"]
        and commit.get("releaseId") == plan["releaseId"]
        and commit.get("operationId") == intent.get("operationId")
        and commit.get("intentSha256") == final_evidence.get("rootMetadataIntentSha256")
        and commit.get("rootReleaseSha256") == final_evidence.get("rootReleaseSha256")
        and commit.get("rootChecksumsSha256") == final_evidence.get("rootChecksumsSha256"),
        "state_corrupt",
        "Recorded root metadata transaction evidence is inconsistent.",
    )
    _require(
        intent.get("targetRootReleaseSha256") == commit.get("rootReleaseSha256")
        and intent.get("targetRootChecksumsSha256") == commit.get("rootChecksumsSha256")
        and intent.get("reportSha256") == final_evidence.get("reportSha256")
        and intent.get("verifiedStateSnapshotSha256")
        == final_evidence.get("verifiedStateSnapshotSha256"),
        "state_corrupt",
        "Recorded root metadata intent differs from committed finalize evidence.",
    )
    report_path = os.path.join(paths["releaseDir"], "release-report.json")
    report_checksum_path = os.path.join(paths["releaseDir"], "release-report.SHA256")
    snapshot_path = os.path.join(paths["releaseDir"], "release-state-verified.json")
    _require(final_evidence.get("reportPath") == report_path, "state_corrupt", "Recorded report path differs from the frozen release directory.")
    _require_private_root_file(report_path, "Recorded release report", final_evidence.get("reportSha256"))
    _require_private_root_file(
        snapshot_path,
        "Recorded verified state snapshot",
        final_evidence.get("verifiedStateSnapshotSha256"),
    )
    _require_private_root_file(report_checksum_path, "Recorded report checksum")
    with open(report_checksum_path, "rb") as handle:
        checksum_raw = handle.read(256)
    expected_checksum = (final_evidence["reportSha256"] + "  release-report.json\n").encode("ascii")
    _require(checksum_raw == expected_checksum, "hash_mismatch", "Recorded report checksum sidecar differs from finalize evidence.")
    report, _report_raw = _read_json_file(report_path)
    _require(
        report.get("releaseId") == plan["releaseId"]
        and report.get("planSha256") == state["planSha256"]
        and report.get("executorSha256") == state["executorSha256"],
        "state_corrupt",
        "Recorded release report identity differs from state.",
    )
    snapshot, _snapshot_raw = _read_json_file(snapshot_path)
    _require(
        snapshot.get("releaseId") == plan["releaseId"]
        and snapshot.get("phase") == "verified"
        and snapshot.get("planSha256") == state["planSha256"],
        "state_corrupt",
        "Recorded verified state snapshot identity is invalid.",
    )
    production = plan["production"]
    _require(
        _sha256_file(production["rootReleasePath"])
        == final_evidence["rootReleaseSha256"]
        and _sha256_file(production["rootChecksumsPath"])
        == final_evidence["rootChecksumsSha256"],
        "hash_mismatch",
        "Current root release metadata differs from the recorded finalize commit.",
    )
    root_release, _root_release_raw = _read_json_file(production["rootReleasePath"])
    _require(
        root_release.get("releaseId") == plan["releaseId"]
        and root_release.get("releaseDir") == paths["releaseDir"]
        and root_release.get("statePath") == snapshot_path
        and root_release.get("stateSha256") == final_evidence["verifiedStateSnapshotSha256"]
        and root_release.get("reportSha256") == final_evidence["reportSha256"],
        "state_corrupt",
        "Root release metadata no longer anchors the recorded audit artifacts.",
    )
    _root_checksums_raw, root_lines = _read_root_checksum_lines(
        production["rootChecksumsPath"]
    )
    checksum_root = os.path.dirname(production["rootChecksumsPath"])
    root_mapping = {name: digest for digest, name in root_lines}
    _require(
        root_mapping.get(os.path.basename(production["rootReleasePath"]))
        == final_evidence["rootReleaseSha256"]
        and root_mapping.get(os.path.basename(production["composePath"]))
        == plan["artifact"]["targetComposeSha256"],
        "hash_mismatch",
        "Recorded root checksum anchors differ from finalized release metadata.",
    )
    for digest, name in root_lines:
        member = os.path.join(checksum_root, name)
        _require(
            os.path.isfile(member)
            and not os.path.islink(member)
            and _sha256_file(member) == digest,
            "hash_mismatch",
            "A recorded root checksum member failed verification.",
            {"member": name},
        )
    return {
        "reportSha256": final_evidence["reportSha256"],
        "verifiedStateSnapshotSha256": final_evidence["verifiedStateSnapshotSha256"],
    }


def _verify_event_log(path):
    if not os.path.exists(path):
        return {"headSha256": None, "sequence": 0}
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode) and st.st_size <= 64 * 1024 * 1024, "state_corrupt", "Release event log is unsafe or too large.")
    previous = None
    sequence = 0
    with open(path, "rb") as handle:
        for raw in handle:
            _require(len(raw) <= MAX_JSON_BYTES and raw.endswith(b"\n"), "state_corrupt", "Release event log line is invalid.")
            try:
                event = _json_loads_strict(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ReleaseError("state_corrupt", "Release event log contains invalid JSON.")
            _require_exact_keys(
                event,
                ("sequence", "at", "type", "phase", "payload", "previousSha256", "sha256"),
                "release event",
            )
            sequence += 1
            _require(event["sequence"] == sequence, "state_corrupt", "Release event sequence is broken.")
            _require(event["previousSha256"] == previous, "state_corrupt", "Release event hash chain is broken.")
            digest = event["sha256"]
            unsigned = dict(event)
            del unsigned["sha256"]
            _require(digest == _sha256_json(unsigned), "state_corrupt", "Release event hash is invalid.")
            previous = digest
    return {"headSha256": previous, "sequence": sequence}


def _verify_staged_bundle(paths, state):
    stage = (state.get("evidence") or {}).get("stage")
    _require(isinstance(stage, dict), "state_corrupt", "Stage evidence is missing.")
    internal_sha = stage.get("internalChecksumsSha256")
    _require(isinstance(internal_sha, str), "state_corrupt", "Internal checksum evidence is missing.")
    _require_private_root_file(
        paths["internalChecksums"],
        "Frozen internal checksum manifest",
        internal_sha,
    )
    checksums = _parse_checksum_file(paths["internalChecksums"], CHECKSUM_MEMBERS)
    for name in CHECKSUM_MEMBERS:
        member = os.path.join(paths["releaseDir"], name)
        _require_private_root_file(member, "Frozen bundle member " + name, checksums[name])
    return {"memberCount": len(checksums), "checksumsSha256": internal_sha}


def _append_event(paths, event_type, phase, payload):
    verified = _verify_event_log(paths["events"])
    event = {
        "sequence": verified["sequence"] + 1,
        "at": _utc_now(),
        "type": event_type,
        "phase": phase,
        "payload": payload,
        "previousSha256": verified["headSha256"],
    }
    event["sha256"] = _sha256_json(event)
    descriptor = os.open(paths["events"], os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        raw = _canonical_bytes(event) + b"\n"
        offset = 0
        while offset < len(raw):
            offset += os.write(descriptor, raw[offset:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _fsync_directory(os.path.dirname(paths["events"]))
    return event


def _load_state(paths, verify_bundle=False):
    state, _raw = _read_json_file(paths["state"])
    required = (
        "schemaVersion",
        "releaseId",
        "phase",
        "lastSafePhase",
        "revision",
        "planSha256",
        "executorSha256",
        "bundleSha256",
        "bundleSize",
        "createdAt",
        "updatedAt",
        "inFlight",
        "snapshotRestoreAllowed",
        "trafficMayHaveResumed",
        "evidence",
        "eventsHeadSha256",
    )
    _require_exact_keys(state, required, "release state")
    _require(state["schemaVersion"] == STATE_SCHEMA, "state_corrupt", "Release state schema is invalid.")
    _require(state["releaseId"] == os.path.basename(paths["releaseDir"]), "state_corrupt", "Release state ID differs from its directory.")
    _require_int(state["revision"], "release state revision", 1)
    _require_bool(state["snapshotRestoreAllowed"], "release state snapshotRestoreAllowed")
    _require_bool(state["trafficMayHaveResumed"], "release state trafficMayHaveResumed")
    _require(isinstance(state["evidence"], dict), "state_corrupt", "Release evidence must be an object.")
    events = _verify_event_log(paths["events"])
    _require(events["headSha256"] == state["eventsHeadSha256"], "state_corrupt", "Release state and event log heads differ.")
    plan, _plan_raw = _read_json_file(paths["plan"])
    plan = _validate_frozen_plan(plan)
    _require(_sha256_json(plan) == state["planSha256"], "state_corrupt", "Frozen deployment plan hash differs from state.")
    _require(_sha256_file(paths["runner"]) == state["executorSha256"], "state_corrupt", "Frozen executor hash differs from state.")
    if verify_bundle:
        _verify_staged_bundle(paths, state)
    return state, plan


def _save_state_with_event(paths, state, event_type, payload):
    event = _append_event(paths, event_type, state["phase"], payload)
    state["eventsHeadSha256"] = event["sha256"]
    state["updatedAt"] = event["at"]
    state["revision"] += 1
    _atomic_write_json(paths["state"], state, 0o600)
    return state


def _initialize_state(paths, plan, bundle, stage_evidence):
    _require(not os.path.exists(paths["state"]), "already_exists", "Release state already exists.")
    state = {
        "schemaVersion": STATE_SCHEMA,
        "releaseId": plan["releaseId"],
        "phase": "prepared",
        "lastSafePhase": "prepared",
        "revision": 0,
        "planSha256": _sha256_json(plan),
        "executorSha256": plan["artifact"]["executorSha256"],
        "bundleSha256": bundle["sha256"],
        "bundleSize": bundle["size"],
        "createdAt": _utc_now(),
        "updatedAt": _utc_now(),
        "inFlight": None,
        "snapshotRestoreAllowed": True,
        "trafficMayHaveResumed": False,
        "evidence": {"stage": stage_evidence},
        "eventsHeadSha256": None,
    }
    event = _append_event(
        paths,
        "stage-completed",
        "prepared",
        {
            "planSha256": state["planSha256"],
            "executorSha256": state["executorSha256"],
            "bundleSha256": state["bundleSha256"],
            "stageEvidenceSha256": _sha256_json(stage_evidence),
        },
    )
    state["eventsHeadSha256"] = event["sha256"]
    state["updatedAt"] = event["at"]
    state["revision"] = 1
    _atomic_write_json(paths["state"], state, 0o600, require_absent=True)
    return state


def _prepare_upload(request):
    plan = _validate_frozen_plan(request.get("plan"))
    bundle = _validate_bundle(request.get("bundle"))
    _require(os.geteuid() == 0, "permission_denied", "Preparing a production upload requires root.")
    _preflight({"plan": plan, "bundle": bundle})
    prepared_paths = _release_paths(plan)
    _require(not os.path.exists(prepared_paths["releaseDir"]), "already_exists", "This release ID has already been staged.")
    _require(not os.path.lexists(prepared_paths["stageMarker"]), "stage_result_unknown", "A prior stage attempt requires manual diagnosis before another upload.")
    upload_root = plan["server"]["uploadRoot"]
    _ensure_private_root_directory(upload_root, "Upload root")
    session_id = secrets.token_hex(16)
    _require(bool(RELEASE_ID_RE.match(session_id)), "internal_error", "Generated upload session ID is invalid.")
    session_dir = os.path.join(upload_root, session_id)
    _mkdir_private(session_dir)
    upload_path = os.path.join(session_dir, bundle["fileName"])
    checksums_path = os.path.join(session_dir, "SHA256SUMS")
    for private_upload in (upload_path, checksums_path):
        descriptor = os.open(private_upload, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    _fsync_directory(session_dir)
    session = {
        "schemaVersion": 1,
        "sessionId": session_id,
        "releaseId": plan["releaseId"],
        "planSha256": _sha256_json(plan),
        "bundle": bundle,
        "createdAt": _utc_now(),
        "uploadPath": upload_path,
        "checksumsPath": checksums_path,
        "consumed": False,
    }
    _atomic_write_json(os.path.join(session_dir, "session.json"), session, 0o600, require_absent=True)
    return {
        "sessionId": session_id,
        "uploadDirectory": session_dir,
        "uploadPath": upload_path,
        "checksumsPath": checksums_path,
    }


def _read_upload_session(plan, bundle, session_id):
    _require_string(session_id, "sessionId", 8, 128)
    _require(bool(RELEASE_ID_RE.match(session_id)), "invalid_request", "sessionId has an invalid format.")
    session_dir = os.path.join(plan["server"]["uploadRoot"], session_id)
    _require(os.path.dirname(session_dir) == plan["server"]["uploadRoot"], "invalid_request", "Upload session escapes uploadRoot.")
    _require(os.path.isdir(session_dir) and not os.path.islink(session_dir), "upload_session_missing", "Upload session is missing or unsafe.")
    session, _raw = _read_json_file(os.path.join(session_dir, "session.json"))
    _require_exact_keys(
        session,
        (
            "schemaVersion",
            "sessionId",
            "releaseId",
            "planSha256",
            "bundle",
            "createdAt",
            "uploadPath",
            "checksumsPath",
            "consumed",
        ),
        "upload session",
    )
    _require(session["schemaVersion"] == 1 and session["sessionId"] == session_id, "upload_session_mismatch", "Upload session identity is invalid.")
    _require(session["releaseId"] == plan["releaseId"], "upload_session_mismatch", "Upload session release ID differs from the plan.")
    _require(session["planSha256"] == _sha256_json(plan), "upload_session_mismatch", "Upload session plan hash differs from the request.")
    _require(session["bundle"] == bundle, "upload_session_mismatch", "Upload session bundle metadata differs from the request.")
    _require(session["consumed"] is False, "already_consumed", "Upload session has already been consumed.")
    expected_upload = os.path.join(session_dir, bundle["fileName"])
    expected_checksums = os.path.join(session_dir, "SHA256SUMS")
    _require(session["uploadPath"] == expected_upload and session["checksumsPath"] == expected_checksums, "upload_session_mismatch", "Upload session paths are invalid.")
    return session_dir, session


def _verify_release_bundle_directory(directory, authorized_plan):
    checksums = _parse_checksum_file(os.path.join(directory, "SHA256SUMS"), CHECKSUM_MEMBERS)
    for name in CHECKSUM_MEMBERS:
        path = os.path.join(directory, name)
        _require(_sha256_file(path) == checksums[name], "hash_mismatch", "An internal release bundle checksum failed.", {"member": name})
    frozen, _frozen_raw = _read_json_file(os.path.join(directory, "deployment-plan.json"))
    frozen = _validate_frozen_plan(frozen)
    _require(frozen == authorized_plan, "plan_mismatch", "Bundle deployment plan differs from the authorized frozen plan.")
    _require(_sha256_json(frozen) == _sha256_json(authorized_plan), "plan_mismatch", "Bundle deployment plan hash differs from the authorized frozen plan.")
    artifact = frozen["artifact"]
    expected_hashes = {
        "README.md": artifact["operationSheetSha256"],
        "allowed-delta.json": artifact["allowedDeltaSha256"],
        "release-runner.py": artifact["executorSha256"],
        "compose.candidate.yaml": artifact["targetComposeSha256"],
    }
    for name, digest in expected_hashes.items():
        _require(checksums[name] == digest, "hash_mismatch", "A frozen artifact hash does not match SHA256SUMS.", {"member": name})
    delta, _delta_raw = _read_json_file(os.path.join(directory, "allowed-delta.json"))
    delta = _validate_delta(delta, frozen)
    _require(_sha256_file(os.path.join(directory, "allowed-delta.json")) == artifact["allowedDeltaSha256"], "hash_mismatch", "Allowed delta bytes differ from the frozen hash.")
    _require(_sha256_file(os.path.join(directory, "README.md")) == artifact["operationSheetSha256"], "hash_mismatch", "Operation sheet bytes differ from the frozen hash.")
    _require(_sha256_file(os.path.join(directory, "release-runner.py")) == artifact["executorSha256"], "hash_mismatch", "Executor bytes differ from the frozen hash.")
    _require(_sha256_file(os.path.join(directory, "compose.candidate.yaml")) == artifact["targetComposeSha256"], "hash_mismatch", "Candidate Compose bytes differ from the frozen hash.")
    release, _release_raw = _read_json_file(os.path.join(directory, "release.json"))
    _require(isinstance(release, dict), "invalid_release", "release.json must be an object.")
    required_release_values = {
        "schemaVersion": 2,
        "deploymentMode": "upgrade-in-place",
        "containsBusinessData": False,
        "containsCredentials": False,
        "containsFrontendBuilds": False,
        "containsComposeTemplate": False,
        "containsComposeCandidate": True,
        "imageCodeMatchesRepository": True,
        "deploymentPlanFile": "deployment-plan.json",
        "allowedDeltaFile": "allowed-delta.json",
        "executorFile": "release-runner.py",
        "composeCandidateFile": "compose.candidate.yaml",
        "operationSheetSha256": artifact["operationSheetSha256"],
        "allowedDeltaSha256": artifact["allowedDeltaSha256"],
        "executorSha256": artifact["executorSha256"],
        "sourceManifestSha256": artifact["sourceManifestSha256"],
        "sourceComposeSha256": frozen["source"]["composeSha256"],
        "targetComposeSha256": artifact["targetComposeSha256"],
        "maximumExpandedBytes": artifact["maximumExpandedBytes"],
    }
    for key, expected in required_release_values.items():
        _require(release.get(key) == expected, "invalid_release", "release.json has an invalid frozen release field.", {"field": key})
    _require(
        release.get("deploymentPlanSha256") == _sha256_file(os.path.join(directory, "deployment-plan.json")),
        "invalid_release",
        "release.json deployment plan hash differs from the bundled bytes.",
    )
    _require(release.get("sourceManifest") == frozen["sourceManifest"], "invalid_release", "release.json source manifest differs from the frozen plan.")
    _require(release.get("newMigrationFiles") == frozen["migration"]["newFiles"], "invalid_release", "release.json new migration list differs from the frozen plan.")
    _require(release.get("imageTag") == frozen["target"]["imageTag"], "invalid_release", "release.json target image tag differs from the plan.")
    _require(release.get("releaseId") == frozen["releaseId"], "invalid_release", "release.json releaseId differs from the frozen plan.")
    _require(release.get("pocketbaseVersion") == frozen["target"]["pocketbaseVersion"], "invalid_release", "release.json PocketBase version differs from the plan.")
    _require(release.get("platform") == frozen["target"]["platform"], "invalid_release", "release.json platform differs from the plan.")
    _require(release.get("imageConfigDigest") == artifact["targetImageConfigDigest"], "invalid_release", "release.json image config digest differs from the plan.")
    release_migrations = release.get("migrationFiles")
    _require(isinstance(release_migrations, list), "invalid_release", "release.json migrationFiles is invalid.")
    expected_migrations = sorted(frozen["source"]["requiredMigrationFiles"] + frozen["migration"]["newFiles"])
    _require(sorted(release_migrations) == expected_migrations, "invalid_release", "release.json migration file set differs from the plan.")
    return frozen, delta, release, checksums


def _stage(request):
    input_plan = _validate_frozen_plan(request.get("plan"))
    bundle = _validate_bundle(request.get("bundle"))
    session_id = request.get("sessionId")
    _require(os.geteuid() == 0, "permission_denied", "Staging a production release requires root.")
    _preflight(
        {"plan": input_plan, "bundle": bundle},
        bundle_already_present=True,
    )
    session_dir, session = _read_upload_session(input_plan, bundle, session_id)
    upload_path = session["uploadPath"]
    checksums_path = session["checksumsPath"]
    session_stat = os.lstat(session_dir)
    _require(
        stat.S_ISDIR(session_stat.st_mode)
        and session_stat.st_uid == 0
        and stat.S_IMODE(session_stat.st_mode) & 0o077 == 0,
        "unsafe_upload",
        "Upload session directory must be root-owned and private.",
    )
    for path in (upload_path, checksums_path):
        st = os.lstat(path)
        _require(stat.S_ISREG(st.st_mode) and not os.path.islink(path), "unsafe_upload", "Uploaded release material must be a regular non-link file.")
        _require(st.st_uid == 0, "unsafe_upload", "Uploaded release material must be root-owned.")
        # OpenSSH/SFTP clients may copy the local 0644 mode onto an already
        # pre-created file.  The containing directory and inode identity have
        # already been verified; make the file private before reading bytes.
        os.chmod(path, 0o600)
        _require(stat.S_IMODE(os.lstat(path).st_mode) == 0o600, "unsafe_upload", "Uploaded release material could not be made private.")
    st = os.lstat(upload_path)
    _require(st.st_size == bundle["size"], "hash_mismatch", "Uploaded bundle size differs from the frozen metadata.")
    _require(_sha256_file(upload_path) == bundle["sha256"], "hash_mismatch", "Uploaded bundle hash differs from the frozen metadata.")
    outer = _parse_checksum_file(checksums_path, [bundle["fileName"]], exact=False)
    _require(outer[bundle["fileName"]] == bundle["sha256"], "hash_mismatch", "Outer SHA256SUMS differs from the frozen bundle hash.")

    stage_marker = {
        "schemaVersion": 1,
        "releaseId": input_plan["releaseId"],
        "sessionId": session_id,
        "bundleSha256": bundle["sha256"],
        "startedAt": _utc_now(),
    }
    stage_marker_path = _release_paths(input_plan)["stageMarker"]
    # Claim the release before extraction, Compose rendering, archive
    # inspection, or Docker work. The no-replace hard-link publication makes
    # concurrent stage requests mutually exclusive. A disconnect after this
    # point deliberately leaves the marker for manual diagnosis.
    _atomic_write_json(stage_marker_path, stage_marker, 0o600, require_absent=True)
    session["consumed"] = True
    _atomic_write_json(os.path.join(session_dir, "session.json"), session, 0o600)

    release_root = input_plan["server"]["releaseRoot"]
    _ensure_private_root_directory(release_root, "Release root")
    final_dir = os.path.join(release_root, input_plan["releaseId"])
    _require(not os.path.lexists(final_dir), "already_exists", "A release directory with this ID already exists.")
    staging_dir = tempfile.mkdtemp(prefix=".%s.staging." % input_plan["releaseId"], dir=release_root)
    os.chmod(staging_dir, 0o700)
    _extract_release_bundle(
        upload_path,
        staging_dir,
        input_plan["artifact"]["maximumExpandedBytes"],
    )
    frozen, delta, release, _checksums = _verify_release_bundle_directory(staging_dir, input_plan)

    image_path = os.path.join(staging_dir, "pocketbase-image.tar")
    image_archive = _inspect_docker_save_archive(
        image_path,
        frozen["target"]["imageTag"],
        frozen["artifact"]["targetImageConfigDigest"],
    )
    current_config = _compose_config(frozen, frozen["production"]["composePath"])
    candidate_config = _compose_config(frozen, os.path.join(staging_dir, "compose.candidate.yaml"))
    current_without, current_image = _compose_without_target_image(current_config, frozen["production"]["composeService"])
    candidate_without, candidate_image = _compose_without_target_image(candidate_config, frozen["production"]["composeService"])
    _require(current_image == frozen["source"]["imageTag"], "source_drift", "Current Compose image differs from the source plan during stage.")
    _require(candidate_image == frozen["target"]["imageTag"], "invalid_compose", "Candidate Compose image differs from the target plan.")
    _require(current_without == candidate_without, "invalid_compose", "Candidate Compose changes fields other than the target image.")
    _require(_sha256_file(upload_path) == bundle["sha256"] and os.path.getsize(upload_path) == bundle["size"], "hash_mismatch", "Uploaded bundle changed while it was being safely extracted.")
    outer_recheck = _parse_checksum_file(checksums_path, [bundle["fileName"]], exact=False)
    _require(outer_recheck[bundle["fileName"]] == bundle["sha256"], "hash_mismatch", "Outer SHA256SUMS changed during stage validation.")

    existing_target_id = _optional_image_id(frozen["target"]["imageTag"])
    _require(
        existing_target_id in (None, frozen["artifact"]["targetImageConfigDigest"]),
        "image_tag_collision",
        "Target image tag already points at a different image ID.",
    )
    _run(["docker", "load", "--input", image_path], timeout=600, unknown_on_timeout=True)
    image = _verify_frozen_target_image(frozen)
    validation_name = "questions-release-stage-%s" % frozen["releaseId"][:48]
    validation_container = _image_version_with_named_container(
        frozen["artifact"]["targetImageConfigDigest"],
        validation_name,
        frozen["target"]["pocketbaseVersion"],
        120,
    )
    _require(
        validation_container.get("Image") == frozen["artifact"]["targetImageConfigDigest"],
        "image_mismatch",
        "Stage validation container does not use the frozen image ID.",
    )
    source_evidence = _verify_image_source_manifest(validation_name, frozen["sourceManifest"])
    image_migrations = _migration_file_names_from_container(validation_name)
    expected_migrations = sorted(frozen["source"]["requiredMigrationFiles"] + frozen["migration"]["newFiles"])
    _require(image_migrations == expected_migrations, "image_source_mismatch", "Loaded image migration file set differs from the frozen plan.")
    _remove_stopped_container(validation_name)

    os.rename(staging_dir, final_dir)
    _fsync_directory(release_root)
    paths = _release_paths(frozen)
    stage_evidence = {
        "outerBundleSha256": bundle["sha256"],
        "outerChecksumsSha256": _sha256_file(checksums_path),
        "internalChecksumsSha256": _sha256_file(os.path.join(final_dir, "SHA256SUMS")),
        "imageArchiveSha256": _sha256_file(os.path.join(final_dir, "pocketbase-image.tar")),
        "imageConfigDigest": image_archive["configDigest"],
        "loadedImageId": image.get("Id"),
        "loadedImageRepoDigestsSha256": _sha256_json(sorted(image.get("RepoDigests") or [])),
        "sourceManifestSha256": frozen["artifact"]["sourceManifestSha256"],
        "sourceVerification": source_evidence,
        "candidateComposeSha256": frozen["artifact"]["targetComposeSha256"],
        "releaseJsonSha256": _sha256_file(os.path.join(final_dir, "release.json")),
        "deltaSha256": frozen["artifact"]["allowedDeltaSha256"],
        "operationSheetSha256": frozen["artifact"]["operationSheetSha256"],
    }
    with _file_lock(paths["lock"], exclusive=True):
        state = _initialize_state(paths, frozen, bundle, stage_evidence)
    _safe_unlink(paths["stageMarker"])
    return {
        "releaseId": frozen["releaseId"],
        "phase": state["phase"],
        "revision": state["revision"],
        "nextOperation": "backup",
        "releaseDirectory": final_dir,
        "planSha256": state["planSha256"],
        "executorSha256": state["executorSha256"],
        "bundleSha256": state["bundleSha256"],
    }


def _read_active_marker(paths):
    if not os.path.lexists(paths["activeMarker"]):
        return None
    _require_private_root_file(paths["activeMarker"], "Persistent global active release marker")
    marker, _raw = _read_json_file(paths["activeMarker"])
    _require_exact_keys(
        marker,
        (
            "schemaVersion",
            "releaseId",
            "operation",
            "operationId",
            "unit",
            "statePath",
            "startedAt",
        ),
        "active release marker",
    )
    _require(marker["schemaVersion"] == 1, "state_corrupt", "Active release marker schema is invalid.")
    return marker


def _read_stage_marker(paths):
    if not os.path.lexists(paths["stageMarker"]):
        return None
    _require_private_root_file(paths["stageMarker"], "Stage-attempt marker")
    marker, _raw = _read_json_file(paths["stageMarker"])
    _require_exact_keys(
        marker,
        ("schemaVersion", "releaseId", "sessionId", "bundleSha256", "startedAt"),
        "stage-attempt marker",
    )
    _require(marker["schemaVersion"] == 1, "state_corrupt", "Stage-attempt marker schema is invalid.")
    return marker


def _next_operation(state, plan):
    if state["phase"] == "backup-verified":
        return "migrate" if plan["migration"]["mode"] == "required" else "no_migration"
    return NEXT_BY_PHASE.get(state["phase"])


def _state_reconciliation_status(plan, paths, exc):
    try:
        marker = _read_active_marker(paths)
    except Exception:
        marker = {"state": "unreadable"}
    failure = _redacted_exception(exc)
    return {
        "releaseId": plan["releaseId"],
        "phase": "blocked",
        "running": True,
        "terminal": True,
        "blocked": True,
        "inFlight": {
            "operation": "state-reconciliation",
            "outcome": "unknown",
            "code": failure["code"],
        },
        "revision": 0,
        "lastSafePhase": None,
        "snapshotRestoreAllowed": False,
        "trafficMayHaveResumed": True,
        "updatedAt": plan["artifact"]["createdAt"],
        "activeMarker": marker,
        "nextOperation": None,
        "planSha256": _sha256_json(plan),
        "executorSha256": plan["artifact"]["executorSha256"],
        "eventsHeadSha256": None,
    }


def _status(request):
    plan = _validate_frozen_plan(request.get("plan"))
    paths = _release_paths(plan)
    stage_marker = _read_stage_marker(paths)
    if not os.path.exists(paths["state"]):
        active_marker = _read_active_marker(paths)
        if stage_marker is not None:
            _require(stage_marker["releaseId"] == plan["releaseId"], "state_corrupt", "Stage-attempt marker belongs to a different release.")
            return {
                "releaseId": plan["releaseId"],
                "phase": "blocked",
                "running": True,
                "terminal": True,
                "blocked": True,
                "inFlight": {
                    "operation": "stage",
                    "sessionId": stage_marker["sessionId"],
                    "outcome": "unknown",
                    "startedAt": stage_marker["startedAt"],
                },
                "revision": 0,
                "lastSafePhase": None,
                "snapshotRestoreAllowed": True,
                "trafficMayHaveResumed": False,
                "updatedAt": stage_marker["startedAt"],
                "activeMarker": active_marker,
                "nextOperation": None,
                "planSha256": _sha256_json(plan),
                "executorSha256": plan["artifact"]["executorSha256"],
                "eventsHeadSha256": None,
            }
        _require(not os.path.exists(paths["releaseDir"]), "state_corrupt", "Release directory exists without a state file.")
        return {
            "releaseId": plan["releaseId"],
            "phase": "not-staged",
            "running": False,
            "terminal": False,
            "blocked": False,
            "inFlight": None,
            "revision": 0,
            "lastSafePhase": None,
            "snapshotRestoreAllowed": True,
            "trafficMayHaveResumed": False,
            "updatedAt": plan["artifact"]["createdAt"],
            "activeMarker": active_marker,
            "nextOperation": None,
            "planSha256": _sha256_json(plan),
            "executorSha256": plan["artifact"]["executorSha256"],
            "eventsHeadSha256": None,
        }
    _require(os.path.isdir(paths["releaseDir"]) and not os.path.islink(paths["releaseDir"]), "release_missing", "Frozen release directory is missing or unsafe.")
    _require(os.path.exists(paths["lock"]), "state_corrupt", "Release lock file is missing.")
    with _file_lock(paths["lock"], exclusive=False):
        try:
            state, stored_plan = _load_state(paths)
        except Exception as exc:
            # State/event updates are two durable files. A power loss between
            # their fsyncs must remain observable without turning `status`
            # itself into a dead end. The persistent global marker prevents a
            # different release ID from crossing this unknown outcome.
            return _state_reconciliation_status(plan, paths, exc)
        _require(stored_plan == plan, "plan_mismatch", "Status plan differs from the staged frozen plan.")
        if stage_marker is not None:
            _require(
                stage_marker["releaseId"] == plan["releaseId"]
                and stage_marker["bundleSha256"] == state["bundleSha256"],
                "state_corrupt",
                "Stage-attempt marker identity differs from prepared state.",
            )
            return {
                "releaseId": state["releaseId"],
                "phase": "blocked",
                "running": True,
                "terminal": True,
                "blocked": True,
                "inFlight": {
                    "operation": "stage",
                    "sessionId": stage_marker["sessionId"],
                    "outcome": "unknown",
                    "startedAt": stage_marker["startedAt"],
                },
                "revision": state["revision"],
                "lastSafePhase": state["lastSafePhase"],
                "snapshotRestoreAllowed": state["snapshotRestoreAllowed"],
                "trafficMayHaveResumed": state["trafficMayHaveResumed"],
                "updatedAt": state["updatedAt"],
                "activeMarker": _read_active_marker(paths),
                "nextOperation": None,
                "planSha256": state["planSha256"],
                "executorSha256": state["executorSha256"],
                "eventsHeadSha256": state["eventsHeadSha256"],
            }
        if state["phase"] == "recorded":
            try:
                _verify_recorded_artifacts(plan, paths, state)
            except Exception as exc:
                return _state_reconciliation_status(plan, paths, exc)
        marker = _read_active_marker(paths)
        running = state["inFlight"] is not None
        return {
            "releaseId": state["releaseId"],
            "phase": state["phase"],
            "running": running,
            "terminal": state["phase"] in TERMINAL_PHASES,
            "blocked": state["phase"] == "blocked",
            "inFlight": copy.deepcopy(state["inFlight"]),
            "revision": state["revision"],
            "lastSafePhase": state["lastSafePhase"],
            "snapshotRestoreAllowed": state["snapshotRestoreAllowed"],
            "trafficMayHaveResumed": state["trafficMayHaveResumed"],
            "updatedAt": state["updatedAt"],
            "activeMarker": marker,
            "nextOperation": _next_operation(state, plan),
            "planSha256": state["planSha256"],
            "executorSha256": state["executorSha256"],
            "eventsHeadSha256": state["eventsHeadSha256"],
        }


def _expected_operation(state, plan, operation):
    expected = _next_operation(state, plan)
    _require(expected == operation, "invalid_transition", "Requested operation is not valid for the current release phase.", {"phase": state["phase"], "expectedOperation": expected})
    if operation == "migrate":
        _require(plan["migration"]["mode"] == "required", "invalid_transition", "Migration operation contradicts the frozen plan.")
    if operation == "no_migration":
        _require(plan["migration"]["mode"] == "none", "invalid_transition", "No-migration operation contradicts the frozen plan.")


def _block_state(paths, state, exc, operation_id=None):
    previous_phase = state["phase"]
    state["phase"] = "blocked"
    if state.get("inFlight") is None and operation_id is not None:
        state["inFlight"] = {"operationId": operation_id, "outcome": "unknown"}
    if isinstance(state.get("inFlight"), dict):
        state["inFlight"]["outcome"] = "unknown" if isinstance(exc, ResultUnknown) else "failed"
        state["inFlight"]["failedAt"] = _utc_now()
    failure = _redacted_exception(exc)
    evidence = state.setdefault("evidence", {})
    evidence["failure"] = {
        "at": _utc_now(),
        "operationId": operation_id,
        "previousPhase": previous_phase,
        "code": failure["code"],
        "detailsSha256": _sha256_json(failure.get("details") or {}),
        "resultUnknown": isinstance(exc, ResultUnknown),
    }
    _save_state_with_event(
        paths,
        state,
        "operation-blocked",
        {
            "operationId": operation_id,
            "previousPhase": previous_phase,
            "code": failure["code"],
            "detailsSha256": evidence["failure"]["detailsSha256"],
            "resultUnknown": isinstance(exc, ResultUnknown),
        },
    )


def _start_operation(request):
    plan = _validate_frozen_plan(request.get("plan"))
    operation = request.get("operation")
    _require(operation in OPERATIONS, "invalid_request", "start_operation.operation is invalid.")
    expected_revision = _require_int(request.get("expectedRevision"), "expectedRevision", 1)
    expected_phase = _require_string(request.get("expectedPhase"), "expectedPhase", 1, 64)
    _require(os.geteuid() == 0, "permission_denied", "Starting a production operation requires root.")
    paths = _release_paths(plan)
    _ensure_private_root_directory(GLOBAL_LOCK_ROOT, "Global release lock root")
    _require(os.path.exists(paths["lock"]), "state_corrupt", "Release lock file is missing.")
    _require(not os.path.lexists(paths["stageMarker"]), "stage_result_unknown", "A stage-attempt marker exists; production operations are locked.")
    operation_id = secrets.token_hex(16)
    unit_release = re.sub(r"[^a-z0-9_-]", "-", plan["releaseId"].lower())[:40]
    unit = "questions-release-%s-%s-%s" % (unit_release, operation.replace("_", "-"), operation_id[:8])
    with _file_lock(paths["globalLock"], exclusive=True):
        with _file_lock(paths["lock"], exclusive=True):
            state, stored_plan = _load_state(paths, verify_bundle=True)
            _require(stored_plan == plan, "plan_mismatch", "Operation plan differs from the staged frozen plan.")
            _require(state["revision"] == expected_revision, "state_changed", "Release state revision changed after status.", {"actualRevision": state["revision"]})
            _require(state["phase"] == expected_phase, "state_changed", "Release phase changed after status.", {"actualPhase": state["phase"]})
            _require(state["phase"] != "blocked", "release_blocked", "Blocked releases require manual read-only diagnosis.")
            _require(state["inFlight"] is None, "operation_in_flight", "A release operation is already in flight.")
            _require(_read_active_marker(paths) is None, "global_operation_active", "A global release marker already exists; do not retry automatically.")
            _expected_operation(state, plan, operation)
            marker = {
                "schemaVersion": 1,
                "releaseId": plan["releaseId"],
                "operation": operation,
                "operationId": operation_id,
                "unit": unit,
                "statePath": paths["state"],
                "startedAt": _utc_now(),
            }
            # Marker first: a crash between the two durable writes leaves an
            # unmistakable global lock rather than permitting another worker.
            _atomic_write_json(paths["activeMarker"], marker, 0o600, require_absent=True)
            state["inFlight"] = {
                "operation": operation,
                "operationId": operation_id,
                "unit": unit,
                "startedAt": marker["startedAt"],
                "outcome": "pending",
            }
            _save_state_with_event(
                paths,
                state,
                "operation-dispatched",
                {
                    "operation": operation,
                    "operationId": operation_id,
                    "unit": unit,
                    "expectedRevision": expected_revision,
                    "expectedPhase": expected_phase,
                },
            )
            command = [
                "systemd-run",
                "--unit=" + unit,
                "--collect",
                "--no-block",
                "--property=Type=oneshot",
                "--property=UMask=0077",
                "--property=WorkingDirectory=" + paths["releaseDir"],
                "--property=NoNewPrivileges=yes",
                "--",
                os.path.realpath(sys.executable),
                paths["runner"],
                "worker",
                "--release-dir",
                paths["releaseDir"],
                "--operation",
                operation,
                "--operation-id",
                operation_id,
            ]
            try:
                _run(command, timeout=30, unknown_on_timeout=True)
            except Exception as exc:
                _block_state(paths, state, exc, operation_id)
                raise
    return {
        "releaseId": plan["releaseId"],
        "phase": state["phase"],
        "running": True,
        "operation": operation,
        "operationId": operation_id,
        "unit": unit,
        "revision": state["revision"],
    }


def _assert_no_other_data_owner(plan):
    production = plan["production"]
    stdout, _stderr, _code = _run(
        ["docker", "container", "ls", "--all", "--quiet", "--no-trunc"],
        timeout=60,
    )
    identifiers = [line.strip() for line in stdout.decode("utf-8", "replace").splitlines() if line.strip()]
    if not identifiers:
        return
    containers = _docker_json(["container", "inspect"] + identifiers, timeout=120)
    owners = []
    expected = os.path.realpath(production["dataHostPath"])
    for container in containers:
        for mount in container.get("Mounts") or []:
            if mount.get("Type") != "bind":
                continue
            mounted_source = os.path.realpath(mount.get("Source", ""))
            overlaps = (
                mounted_source == expected
                or mounted_source.startswith(expected + os.sep)
                or expected.startswith(mounted_source + os.sep)
            )
            if not overlaps:
                continue
            state = container.get("State") or {}
            if state.get("Running"):
                owners.append((container.get("Name") or "").lstrip("/"))
    _require(not owners, "data_directory_busy", "A running container still opens the production data directory.", {"ownerCount": len(owners), "ownersSha256": _sha256_json(sorted(owners))})


def _assert_no_host_database_owner(plan):
    """Reject non-container processes that still hold the production SQLite files."""
    binary = shutil.which("fuser")
    _require(binary is not None and os.path.isabs(binary), "dependency_missing", "fuser is unavailable.")
    database = os.path.join(
        plan["production"]["dataHostPath"],
        plan["production"]["databaseRelativePath"],
    )
    candidates = [database]
    for suffix in ("-wal", "-shm"):
        candidate = database + suffix
        if os.path.exists(candidate):
            candidates.append(candidate)
    stdout, stderr, code = _run(
        [binary, "--"] + candidates,
        timeout=30,
        ok_codes=(0, 1),
        maximum_output=1024 * 1024,
    )
    _require(
        code == 1,
        "data_directory_busy",
        "A host process still holds a production SQLite file.",
        {"ownerEvidenceSha256": _sha256_bytes(stdout + b"\n" + stderr)},
    )


def _manifest_entry(path, archive_name):
    st = os.lstat(path)
    _require(not stat.S_ISLNK(st.st_mode), "unsafe_backup_source", "Backup source contains a symbolic link.", {"pathSha256": _sha256_bytes(path.encode("utf-8"))})
    if stat.S_ISDIR(st.st_mode):
        kind = "directory"
        size = 0
        digest = None
    elif stat.S_ISREG(st.st_mode):
        kind = "file"
        size = st.st_size
        digest = _sha256_file(path)
    else:
        raise ReleaseError("unsafe_backup_source", "Backup source contains an unsupported file type.", {"pathSha256": _sha256_bytes(path.encode("utf-8"))})
    return {
        "archivePath": archive_name,
        "type": kind,
        "mode": stat.S_IMODE(st.st_mode),
        "uid": st.st_uid,
        "gid": st.st_gid,
        "size": size,
        "sha256": digest,
    }


def _backup_source_manifest(plan):
    production = plan["production"]
    data_root = production["dataHostPath"]
    _require(os.path.isdir(data_root) and not os.path.islink(data_root), "unsafe_backup_source", "Production data directory is unsafe.")
    entries = [_manifest_entry(data_root, "pb_data")]
    for current, directories, files in os.walk(data_root, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        relative = os.path.relpath(current, data_root)
        if relative == ".":
            relative = ""
        for name in directories:
            source = os.path.join(current, name)
            archive_name = "/".join(x for x in ("pb_data", relative.replace(os.sep, "/"), name) if x)
            entries.append(_manifest_entry(source, archive_name))
        for name in files:
            source = os.path.join(current, name)
            archive_name = "/".join(x for x in ("pb_data", relative.replace(os.sep, "/"), name) if x)
            entries.append(_manifest_entry(source, archive_name))
    metadata = (
        (production["composePath"], "metadata/compose.yaml"),
        (production["rootReleasePath"], "metadata/release.json"),
        (production["rootChecksumsPath"], "metadata/SHA256SUMS"),
    )
    entries.append(
        {
            "archivePath": "metadata",
            "type": "directory",
            "mode": 0o700,
            "uid": 0,
            "gid": 0,
            "size": 0,
            "sha256": None,
        }
    )
    for source, archive_name in metadata:
        _require(os.path.isfile(source) and not os.path.islink(source), "unsafe_backup_source", "Required production metadata is missing or unsafe.")
        entries.append(_manifest_entry(source, archive_name))
    entries.sort(key=lambda item: item["archivePath"])
    _require(len(entries) == len(set(item["archivePath"] for item in entries)), "unsafe_backup_source", "Backup source manifest contains duplicate paths.")
    return {"schemaVersion": 1, "algorithm": "sha256", "files": entries, "createdAt": _utc_now()}


def _source_for_backup_entry(plan, entry):
    archive_name = entry["archivePath"]
    production = plan["production"]
    if archive_name == "pb_data":
        return production["dataHostPath"]
    if archive_name.startswith("pb_data/"):
        relative = archive_name[len("pb_data/") :]
        target = os.path.realpath(os.path.join(production["dataHostPath"], relative))
        root = os.path.realpath(production["dataHostPath"])
        _require(target.startswith(root + os.sep), "unsafe_backup_source", "Backup source escapes the data directory.")
        return target
    mapping = {
        "metadata/compose.yaml": production["composePath"],
        "metadata/release.json": production["rootReleasePath"],
        "metadata/SHA256SUMS": production["rootChecksumsPath"],
    }
    return mapping.get(archive_name)


def _create_backup_archive(plan, archive_path, manifest):
    _require(not os.path.lexists(archive_path), "already_exists", "Backup archive path already exists.")
    try:
        with tarfile.open(archive_path, "w:gz", dereference=False) as archive:
            for entry in manifest["files"]:
                archive_name = entry["archivePath"]
                if archive_name == "metadata":
                    info = tarfile.TarInfo("metadata")
                    info.type = tarfile.DIRTYPE
                    info.mode = entry["mode"]
                    info.uid = entry["uid"]
                    info.gid = entry["gid"]
                    info.mtime = int(time.time())
                    archive.addfile(info)
                    continue
                source = _source_for_backup_entry(plan, entry)
                _require(source is not None, "internal_error", "Backup manifest source mapping is incomplete.")
                info = archive.gettarinfo(source, arcname=archive_name)
                _require(
                    (entry["type"] == "file" and info.isfile())
                    or (entry["type"] == "directory" and info.isdir()),
                    "backup_source_changed",
                    "Backup source type changed while archiving.",
                )
                _require(stat.S_IMODE(info.mode) == entry["mode"] and info.uid == entry["uid"] and info.gid == entry["gid"], "backup_source_changed", "Backup source metadata changed while archiving.")
                if info.isfile():
                    _require(info.size == entry["size"] and _sha256_file(source) == entry["sha256"], "backup_source_changed", "Backup source content changed while archiving.")
                    with open(source, "rb") as handle:
                        archive.addfile(info, handle)
                else:
                    archive.addfile(info)
            manifest_raw = _canonical_bytes(manifest) + b"\n"
            info = tarfile.TarInfo("backup-file-manifest.json")
            info.size = len(manifest_raw)
            info.mode = 0o600
            info.uid = 0
            info.gid = 0
            info.mtime = int(time.time())
            archive.addfile(info, io.BytesIO(manifest_raw))
    except (tarfile.TarError, OSError):
        raise ReleaseError("backup_archive_failed", "Stopped production data could not be archived.")
    os.chmod(archive_path, 0o600)
    descriptor = os.open(archive_path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _fsync_directory(os.path.dirname(archive_path))


def _restore_backup_archive(archive_path, restore_root, expected_manifest):
    _mkdir_private(restore_root)
    expected_entries = {item["archivePath"]: item for item in expected_manifest["files"]}
    expected_names = set(expected_entries.keys()) | {"backup-file-manifest.json"}
    try:
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            names = []
            for member in members:
                name = member.name.replace("\\", "/").rstrip("/")
                _require(name == member.name.rstrip("/"), "unsafe_backup_archive", "Backup archive path is not portable.")
                _require_relative_path(name, "backup archive member")
                _require(name in expected_names, "unsafe_backup_archive", "Backup archive contains an unexpected member.")
                _require(not member.issym() and not member.islnk(), "unsafe_backup_archive", "Backup archive links are forbidden.")
                expected = expected_entries.get(name)
                if name == "backup-file-manifest.json":
                    _require(member.isfile(), "unsafe_backup_archive", "Backup manifest member is not a file.")
                elif expected["type"] == "directory":
                    _require(member.isdir(), "unsafe_backup_archive", "Backup directory member type differs from manifest.")
                else:
                    _require(member.isfile(), "unsafe_backup_archive", "Backup file member type differs from manifest.")
                names.append(name)
            _require(len(names) == len(set(names)) and set(names) == expected_names, "unsafe_backup_archive", "Backup archive member set differs from its manifest.")
            manifest_member = archive.getmember("backup-file-manifest.json")
            embedded_raw = archive.extractfile(manifest_member).read(MAX_JSON_BYTES + 1)
            _require(len(embedded_raw) <= MAX_JSON_BYTES, "file_too_large", "Embedded backup manifest is too large.")
            try:
                embedded = _json_loads_strict(embedded_raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                raise ReleaseError("unsafe_backup_archive", "Embedded backup manifest is invalid.")
            _require(embedded == expected_manifest, "unsafe_backup_archive", "Embedded backup manifest differs from the verified external manifest.")
            for member in sorted(members, key=lambda item: (not item.isdir(), item.name)):
                name = member.name.rstrip("/")
                if name == "backup-file-manifest.json":
                    continue
                expected = expected_entries[name]
                target = os.path.join(restore_root, name)
                parent = os.path.dirname(target)
                _require(os.path.realpath(parent).startswith(os.path.realpath(restore_root) + os.sep) or os.path.realpath(parent) == os.path.realpath(restore_root), "unsafe_backup_archive", "Backup extraction target escapes restore root.")
                if expected["type"] == "directory":
                    if not os.path.exists(target):
                        os.mkdir(target, expected["mode"])
                    os.chmod(target, expected["mode"])
                    os.chown(target, expected["uid"], expected["gid"])
                else:
                    _require(os.path.isdir(parent), "unsafe_backup_archive", "Backup file parent is missing.")
                    source = archive.extractfile(member)
                    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, expected["mode"])
                    try:
                        remaining = member.size
                        while remaining:
                            chunk = source.read(min(1024 * 1024, remaining))
                            _require(bool(chunk), "unsafe_backup_archive", "Backup file ended early.")
                            os.write(descriptor, chunk)
                            remaining -= len(chunk)
                        os.fsync(descriptor)
                        os.fchmod(descriptor, expected["mode"])
                        os.fchown(descriptor, expected["uid"], expected["gid"])
                    finally:
                        os.close(descriptor)
    except (tarfile.TarError, OSError):
        raise ReleaseError("backup_restore_failed", "Backup archive could not be restored safely.")
    _verify_restored_manifest(restore_root, expected_manifest)


def _verify_restored_manifest(restore_root, manifest):
    expected = {item["archivePath"]: item for item in manifest["files"]}
    actual_names = []
    for current, directories, files in os.walk(restore_root, topdown=True, followlinks=False):
        directories.sort()
        files.sort()
        relative = os.path.relpath(current, restore_root)
        if relative != ".":
            actual_names.append(relative.replace(os.sep, "/"))
        for name in files:
            relative_file = os.path.join(relative, name).replace(os.sep, "/")
            while relative_file.startswith("./"):
                relative_file = relative_file[2:]
            actual_names.append(relative_file)
    _require(set(actual_names) == set(expected.keys()), "backup_restore_mismatch", "Restored backup member set differs from the manifest.")
    for name, item in expected.items():
        path = os.path.join(restore_root, name)
        st = os.lstat(path)
        actual_type = "directory" if stat.S_ISDIR(st.st_mode) else "file" if stat.S_ISREG(st.st_mode) else "other"
        _require(actual_type == item["type"], "backup_restore_mismatch", "Restored backup file type differs from the manifest.")
        _require(stat.S_IMODE(st.st_mode) == item["mode"] and st.st_uid == item["uid"] and st.st_gid == item["gid"], "backup_restore_mismatch", "Restored backup metadata differs from the manifest.")
        if item["type"] == "file":
            _require(st.st_size == item["size"] and _sha256_file(path) == item["sha256"], "backup_restore_mismatch", "Restored backup content differs from the manifest.")


def _job_container_name(plan, operation_id, purpose):
    release = re.sub(r"[^a-z0-9_.-]", "-", plan["releaseId"].lower())[:36]
    purpose = re.sub(r"[^a-z0-9_.-]", "-", purpose.lower())[:20]
    return "questions-release-%s-%s-%s" % (release, purpose, operation_id[:8])


def _create_data_job(plan, name, data_path, command):
    _require(not _container_exists(name), "container_name_conflict", "A persistent release job container already exists; do not retry automatically.", {"container": name})
    _require(os.path.isdir(data_path) and not os.path.islink(data_path), "unsafe_path", "Release job data path is unsafe.")
    production = plan["production"]
    mount = "type=bind,source=%s,target=%s" % (data_path, production["dataContainerPath"])
    _run(
        [
            "docker",
            "create",
            "--name",
            name,
            "--network",
            "none",
            "--platform",
            "linux/amd64",
            "--security-opt",
            "no-new-privileges:true",
            "--cap-drop",
            "ALL",
            "--mount",
            mount,
            # Use the immutable config digest for every database-owning job.
            # The reviewed tag is re-anchored separately before each dangerous
            # stage, but a concurrent retag can never change this container.
            plan["artifact"]["targetImageConfigDigest"],
        ]
        + list(command),
        timeout=120,
        unknown_on_timeout=True,
    )
    created = _docker_inspect_container(name)
    _require(
        created.get("Image") == plan["artifact"]["targetImageConfigDigest"],
        "image_mismatch",
        "Release job container does not use the frozen image ID.",
    )
    _require(
        not (created.get("State") or {}).get("Running"),
        "container_mismatch",
        "A newly created release job started before verification.",
    )
    return created


def _start_and_wait_job(name, timeout):
    _run(["docker", "start", name], timeout=30, unknown_on_timeout=True)
    deadline = time.time() + timeout
    while time.time() < deadline:
        container = _docker_inspect_container(name)
        state = container.get("State") or {}
        if not state.get("Running"):
            exit_code = state.get("ExitCode")
            if exit_code != 0:
                stdout, stderr, _code = _run(["docker", "logs", name], timeout=30, ok_codes=(0, 1))
                raise ReleaseError("job_failed", "A persistent release job container failed.", {"container": name, "exitCode": exit_code, "logsSha256": _sha256_bytes(stdout + b"\n" + stderr)})
            return container
        time.sleep(1)
    raise ResultUnknown("A persistent release job container did not reach a terminal state before timeout.", {"container": name, "timeoutSeconds": timeout})


def _migration_command(plan):
    data_dir = plan["production"]["dataContainerPath"]
    return [
        "migrate",
        "up",
        "--dir=" + data_dir,
        "--hooksDir=/pb/pb_hooks",
        "--migrationsDir=/pb/pb_migrations",
        "--automigrate=false",
    ]


def _run_migration_job(plan, name, data_path, timeout):
    _create_data_job(plan, name, data_path, _migration_command(plan))
    container = _start_and_wait_job(name, timeout)
    return {
        "container": name,
        "containerId": container.get("Id"),
        "imageId": container.get("Image"),
        "finishedAt": (container.get("State") or {}).get("FinishedAt"),
        "exitCode": (container.get("State") or {}).get("ExitCode"),
    }


def _wait_container_http(name, timeout):
    deadline = time.time() + timeout
    consecutive = 0
    while time.time() < deadline:
        container = _docker_inspect_container(name)
        state = container.get("State") or {}
        if not state.get("Running"):
            raise ReleaseError("serve_validation_failed", "Restore serve validation container exited before becoming stable.", {"container": name, "exitCode": state.get("ExitCode")})
        _stdout, _stderr, code = _run(
            ["docker", "exec", name, "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8090/api/health"],
            timeout=10,
            ok_codes=(0, 1),
        )
        if code == 0:
            consecutive += 1
            if consecutive >= 3:
                return
        else:
            consecutive = 0
        time.sleep(1)
    raise ResultUnknown("Restore serve validation did not become stable before timeout.", {"container": name, "timeoutSeconds": timeout})


def _run_serve_cycle(plan, name, data_path, timeout):
    command = [
        "serve",
        "--http=0.0.0.0:8090",
        "--dir=" + plan["production"]["dataContainerPath"],
        "--hooksDir=/pb/pb_hooks",
        "--migrationsDir=/pb/pb_migrations",
        "--automigrate=false",
    ]
    _create_data_job(plan, name, data_path, command)
    _run(["docker", "start", name], timeout=30, unknown_on_timeout=True)
    _wait_container_http(name, timeout)
    _run(["docker", "stop", "--time", "30", name], timeout=60, unknown_on_timeout=True)
    container = _docker_inspect_container(name)
    _require(not (container.get("State") or {}).get("Running"), "serve_validation_failed", "Restore serve validation container is still running.")
    return {
        "container": name,
        "containerId": container.get("Id"),
        "imageId": container.get("Image"),
        "finishedAt": (container.get("State") or {}).get("FinishedAt"),
    }


def _validate_sqlite_stat1_delta(before, after):
    def keyed(summary):
        rows = summary.get("sqliteStat1")
        _require(isinstance(rows, list), "delta_mismatch", "SQLite statistics evidence is missing or invalid.")
        table_summary = summary.get("tables", {}).get("sqlite_stat1")
        _require(
            (table_summary is None and not rows)
            or (isinstance(table_summary, dict) and table_summary.get("rowCount") == len(rows)),
            "delta_mismatch",
            "SQLite statistics evidence differs from its table row count.",
        )
        result = {}
        for row in rows:
            _require(
                isinstance(row, dict)
                and set(row.keys()) == {"table", "index", "statSha256"}
                and isinstance(row.get("table"), str)
                and row["table"]
                and (row.get("index") is None or (isinstance(row["index"], str) and row["index"]))
                and isinstance(row.get("statSha256"), str)
                and bool(SHA256_RE.match(row["statSha256"])),
                "delta_mismatch",
                "SQLite statistics evidence contains an invalid row.",
            )
            key = (row["table"], row["index"])
            _require(key not in result, "delta_mismatch", "SQLite statistics evidence contains a duplicate key.")
            result[key] = row["statSha256"]
        return result

    before_rows = keyed(before)
    after_rows = keyed(after)
    _require(
        set(before_rows).issubset(set(after_rows)),
        "delta_mismatch",
        "Migration removed an existing SQLite statistics row.",
    )
    for key, digest in before_rows.items():
        _require(
            after_rows[key] == digest,
            "delta_mismatch",
            "Migration changed an existing SQLite statistics row.",
            {"table": key[0], "index": key[1]},
        )
    known_indexes = {
        (item["table"], item["name"])
        for item in after["schemaObjects"]
        if item["type"] == "index"
    }
    added = sorted(
        set(after_rows) - set(before_rows),
        key=lambda item: (item[0], "" if item[1] is None else item[1]),
    )
    for key in added:
        _require(
            key[1] is not None and key in known_indexes,
            "delta_mismatch",
            "Migration added SQLite statistics for an unknown index.",
            {"table": key[0], "index": key[1]},
        )
    return {
        "addedCount": len(added),
        "addedKeysSha256": _sha256_json(
            [{"table": key[0], "index": key[1]} for key in added]
        ),
    }


def _validate_additive_delta(before, after, delta, planned_new_files):
    before_objects = {
        (item["type"], item["name"], item["table"]): item
        for item in before["schemaObjects"]
    }
    after_objects = {
        (item["type"], item["name"], item["table"]): item
        for item in after["schemaObjects"]
    }
    _require(set(before_objects).issubset(set(after_objects)), "delta_mismatch", "Migration removed an existing schema object.")
    for key, item in before_objects.items():
        _require(after_objects[key] == item, "delta_mismatch", "Migration changed an existing schema object.", {"objectType": key[0], "objectName": key[1]})
    actual_added_objects = sorted(set(after_objects) - set(before_objects))
    expected_added_objects = sorted((item["type"], item["name"], item["table"]) for item in delta["newSchemaObjects"])
    _require(actual_added_objects == expected_added_objects, "delta_mismatch", "Migration schema additions differ from the allowed delta.", {"actualCount": len(actual_added_objects), "expectedCount": len(expected_added_objects)})

    before_tables = before["tables"]
    after_tables = after["tables"]
    _require(set(before_tables).issubset(set(after_tables)), "delta_mismatch", "Migration removed an existing table.")
    expected_new_tables = sorted(item["name"] for item in delta["newSchemaObjects"] if item["type"] == "table")
    actual_new_tables = sorted(set(after_tables) - set(before_tables))
    _require(actual_new_tables == expected_new_tables, "delta_mismatch", "Migration table additions differ from the allowed delta.")
    sqlite_stat1_evidence = _validate_sqlite_stat1_delta(before, after)
    for table in before_tables:
        if table in ("_migrations", "_collections", "sqlite_stat1"):
            continue
        _require(after_tables[table] == before_tables[table], "delta_mismatch", "Migration changed an existing business or system table.", {"table": table})
    for table in delta["emptyTables"]:
        _require(table in after_tables and after_tables[table]["rowCount"] == 0, "delta_mismatch", "A table required to be empty is missing or contains records.", {"table": table})
    for table in actual_new_tables:
        _require(after_tables[table]["rowCount"] == 0, "delta_mismatch", "A newly added table is not empty.", {"table": table})

    expected_migration_files = sorted(before["migrationFiles"] + planned_new_files)
    _require(expected_migration_files == after["migrationFiles"], "delta_mismatch", "Migration ledger filenames differ from the planned append.")
    _require(len(after["migrationFiles"]) == len(set(after["migrationFiles"])), "delta_mismatch", "Migration ledger contains duplicate filenames.")
    _require(
        sorted(before["migrationRows"]) == before["migrationFiles"]
        and sorted(after["migrationRows"]) == after["migrationFiles"],
        "delta_mismatch",
        "Migration ledger row evidence differs from its filename index.",
    )
    for filename, digest in before["migrationRows"].items():
        _require(
            after["migrationRows"].get(filename) == digest,
            "delta_mismatch",
            "Migration changed an existing migration-ledger row.",
            {"migrationFile": filename},
        )
    before_collections = before["collections"]
    after_collections = after["collections"]
    _require(set(before_collections).issubset(set(after_collections)), "delta_mismatch", "Migration removed an existing PocketBase collection.")
    for name, item in before_collections.items():
        _require(after_collections[name] == item, "delta_mismatch", "Migration changed an existing PocketBase collection.", {"collection": name})
    expected_collections = sorted(item["name"] for item in delta["newCollections"])
    actual_collections = sorted(set(after_collections) - set(before_collections))
    _require(actual_collections == expected_collections, "delta_mismatch", "PocketBase collection additions differ from the allowed delta.")
    collection_rules = {item["name"]: item["requirePrivate"] for item in delta["newCollections"]}
    for name in actual_collections:
        if collection_rules[name]:
            _require(after_collections[name]["private"] is True, "delta_mismatch", "A new collection required to be private has an access rule.", {"collection": name})
    return {
        "beforeSummarySha256": before["summarySha256"],
        "afterSummarySha256": after["summarySha256"],
        "addedSchemaObjectCount": len(actual_added_objects),
        "addedTableCount": len(actual_new_tables),
        "addedCollectionCount": len(actual_collections),
        "addedMigrationCount": len(planned_new_files),
        "addedSqliteStatisticCount": sqlite_stat1_evidence["addedCount"],
        "addedSqliteStatisticKeysSha256": sqlite_stat1_evidence["addedKeysSha256"],
    }


def _validate_migration_delta(before, after, delta, planned_new_files):
    if delta["verifier"] == DELTA_VERIFIER:
        return _validate_additive_delta(before, after, delta, planned_new_files)
    _require(delta["verifier"] == CONTEXT_VERIFIER and _canonical_bytes(delta.get("contextEvolution")) == _canonical_bytes(CONTEXT_EVOLUTION)
             and planned_new_files == [CONTEXT_MIGRATION] and delta["newMigrationFiles"] == planned_new_files
             and delta["newCollections"] == [] and delta["newSchemaObjects"] == [] and delta["emptyTables"] == [],
             "delta_mismatch", "Context evolution declaration differs from its fixed reviewed contract.")
    old = before.get("contextEvolution")
    new = after.get("contextEvolution")
    _require(isinstance(old, dict) and isinstance(new, dict)
             and old["hasKind"] is False and new["hasKind"] is True
             and old["validFields"] is True and new["validFields"] is True,
             "delta_mismatch", "Context session/kind field definitions differ from the reviewed transition.")
    _require(old["normalizedCollectionSha256"] == new["normalizedCollectionSha256"]
             and before["collections"][CONTEXT_TABLE]["private"] is True
             and after["collections"][CONTEXT_TABLE]["private"] is True,
             "delta_mismatch", "Context collection changed outside session.required, the exact kind field and updated timestamp.")
    timestamp = r"^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$"
    _require(isinstance(old["updated"], str) and isinstance(new["updated"], str)
             and bool(re.match(timestamp, old["updated"])) and bool(re.match(timestamp, new["updated"]))
             and new["updated"] >= old["updated"], "delta_mismatch", "Context collection updated timestamp regressed or is invalid.")
    _require([item[1] for item in old["columnInfo"]] == ["id", "notification", "session"]
             and new["columnInfo"] == old["columnInfo"] + [[3, "kind", "TEXT", 1, "''", 0]],
             "delta_mismatch", "Context SQL columns differ outside the exact appended kind column.")
    _require(old["missingSessionCount"] == 0 and new["missingSessionCount"] == 0
             and new["nonSessionKindCount"] == 0 and new["legacyRows"] == old["legacyRows"]
             and old["legacyRows"] == before["tables"][CONTEXT_TABLE],
             "delta_mismatch", "Context migration changed old rows or did not backfill every kind to session.")
    normalized = copy.deepcopy(after)
    old_object = [item for item in before["schemaObjects"] if item["type"] == "table" and item["name"] == CONTEXT_TABLE]
    new_object = [item for item in normalized["schemaObjects"] if item["type"] == "table" and item["name"] == CONTEXT_TABLE]
    _require(len(old_object) == len(new_object) == 1
             and new_object[0]["sqlSha256"] == old["expectedAddedKindSqlSha256"],
             "delta_mismatch", "Context CREATE TABLE SQL differs from the exact reviewed append.")
    new_object[0]["sqlSha256"] = old_object[0]["sqlSha256"]
    normalized["tables"][CONTEXT_TABLE] = copy.deepcopy(before["tables"][CONTEXT_TABLE])
    normalized["collections"][CONTEXT_TABLE] = copy.deepcopy(before["collections"][CONTEXT_TABLE])
    result = _validate_additive_delta(before, normalized, delta, planned_new_files)
    result.update({"afterSummarySha256": after["summarySha256"], "contextEvolution": CONTEXT_EVOLUTION,
                   "preservedContextRowCount": old["legacyRows"]["rowCount"]})
    return result


def _equivalent_rehearsed_outcome(rehearsed, production, delta):
    _require(rehearsed["schemaObjects"] == production["schemaObjects"], "migration_outcome_mismatch", "Production schema differs from the rehearsed migration outcome.")
    _require(rehearsed["migrationFiles"] == production["migrationFiles"], "migration_outcome_mismatch", "Production migration ledger filenames differ from rehearsal.")
    _require(
        sorted(rehearsed["migrationRows"]) == rehearsed["migrationFiles"]
        and sorted(production["migrationRows"]) == production["migrationFiles"],
        "migration_outcome_mismatch",
        "Production migration ledger row evidence differs from rehearsal.",
    )
    new_migration_files = set(delta["newMigrationFiles"])
    for filename, digest in rehearsed["migrationRows"].items():
        if filename not in new_migration_files:
            _require(
                production["migrationRows"].get(filename) == digest,
                "migration_outcome_mismatch",
                "Production changed an existing migration-ledger row.",
                {"migrationFile": filename},
            )
    _require(set(rehearsed["tables"]) == set(production["tables"]), "migration_outcome_mismatch", "Production table set differs from rehearsal.")
    for table in rehearsed["tables"]:
        if table in ("_migrations", "_collections"):
            _require(rehearsed["tables"][table]["rowCount"] == production["tables"][table]["rowCount"], "migration_outcome_mismatch", "Production system table count differs from rehearsal.", {"table": table})
        else:
            _require(rehearsed["tables"][table] == production["tables"][table], "migration_outcome_mismatch", "Production table digest differs from rehearsal.", {"table": table})
    _require(set(rehearsed["collections"]) == set(production["collections"]), "migration_outcome_mismatch", "Production collection set differs from rehearsal.")
    new_names = set(item["name"] for item in delta["newCollections"])
    for name in rehearsed["collections"]:
        if name in new_names:
            for key in ("type", "private"):
                _require(rehearsed["collections"][name][key] == production["collections"][name][key], "migration_outcome_mismatch", "A new production collection property differs from rehearsal.", {"collection": name, "property": key})
        elif delta.get("verifier") == CONTEXT_VERIFIER and name == CONTEXT_TABLE:
            left, right = rehearsed["contextEvolution"], production["contextEvolution"]
            _require(left["validFields"] and right["validFields"] and left["hasKind"] and right["hasKind"]
                     and left["normalizedCollectionSha256"] == right["normalizedCollectionSha256"],
                     "migration_outcome_mismatch", "Context collection differs from the rehearsed outcome outside its generated updated timestamp.")
        else:
            _require(rehearsed["collections"][name] == production["collections"][name], "migration_outcome_mismatch", "An existing collection differs from rehearsal.", {"collection": name})


def _validate_post_switch_structure(baseline, current, delta):
    """Allow live row changes while keeping the deployed database contract fixed."""
    _require(
        current["migrationFiles"] == baseline["migrationFiles"],
        "data_verification_failed",
        "Post-switch migration ledger filenames differ from the verified baseline.",
    )
    _require(
        current["schemaObjects"] == baseline["schemaObjects"],
        "data_verification_failed",
        "Post-switch SQLite schema differs from the verified baseline.",
    )
    _require(
        set(current["tables"]) == set(baseline["tables"]),
        "data_verification_failed",
        "Post-switch table set differs from the verified baseline.",
    )
    _require(
        "_migrations" in current["tables"]
        and current["migrationRows"] == baseline["migrationRows"]
        and current["tables"]["_migrations"] == baseline["tables"]["_migrations"],
        "data_verification_failed",
        "Post-switch migration ledger rows differ from the verified baseline.",
    )
    for table in baseline["tables"]:
        _require(
            current["tables"][table]["columns"]
            == baseline["tables"][table]["columns"],
            "data_verification_failed",
            "Post-switch table columns differ from the verified baseline.",
            {"table": table},
        )
    _require(
        current["collections"] == baseline["collections"],
        "data_verification_failed",
        "Post-switch PocketBase collection definitions differ from the verified baseline.",
    )
    inactive_tables = []
    for table in delta["emptyTables"]:
        _require(
            table in current["tables"]
            and current["tables"][table]["rowCount"] == 0,
            "activation_detected",
            "A feature table required to remain empty before activation contains records.",
            {"table": table},
        )
        inactive_tables.append(table)
    changed_row_tables = []
    for table in baseline["tables"]:
        before = baseline["tables"][table]
        after = current["tables"][table]
        if (
            before.get("rowCount") != after.get("rowCount")
            or before.get("rowDigest") != after.get("rowDigest")
        ):
            changed_row_tables.append(table)
    return {
        "baselineSummarySha256": baseline["summarySha256"],
        "currentSummarySha256": current["summarySha256"],
        "schemaDigest": current["schemaDigest"],
        "tableCount": len(current["tables"]),
        "collectionCount": len(current["collections"]),
        "migrationFileCount": len(current["migrationFiles"]),
        "inactiveEmptyTables": sorted(inactive_tables),
        "changedRowTableCount": len(changed_row_tables),
        "changedRowTablesSha256": _sha256_json(sorted(changed_row_tables)),
        "liveBusinessRowsMayHaveChanged": bool(changed_row_tables),
    }


def _backup_verification_path(plan, state):
    backup = (state.get("evidence") or {}).get("backup")
    _require_exact_keys(
        backup,
        (
            "backupDirectory",
            "archivePath",
            "archiveSha256",
            "archiveSize",
            "fileManifestSha256",
            "verificationPath",
            "verificationSha256",
            "beforeSummarySha256",
            "restoredAfterSummarySha256",
            "maintenanceStartedAt",
            "verifiedAt",
        ),
        "verified backup evidence",
    )
    backup_dir = _require_absolute_path(backup["backupDirectory"], "verified backup directory")
    archive_path = _require_absolute_path(backup["archivePath"], "verified backup archive")
    verification_path = _require_absolute_path(backup["verificationPath"], "verified backup report")
    archive_sha = _require_sha(backup["archiveSha256"], "verified backup archiveSha256")
    manifest_sha = _require_sha(backup["fileManifestSha256"], "verified backup fileManifestSha256")
    verification_sha = _require_sha(backup["verificationSha256"], "verified backup verificationSha256")
    _require_sha(backup["beforeSummarySha256"], "verified backup beforeSummarySha256")
    _require_sha(backup["restoredAfterSummarySha256"], "verified backup restoredAfterSummarySha256")
    _require_string(backup["maintenanceStartedAt"], "verified backup maintenanceStartedAt", 1, 128)
    _require_string(backup["verifiedAt"], "verified backup verifiedAt", 1, 128)
    archive_size = _require_int(backup["archiveSize"], "verified backup archiveSize", 1)
    prefix = plan["releaseId"] + "."
    base_name = os.path.basename(backup_dir)
    _require(
        os.path.dirname(backup_dir) == plan["server"]["backupRoot"]
        and base_name.startswith(prefix),
        "backup_mismatch",
        "Verified backup directory is outside the frozen backup root.",
    )
    operation_id = base_name[len(prefix) :]
    _require(bool(RELEASE_ID_RE.match(operation_id)), "backup_mismatch", "Verified backup operation ID is invalid.")
    expected_archive = os.path.join(backup_dir, "pre-upgrade.tar.gz")
    expected_manifest = os.path.join(backup_dir, "backup-file-manifest.json")
    expected_checksums = os.path.join(backup_dir, "SHA256SUMS")
    expected_verification = os.path.join(backup_dir, "backup-verification.json")
    _require(
        archive_path == expected_archive and verification_path == expected_verification,
        "backup_mismatch",
        "Verified backup evidence paths differ from the frozen backup layout.",
    )
    _secure_directory_chain(backup_dir, "Verified backup directory", require_private_leaf=True)
    _require(os.path.isfile(verification_path), "backup_missing", "Verified backup report is missing.")
    _require_private_root_file(verification_path, "Verified backup report", verification_sha)
    report, _raw = _read_json_file(verification_path)
    _require_exact_keys(
        report,
        (
            "schemaVersion",
            "releaseId",
            "operationId",
            "maintenanceStartedAt",
            "targetStoppedAt",
            "backupDirectory",
            "archivePath",
            "archiveSize",
            "archiveSha256",
            "fileManifestSha256",
            "fileCount",
            "productionBefore",
            "restoredBefore",
            "restoredAfterMigration",
            "deltaEvidence",
            "migrationJob",
            "serveCycles",
            "stableSummarySha256s",
            "verifiedAt",
        ),
        "verified backup report",
    )
    _require(
        isinstance(report["productionBefore"], dict)
        and isinstance(report["restoredAfterMigration"], dict),
        "backup_mismatch",
        "Verified backup report database evidence is invalid.",
    )
    _require(
        report["schemaVersion"] == 1
        and report["releaseId"] == plan["releaseId"]
        and report["operationId"] == operation_id
        and report["backupDirectory"] == backup_dir
        and report["archivePath"] == archive_path
        and report["archiveSize"] == archive_size
        and report["archiveSha256"] == archive_sha
        and report["fileManifestSha256"] == manifest_sha
        and report["maintenanceStartedAt"] == backup["maintenanceStartedAt"]
        and report["verifiedAt"] == backup["verifiedAt"]
        and report["productionBefore"].get("summarySha256") == backup["beforeSummarySha256"]
        and report["restoredAfterMigration"].get("summarySha256") == backup["restoredAfterSummarySha256"],
        "backup_mismatch",
        "Verified backup report differs from the durable release state.",
    )
    for filename, label, digest in (
        (archive_path, "Verified backup archive", archive_sha),
        (expected_manifest, "Verified backup file manifest", manifest_sha),
    ):
        _require(os.path.isfile(filename), "backup_missing", label + " is missing.")
        file_info = _require_private_root_file(filename, label, digest)
        if filename == archive_path:
            _require(file_info.st_size == archive_size, "backup_mismatch", "Verified backup archive size differs from state.")
    _require(os.path.isfile(expected_checksums), "backup_missing", "Verified backup checksum manifest is missing.")
    _require_private_root_file(expected_checksums, "Verified backup checksum manifest")
    checksums = _parse_checksum_file(
        expected_checksums,
        ("pre-upgrade.tar.gz", "backup-file-manifest.json"),
    )
    _require(
        checksums["pre-upgrade.tar.gz"] == archive_sha
        and checksums["backup-file-manifest.json"] == manifest_sha,
        "backup_mismatch",
        "Verified backup checksum manifest differs from state.",
    )
    manifest, _manifest_raw = _read_json_file(expected_manifest)
    _require_exact_keys(manifest, ("schemaVersion", "algorithm", "files", "createdAt"), "verified backup file manifest")
    _require(
        manifest["schemaVersion"] == 1
        and manifest["algorithm"] == "sha256"
        and isinstance(manifest["files"], list)
        and len(manifest["files"]) == report["fileCount"],
        "backup_mismatch",
        "Verified backup file manifest differs from its report.",
    )
    return report


def _operation_backup(plan, paths, operation_id):
    production = plan["production"]
    _verify_frozen_target_image(plan)
    _current_facts(plan, require_running=True, full_database=True)
    backup_root = plan["server"]["backupRoot"]
    _ensure_private_root_directory(backup_root, "Backup root")
    estimated_source_bytes, estimated_source_entries = _estimate_tree_logical_usage(
        production["dataHostPath"]
    )
    _space_budget(
        plan,
        _base_space_allocations(plan)
        + [
            (
                "backupArchiveRestoreAndMigration",
                backup_root,
                _backup_projected_write_bytes(
                    estimated_source_bytes,
                    estimated_source_entries,
                ),
            )
        ],
    )
    backup_dir = os.path.join(backup_root, "%s.%s" % (plan["releaseId"], operation_id))
    _require(not os.path.lexists(backup_dir), "already_exists", "This release operation already has a backup directory.")
    _mkdir_private(backup_dir)
    maintenance_started = _utc_now()
    _run(
        _compose_command(
            plan,
            production["composePath"],
            [
                "stop",
                "--timeout",
                str(min(max(plan["verification"]["healthTimeoutSeconds"], 30), 300)),
                production["composeService"],
            ],
        ),
        timeout=min(max(plan["verification"]["healthTimeoutSeconds"] + 30, 60), 360),
        unknown_on_timeout=True,
    )
    stopped = _docker_inspect_container(production["containerName"])
    _require(not (stopped.get("State") or {}).get("Running"), "stop_failed", "Target production container is still running after stop.")
    _assert_no_other_data_owner(plan)
    _assert_no_host_database_owner(plan)
    stopped_facts = _current_facts(plan, require_running=False, full_database=True)
    before = stopped_facts["database"]
    manifest = _backup_source_manifest(plan)
    manifest_source_bytes = sum(
        item["size"] for item in manifest["files"] if item["type"] == "file"
    )
    _space_budget(
        plan,
        _base_space_allocations(plan)
        + [
            (
                "backupArchiveRestoreAndMigration",
                backup_root,
                _backup_projected_write_bytes(
                    manifest_source_bytes,
                    len(manifest["files"]),
                ),
            )
        ],
    )
    manifest_path = os.path.join(backup_dir, "backup-file-manifest.json")
    _atomic_write_json(manifest_path, manifest, 0o600, require_absent=True)
    archive_path = os.path.join(backup_dir, "pre-upgrade.tar.gz")
    _create_backup_archive(plan, archive_path, manifest)
    archive_sha = _sha256_file(archive_path)
    _atomic_write_bytes(
        os.path.join(backup_dir, "SHA256SUMS"),
        ("%s  pre-upgrade.tar.gz\n%s  backup-file-manifest.json\n" % (archive_sha, _sha256_file(manifest_path))).encode("ascii"),
        0o600,
        require_absent=True,
    )
    restore_root = os.path.join(backup_dir, "restore")
    _restore_backup_archive(archive_path, restore_root, manifest)
    restored_data = os.path.join(restore_root, "pb_data")
    restored_before = _sqlite_summary(os.path.join(restored_data, production["databaseRelativePath"]))
    _require(restored_before == before, "backup_restore_mismatch", "Restored SQLite summary differs from stopped production.")

    migration_name = _job_container_name(plan, operation_id, "restore-migrate")
    migration_job = _run_migration_job(
        plan,
        migration_name,
        restored_data,
        max(plan["verification"]["healthTimeoutSeconds"], 120),
    )
    restored_after_migration = _sqlite_summary(os.path.join(restored_data, production["databaseRelativePath"]))
    delta, _delta_raw = _read_json_file(paths["delta"])
    delta = _validate_delta(delta, plan)
    delta_evidence = _validate_migration_delta(before, restored_after_migration, delta, plan["migration"]["newFiles"])

    serve_cycles = []
    stable_summaries = []
    for index in (1, 2):
        name = _job_container_name(plan, operation_id, "restore-serve-%d" % index)
        serve_cycles.append(
            _run_serve_cycle(
                plan,
                name,
                restored_data,
                plan["verification"]["healthTimeoutSeconds"],
            )
        )
        summary = _sqlite_summary(os.path.join(restored_data, production["databaseRelativePath"]))
        _require(summary == restored_after_migration, "serve_validation_failed", "Restored database changed during a serve stability cycle.", {"cycle": index})
        stable_summaries.append(summary["summarySha256"])

    verification = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "operationId": operation_id,
        "maintenanceStartedAt": maintenance_started,
        "targetStoppedAt": (stopped.get("State") or {}).get("FinishedAt"),
        "backupDirectory": backup_dir,
        "archivePath": archive_path,
        "archiveSize": os.path.getsize(archive_path),
        "archiveSha256": archive_sha,
        "fileManifestSha256": _sha256_file(manifest_path),
        "fileCount": len(manifest["files"]),
        "productionBefore": before,
        "restoredBefore": restored_before,
        "restoredAfterMigration": restored_after_migration,
        "deltaEvidence": delta_evidence,
        "migrationJob": migration_job,
        "serveCycles": serve_cycles,
        "stableSummarySha256s": stable_summaries,
        "verifiedAt": _utc_now(),
    }
    verification_path = os.path.join(backup_dir, "backup-verification.json")
    _atomic_write_json(verification_path, verification, 0o600, require_absent=True)
    return {
        "backupDirectory": backup_dir,
        "archivePath": archive_path,
        "archiveSha256": archive_sha,
        "archiveSize": os.path.getsize(archive_path),
        "fileManifestSha256": _sha256_file(manifest_path),
        "verificationPath": verification_path,
        "verificationSha256": _sha256_file(verification_path),
        "beforeSummarySha256": before["summarySha256"],
        "restoredAfterSummarySha256": restored_after_migration["summarySha256"],
        "maintenanceStartedAt": maintenance_started,
        "verifiedAt": verification["verifiedAt"],
    }


def _operation_migrate(plan, paths, state, operation_id):
    production = plan["production"]
    _require(plan["migration"]["mode"] == "required", "invalid_transition", "Frozen plan does not require a migration.")
    _verify_frozen_target_image(plan)
    current = _current_facts(plan, require_running=False, full_database=True)
    target = _docker_inspect_container(production["containerName"])
    _require(not (target.get("State") or {}).get("Running"), "container_mismatch", "Production container must remain stopped before migration.")
    _assert_no_other_data_owner(plan)
    _assert_no_host_database_owner(plan)
    backup = _backup_verification_path(plan, state)
    _require(current["database"] == backup["productionBefore"], "source_drift", "Stopped production database differs from the verified backup baseline.")
    delta, _raw = _read_json_file(paths["delta"])
    delta = _validate_delta(delta, plan)
    migration_source_bytes, _migration_source_entries = _estimate_tree_logical_usage(
        production["dataHostPath"]
    )
    migration_working_bytes = max(migration_source_bytes, 256 * 1024 * 1024)
    _space_budget(
        plan,
        _base_space_allocations(plan)
        + [("productionMigrationWorkingSpace", production["dataHostPath"], migration_working_bytes)],
    )
    job_name = _job_container_name(plan, operation_id, "production-migrate")
    job = _run_migration_job(
        plan,
        job_name,
        production["dataHostPath"],
        max(plan["verification"]["healthTimeoutSeconds"], 120),
    )
    after = _sqlite_summary(os.path.join(production["dataHostPath"], production["databaseRelativePath"]))
    delta_evidence = _validate_migration_delta(current["database"], after, delta, plan["migration"]["newFiles"])
    _equivalent_rehearsed_outcome(backup["restoredAfterMigration"], after, delta)
    evidence = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "operationId": operation_id,
        "job": job,
        "beforeSummarySha256": current["database"]["summarySha256"],
        "after": after,
        "deltaEvidence": delta_evidence,
        "completedAt": _utc_now(),
    }
    evidence_path = os.path.join(paths["releaseDir"], "production-migration-verification.json")
    _atomic_write_json(evidence_path, evidence, 0o600, require_absent=True)
    return {
        "container": job_name,
        "containerId": job["containerId"],
        "verificationPath": evidence_path,
        "verificationSha256": _sha256_file(evidence_path),
        "beforeSummarySha256": evidence["beforeSummarySha256"],
        "afterSummarySha256": after["summarySha256"],
        "migrationLedgerSha256": after["migrationLedgerSha256"],
        "completedAt": evidence["completedAt"],
    }


def _operation_no_migration(plan, paths, state, operation_id):
    _require(plan["migration"]["mode"] == "none", "invalid_transition", "Frozen plan requires a migration.")
    delta, _raw = _read_json_file(paths["delta"])
    _validate_delta(delta, plan)
    production = plan["production"]
    current = _current_facts(plan, require_running=False, full_database=True)
    target = _docker_inspect_container(production["containerName"])
    _require(not (target.get("State") or {}).get("Running"), "container_mismatch", "Production container must remain stopped before the no-migration gate.")
    _assert_no_other_data_owner(plan)
    _assert_no_host_database_owner(plan)
    backup = _backup_verification_path(plan, state)
    _require(current["database"] == backup["productionBefore"], "source_drift", "Stopped production database differs from the verified backup baseline.")
    _require(
        set(plan["source"]["requiredMigrationFiles"]).issubset(set(current["database"]["migrationFiles"])),
        "source_drift",
        "No-migration ledger is missing a required project migration.",
    )
    return {
        "operationId": operation_id,
        "verifiedSummarySha256": current["database"]["summarySha256"],
        "migrationLedgerSha256": current["database"]["migrationLedgerSha256"],
        "verifiedAt": _utc_now(),
    }


def _atomic_replace_preserving_metadata(path, payload, expected_sha256):
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode) and not os.path.islink(path), "unsafe_path", "Atomic replacement target is unsafe.")
    _require(_sha256_file(path) == expected_sha256, "source_drift", "Atomic replacement target changed before write.")
    parent = os.path.dirname(path)
    temporary = os.path.join(parent, ".%s.release.%s" % (os.path.basename(path), secrets.token_hex(12)))
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IMODE(st.st_mode))
    try:
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fchmod(descriptor, stat.S_IMODE(st.st_mode))
        os.fchown(descriptor, st.st_uid, st.st_gid)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, path)
        _fsync_directory(parent)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _https_status(url, timeout):
    context = ssl.create_default_context()
    opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context))
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "questions-release-runner/1", "Accept": "application/json"},
        method="GET",
    )
    try:
        response = opener.open(request, timeout=timeout)
        try:
            body = response.read(65537)
            _require(len(body) <= 65536, "probe_failed", "HTTPS probe response is unexpectedly large.")
            return response.getcode(), _sha256_bytes(body)
        finally:
            response.close()
    except urllib.error.HTTPError as exc:
        body = exc.read(65537)
        _require(len(body) <= 65536, "probe_failed", "HTTPS error response is unexpectedly large.")
        return exc.code, _sha256_bytes(body)
    except (urllib.error.URLError, ssl.SSLError, OSError):
        raise ReleaseError("probe_failed", "HTTPS probe could not be completed.", {"urlSha256": _sha256_bytes(url.encode("utf-8"))})


def _trailing_successful_healthchecks(container):
    health = ((container.get("State") or {}).get("Health") or {})
    log = health.get("Log") or []
    _require(isinstance(log, list), "switch_failed", "Target container health log is invalid.")
    successes = []
    seen = set()
    for entry in reversed(log):
        if not isinstance(entry, dict) or entry.get("ExitCode") != 0:
            break
        start = entry.get("Start")
        end = entry.get("End")
        if not isinstance(start, str) or not start or not isinstance(end, str) or not end:
            break
        key = (start, end)
        if key in seen:
            break
        seen.add(key)
        successes.append(key)
    return successes


def _wait_target_healthy(plan, expected_container_id, expected_restart_count):
    production = plan["production"]
    deadline = time.time() + plan["verification"]["healthTimeoutSeconds"]
    last_health = None
    successful_checks = 0
    while time.time() < deadline:
        container = _docker_inspect_container(production["containerName"])
        state = container.get("State") or {}
        _require(container.get("Id") == expected_container_id, "switch_failed", "Target production container identity changed during health verification.")
        _require(container.get("RestartCount") == expected_restart_count, "switch_failed", "Target production container restarted during health verification.")
        _require(state.get("Running"), "switch_failed", "Target production container exited during health verification.", {"exitCode": state.get("ExitCode")})
        last_health = (state.get("Health") or {}).get("Status")
        successful_checks = len(_trailing_successful_healthchecks(container))
        if last_health == "healthy" and successful_checks >= 3:
            return container
        time.sleep(1)
    raise ResultUnknown(
        "Target production container did not produce three distinct consecutive successful healthchecks before timeout.",
        {
            "lastHealth": last_health,
            "successfulHealthchecks": successful_checks,
            "timeoutSeconds": plan["verification"]["healthTimeoutSeconds"],
        },
    )


def _verify_target_container_definition(plan, container):
    production = plan["production"]
    target = plan["target"]
    expected_image_id = plan["artifact"]["targetImageConfigDigest"]
    _require((container.get("Config") or {}).get("Image") == target["imageTag"], "switch_failed", "Target production container tag differs from the frozen plan.")
    _require(container.get("Image") == expected_image_id, "switch_failed", "Target production container image ID differs from the frozen config digest.")
    _container_mount_matches(container, production["dataHostPath"], production["dataContainerPath"], production.get("pushRuntime"))
    _container_port_matches(container, production["hostIp"], production["hostPort"], production["containerPort"])
    _verify_container_runtime_contract(plan, container)


def _verify_target_container(plan, container):
    target = plan["target"]
    _verify_target_container_definition(plan, container)
    state = container.get("State") or {}
    _require(state.get("Running") and (state.get("Health") or {}).get("Status") == "healthy", "switch_failed", "Target production container is not running healthy.")
    stdout, _stderr, _code = _run(
        ["docker", "exec", plan["production"]["containerName"], "/pb/pocketbase", "--version"],
        timeout=30,
    )
    _require(_decode_output(stdout) == "pocketbase version " + target["pocketbaseVersion"], "version_mismatch", "Running PocketBase version differs from the frozen plan.")


def _require_switch_container_continuity(plan, container, switch):
    _require(isinstance(switch, dict), "state_corrupt", "Switch evidence is missing or invalid.")
    _require(
        switch.get("containerId") == container.get("Id")
        and switch.get("imageId") == plan["artifact"]["targetImageConfigDigest"]
        and container.get("Image") == switch.get("imageId")
        and switch.get("restartCount") == 0
        and container.get("RestartCount") == switch.get("restartCount"),
        "switch_failed",
        "Target container identity, image, or restart count changed after switch verification.",
    )
    return True


def _verify_external_probes(plan):
    verification = plan["verification"]
    deadline = time.time() + verification["healthTimeoutSeconds"]
    health_status = None
    health_body_sha = None
    while time.time() < deadline:
        try:
            health_status, health_body_sha = _https_status(verification["healthUrl"], min(10, verification["healthTimeoutSeconds"]))
            if health_status == 200:
                break
        except ReleaseError:
            pass
        time.sleep(1)
    _require(health_status == 200, "probe_failed", "Public HTTPS health probe did not return 200.", {"actualStatus": health_status})
    parsed = urllib.parse.urlsplit(verification["healthUrl"])
    origin = "%s://%s" % (parsed.scheme, parsed.netloc)
    probes = []
    for item in verification["probes"]:
        url = origin + item["path"]
        status_code, body_sha = _https_status(url, min(15, verification["healthTimeoutSeconds"]))
        _require(status_code == item["expectedStatus"], "probe_failed", "An unauthenticated HTTPS boundary probe returned an unexpected status.", {"pathSha256": _sha256_bytes(item["path"].encode("utf-8")), "actualStatus": status_code, "expectedStatus": item["expectedStatus"]})
        probes.append(
            {
                "pathSha256": _sha256_bytes(item["path"].encode("utf-8")),
                "status": status_code,
                "bodySha256": body_sha,
            }
        )
    return {
        "healthUrlSha256": _sha256_bytes(verification["healthUrl"].encode("utf-8")),
        "healthStatus": health_status,
        "healthBodySha256": health_body_sha,
        "probes": probes,
    }


def _expected_pre_switch_database(plan, state):
    backup = _backup_verification_path(plan, state)
    if plan["migration"]["mode"] == "none":
        return backup["productionBefore"]
    migration = (state.get("evidence") or {}).get("migration")
    _require(isinstance(migration, dict), "state_corrupt", "Production migration evidence is missing.")
    path = migration.get("verificationPath")
    digest = migration.get("verificationSha256")
    _require(isinstance(path, str) and isinstance(digest, str), "state_corrupt", "Production migration evidence is incomplete.")
    _require(os.path.isfile(path) and not os.path.islink(path), "state_corrupt", "Production migration verification file is missing.")
    _require(_sha256_file(path) == digest, "state_corrupt", "Production migration verification hash differs from state.")
    report, _raw = _read_json_file(path)
    return report["after"]


def _operation_switch(plan, paths, state, operation_id):
    production = plan["production"]
    _verify_frozen_target_image(plan)
    container = _docker_inspect_container(production["containerName"])
    _require(not (container.get("State") or {}).get("Running"), "container_mismatch", "Production container must remain stopped before switch.")
    _assert_no_other_data_owner(plan)
    _assert_no_host_database_owner(plan)
    facts = _current_facts(plan, require_running=False, full_database=True, enforce_source_ledger=False)
    expected_database = _expected_pre_switch_database(plan, state)
    _require(facts["database"] == expected_database, "source_drift", "Production database differs from the verified pre-switch state.")
    with open(production["composePath"], "rb") as handle:
        source_bytes = handle.read(MAX_JSON_BYTES + 1)
    _require(len(source_bytes) <= MAX_JSON_BYTES, "file_too_large", "Production Compose is unexpectedly large.")
    source_token = plan["source"]["imageTag"].encode("utf-8")
    target_token = plan["target"]["imageTag"].encode("utf-8")
    _require(source_bytes.count(source_token) == 1, "compose_mismatch", "Source image text must occur exactly once in production Compose.")
    _require(source_bytes.count(target_token) == 0, "compose_mismatch", "Target image text already appears in production Compose.")
    candidate_bytes = source_bytes.replace(source_token, target_token, 1)
    with open(paths["candidateCompose"], "rb") as handle:
        frozen_candidate = handle.read(MAX_JSON_BYTES + 1)
    _require(len(frozen_candidate) <= MAX_JSON_BYTES, "file_too_large", "Candidate Compose is unexpectedly large.")
    _require(candidate_bytes == frozen_candidate, "compose_mismatch", "Exact source-to-target image replacement differs from the frozen candidate Compose.")
    _require(_sha256_bytes(candidate_bytes) == plan["artifact"]["targetComposeSha256"], "hash_mismatch", "Candidate Compose hash differs from the frozen plan.")
    current_config = _compose_config(plan, production["composePath"])
    candidate_config = _compose_config(plan, paths["candidateCompose"])
    current_without, current_image = _compose_without_target_image(current_config, production["composeService"])
    candidate_without, candidate_image = _compose_without_target_image(candidate_config, production["composeService"])
    _require(current_image == plan["source"]["imageTag"] and candidate_image == plan["target"]["imageTag"], "compose_mismatch", "Resolved Compose image transition differs from the frozen plan.")
    _require(current_without == candidate_without, "compose_mismatch", "Resolved candidate Compose changes fields other than image.")

    _atomic_replace_preserving_metadata(production["composePath"], candidate_bytes, plan["source"]["composeSha256"])
    _require(_sha256_file(production["composePath"]) == plan["artifact"]["targetComposeSha256"], "hash_mismatch", "Production Compose hash differs after atomic replacement.")
    actual_config = _compose_config(plan, production["composePath"])
    _require(actual_config == candidate_config, "compose_mismatch", "Resolved production Compose differs from the frozen candidate after replacement.")
    # Create the Compose replacement without starting it.  This closes the
    # mutable-tag window: a wrong image is detected while the public service is
    # still stopped, before any traffic can reach the container.
    _run(
        _compose_command(
            plan,
            production["composePath"],
            [
                "up",
                "--detach",
                "--no-deps",
                "--no-start",
                "--pull",
                "never",
                production["composeService"],
            ],
        ),
        timeout=max(plan["verification"]["healthTimeoutSeconds"], 120),
        unknown_on_timeout=True,
    )
    created = _docker_inspect_container(production["containerName"])
    _require(
        not (created.get("State") or {}).get("Running"),
        "switch_failed",
        "Target production container started before its frozen identity was verified.",
    )
    _verify_target_container_definition(plan, created)
    _run(
        _compose_command(
            plan,
            production["composePath"],
            ["start", production["composeService"]],
        ),
        timeout=60,
        unknown_on_timeout=True,
    )
    _require((created.get("RestartCount") or 0) == 0, "switch_failed", "Target production container had already restarted before its first start gate.")
    healthy = _wait_target_healthy(plan, created.get("Id"), 0)
    _verify_target_container(plan, healthy)
    after_database = _sqlite_summary(os.path.join(production["dataHostPath"], production["databaseRelativePath"]))
    # The public service is reachable again once the target is healthy, so an
    # existing business table may legitimately receive a write before this
    # snapshot is taken.  Keep the release contract frozen without treating
    # real traffic as corruption: schema, migrations and collection definitions
    # must remain identical, and every not-yet-activated table must stay empty.
    delta, _delta_raw = _read_json_file(paths["delta"])
    delta = _validate_delta(delta, plan)
    structural_evidence = _validate_post_switch_structure(
        expected_database,
        after_database,
        delta,
    )
    probes = _verify_external_probes(plan)
    final_container = _docker_inspect_container(production["containerName"])
    _verify_target_container(plan, final_container)
    _require(final_container.get("Id") == created.get("Id"), "switch_failed", "Target production container identity changed during verification.")
    _require((final_container.get("RestartCount") or 0) == 0, "switch_failed", "Target production container restarted during verification.")
    return {
        "operationId": operation_id,
        "composeSha256": _sha256_file(production["composePath"]),
        "composeConfigSha256": _sha256_json(actual_config),
        "containerId": final_container.get("Id"),
        "imageId": final_container.get("Image"),
        "restartCount": final_container.get("RestartCount"),
        "successfulHealthchecks": len(_trailing_successful_healthchecks(healthy)),
        "databaseSummarySha256": after_database["summarySha256"],
        "migrationLedgerSha256": after_database["migrationLedgerSha256"],
        "postSwitchStructure": structural_evidence,
        "probes": probes,
        "verifiedAt": _utc_now(),
    }


def _operation_finalize(plan, paths, state, operation_id):
    production = plan["production"]
    _require_trusted_production_paths(plan)
    _verify_frozen_target_image(plan)
    container = _docker_inspect_container(production["containerName"])
    _verify_target_container(plan, container)
    switch = (state.get("evidence") or {}).get("switch")
    _require_switch_container_continuity(plan, container, switch)
    _require(_sha256_file(production["composePath"]) == plan["artifact"]["targetComposeSha256"], "source_drift", "Production Compose drifted before finalize.")
    compose_config = _compose_config(plan, production["composePath"])
    _without, image = _compose_without_target_image(compose_config, production["composeService"])
    _require(image == plan["target"]["imageTag"], "source_drift", "Resolved production image drifted before finalize.")
    probes = _verify_external_probes(plan)
    database = _sqlite_summary(os.path.join(production["dataHostPath"], production["databaseRelativePath"]))
    _require(state["trafficMayHaveResumed"] is True, "state_corrupt", "Verified state must conservatively record that traffic may have resumed.")
    _require(state["snapshotRestoreAllowed"] is False, "state_corrupt", "Verified state must permanently forbid automatic snapshot restore.")
    structural_baseline = _expected_pre_switch_database(plan, state)
    delta, _delta_raw = _read_json_file(paths["delta"])
    delta = _validate_delta(delta, plan)
    structural_evidence = _validate_post_switch_structure(
        structural_baseline,
        database,
        delta,
    )
    state_snapshot_path = os.path.join(paths["releaseDir"], "release-state-verified.json")
    with open(paths["state"], "rb") as state_handle:
        state_snapshot_raw = state_handle.read(MAX_JSON_BYTES + 1)
    _require(len(state_snapshot_raw) <= MAX_JSON_BYTES, "state_corrupt", "Verified state snapshot exceeds its size limit.")
    _atomic_write_bytes(state_snapshot_path, state_snapshot_raw, 0o600, require_absent=True)
    state_snapshot_sha256 = _sha256_file(state_snapshot_path)
    report = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "operationId": operation_id,
        "planSha256": state["planSha256"],
        "executorSha256": state["executorSha256"],
        "bundleSha256": state["bundleSha256"],
        "phaseBeforeFinalize": state["phase"],
        "lastSafePhase": state["lastSafePhase"],
        "snapshotRestoreAllowed": state["snapshotRestoreAllowed"],
        "trafficMayHaveResumed": state["trafficMayHaveResumed"],
        "backupEvidenceSha256": _sha256_json((state.get("evidence") or {}).get("backup")),
        "migrationEvidenceSha256": _sha256_json((state.get("evidence") or {}).get("migration") or (state.get("evidence") or {}).get("noMigration")),
        "switchEvidenceSha256": _sha256_json(switch),
        "composeSha256": _sha256_file(production["composePath"]),
        "imageId": container.get("Image"),
        "databaseSummarySha256": database["summarySha256"],
        "migrationLedgerSha256": database["migrationLedgerSha256"],
        "postSwitchStructure": structural_evidence,
        "probeEvidenceSha256": _sha256_json(probes),
        "verifiedStateSnapshotSha256": state_snapshot_sha256,
        "activationPerformed": False,
        "productionWriteTestPerformed": False,
        "businessRowsComparedForEquality": False,
        "businessRowsMayHaveChangedAfterTrafficResumed": True,
        "finalizedAt": _utc_now(),
    }
    report_path = os.path.join(paths["releaseDir"], "release-report.json")
    _atomic_write_json(report_path, report, 0o600, require_absent=True)
    digest = _sha256_file(report_path)
    _atomic_write_bytes(
        os.path.join(paths["releaseDir"], "release-report.SHA256"),
        (digest + "  release-report.json\n").encode("ascii"),
        0o600,
        require_absent=True,
    )
    final_container = _docker_inspect_container(production["containerName"])
    _verify_target_container(plan, final_container)
    _require_switch_container_continuity(plan, final_container, switch)
    _require(
        _sha256_file(production["composePath"])
        == plan["artifact"]["targetComposeSha256"],
        "source_drift",
        "Production Compose changed during finalize verification.",
    )
    root_metadata = _update_root_release_metadata(
        plan,
        paths,
        state,
        operation_id,
        final_container,
        report_path,
        digest,
        state_snapshot_path,
        state_snapshot_sha256,
    )
    return {
        "operationId": operation_id,
        "reportPath": report_path,
        "reportSha256": digest,
        "rootReleaseSha256": root_metadata["rootReleaseSha256"],
        "rootChecksumsSha256": root_metadata["rootChecksumsSha256"],
        "rootMetadataIntentSha256": root_metadata["rootMetadataIntentSha256"],
        "rootMetadataCommitSha256": root_metadata["rootMetadataCommitSha256"],
        "verifiedStateSnapshotSha256": state_snapshot_sha256,
        "databaseSummarySha256AtFinalize": database["summarySha256"],
        "postSwitchStructureSha256": _sha256_json(structural_evidence),
        "recordedAt": report["finalizedAt"],
    }


def _read_root_checksum_lines(path):
    st = os.lstat(path)
    _require(stat.S_ISREG(st.st_mode) and st.st_size <= 1024 * 1024, "invalid_checksums", "Root checksum manifest is unsafe or too large.")
    with open(path, "rb") as handle:
        raw = handle.read(1024 * 1024 + 1)
    try:
        text_value = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise ReleaseError("invalid_checksums", "Root checksum manifest is not UTF-8.")
    _require(text_value.endswith("\n"), "invalid_checksums", "Root checksum manifest must end with a newline.")
    lines = []
    names = set()
    for line in text_value.splitlines():
        _require("  " in line, "invalid_checksums", "Root checksum manifest has an invalid line.")
        digest, name = line.split("  ", 1)
        _require(bool(SHA256_RE.match(digest)) and bool(SAFE_FILE_RE.match(name)), "invalid_checksums", "Root checksum manifest has an unsafe entry.")
        _require(name not in names, "invalid_checksums", "Root checksum manifest contains a duplicate filename.")
        names.add(name)
        lines.append((digest, name))
    return raw, lines


def _update_root_release_metadata(
    plan,
    paths,
    state,
    operation_id,
    container,
    report_path,
    report_sha256,
    state_snapshot_path,
    state_snapshot_sha256,
):
    production = plan["production"]
    _require(_sha256_file(report_path) == report_sha256, "hash_mismatch", "Final report changed before root metadata update.")
    _require(_sha256_file(state_snapshot_path) == state_snapshot_sha256, "hash_mismatch", "Verified state snapshot changed before root metadata update.")
    checksums_before_sha = _sha256_file(production["rootChecksumsPath"])
    _raw, lines = _read_root_checksum_lines(production["rootChecksumsPath"])
    compose_name = os.path.basename(production["composePath"])
    release_name = os.path.basename(production["rootReleasePath"])
    _require(compose_name != release_name, "invalid_checksums", "Compose and root release metadata filenames collide.")
    mapping = {name: digest for digest, name in lines}
    _require(compose_name in mapping and release_name in mapping, "invalid_checksums", "Root checksum manifest must contain Compose and release.json exactly once.")
    _require(mapping[compose_name] == _recorded_source_compose_sha(plan), "source_drift", "Root checksum manifest source Compose digest differs from the frozen plan.")
    _require(mapping[release_name] == plan["source"]["releaseJsonSha256"], "source_drift", "Root checksum manifest source release.json digest differs from the frozen plan.")
    checksum_root = os.path.dirname(production["rootChecksumsPath"])
    for digest, name in lines:
        candidate = os.path.join(checksum_root, name)
        _require(os.path.isfile(candidate) and not os.path.islink(candidate), "invalid_checksums", "A root checksum member is missing or unsafe.", {"member": name})
        if name == compose_name:
            _require(_sha256_file(candidate) == plan["artifact"]["targetComposeSha256"], "hash_mismatch", "Production Compose does not match the frozen target before metadata finalize.")
        elif name == release_name:
            _require(_sha256_file(candidate) == plan["source"]["releaseJsonSha256"], "source_drift", "Production release.json changed before metadata finalize.")
        else:
            _require(_sha256_file(candidate) == digest, "hash_mismatch", "An unrelated root checksum member failed verification.", {"member": name})

    package_release, _package_raw = _read_json_file(os.path.join(paths["releaseDir"], "release.json"))
    _require(isinstance(package_release, dict), "invalid_release", "Frozen package release.json is invalid.")
    _require(package_release.get("releaseId") == plan["releaseId"], "invalid_release", "Frozen package release.json releaseId differs from the plan.")
    backup = (state.get("evidence") or {}).get("backup")
    _require(isinstance(backup, dict), "state_corrupt", "Backup evidence is missing during root metadata finalize.")
    deployed = copy.deepcopy(package_release)
    deployment_fields = {
        "deployedAt": _utc_now(),
        "previousImageId": plan["source"]["imageId"],
        "previousImageTag": plan["source"]["imageTag"],
        "currentImageId": container.get("Image"),
        "composeSha256": plan["artifact"]["targetComposeSha256"],
        "backupDir": backup["backupDirectory"],
        "releaseDir": paths["releaseDir"],
        "statePath": state_snapshot_path,
        "stateSha256": state_snapshot_sha256,
        "reportSha256": report_sha256,
    }
    for key in deployment_fields:
        _require(key not in deployed, "invalid_release", "Frozen package release.json already defines a reserved deployment field.", {"field": key})
    deployed.update(deployment_fields)
    deployed_raw = json.dumps(deployed, sort_keys=True, indent=2, ensure_ascii=False).encode("utf-8") + b"\n"
    deployed_sha = _sha256_bytes(deployed_raw)
    replacement = {
        compose_name: plan["artifact"]["targetComposeSha256"],
        release_name: deployed_sha,
    }
    checksum_raw = "".join(
        "%s  %s\n" % (replacement.get(name, digest), name)
        for digest, name in lines
    ).encode("utf-8")
    target_checksums_sha = _sha256_bytes(checksum_raw)
    intent = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "operationId": operation_id,
        "sourceRootReleaseSha256": plan["source"]["releaseJsonSha256"],
        "sourceRootChecksumsSha256": checksums_before_sha,
        "targetRootReleaseSha256": deployed_sha,
        "targetRootChecksumsSha256": target_checksums_sha,
        "reportSha256": report_sha256,
        "verifiedStateSnapshotSha256": state_snapshot_sha256,
        "createdAt": _utc_now(),
    }
    _atomic_write_json(paths["finalizeIntent"], intent, 0o600, require_absent=True)
    intent_sha = _sha256_file(paths["finalizeIntent"])
    _atomic_replace_preserving_metadata(
        production["rootReleasePath"],
        deployed_raw,
        plan["source"]["releaseJsonSha256"],
    )
    _atomic_replace_preserving_metadata(
        production["rootChecksumsPath"],
        checksum_raw,
        checksums_before_sha,
    )
    _require(_sha256_file(production["rootReleasePath"]) == deployed_sha, "hash_mismatch", "Final root release.json hash differs after replacement.")
    _post_raw, post_lines = _read_root_checksum_lines(production["rootChecksumsPath"])
    for digest, name in post_lines:
        candidate = os.path.join(checksum_root, name)
        _require(_sha256_file(candidate) == digest, "hash_mismatch", "Root checksum manifest failed after metadata finalize.", {"member": name})
    _require(
        _sha256_file(production["rootChecksumsPath"]) == target_checksums_sha,
        "hash_mismatch",
        "Final root checksum manifest differs from the durable finalize intent.",
    )
    commit = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "operationId": operation_id,
        "intentSha256": intent_sha,
        "rootReleaseSha256": deployed_sha,
        "rootChecksumsSha256": target_checksums_sha,
        "committedAt": _utc_now(),
    }
    _atomic_write_json(paths["finalizeCommit"], commit, 0o600, require_absent=True)
    commit_sha = _sha256_file(paths["finalizeCommit"])
    return {
        "rootReleaseSha256": deployed_sha,
        "rootChecksumsSha256": target_checksums_sha,
        "rootMetadataIntentSha256": intent_sha,
        "rootMetadataCommitSha256": commit_sha,
        "stateSha256RecordedInRelease": deployment_fields["stateSha256"],
        "reportSha256": report_sha256,
    }


def _worker_marker_matches(paths, marker, plan, operation, operation_id):
    _require(marker is not None, "state_corrupt", "Global active release marker is missing.")
    _require(
        marker["releaseId"] == plan["releaseId"]
        and marker["operation"] == operation
        and marker["operationId"] == operation_id
        and marker["statePath"] == paths["state"],
        "state_corrupt",
        "Global active release marker differs from the worker identity.",
    )


def _worker_state_matches(state, operation, operation_id):
    inflight = state.get("inFlight")
    _require(isinstance(inflight, dict), "state_corrupt", "Worker has no matching in-flight state.")
    _require(
        inflight.get("operation") == operation and inflight.get("operationId") == operation_id,
        "state_corrupt",
        "Worker identity differs from the in-flight state.",
    )


def _worker_load(release_dir, operation, operation_id):
    _require(os.path.isabs(release_dir) and os.path.normpath(release_dir) == release_dir, "invalid_worker", "Worker release directory must be an absolute normalized path.")
    _require(os.path.isdir(release_dir) and not os.path.islink(release_dir), "invalid_worker", "Worker release directory is missing or unsafe.")
    plan, _raw = _read_json_file(os.path.join(release_dir, "deployment-plan.json"))
    plan = _validate_frozen_plan(plan)
    paths = _release_paths(plan)
    _require(paths["releaseDir"] == release_dir, "invalid_worker", "Worker release directory differs from the frozen plan.")
    _secure_directory_chain(paths["releaseDir"], "Frozen release directory", require_private_leaf=True)
    _require(operation in OPERATIONS, "invalid_worker", "Worker operation is invalid.")
    _require(bool(RELEASE_ID_RE.match(operation_id)), "invalid_worker", "Worker operation ID is invalid.")
    _require_private_root_file(paths["plan"], "Frozen deployment plan")
    _require_private_root_file(
        paths["delta"],
        "Frozen allowed delta",
        plan["artifact"]["allowedDeltaSha256"],
    )
    _require_private_root_file(
        paths["candidateCompose"],
        "Frozen candidate Compose",
        plan["artifact"]["targetComposeSha256"],
    )
    _require_private_root_file(
        paths["runner"],
        "Frozen release runner",
        plan["artifact"]["executorSha256"],
    )
    _require(os.path.realpath(__file__) == os.path.realpath(paths["runner"]), "executor_mismatch", "Worker is not executing the frozen package runner.")
    return plan, paths


def _worker_begin(plan, paths, operation, operation_id):
    with _file_lock(paths["globalLock"], exclusive=True):
        with _file_lock(paths["lock"], exclusive=True):
            state, stored_plan = _load_state(paths, verify_bundle=True)
            _require(stored_plan == plan, "plan_mismatch", "Worker plan differs from staged state.")
            marker = _read_active_marker(paths)
            _worker_marker_matches(paths, marker, plan, operation, operation_id)
            _worker_state_matches(state, operation, operation_id)
            _expected_operation(state, plan, operation)
            _require(state["inFlight"].get("outcome") == "pending", "operation_in_flight", "Worker operation was already observed; it cannot be restarted automatically.")
            state["inFlight"]["outcome"] = "running"
            state["inFlight"]["workerPid"] = os.getpid()
            state["inFlight"]["workerObservedAt"] = _utc_now()
            _save_state_with_event(
                paths,
                state,
                "worker-started",
                {
                    "operation": operation,
                    "operationId": operation_id,
                    "workerPid": os.getpid(),
                },
            )
            return state


def _worker_intermediate(plan, paths, operation, operation_id, phase, disable_snapshot=False, traffic_may_resume=False):
    with _file_lock(paths["globalLock"], exclusive=True):
        with _file_lock(paths["lock"], exclusive=True):
            state, stored_plan = _load_state(paths)
            _require(stored_plan == plan, "plan_mismatch", "Worker plan differs from staged state.")
            marker = _read_active_marker(paths)
            _worker_marker_matches(paths, marker, plan, operation, operation_id)
            _worker_state_matches(state, operation, operation_id)
            if operation == "migrate":
                _require(state["phase"] == "backup-verified" and phase == "production-migrating", "invalid_transition", "Migration intermediate transition is invalid.")
            elif operation == "switch":
                _require(state["phase"] in ("production-migrated", "migration-not-required") and phase == "switching", "invalid_transition", "Switch intermediate transition is invalid.")
            else:
                raise ReleaseError("invalid_transition", "This operation has no intermediate phase.")
            state["phase"] = phase
            if disable_snapshot:
                state["snapshotRestoreAllowed"] = False
            if traffic_may_resume:
                state["trafficMayHaveResumed"] = True
            state["inFlight"]["enteredPhaseAt"] = _utc_now()
            _save_state_with_event(
                paths,
                state,
                "operation-phase-entered",
                {
                    "operation": operation,
                    "operationId": operation_id,
                    "phase": phase,
                    "snapshotRestoreAllowed": state["snapshotRestoreAllowed"],
                    "trafficMayHaveResumed": state["trafficMayHaveResumed"],
                },
            )
            return state


def _worker_success(plan, paths, operation, operation_id, evidence):
    expected_phase, next_phase, evidence_key = WORKER_TRANSITIONS[operation]
    with _file_lock(paths["globalLock"], exclusive=True):
        with _file_lock(paths["lock"], exclusive=True):
            state, stored_plan = _load_state(paths, verify_bundle=True)
            _require(stored_plan == plan, "plan_mismatch", "Worker plan differs from staged state.")
            marker = _read_active_marker(paths)
            _worker_marker_matches(paths, marker, plan, operation, operation_id)
            _worker_state_matches(state, operation, operation_id)
            _require(state["phase"] == expected_phase, "invalid_transition", "Worker completion phase differs from the expected transition.")
            state["phase"] = next_phase
            state["lastSafePhase"] = next_phase
            state["evidence"][evidence_key] = evidence
            state["inFlight"] = None
            _save_state_with_event(
                paths,
                state,
                "operation-completed",
                {
                    "operation": operation,
                    "operationId": operation_id,
                    "phase": next_phase,
                    "evidenceSha256": _sha256_json(evidence),
                },
            )
            # A crash after the durable state update but before unlink leaves a
            # stale marker and therefore still fails closed on the next start.
            _safe_unlink(paths["activeMarker"])
            return state


def _worker_block(plan, paths, operation, operation_id, exc):
    try:
        with _file_lock(paths["globalLock"], exclusive=True):
            with _file_lock(paths["lock"], exclusive=True):
                state, _stored_plan = _load_state(paths)
                if state["phase"] != "blocked":
                    _block_state(paths, state, exc, operation_id)
    except Exception as block_exc:
        sys.stderr.write(
            "release worker could not persist blocked state: %s/%s\n"
            % (exc.__class__.__name__, block_exc.__class__.__name__)
        )
        sys.stderr.flush()


def _run_worker(release_dir, operation, operation_id):
    _require(os.geteuid() == 0, "permission_denied", "Production release worker must run as root.")
    _require(sys.version_info >= (3, 6), "python_too_old", "Production release worker requires Python 3.6 or newer.")
    plan = None
    paths = None
    try:
        plan, paths = _worker_load(release_dir, operation, operation_id)
        state = _worker_begin(plan, paths, operation, operation_id)
        if operation == "backup":
            evidence = _operation_backup(plan, paths, operation_id)
        elif operation == "migrate":
            state = _worker_intermediate(
                plan,
                paths,
                operation,
                operation_id,
                "production-migrating",
            )
            evidence = _operation_migrate(plan, paths, state, operation_id)
        elif operation == "no_migration":
            evidence = _operation_no_migration(plan, paths, state, operation_id)
        elif operation == "switch":
            state = _worker_intermediate(
                plan,
                paths,
                operation,
                operation_id,
                "switching",
                disable_snapshot=True,
                traffic_may_resume=True,
            )
            evidence = _operation_switch(plan, paths, state, operation_id)
        elif operation == "finalize":
            evidence = _operation_finalize(plan, paths, state, operation_id)
        else:
            raise ReleaseError("invalid_worker", "Unknown worker operation.")
        _worker_success(plan, paths, operation, operation_id, evidence)
        return 0
    except Exception as exc:
        if plan is not None and paths is not None:
            _worker_block(plan, paths, operation, operation_id, exc)
        error = _redacted_exception(exc)
        sys.stderr.write("release worker blocked: %s: %s\n" % (error["code"], error["message"]))
        sys.stderr.flush()
        return 1


def _validate_rpc_request(request):
    _require(isinstance(request, dict), "invalid_request", "RPC request must be an object.")
    _require(request.get("protocol") == PROTOCOL, "invalid_request", "RPC protocol version is invalid.")
    nonce = _require_string(request.get("nonce"), "nonce", 8, 256)
    _require(bool(re.match(r"^[A-Za-z0-9._:-]+$", nonce)), "invalid_request", "RPC nonce has an invalid format.")
    action = request.get("action")
    _require(
        action in ("inventory", "preflight", "prepare_upload", "stage", "status", "start_operation"),
        "invalid_request",
        "RPC action is invalid.",
    )
    allowed = {
        "inventory": {"protocol", "nonce", "action", "plan", "paths", "bootstrapPaths"},
        "preflight": {"protocol", "nonce", "action", "plan", "bundle"},
        "prepare_upload": {"protocol", "nonce", "action", "plan", "bundle"},
        "stage": {"protocol", "nonce", "action", "plan", "bundle", "sessionId"},
        "status": {"protocol", "nonce", "action", "plan"},
        "start_operation": {
            "protocol",
            "nonce",
            "action",
            "plan",
            "operation",
            "expectedRevision",
            "expectedPhase",
        },
    }
    unknown = set(request.keys()) - allowed[action]
    _require(not unknown, "invalid_request", "RPC request has unknown fields.", {"unknown": sorted(unknown)})
    required = {
        "inventory": {"plan"},
        "preflight": {"plan", "bundle"},
        "prepare_upload": {"plan", "bundle"},
        "stage": {"plan", "bundle", "sessionId"},
        "status": {"plan"},
        "start_operation": {"plan", "operation", "expectedRevision", "expectedPhase"},
    }
    missing = required[action] - set(request.keys())
    _require(not missing, "invalid_request", "RPC request is missing required fields.", {"missing": sorted(missing)})
    return nonce, action


def _dispatch_rpc(request):
    nonce = request.get("nonce") if isinstance(request, dict) else None
    action = request.get("action") if isinstance(request, dict) else None
    try:
        nonce, action = _validate_rpc_request(request)
        handlers = {
            "inventory": _inventory,
            "preflight": _preflight,
            "prepare_upload": _prepare_upload,
            "stage": _stage,
            "status": _status,
            "start_operation": _start_operation,
        }
        result = handlers[action](request)
        return {
            "protocol": PROTOCOL,
            "nonce": nonce,
            "action": action,
            "ok": True,
            "result": result,
        }
    except Exception as exc:
        return {
            "protocol": PROTOCOL,
            "nonce": nonce,
            "action": action,
            "ok": False,
            "error": _redacted_exception(exc),
        }


def _emit_rpc(response):
    raw = json.dumps(response, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    sys.stdout.write(RPC_PREFIX + raw + "\n")
    sys.stdout.flush()


def _read_rpc_stdin():
    raw = sys.stdin.buffer.read(MAX_RPC_BYTES + 1)
    _require(len(raw) <= MAX_RPC_BYTES, "invalid_request", "RPC request exceeds its size limit.")
    try:
        return _json_loads_strict(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ReleaseError("invalid_json", "RPC stdin is not valid UTF-8 JSON.")


def _selftest():
    _require(_sha256_json({"b": 2, "a": 1}) == _sha256_bytes(b'{"a":1,"b":2}'), "selftest_failed", "Canonical JSON self-test failed.")
    values = [None, b"x", "x", 1, 1.25]
    _require(len(set(_typed_value_bytes(value) for value in values)) == len(values), "selftest_failed", "Typed row encoding self-test failed.")
    _require(WORKER_TRANSITIONS["finalize"][:2] == ("verified", "recorded"), "selftest_failed", "Finalize transition self-test failed.")
    structural_baseline = {
        "migrationFiles": ["1000000000_base.js"],
        "migrationRows": {"1000000000_base.js": "9" * 64},
        "schemaObjects": [
            {
                "type": "table",
                "name": "business",
                "table": "business",
                "sqlSha256": "a" * 64,
            },
            {
                "type": "table",
                "name": "feature_empty",
                "table": "feature_empty",
                "sqlSha256": "b" * 64,
            },
        ],
        "schemaDigest": "c" * 64,
        "tables": {
            "_migrations": {
                "columns": ["file", "applied"],
                "rowCount": 1,
                "rowDigest": "8" * 64,
            },
            "business": {
                "columns": ["id", "value"],
                "rowCount": 1,
                "rowDigest": "d" * 64,
            },
            "feature_empty": {
                "columns": ["id"],
                "rowCount": 0,
                "rowDigest": "e" * 64,
            },
        },
        "collections": {
            "business": {
                "type": "base",
                "private": True,
                "rowDigest": "f" * 64,
            }
        },
        "summarySha256": "1" * 64,
    }
    structural_current = copy.deepcopy(structural_baseline)
    structural_current["tables"]["business"]["rowCount"] = 2
    structural_current["tables"]["business"]["rowDigest"] = "2" * 64
    structural_current["summarySha256"] = "3" * 64
    structure_result = _validate_post_switch_structure(
        structural_baseline,
        structural_current,
        {"emptyTables": ["feature_empty"]},
    )
    _require(
        structure_result["liveBusinessRowsMayHaveChanged"] is True
        and structure_result["changedRowTableCount"] == 1,
        "selftest_failed",
        "Post-switch live-row tolerance self-test failed.",
    )
    activated_current = copy.deepcopy(structural_current)
    activated_current["tables"]["feature_empty"]["rowCount"] = 1
    activation_blocked = False
    try:
        _validate_post_switch_structure(
            structural_baseline,
            activated_current,
            {"emptyTables": ["feature_empty"]},
        )
    except ReleaseError as exc:
        activation_blocked = exc.code == "activation_detected"
    _require(
        activation_blocked,
        "selftest_failed",
        "Post-switch inactive-table self-test failed.",
    )
    temporary = tempfile.mkdtemp(prefix="questions-release-runner-test-")
    try:
        os.chmod(temporary, 0o700)
        target = os.path.join(temporary, "atomic.json")
        _atomic_write_json(target, {"ok": True}, 0o600, require_absent=True)
        loaded, _raw = _read_json_file(target)
        _require(loaded == {"ok": True}, "selftest_failed", "Atomic JSON self-test failed.")
        paths = {
            "events": os.path.join(temporary, "events.jsonl"),
        }
        first = _append_event(paths, "one", "prepared", {"x": 1})
        second = _append_event(paths, "two", "prepared", {"x": 2})
        verified = _verify_event_log(paths["events"])
        _require(verified["headSha256"] == second["sha256"] and second["previousSha256"] == first["sha256"], "selftest_failed", "Event hash-chain self-test failed.")
        checksums_path = os.path.join(temporary, "SHA256SUMS")
        _atomic_write_bytes(checksums_path, b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  artifact.tar.gz\n", 0o600, require_absent=True)
        parsed = _parse_checksum_file(checksums_path, ["artifact.tar.gz"], exact=False)
        _require(parsed["artifact.tar.gz"] == "a" * 64, "selftest_failed", "Checksum parser self-test failed.")
    finally:
        shutil.rmtree(temporary)
    sys.stderr.write("release-runner selftest: ok\n")
    return 0


def _main(argv):
    parser = argparse.ArgumentParser(prog="release-runner.py")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("rpc")
    worker = subparsers.add_parser("worker")
    worker.add_argument("--release-dir", required=True)
    worker.add_argument("--operation", required=True, choices=OPERATIONS)
    worker.add_argument("--operation-id", required=True)
    subparsers.add_parser("selftest")
    args = parser.parse_args(argv)
    if args.command == "rpc":
        try:
            request = _read_rpc_stdin()
            response = _dispatch_rpc(request)
        except Exception as exc:
            response = {
                "protocol": PROTOCOL,
                "nonce": None,
                "action": None,
                "ok": False,
                "error": _redacted_exception(exc),
            }
        _emit_rpc(response)
        return 0 if response.get("ok") else 2
    if args.command == "worker":
        return _run_worker(args.release_dir, args.operation, args.operation_id)
    if args.command == "selftest":
        return _selftest()
    parser.error("a command is required")
    return 2


if BOOTSTRAP_REQUEST is not None:
    if isinstance(BOOTSTRAP_REQUEST, str):
        try:
            BOOTSTRAP_REQUEST = _json_loads_strict(BOOTSTRAP_REQUEST)
        except ValueError:
            BOOTSTRAP_REQUEST = {"protocol": None, "nonce": None, "action": None}
    _emit_rpc(_dispatch_rpc(BOOTSTRAP_REQUEST))
elif __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
