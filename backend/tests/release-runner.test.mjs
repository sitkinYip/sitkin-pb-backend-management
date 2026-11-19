import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const runnerPath = path.resolve(
  import.meta.dirname,
  "../deploy/1panel/release-runner.py",
);

function runPython(source) {
  const result = spawnSync("python3", ["-c", source, runnerPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
    },
  });
  assert.equal(
    result.status,
    0,
    `Python release-runner test failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

const loadRunner = String.raw`
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("questions_release_runner", sys.argv[1])
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
`;

test("release runner remains Python 3.6 compatible and passes its offline selftest", () => {
  const result = runPython(String.raw`
import ast
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
ast.parse(source, filename=sys.argv[1], feature_version=(3, 6))
${loadRunner}
assert runner._selftest() == 0
`);
  assert.match(result.stderr, /release-runner selftest: ok/);
});

test("release runner rejects duplicate JSON keys at every file boundary", () => {
  runPython(String.raw`
${loadRunner}

try:
    runner._json_loads_strict('{"releaseId":"reviewed","releaseId":"replaced"}')
except ValueError:
    pass
else:
    raise AssertionError("duplicate JSON keys were accepted")
`);
});

test("stopped container port validation uses its durable HostConfig binding", () => {
  runPython(String.raw`
${loadRunner}

binding = {"8090/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8090"}]}
running = {
    "State": {"Running": True},
    "NetworkSettings": {"Ports": binding},
    "HostConfig": {"PortBindings": binding},
}
stopped = {
    "State": {"Running": False},
    "NetworkSettings": {"Ports": {}},
    "HostConfig": {"PortBindings": binding},
}
assert runner._container_port_matches(running, "127.0.0.1", 8090, 8090) is None
assert runner._container_port_matches(stopped, "127.0.0.1", 8090, 8090) is None

stopped["HostConfig"]["PortBindings"] = {
    "8090/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8090"}]
}
try:
    runner._container_port_matches(stopped, "127.0.0.1", 8090, 8090)
except runner.ReleaseError as error:
    assert error.code == "port_mismatch"
else:
    raise AssertionError("an unsafe stopped-container binding was accepted")
`);
});

test("require-absent writes have an atomic no-replace publication point", () => {
  runPython(String.raw`
import os
import tempfile
import threading
${loadRunner}

with tempfile.TemporaryDirectory(prefix="questions-exclusive-write-") as directory:
    target = os.path.join(directory, "marker.json")
    gate = threading.Barrier(2)
    results = []

    def publish(payload):
        gate.wait()
        try:
            runner._atomic_write_bytes(target, payload, require_absent=True)
            results.append("won:" + payload.decode("ascii"))
        except runner.ReleaseError as error:
            assert error.code == "already_exists"
            results.append("lost:" + payload.decode("ascii"))

    threads = [
        threading.Thread(target=publish, args=(b"first",)),
        threading.Thread(target=publish, args=(b"second",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
        assert not thread.is_alive()
    assert len([item for item in results if item.startswith("won:")]) == 1
    assert len([item for item in results if item.startswith("lost:")]) == 1
    with open(target, "rb") as handle:
        assert handle.read() in (b"first", b"second")
    assert not [name for name in os.listdir(directory) if ".tmp." in name]
`);
});

test("stage claims and consumes its upload before any long-running validation", () => {
  runPython(String.raw`
import inspect
${loadRunner}

source = inspect.getsource(runner._stage)
claim = source.index("_atomic_write_json(stage_marker_path")
consume = source.index('session["consumed"] = True')
extract = source.index("_extract_release_bundle(")
compose = source.index("_compose_config(")
docker_load = source.index('["docker", "load"')
assert claim < consume < extract < compose < docker_load
`);
});

test("runner preflight RPC requires authenticated bundle metadata", () => {
  runPython(String.raw`
${loadRunner}

request = {
    "protocol": 1,
    "nonce": "nonce-1234",
    "action": "preflight",
    "plan": {},
    "bundle": {},
}
assert runner._validate_rpc_request(request) == ("nonce-1234", "preflight")
del request["bundle"]
try:
    runner._validate_rpc_request(request)
except runner.ReleaseError as error:
    assert error.code == "invalid_request"
else:
    raise AssertionError("preflight without bundle metadata was accepted")
`);
});

test("space budgets aggregate projected writes that share one filesystem", () => {
  runPython(String.raw`
import tempfile
${loadRunner}

with tempfile.TemporaryDirectory(prefix="questions-space-budget-") as directory:
    free = runner._free_bytes(directory)
    plan = {"server": {"minimumFreeBytes": 1}}
    each = free // 2 + 1
    try:
        runner._space_budget(
            plan,
            [("release", directory, each), ("backup", directory, each)],
        )
    except runner.ReleaseError as error:
        assert error.code == "insufficient_space"
    else:
        raise AssertionError("same-filesystem projected writes were not aggregated")
`);
});

test("crash-torn state remains visible as blocked and the global marker is persistent", () => {
  runPython(String.raw`
${loadRunner}

assert runner.GLOBAL_LOCK_ROOT.startswith("/var/lib/")
plan = {
    "releaseId": "release-crash-test",
    "artifact": {
        "createdAt": "2026-08-31T00:00:00Z",
        "executorSha256": "a" * 64,
    },
}
status = runner._state_reconciliation_status(
    plan,
    {"activeMarker": "/definitely/missing/questions-marker.json"},
    runner.ReleaseError("state_corrupt", "torn event/state commit"),
)
assert status["phase"] == "blocked"
assert status["blocked"] is True
assert status["inFlight"]["outcome"] == "unknown"
assert status["snapshotRestoreAllowed"] is False
assert status["trafficMayHaveResumed"] is True
`);
});

test("a stage marker remains result-unknown even after prepared state became visible", () => {
  runPython(String.raw`
import contextlib
import os
import tempfile
${loadRunner}

@contextlib.contextmanager
def unlocked(*_args, **_kwargs):
    yield

with tempfile.TemporaryDirectory(prefix="questions-stage-state-window-") as directory:
    release_dir = os.path.join(directory, "release-stage-window")
    os.mkdir(release_dir)
    state_path = os.path.join(release_dir, "release-state.json")
    lock_path = os.path.join(release_dir, ".release.lock")
    open(state_path, "wb").close()
    open(lock_path, "wb").close()
    plan = {
        "releaseId": "release-stage-window",
        "artifact": {
            "createdAt": "2026-08-31T00:00:00Z",
            "executorSha256": "a" * 64,
        },
    }
    paths = {
        "releaseDir": release_dir,
        "state": state_path,
        "lock": lock_path,
        "stageMarker": os.path.join(directory, ".stage.json"),
        "activeMarker": os.path.join(directory, ".active.json"),
    }
    state = {
        "releaseId": plan["releaseId"],
        "phase": "prepared",
        "revision": 1,
        "lastSafePhase": "prepared",
        "snapshotRestoreAllowed": True,
        "trafficMayHaveResumed": False,
        "updatedAt": "2026-08-31T00:00:01Z",
        "bundleSha256": "b" * 64,
        "planSha256": "c" * 64,
        "executorSha256": "a" * 64,
        "eventsHeadSha256": "d" * 64,
        "inFlight": None,
    }
    marker = {
        "schemaVersion": 1,
        "releaseId": plan["releaseId"],
        "sessionId": "ab" * 16,
        "bundleSha256": state["bundleSha256"],
        "startedAt": "2026-08-31T00:00:00Z",
    }
    runner._validate_frozen_plan = lambda value: value
    runner._release_paths = lambda _plan: paths
    runner._read_stage_marker = lambda _paths: marker
    runner._read_active_marker = lambda _paths: None
    runner._file_lock = unlocked
    runner._load_state = lambda _paths: (state, plan)
    status = runner._status({"plan": plan})
    assert status["phase"] == "blocked"
    assert status["blocked"] is True
    assert status["inFlight"]["operation"] == "stage"
    assert status["inFlight"]["outcome"] == "unknown"
    assert status["nextOperation"] is None
`);
});

test("release runner rejects traversal and link members without extracting them", () => {
  runPython(String.raw`
import io
import tarfile
${loadRunner}

def expect_unsafe(buffer, allowed):
    buffer.seek(0)
    try:
        with tarfile.open(fileobj=buffer, mode="r:") as archive:
            runner._safe_tar_members(archive, allowed)
    except runner.ReleaseError as error:
        assert error.code in ("unsafe_archive", "invalid_schema")
        return
    raise AssertionError("unsafe archive was accepted")

traversal = io.BytesIO()
with tarfile.open(fileobj=traversal, mode="w:") as archive:
    member = tarfile.TarInfo("../README.md")
    member.size = 1
    archive.addfile(member, io.BytesIO(b"x"))
expect_unsafe(traversal, ("../README.md",))

link = io.BytesIO()
with tarfile.open(fileobj=link, mode="w:") as archive:
    member = tarfile.TarInfo("README.md")
    member.type = tarfile.SYMTYPE
    member.linkname = "/etc/passwd"
    archive.addfile(member)
expect_unsafe(link, ("README.md",))
`);
});

test("SQLite release evidence is deterministic and never contains raw row values", () => {
  runPython(String.raw`
import json
import os
import sqlite3
import tempfile
${loadRunner}

secret = "DO_NOT_LEAK_PLAYER_ANSWER_7d9a"
with tempfile.TemporaryDirectory(prefix="questions-runner-sqlite-") as directory:
    database = os.path.join(directory, "data.db")
    connection = sqlite3.connect(database)
    connection.executescript("""
      CREATE TABLE _migrations (file TEXT PRIMARY KEY, applied INTEGER NOT NULL);
      CREATE TABLE _collections (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        listRule TEXT,
        viewRule TEXT,
        createRule TEXT,
        updateRule TEXT,
        deleteRule TEXT
      );
      CREATE TABLE game_secret (id TEXT PRIMARY KEY, answer TEXT NOT NULL);
      CREATE INDEX idx_game_secret_answer ON game_secret(answer);
    """)
    connection.execute("INSERT INTO _migrations VALUES (?, ?)", ("1787788800_game_schema.js", 1))
    connection.execute("INSERT INTO _collections VALUES (?, ?, NULL, NULL, NULL, NULL, NULL)", ("game_secret", "base"))
    connection.execute("INSERT INTO game_secret VALUES (?, ?)", ("row-1", secret))
    connection.execute("ANALYZE game_secret")
    connection.commit()
    connection.close()

    first = runner._sqlite_summary(database)
    second = runner._sqlite_summary(database)
    serialized = json.dumps(first, sort_keys=True)
    assert first == second
    assert secret not in serialized
    assert "row-1" not in serialized
    assert first["tables"]["game_secret"]["rowCount"] == 1
    assert len(first["sqliteStat1"]) == 2
    assert all(set(item) == {"table", "index", "statSha256"} for item in first["sqliteStat1"])
    assert {item["index"] for item in first["sqliteStat1"]} == {
        "idx_game_secret_answer",
        "sqlite_autoindex_game_secret_1",
    }

    connection = sqlite3.connect(database)
    connection.execute("UPDATE game_secret SET answer = ? WHERE id = ?", ("changed", "row-1"))
    connection.commit()
    connection.close()
    changed = runner._sqlite_summary(database)
    assert changed["summarySha256"] != first["summarySha256"]
`);
});

test("additive verifier accepts only the frozen empty private collection delta", () => {
  runPython(String.raw`
import copy
${loadRunner}

table = lambda count, digest: {"rowCount": count, "rowDigest": digest, "columns": ["id"]}
before = {
    "schemaObjects": [
        {"type": "index", "name": "idx_game_old", "table": "game_old", "sqlSha256": "0" * 64},
        {"type": "table", "name": "game_old", "table": "game_old", "sqlSha256": "1" * 64},
    ],
    "tables": {
        "_collections": table(1, "2" * 64),
        "_migrations": table(1, "3" * 64),
        "game_old": table(1, "4" * 64),
        "sqlite_stat1": table(0, "1" * 64),
    },
    "migrationFiles": ["1787788800_game_schema.js"],
    "migrationRows": {"1787788800_game_schema.js": "f" * 64},
    "collections": {
        "game_old": {"type": "base", "private": True, "rowDigest": "5" * 64},
    },
    "sqliteStat1": [],
    "summarySha256": "6" * 64,
}
after = copy.deepcopy(before)
after["schemaObjects"] += [
    {"type": "index", "name": "idx_game_new", "table": "game_new", "sqlSha256": "7" * 64},
    {"type": "table", "name": "game_new", "table": "game_new", "sqlSha256": "8" * 64},
]
after["tables"]["_collections"] = table(2, "9" * 64)
after["tables"]["_migrations"] = table(2, "a" * 64)
after["tables"]["game_new"] = table(0, "b" * 64)
after["tables"]["sqlite_stat1"] = table(1, "e" * 64)
after["migrationFiles"].append("1789000000_game_new.js")
after["migrationRows"]["1789000000_game_new.js"] = "0" * 64
after["collections"]["game_new"] = {
    "type": "base",
    "private": True,
    "rowDigest": "c" * 64,
}
after["sqliteStat1"].append({
    "table": "game_old",
    "index": "idx_game_old",
    "statSha256": "1" * 64,
})
after["summarySha256"] = "d" * 64
delta = {
    "newCollections": [{"name": "game_new", "requirePrivate": True}],
    "newSchemaObjects": [
        {"type": "index", "name": "idx_game_new", "table": "game_new"},
        {"type": "table", "name": "game_new", "table": "game_new"},
    ],
    "emptyTables": ["game_new"],
}

evidence = runner._validate_additive_delta(
    before,
    after,
    delta,
    ["1789000000_game_new.js"],
)
assert evidence["addedCollectionCount"] == 1
assert evidence["addedTableCount"] == 1
assert evidence["addedSqliteStatisticCount"] == 1

production_outcome = copy.deepcopy(after)
production_outcome["migrationRows"]["1789000000_game_new.js"] = "1" * 64
production_outcome["tables"]["_migrations"]["rowDigest"] = "2" * 64
delta_with_migrations = copy.deepcopy(delta)
delta_with_migrations["newMigrationFiles"] = ["1789000000_game_new.js"]
runner._equivalent_rehearsed_outcome(
    after,
    production_outcome,
    delta_with_migrations,
)

rewritten_production_ledger = copy.deepcopy(production_outcome)
rewritten_production_ledger["migrationRows"]["1787788800_game_schema.js"] = "3" * 64
try:
    runner._equivalent_rehearsed_outcome(
        after,
        rewritten_production_ledger,
        delta_with_migrations,
    )
except runner.ReleaseError as error:
    assert error.code == "migration_outcome_mismatch"
else:
    raise AssertionError("production rewrote a rehearsed historical migration row")

changed_existing = copy.deepcopy(after)
changed_existing["tables"]["game_old"]["rowDigest"] = "e" * 64
try:
    runner._validate_additive_delta(
        before,
        changed_existing,
        delta,
        ["1789000000_game_new.js"],
    )
except runner.ReleaseError as error:
    assert error.code == "delta_mismatch"
else:
    raise AssertionError("existing business data change was accepted")

rewritten_ledger = copy.deepcopy(after)
rewritten_ledger["migrationRows"]["1787788800_game_schema.js"] = "e" * 64
try:
    runner._validate_additive_delta(
        before,
        rewritten_ledger,
        delta,
        ["1789000000_game_new.js"],
    )
except runner.ReleaseError as error:
    assert error.code == "delta_mismatch"
else:
    raise AssertionError("an existing migration-ledger row rewrite was accepted")

public_collection = copy.deepcopy(after)
public_collection["collections"]["game_new"]["private"] = False
try:
    runner._validate_additive_delta(
        before,
        public_collection,
        delta,
        ["1789000000_game_new.js"],
    )
except runner.ReleaseError as error:
    assert error.code == "delta_mismatch"
else:
    raise AssertionError("public collection was accepted")

unknown_statistic = copy.deepcopy(after)
unknown_statistic["sqliteStat1"][0]["index"] = "idx_unknown"
try:
    runner._validate_additive_delta(
        before,
        unknown_statistic,
        delta,
        ["1789000000_game_new.js"],
    )
except runner.ReleaseError as error:
    assert error.code == "delta_mismatch"
else:
    raise AssertionError("statistics for an unknown index were accepted")

before_with_statistic = copy.deepcopy(before)
before_with_statistic["tables"]["sqlite_stat1"] = table(1, "7" * 64)
before_with_statistic["sqliteStat1"].append({
    "table": "game_old",
    "index": "idx_game_old",
    "statSha256": "2" * 64,
})
changed_statistic = copy.deepcopy(after)
try:
    runner._validate_additive_delta(
        before_with_statistic,
        changed_statistic,
        delta,
        ["1789000000_game_new.js"],
    )
except runner.ReleaseError as error:
    assert error.code == "delta_mismatch"
else:
    raise AssertionError("an existing SQLite statistic rewrite was accepted")
`);
});

test("post-switch verification permits live business writes but blocks activation", () => {
  runPython(String.raw`
import copy
${loadRunner}

table = lambda count, digest: {"rowCount": count, "rowDigest": digest, "columns": ["id"]}
baseline = {
    "schemaObjects": [
        {"type": "table", "name": "business", "table": "business", "sqlSha256": "1" * 64},
        {"type": "table", "name": "feature_empty", "table": "feature_empty", "sqlSha256": "2" * 64},
    ],
    "schemaDigest": "3" * 64,
    "tables": {
        "_migrations": table(1, "0" * 64),
        "business": table(1, "4" * 64),
        "feature_empty": table(0, "5" * 64),
    },
    "migrationFiles": ["1787788800_game_schema.js"],
    "migrationRows": {"1787788800_game_schema.js": "f" * 64},
    "collections": {
        "business": {"type": "base", "private": True, "rowDigest": "6" * 64},
        "feature_empty": {"type": "base", "private": True, "rowDigest": "7" * 64},
    },
    "summarySha256": "8" * 64,
}
after_traffic = copy.deepcopy(baseline)
after_traffic["tables"]["business"]["rowCount"] = 2
after_traffic["tables"]["business"]["rowDigest"] = "9" * 64
after_traffic["summarySha256"] = "a" * 64
evidence = runner._validate_post_switch_structure(
    baseline,
    after_traffic,
    {"emptyTables": ["feature_empty"]},
)
assert evidence["liveBusinessRowsMayHaveChanged"] is True
assert evidence["changedRowTableCount"] == 1

rewritten_ledger = copy.deepcopy(after_traffic)
rewritten_ledger["tables"]["_migrations"]["rowDigest"] = "e" * 64
rewritten_ledger["migrationRows"]["1787788800_game_schema.js"] = "d" * 64
try:
    runner._validate_post_switch_structure(
        baseline,
        rewritten_ledger,
        {"emptyTables": ["feature_empty"]},
    )
except runner.ReleaseError as error:
    assert error.code == "data_verification_failed"
else:
    raise AssertionError("a post-switch migration-ledger rewrite was accepted")

activated = copy.deepcopy(after_traffic)
activated["tables"]["feature_empty"]["rowCount"] = 1
try:
    runner._validate_post_switch_structure(
        baseline,
        activated,
        {"emptyTables": ["feature_empty"]},
    )
except runner.ReleaseError as error:
    assert error.code == "activation_detected"
else:
    raise AssertionError("inactive feature table write was accepted")
`);
});

test("server-side delta validation independently enforces private empty collections", () => {
  runPython(String.raw`
import copy
${loadRunner}

plan = {
    "migration": {
        "verifier": "additive-empty-collections-v1",
        "mode": "required",
        "newFiles": ["1789000000_game_new.js"],
    },
}
valid = {
    "schemaVersion": 1,
    "verifier": "additive-empty-collections-v1",
    "newMigrationFiles": ["1789000000_game_new.js"],
    "newCollections": [{"name": "game_new", "requirePrivate": True}],
    "newSchemaObjects": [
        {"type": "index", "name": "idx_game_new", "table": "game_new"},
        {"type": "table", "name": "game_new", "table": "game_new"},
    ],
    "emptyTables": ["game_new"],
}
assert runner._validate_delta(valid, plan) == valid

def rejected(candidate):
    try:
        runner._validate_delta(candidate, plan)
    except runner.ReleaseError as error:
        assert error.code == "invalid_schema"
        return
    raise AssertionError("unsafe allowed delta was accepted")

public = copy.deepcopy(valid)
public["newCollections"][0]["requirePrivate"] = False
rejected(public)

not_empty = copy.deepcopy(valid)
not_empty["emptyTables"] = []
rejected(not_empty)

unbound = copy.deepcopy(valid)
unbound["newCollections"][0]["name"] = "game_other"
rejected(unbound)

raw_table = copy.deepcopy(valid)
raw_table["newSchemaObjects"].append(
    {"type": "table", "name": "unrelated_raw", "table": "unrelated_raw"}
)
raw_table["newSchemaObjects"].sort(key=lambda item: (item["type"], item["name"]))
raw_table["emptyTables"].append("unrelated_raw")
rejected(raw_table)
`);
});

test("runner enforces subprocess output limits while streaming", () => {
  runPython(String.raw`
import sys
${loadRunner}

try:
    runner._run(
        [sys.executable, "-c", "import sys; sys.stdout.write('x' * 131072)"],
        timeout=10,
        maximum_output=1024,
    )
except runner.ReleaseError as error:
    assert error.code == "command_output_too_large"
else:
    raise AssertionError("oversized subprocess output was accepted")
`);
});

test("runner timeout kills descendants that retain inherited output pipes", () => {
  runPython(String.raw`
import sys
import time
${loadRunner}

started = time.monotonic()
try:
    runner._run(
        [
            sys.executable,
            "-c",
            "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time; time.sleep(10)']); time.sleep(10)",
        ],
        timeout=0.2,
    )
except runner.ReleaseError as error:
    assert error.code == "command_timeout"
else:
    raise AssertionError("timed-out descendant process was accepted")
assert time.monotonic() - started < 2.0
`);
});

test("target health gate counts distinct Docker healthcheck records, not polls", () => {
  runPython(String.raw`
import copy
${loadRunner}

def health_entry(index):
    return {
        "Start": "2026-08-31T00:00:%02dZ" % index,
        "End": "2026-08-31T00:00:%02dZ" % (index + 1),
        "ExitCode": 0,
        "Output": "",
    }

base = {
    "Id": "container-reviewed-id",
    "RestartCount": 0,
    "State": {
        "Running": True,
        "ExitCode": 0,
        "Health": {"Status": "healthy", "Log": []},
    },
}
responses = []
for indexes in ([1], [1], [1, 2], [1, 2, 3]):
    item = copy.deepcopy(base)
    item["State"]["Health"]["Log"] = [health_entry(index) for index in indexes]
    responses.append(item)
calls = []

def inspect(_name):
    calls.append(True)
    return responses.pop(0)

clock = [0.0]
runner._docker_inspect_container = inspect
runner.time.time = lambda: clock[0]
runner.time.sleep = lambda seconds: clock.__setitem__(0, clock[0] + seconds)
plan = {
    "production": {"containerName": "questions-game-v1"},
    "verification": {"healthTimeoutSeconds": 90},
}
result = runner._wait_target_healthy(plan, "container-reviewed-id", 0)
assert result["Id"] == "container-reviewed-id"
assert len(calls) == 4

restarted = copy.deepcopy(base)
restarted["RestartCount"] = 1
runner._docker_inspect_container = lambda _name: restarted
try:
    runner._wait_target_healthy(plan, "container-reviewed-id", 0)
except runner.ReleaseError as error:
    assert error.code == "switch_failed"
else:
    raise AssertionError("a restarted target container passed the health gate")
`);
});

test("preflight and finalize preserve the exact switched container identity", () => {
  runPython(String.raw`
import inspect
${loadRunner}

plan = {"artifact": {"targetImageConfigDigest": "sha256:" + "a" * 64}}
switch = {
    "containerId": "reviewed-container-id",
    "imageId": "sha256:" + "a" * 64,
    "restartCount": 0,
}
container = {
    "Id": "reviewed-container-id",
    "Image": "sha256:" + "a" * 64,
    "RestartCount": 0,
}
assert runner._require_switch_container_continuity(plan, container, switch)
for field, value in (("Id", "replacement"), ("RestartCount", 1)):
    changed = dict(container)
    changed[field] = value
    try:
        runner._require_switch_container_continuity(plan, changed, switch)
    except runner.ReleaseError as error:
        assert error.code == "switch_failed"
    else:
        raise AssertionError("switched container continuity drift was accepted")

assert "_require_switch_container_continuity" in inspect.getsource(
    runner._preflight_target_phase
)
assert inspect.getsource(runner._operation_finalize).count(
    "_require_switch_container_continuity"
) >= 2
`);
});

test("recorded status evidence pins both root metadata files and every checksum member", () => {
  runPython(String.raw`
import os
import stat
import tempfile
${loadRunner}

def write_json(path, value):
    with open(path, "wb") as handle:
        handle.write(runner._canonical_bytes(value) + b"\n")

def local_private_file(path, label, expected_sha256=None):
    info = os.lstat(path)
    runner._require(stat.S_ISREG(info.st_mode), "unsafe_path", label + " must be regular")
    if expected_sha256 is not None:
        runner._require(
            runner._sha256_file(path) == expected_sha256,
            "hash_mismatch",
            label + " hash changed",
        )
    return info

runner._require_trusted_production_paths = lambda _plan: True
runner._require_private_root_file = local_private_file

with tempfile.TemporaryDirectory(prefix="questions-recorded-root-") as directory:
    release_dir = os.path.join(directory, "release-recorded-root")
    os.mkdir(release_dir)
    compose_path = os.path.join(directory, "compose.yaml")
    root_release_path = os.path.join(directory, "release.json")
    root_checksums_path = os.path.join(directory, "SHA256SUMS")
    report_path = os.path.join(release_dir, "release-report.json")
    report_checksum_path = os.path.join(release_dir, "release-report.SHA256")
    snapshot_path = os.path.join(release_dir, "release-state-verified.json")
    intent_path = os.path.join(release_dir, "root-metadata-finalize-intent.json")
    commit_path = os.path.join(release_dir, "root-metadata-finalize-commit.json")
    with open(compose_path, "wb") as handle:
        handle.write(b"services: {}\n")
    compose_sha = runner._sha256_file(compose_path)
    report = {
        "releaseId": "release-recorded-root",
        "planSha256": "a" * 64,
        "executorSha256": "b" * 64,
    }
    snapshot = {
        "releaseId": "release-recorded-root",
        "phase": "verified",
        "planSha256": "a" * 64,
    }
    write_json(report_path, report)
    write_json(snapshot_path, snapshot)
    report_sha = runner._sha256_file(report_path)
    snapshot_sha = runner._sha256_file(snapshot_path)
    with open(report_checksum_path, "wb") as handle:
        handle.write((report_sha + "  release-report.json\n").encode("ascii"))
    root_release = {
        "releaseId": "release-recorded-root",
        "releaseDir": release_dir,
        "statePath": snapshot_path,
        "stateSha256": snapshot_sha,
        "reportSha256": report_sha,
    }
    write_json(root_release_path, root_release)
    root_release_sha = runner._sha256_file(root_release_path)
    with open(root_checksums_path, "wb") as handle:
        handle.write((
            compose_sha + "  compose.yaml\n" +
            root_release_sha + "  release.json\n"
        ).encode("ascii"))
    root_checksums_sha = runner._sha256_file(root_checksums_path)
    operation_id = "cd" * 16
    intent = {
        "schemaVersion": 1,
        "releaseId": "release-recorded-root",
        "operationId": operation_id,
        "sourceRootReleaseSha256": "c" * 64,
        "sourceRootChecksumsSha256": "d" * 64,
        "targetRootReleaseSha256": root_release_sha,
        "targetRootChecksumsSha256": root_checksums_sha,
        "reportSha256": report_sha,
        "verifiedStateSnapshotSha256": snapshot_sha,
        "createdAt": "2026-08-31T00:00:00Z",
    }
    write_json(intent_path, intent)
    intent_sha = runner._sha256_file(intent_path)
    commit = {
        "schemaVersion": 1,
        "releaseId": "release-recorded-root",
        "operationId": operation_id,
        "intentSha256": intent_sha,
        "rootReleaseSha256": root_release_sha,
        "rootChecksumsSha256": root_checksums_sha,
        "committedAt": "2026-08-31T00:00:01Z",
    }
    write_json(commit_path, commit)
    commit_sha = runner._sha256_file(commit_path)
    finalize = {
        "reportPath": report_path,
        "reportSha256": report_sha,
        "verifiedStateSnapshotSha256": snapshot_sha,
        "rootMetadataIntentSha256": intent_sha,
        "rootMetadataCommitSha256": commit_sha,
        "rootReleaseSha256": root_release_sha,
        "rootChecksumsSha256": root_checksums_sha,
    }
    plan = {
        "releaseId": "release-recorded-root",
        "artifact": {"targetComposeSha256": compose_sha},
        "production": {
            "composePath": compose_path,
            "rootReleasePath": root_release_path,
            "rootChecksumsPath": root_checksums_path,
        },
    }
    paths = {
        "releaseDir": release_dir,
        "finalizeIntent": intent_path,
        "finalizeCommit": commit_path,
    }
    state = {
        "planSha256": "a" * 64,
        "executorSha256": "b" * 64,
        "evidence": {"finalize": finalize},
    }
    assert runner._verify_recorded_artifacts(plan, paths, state)["reportSha256"] == report_sha

    with open(root_checksums_path, "ab") as handle:
        handle.write(b"tamper\n")
    try:
        runner._verify_recorded_artifacts(plan, paths, state)
    except runner.ReleaseError as error:
        assert error.code == "hash_mismatch"
    else:
        raise AssertionError("tampered recorded root checksums were accepted")
`);
});

test("verified backup remains a live gate after its initial restore rehearsal", () => {
  runPython(String.raw`
import json
import os
import stat
import tempfile
${loadRunner}

def write_json(path, value):
    with open(path, "wb") as handle:
        handle.write(runner._canonical_bytes(value) + b"\n")

def local_private_file(path, label, expected_sha256=None):
    info = os.lstat(path)
    runner._require(stat.S_ISREG(info.st_mode), "unsafe_path", label + " must be regular")
    if expected_sha256 is not None:
        runner._require(
            runner._sha256_file(path) == expected_sha256,
            "hash_mismatch",
            label + " hash changed",
        )
    return info

runner._secure_directory_chain = lambda *args, **kwargs: True
runner._require_private_root_file = local_private_file

with tempfile.TemporaryDirectory(prefix="questions-backup-live-gate-") as backup_root:
    release_id = "release-backup-test"
    operation_id = "ab" * 16
    backup_dir = os.path.join(backup_root, release_id + "." + operation_id)
    os.mkdir(backup_dir, 0o700)
    archive_path = os.path.join(backup_dir, "pre-upgrade.tar.gz")
    with open(archive_path, "wb") as handle:
        handle.write(b"verified-backup-bytes")
    archive_sha = runner._sha256_file(archive_path)
    archive_size = os.path.getsize(archive_path)
    manifest = {
        "schemaVersion": 1,
        "algorithm": "sha256",
        "files": [],
        "createdAt": "2026-08-31T00:00:00Z",
    }
    manifest_path = os.path.join(backup_dir, "backup-file-manifest.json")
    write_json(manifest_path, manifest)
    manifest_sha = runner._sha256_file(manifest_path)
    with open(os.path.join(backup_dir, "SHA256SUMS"), "w", encoding="ascii") as handle:
        handle.write(archive_sha + "  pre-upgrade.tar.gz\n")
        handle.write(manifest_sha + "  backup-file-manifest.json\n")
    before_sha = "1" * 64
    after_sha = "2" * 64
    report = {
        "schemaVersion": 1,
        "releaseId": release_id,
        "operationId": operation_id,
        "maintenanceStartedAt": "2026-08-31T00:00:00Z",
        "targetStoppedAt": "2026-08-31T00:00:01Z",
        "backupDirectory": backup_dir,
        "archivePath": archive_path,
        "archiveSize": archive_size,
        "archiveSha256": archive_sha,
        "fileManifestSha256": manifest_sha,
        "fileCount": 0,
        "productionBefore": {"summarySha256": before_sha},
        "restoredBefore": {"summarySha256": before_sha},
        "restoredAfterMigration": {"summarySha256": after_sha},
        "deltaEvidence": {},
        "migrationJob": {},
        "serveCycles": [],
        "stableSummarySha256s": [],
        "verifiedAt": "2026-08-31T00:02:00Z",
    }
    verification_path = os.path.join(backup_dir, "backup-verification.json")
    write_json(verification_path, report)
    state = {
        "evidence": {
            "backup": {
                "backupDirectory": backup_dir,
                "archivePath": archive_path,
                "archiveSha256": archive_sha,
                "archiveSize": archive_size,
                "fileManifestSha256": manifest_sha,
                "verificationPath": verification_path,
                "verificationSha256": runner._sha256_file(verification_path),
                "beforeSummarySha256": before_sha,
                "restoredAfterSummarySha256": after_sha,
                "maintenanceStartedAt": report["maintenanceStartedAt"],
                "verifiedAt": report["verifiedAt"],
            }
        }
    }
    plan = {"releaseId": release_id, "server": {"backupRoot": backup_root}}
    assert runner._backup_verification_path(plan, state) == report

    with open(archive_path, "ab") as handle:
        handle.write(b"tamper")
    try:
        runner._backup_verification_path(plan, state)
    except runner.ReleaseError as error:
        assert error.code in ("hash_mismatch", "backup_mismatch")
    else:
        raise AssertionError("a changed backup archive was accepted")
`);
});

test("Push runtime preserves only the exact production env and RO secret, while isolated jobs cannot inherit it", () => {
  runPython(String.raw`
import copy, inspect
${loadRunner}
push = {"profile": "harmony-push-production-v1", "projectId": "101000000000000001",
 "secretHostPath": runner.PUSH_SECRET_HOST, "secretContainerPath": runner.PUSH_SECRET_CONTAINER,
 "recordedComposeSha256": "a" * 64}
production = {"composeService": "pocketbase", "dataHostPath": "/opt/1panel/apps/questions-game-v1/pb_data", "dataContainerPath": "/pb/pb_data", "pushRuntime": push}
plan = {"production": production, "source": {"composeSha256": "b" * 64}}
env = runner._push_runtime_environment(push)
volumes = [{"type":"bind", "source":production["dataHostPath"],"target":"/pb/pb_data","bind":{"create_host_path":False}},
 {"type":"bind","source":runner.PUSH_SECRET_HOST,"target":runner.PUSH_SECRET_CONTAINER,"read_only":True,"bind":{"create_host_path":False}}]
config = {"services":{"pocketbase":{"environment":env,"volumes":volumes}}}
runner._verify_compose_push_contract(plan, config)
assert runner._recorded_source_compose_sha(plan) == "a" * 64
mounts = [{"Type":"bind","Source":x["source"],"Destination":x["target"],"RW":not x.get("read_only",False)} for x in volumes]
runner._container_mount_matches({"Mounts":mounts}, production["dataHostPath"], "/pb/pb_data", push)
for change in ["write-secret","other-source","third-mount","auto-create","enable-approval","unknown-env"]:
    value=copy.deepcopy(config)
    service=value["services"]["pocketbase"]
    if change=="write-secret": service["volumes"][1]["read_only"]=False
    elif change=="other-source": service["volumes"][1]["source"]+=".other"
    elif change=="third-mount": service["volumes"].append(copy.deepcopy(volumes[0]))
    elif change=="auto-create": service["volumes"][1]["bind"]["create_host_path"]=True
    elif change=="enable-approval": service["environment"]["STARWARD_PUSH_SUBSCRIPTION_APPROVED"]="1"
    else: service["environment"]["STARWARD_PUSH_OTHER"]="1"
    try: runner._verify_compose_push_contract(plan,value)
    except runner.ReleaseError as error: assert error.code=="invalid_compose"
    else: raise AssertionError(change+" accepted")
for change in ["write-secret","other-source","third-mount"]:
    value=copy.deepcopy(mounts)
    if change=="write-secret": value[1]["RW"]=True
    elif change=="other-source": value[1]["Source"]+=".other"
    else: value.append(copy.deepcopy(mounts[0]))
    try: runner._container_mount_matches({"Mounts":value},production["dataHostPath"],"/pb/pb_data",push)
    except runner.ReleaseError as error: assert error.code=="mount_mismatch"
    else: raise AssertionError(change+" accepted")
commands=[]
runner._container_exists=lambda name:False
runner.os.path.isdir=lambda name:True
runner.os.path.islink=lambda name:False
runner._run=lambda args,**kw:commands.append(args)
runner._docker_inspect_container=lambda name:{"Image":"sha256:"+"c"*64,"State":{"Running":False}}
plan["artifact"]={"targetImageConfigDigest":"sha256:"+"c"*64}
runner._create_data_job(plan,"isolated","/isolated/pb_data",["migrate","up"])
command=commands[0]
assert command[command.index("--network")+1]=="none"
assert command.count("--mount")==1 and "type=bind,source=/isolated/pb_data,target=/pb/pb_data" in command
assert not any("STARWARD_PUSH" in x or "secret" in x for x in command)
assert "STARWARD_PUSH_" in inspect.getsource(runner._require_image_runtime_config)
# Real image config validation rejects baked-in activation before executing any job.
image={"Entrypoint":["/pb/pocketbase"],"Cmd":["serve","--http=0.0.0.0:8090","--dir=/pb/pb_data","--hooksDir=/pb/pb_hooks","--migrationsDir=/pb/pb_migrations","--automigrate=false"],"WorkingDir":"/pb","ExposedPorts":{"8090/tcp":{}},"Env":["PATH=/usr/bin"]}
runner._require_image_runtime_config(image)
container={"Config":copy.deepcopy(image),"HostConfig":{"Privileged":False,"CapDrop":["ALL"],"SecurityOpt":["no-new-privileges:true"],"RestartPolicy":{"Name":"unless-stopped"},"LogConfig":{"Type":"json-file","Config":{"max-file":"3","max-size":"10m"}}},"NetworkSettings":{"Networks":{"isolated":{}}}}
container["Config"]["Env"]=[key+"="+value for key,value in env.items()]
container["Config"]["Labels"]={"com.docker.compose.service":"pocketbase","com.docker.compose.oneoff":"False"}
container["Config"]["Healthcheck"]={"Test":["CMD","wget","-q","-O","/dev/null","http://127.0.0.1:8090/api/health"],"Interval":15000000000,"Timeout":5000000000,"StartPeriod":15000000000,"Retries":3}
runner._verify_container_runtime_contract(plan,container)
for altered in [[],container["Config"]["Env"]+["STARWARD_PUSH_ENABLED=1"],[entry.replace("SUBSCRIPTION_APPROVED=0","SUBSCRIPTION_APPROVED=1") for entry in container["Config"]["Env"]]]:
    wrong=copy.deepcopy(container);wrong["Config"]["Env"]=altered
    try:runner._verify_container_runtime_contract(plan,wrong)
    except runner.ReleaseError as error:assert error.code=="container_mismatch"
    else:raise AssertionError("drifted production Push env accepted")
image["Env"].append("STARWARD_PUSH_ENABLED=1")
try: runner._require_image_runtime_config(image)
except runner.ReleaseError as error: assert error.code=="image_mismatch"
else: raise AssertionError("Push activation baked into the image accepted")
`);
});
