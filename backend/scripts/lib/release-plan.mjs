import { createHash } from "node:crypto";
import path from "node:path";

export const RELEASE_PLAN_SCHEMA_VERSION = 1;
export const DEPLOYMENT_PLAN_SCHEMA_VERSION = 2;
export const ALLOWED_DELTA_SCHEMA_VERSION = 1;
export const RELEASE_VERIFIER = "additive-empty-collections-v1";
export const CONTEXT_VERIFIER = "personal-journey-context-v1";
export const CONTEXT_MIGRATION = "1795075320_push_personal_journey_notices.js";
export const CONTEXT_EVOLUTION = Object.freeze({
  collection: "game_push_notice_contexts", sessionRequired: false,
  kindValues: ["session", "account"], legacyKind: "session",
});
export const MIN_HEALTH_TIMEOUT_SECONDS = 90;

const RELEASE_PLAN_KEYS = [
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
];
const ALLOWED_DELTA_KEYS = [
  "schemaVersion",
  "verifier",
  "newMigrationFiles",
  "newCollections",
  "newSchemaObjects",
  "emptyTables",
];
const MIGRATION_FILE = /^\d{10,}_[a-z0-9][a-z0-9_]*\.js$/;
const IMAGE_TAG =
  /^questions-pocketbase:[a-z0-9][a-z0-9._-]*-amd64$/;
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]{7,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_ID = /^sha256:[a-f0-9]{64}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SQLITE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function fail(label, message) {
  throw new Error(`${label}: ${message}`);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(label, "expected an object");
  return value;
}

function exactKeys(value, expected, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    const unknown = actual.filter((key) => !wanted.includes(key));
    const missing = wanted.filter((key) => !actual.includes(key));
    fail(
      label,
      [
        unknown.length ? `unknown fields ${unknown.join(", ")}` : "",
        missing.length ? `missing fields ${missing.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

function string(value, label, pattern, message = "invalid value") {
  if (typeof value !== "string" || !value.length) fail(label, "expected text");
  if (/\r|\n|\0/.test(value)) fail(label, "control characters are forbidden");
  if (pattern && !pattern.test(value)) fail(label, message);
  return value;
}

function integer(value, label, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    fail(label, `expected an integer from ${minimum} to ${maximum}`);
  return value;
}

function boolean(value, label, expected) {
  if (typeof value !== "boolean") fail(label, "expected a boolean");
  if (expected !== undefined && value !== expected)
    fail(label, `must be ${expected}`);
  return value;
}

function safeAbsolutePath(value, label, minimumParts = 3) {
  string(value, label);
  if (value.length > 1024 || !/^\/[A-Za-z0-9._/-]+$/.test(value))
    fail(label, "contains characters unsafe for a remote path");
  if (!path.posix.isAbsolute(value)) fail(label, "must be an absolute POSIX path");
  if (path.posix.normalize(value) !== value || value.includes("//"))
    fail(label, "must be normalized and cannot contain traversal");
  const parts = value.split("/").filter(Boolean);
  if (
    parts.length < minimumParts ||
    ["/", "/opt", "/opt/1panel"].includes(value)
  )
    fail(label, "path is too broad for a production release target");
  return value;
}

function inside(child, parent, label) {
  const relative = path.posix.relative(parent, child);
  if (!relative || relative.startsWith("../") || path.posix.isAbsolute(relative))
    fail(label, `must be a distinct path inside ${parent}`);
}

function outside(child, parent, label) {
  const contained = (candidate, root) => {
    const relative = path.posix.relative(root, candidate);
    return (
      !relative ||
      (!relative.startsWith("../") &&
        relative !== ".." &&
        !path.posix.isAbsolute(relative))
    );
  };
  if (contained(child, parent) || contained(parent, child))
    fail(label, `must be outside ${parent}`);
}

function sortedUniqueStrings(values, label, pattern) {
  if (!Array.isArray(values)) fail(label, "expected an array");
  const checked = values.map((value, index) =>
    string(value, `${label}[${index}]`, pattern),
  );
  if (new Set(checked).size !== checked.length) fail(label, "duplicates are forbidden");
  const sorted = [...checked].sort();
  if (JSON.stringify(sorted) !== JSON.stringify(checked))
    fail(label, "must be sorted for deterministic review");
  return checked;
}

function sha256(value, label) {
  return string(value, label, SHA256, "expected a lowercase SHA256 digest");
}

function sha256Id(value, label) {
  return string(
    value,
    label,
    SHA256_ID,
    "expected a lowercase sha256:<64 hex> identifier",
  );
}

function migrationFiles(value, label) {
  return sortedUniqueStrings(value, label, MIGRATION_FILE);
}

function validateTransport(value) {
  exactKeys(value, ["sshTarget", "sshPort"], "plan.transport");
  string(
    value.sshTarget,
    "plan.transport.sshTarget",
    /^root@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i,
    "must be the reviewed root@host target used by the root-only runner",
  );
  if (value.sshTarget.includes(".."))
    fail("plan.transport.sshTarget", "invalid SSH target");
  integer(value.sshPort, "plan.transport.sshPort", 1, 65535);
}

function validateServer(value) {
  exactKeys(
    value,
    [
      "expectedHostname",
      "expectedMachineIdSha256",
      "releaseRoot",
      "backupRoot",
      "uploadRoot",
      "minimumFreeBytes",
    ],
    "plan.server",
  );
  string(
    value.expectedHostname,
    "plan.server.expectedHostname",
    /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/,
  );
  sha256(value.expectedMachineIdSha256, "plan.server.expectedMachineIdSha256");
  safeAbsolutePath(value.releaseRoot, "plan.server.releaseRoot");
  safeAbsolutePath(value.backupRoot, "plan.server.backupRoot");
  safeAbsolutePath(value.uploadRoot, "plan.server.uploadRoot");
  integer(value.minimumFreeBytes, "plan.server.minimumFreeBytes", 1);
  if (new Set([value.releaseRoot, value.backupRoot, value.uploadRoot]).size !== 3)
    fail("plan.server", "release, backup and upload roots must be distinct");
}

function validateProduction(value, server) {
  exactKeys(
    value,
    [
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
      ...(value.pushRuntime === undefined ? [] : ["pushRuntime"]),
    ],
    "plan.production",
  );
  if (value.pushRuntime !== undefined) {
    const push = value.pushRuntime;
    exactKeys(push, ["profile", "projectId", "secretHostPath", "secretContainerPath", "recordedComposeSha256"], "plan.production.pushRuntime");
    if (push.profile !== "harmony-push-production-v1") fail("plan.production.pushRuntime.profile", "unsupported profile");
    string(push.projectId, "plan.production.pushRuntime.projectId", /^[0-9]{10,32}$/);
    if (value.projectDirectory !== "/opt/1panel/apps/questions-game-v1" ||
        push.secretHostPath !== "/opt/1panel/secrets/questions-game-v1/starward-harmony-push.json" ||
        push.secretContainerPath !== "/run/secrets/starward-harmony-push.json")
      fail("plan.production.pushRuntime", "only the existing dedicated read-only Push secret is supported");
    sha256(push.recordedComposeSha256, "plan.production.pushRuntime.recordedComposeSha256");
  }
  safeAbsolutePath(value.projectDirectory, "plan.production.projectDirectory");
  safeAbsolutePath(value.composePath, "plan.production.composePath");
  safeAbsolutePath(value.dataHostPath, "plan.production.dataHostPath");
  safeAbsolutePath(
    value.dataContainerPath,
    "plan.production.dataContainerPath",
    2,
  );
  safeAbsolutePath(value.rootReleasePath, "plan.production.rootReleasePath");
  safeAbsolutePath(value.rootChecksumsPath, "plan.production.rootChecksumsPath");
  inside(value.composePath, value.projectDirectory, "plan.production.composePath");
  inside(value.dataHostPath, value.projectDirectory, "plan.production.dataHostPath");
  inside(
    value.rootReleasePath,
    value.projectDirectory,
    "plan.production.rootReleasePath",
  );
  inside(
    value.rootChecksumsPath,
    value.projectDirectory,
    "plan.production.rootChecksumsPath",
  );
  inside(server.releaseRoot, value.projectDirectory, "plan.server.releaseRoot");
  if (server.releaseRoot !== path.posix.join(value.projectDirectory, "releases"))
    fail(
      "plan.server.releaseRoot",
      "must be the fixed releases directory inside projectDirectory",
    );
  outside(server.backupRoot, value.projectDirectory, "plan.server.backupRoot");
  outside(server.uploadRoot, value.projectDirectory, "plan.server.uploadRoot");
  outside(server.releaseRoot, value.dataHostPath, "plan.server.releaseRoot");
  outside(server.backupRoot, value.dataHostPath, "plan.server.backupRoot");
  outside(server.uploadRoot, value.dataHostPath, "plan.server.uploadRoot");
  outside(value.composePath, value.dataHostPath, "plan.production.composePath");
  outside(
    value.rootReleasePath,
    value.dataHostPath,
    "plan.production.rootReleasePath",
  );
  outside(
    value.rootChecksumsPath,
    value.dataHostPath,
    "plan.production.rootChecksumsPath",
  );
  string(value.composeService, "plan.production.composeService", SAFE_NAME);
  string(value.containerName, "plan.production.containerName", SAFE_NAME);
  if (path.posix.basename(value.composePath) !== "compose.yaml")
    fail("plan.production.composePath", "must name compose.yaml");
  if (value.dataContainerPath !== "/pb/pb_data")
    fail("plan.production.dataContainerPath", "must be /pb/pb_data");
  if (value.databaseRelativePath !== "data.db")
    fail("plan.production.databaseRelativePath", "must be data.db");
  if (path.posix.basename(value.rootReleasePath) !== "release.json")
    fail("plan.production.rootReleasePath", "must name release.json");
  if (path.posix.basename(value.rootChecksumsPath) !== "SHA256SUMS")
    fail("plan.production.rootChecksumsPath", "must name SHA256SUMS");
  if (value.hostIp !== "127.0.0.1")
    fail("plan.production.hostIp", "production PocketBase must remain loopback-only");
  integer(value.hostPort, "plan.production.hostPort", 1, 65535);
  integer(value.containerPort, "plan.production.containerPort", 1, 65535);
}

function validateSource(value) {
  exactKeys(
    value,
    [
      "imageTag",
      "imageId",
      "composeSha256",
      "releaseJsonSha256",
      "migrationLedgerSha256",
      "requiredMigrationFiles",
    ],
    "plan.source",
  );
  string(value.imageTag, "plan.source.imageTag", IMAGE_TAG);
  sha256Id(value.imageId, "plan.source.imageId");
  sha256(value.composeSha256, "plan.source.composeSha256");
  sha256(value.releaseJsonSha256, "plan.source.releaseJsonSha256");
  sha256(value.migrationLedgerSha256, "plan.source.migrationLedgerSha256");
  migrationFiles(value.requiredMigrationFiles, "plan.source.requiredMigrationFiles");
}

function validateTarget(value, source, releaseId, options) {
  exactKeys(
    value,
    ["imageTag", "pocketbaseVersion", "platform"],
    "plan.target",
  );
  string(value.imageTag, "plan.target.imageTag", IMAGE_TAG);
  string(
    value.pocketbaseVersion,
    "plan.target.pocketbaseVersion",
    /^\d+\.\d+\.\d+$/,
  );
  if (value.platform !== "linux/amd64")
    fail("plan.target.platform", "must be linux/amd64");
  if (value.imageTag === source.imageTag)
    fail("plan.target.imageTag", "must use a new image tag");
  const releaseImageTag =
    `questions-pocketbase:${value.pocketbaseVersion}-${releaseId}-amd64`;
  if (value.imageTag !== releaseImageTag)
    fail(
      "plan.target.imageTag",
      `must be ${releaseImageTag} so release identity and image identity cannot drift`,
    );
  if (
    options.expectedTargetImageTag &&
    value.imageTag !== options.expectedTargetImageTag
  )
    fail("plan.target.imageTag", "does not match PB_DOCKER_IMAGE");
  if (
    options.expectedPocketbaseVersion &&
    value.pocketbaseVersion !== options.expectedPocketbaseVersion
  )
    fail("plan.target.pocketbaseVersion", "does not match the pinned runtime");
}

function validateMigration(value, source) {
  exactKeys(value, ["mode", "newFiles", "verifier"], "plan.migration");
  if (!["required", "none"].includes(value.mode))
    fail("plan.migration.mode", "must be required or none");
  migrationFiles(value.newFiles, "plan.migration.newFiles");
  if (![RELEASE_VERIFIER, CONTEXT_VERIFIER].includes(value.verifier))
    fail("plan.migration.verifier", "unsupported verifier");
  if (value.verifier === CONTEXT_VERIFIER &&
      (value.mode !== "required" || JSON.stringify(value.newFiles) !== JSON.stringify([CONTEXT_MIGRATION])))
    fail("plan.migration", "context evolution supports only the reviewed single migration");
  if (value.mode === "required" && !value.newFiles.length)
    fail("plan.migration.newFiles", "a required migration needs at least one new file");
  if (value.mode === "none" && value.newFiles.length)
    fail("plan.migration.newFiles", "must be empty when migration mode is none");
  const overlap = value.newFiles.filter((name) =>
    source.requiredMigrationFiles.includes(name),
  );
  if (overlap.length)
    fail("plan.migration.newFiles", `already present in source: ${overlap.join(", ")}`);
}

function validateVerification(value) {
  exactKeys(
    value,
    ["healthUrl", "probes", "healthTimeoutSeconds"],
    "plan.verification",
  );
  string(value.healthUrl, "plan.verification.healthUrl");
  let health;
  try {
    health = new URL(value.healthUrl);
  } catch {
    fail("plan.verification.healthUrl", "invalid URL");
  }
  if (
    health.protocol !== "https:" ||
    health.username ||
    health.password ||
    health.search ||
    health.hash
  )
    fail("plan.verification.healthUrl", "must be a credential-free HTTPS URL");
  if (!Array.isArray(value.probes) || !value.probes.length)
    fail("plan.verification.probes", "at least one authentication-boundary probe is required");
  const probePaths = [];
  for (const [index, probe] of value.probes.entries()) {
    const label = `plan.verification.probes[${index}]`;
    exactKeys(probe, ["path", "expectedStatus"], label);
    string(probe.path, `${label}.path`);
    if (
      !probe.path.startsWith("/") ||
      probe.path.startsWith("//") ||
      probe.path.includes("?") ||
      probe.path.includes("#") ||
      path.posix.normalize(probe.path) !== probe.path
    )
      fail(`${label}.path`, "must be a normalized absolute URL path");
    integer(probe.expectedStatus, `${label}.expectedStatus`, 100, 599);
    probePaths.push(probe.path);
  }
  if (new Set(probePaths).size !== probePaths.length)
    fail("plan.verification.probes", "duplicate paths are forbidden");
  if (
    !value.probes.some(
      (probe) =>
        probe.expectedStatus === 401 && probe.path !== (health.pathname || "/"),
    )
  )
    fail(
      "plan.verification.probes",
      "at least one non-health authentication-boundary probe must expect 401",
    );
  integer(
    value.healthTimeoutSeconds,
    "plan.verification.healthTimeoutSeconds",
    MIN_HEALTH_TIMEOUT_SECONDS,
    1800,
  );
}

function validateActivation(value) {
  exactKeys(value, ["executorMayActivate"], "plan.activation");
  boolean(value.executorMayActivate, "plan.activation.executorMayActivate", false);
}

export function validateReleasePlan(value, options = {}) {
  exactKeys(value, RELEASE_PLAN_KEYS, "plan");
  if (value.schemaVersion !== RELEASE_PLAN_SCHEMA_VERSION)
    fail("plan.schemaVersion", `must be ${RELEASE_PLAN_SCHEMA_VERSION}`);
  if (value.status !== "pending") fail("plan.status", "must be pending");
  string(value.releaseId, "plan.releaseId", RELEASE_ID);
  validateTransport(value.transport);
  validateServer(value.server);
  validateProduction(value.production, value.server);
  validateSource(value.source);
  validateTarget(value.target, value.source, value.releaseId, options);
  validateMigration(value.migration, value.source);
  validateVerification(value.verification);
  validateActivation(value.activation);
  return structuredClone(value);
}

export function validateAllowedDelta(value, plan) {
  exactKeys(value, [...ALLOWED_DELTA_KEYS, ...(value.verifier === CONTEXT_VERIFIER ? ["contextEvolution"] : [])], "allowedDelta");
  if (value.schemaVersion !== ALLOWED_DELTA_SCHEMA_VERSION)
    fail("allowedDelta.schemaVersion", `must be ${ALLOWED_DELTA_SCHEMA_VERSION}`);
  if (![RELEASE_VERIFIER, CONTEXT_VERIFIER].includes(value.verifier))
    fail("allowedDelta.verifier", "unsupported verifier");
  if (value.verifier === CONTEXT_VERIFIER) {
    exactKeys(value.contextEvolution, Object.keys(CONTEXT_EVOLUTION), "allowedDelta.contextEvolution");
    if (canonicalJson(value.contextEvolution) !== canonicalJson(CONTEXT_EVOLUTION) ||
        JSON.stringify(value.newMigrationFiles) !== JSON.stringify([CONTEXT_MIGRATION]) ||
        [value.newCollections, value.newSchemaObjects, value.emptyTables].some((items) => !Array.isArray(items) || items.length))
      fail("allowedDelta", "context evolution cannot permit any other schema, collection or migration change");
  }
  const newMigrationFiles = migrationFiles(
    value.newMigrationFiles,
    "allowedDelta.newMigrationFiles",
  );
  if (!Array.isArray(value.newCollections))
    fail("allowedDelta.newCollections", "expected an array");
  const collectionNames = [];
  for (const [index, collection] of value.newCollections.entries()) {
    const label = `allowedDelta.newCollections[${index}]`;
    exactKeys(collection, ["name", "requirePrivate"], label);
    string(collection.name, `${label}.name`, SQLITE_NAME);
    boolean(collection.requirePrivate, `${label}.requirePrivate`, true);
    collectionNames.push(collection.name);
  }
  if (new Set(collectionNames).size !== collectionNames.length)
    fail("allowedDelta.newCollections", "duplicate names are forbidden");
  if (JSON.stringify([...collectionNames].sort()) !== JSON.stringify(collectionNames))
    fail("allowedDelta.newCollections", "must be sorted by name");
  if (!Array.isArray(value.newSchemaObjects))
    fail("allowedDelta.newSchemaObjects", "expected an array");
  const schemaKeys = [];
  for (const [index, schemaObject] of value.newSchemaObjects.entries()) {
    const label = `allowedDelta.newSchemaObjects[${index}]`;
    exactKeys(schemaObject, ["type", "name", "table"], label);
    if (!["table", "index", "trigger", "view"].includes(schemaObject.type))
      fail(`${label}.type`, "must be table, index, trigger or view");
    string(schemaObject.name, `${label}.name`, SQLITE_NAME);
    string(schemaObject.table, `${label}.table`, SQLITE_NAME);
    schemaKeys.push(`${schemaObject.type}:${schemaObject.name}`);
  }
  if (new Set(schemaKeys).size !== schemaKeys.length)
    fail("allowedDelta.newSchemaObjects", "duplicate type/name pairs are forbidden");
  if (JSON.stringify([...schemaKeys].sort()) !== JSON.stringify(schemaKeys))
    fail("allowedDelta.newSchemaObjects", "must be sorted by type and name");
  const emptyTables = sortedUniqueStrings(
    value.emptyTables,
    "allowedDelta.emptyTables",
    SQLITE_NAME,
  );
  const declaredTables = new Set(
    value.newSchemaObjects
      .filter((schemaObject) => schemaObject.type === "table")
      .map((schemaObject) => schemaObject.name),
  );
  for (const table of emptyTables) {
    if (!declaredTables.has(table))
      fail("allowedDelta.emptyTables", `${table} is not a declared new table`);
  }
  for (const schemaObject of value.newSchemaObjects) {
    if (
      schemaObject.type === "table" &&
      schemaObject.name !== schemaObject.table
    )
      fail(
        "allowedDelta.newSchemaObjects",
        `table ${schemaObject.name} must name itself as its table`,
      );
    if (!emptyTables.includes(schemaObject.table))
      fail(
        "allowedDelta.newSchemaObjects",
        `${schemaObject.name} targets a table that is not required empty`,
      );
  }
  for (const collection of collectionNames) {
    if (!declaredTables.has(collection) || !emptyTables.includes(collection))
      fail(
        "allowedDelta.newCollections",
        `${collection} must have a declared, required-empty table`,
      );
  }
  if (
    declaredTables.size !== collectionNames.length ||
    emptyTables.length !== collectionNames.length ||
    collectionNames.some(
      (collection) =>
        !declaredTables.has(collection) || !emptyTables.includes(collection),
    )
  )
    fail(
      "allowedDelta.newSchemaObjects",
      "every declared table must be exactly one reviewed private collection table",
    );
  if (plan) {
    if (value.verifier !== plan.migration.verifier)
      fail("allowedDelta.verifier", "does not match plan.migration.verifier");
    if (
      JSON.stringify(newMigrationFiles) !== JSON.stringify(plan.migration.newFiles)
    )
      fail("allowedDelta.newMigrationFiles", "does not match plan.migration.newFiles");
    if (
      plan.migration.mode === "none" &&
      (value.newMigrationFiles.length ||
        value.newCollections.length ||
        value.newSchemaObjects.length ||
        value.emptyTables.length)
    )
      fail("allowedDelta", "must be empty when migration mode is none");
    if (plan.migration.mode === "required" && value.verifier === RELEASE_VERIFIER && !value.newCollections.length)
      fail(
        "allowedDelta.newCollections",
        "the additive-empty-collections verifier requires a new collection",
      );
  }
  return structuredClone(value);
}

export function releaseOperationSheetMarkers(plan) {
  return [
    "<!-- release-status: pending -->",
    `<!-- release-id: ${plan.releaseId} -->`,
    `<!-- source-image: ${plan.source.imageTag} -->`,
    `<!-- target-image: ${plan.target.imageTag} -->`,
  ];
}

export function validateOperationSheet(markdown, plan) {
  if (typeof markdown !== "string" || !markdown.length)
    fail("operationSheet", "expected non-empty Markdown");
  for (const marker of releaseOperationSheetMarkers(plan)) {
    const occurrences = markdown.split(marker).length - 1;
    if (occurrences !== 1)
      fail("operationSheet", `expected exactly one marker: ${marker}`);
  }
  for (const key of [
    "release-status",
    "release-id",
    "source-image",
    "target-image",
  ]) {
    const occurrences = [...markdown.matchAll(new RegExp(`<!--\\s*${key}\\s*:`, "g"))]
      .length;
    if (occurrences !== 1)
      fail(
        "operationSheet",
        `expected exactly one marker key without stale alternatives: ${key}`,
      );
  }
  return markdown;
}

export function digestBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function createComposeCandidate(source, plan) {
  if (typeof source !== "string" || !source.length)
    fail("compose.production.yaml", "expected text");
  const sourceSha256 = digestBytes(source);
  if (sourceSha256 !== plan.source.composeSha256)
    fail(
      "compose.production.yaml",
      "SHA256 does not match plan.source.composeSha256",
    );
  const oldLine = `    image: ${plan.source.imageTag}`;
  const newLine = `    image: ${plan.target.imageTag}`;
  if (source.split(oldLine).length - 1 !== 1)
    fail(
      "compose.production.yaml",
      "expected the reviewed source image line exactly once",
    );
  if (source.includes(newLine))
    fail("compose.production.yaml", "target image line already exists");
  const content = source.replace(oldLine, newLine);
  if (content.split(newLine).length - 1 !== 1 || content.includes(oldLine))
    fail("compose.candidate.yaml", "image-only replacement was not exact");
  return {
    content,
    sourceSha256,
    targetSha256: digestBytes(content),
  };
}
