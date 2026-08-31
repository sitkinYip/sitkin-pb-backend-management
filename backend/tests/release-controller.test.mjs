import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RPC_BOOTSTRAP_SOURCE,
  ReleaseTransportError,
  buildScpArgs,
  buildSshRpcArgs,
  createNonce,
  createRpcEnvelope,
  parseRpcResponse,
  runProcess,
  validateControlSocket,
} from "../scripts/lib/release-transport.mjs";
import {
  TRACKED_RELEASE_RUNNER_PATH,
  OPERATION_POLL_TIMEOUT_MS,
  RELEASE_RPC_TIMEOUT_MS,
  STAGE_RPC_TIMEOUT_MS,
  assertPreflightAllowsProgress,
  createReleaseController,
  loadReleaseContext,
  parseCliArguments,
  requireInteractivePhrase,
  runReleaseCommand,
  verifyInventoryRunnerAtHead,
} from "../scripts/release-pocketbase.mjs";
import {
  canonicalJson,
  digestBytes,
} from "../scripts/lib/release-plan.mjs";

const backendRoot = path.resolve(import.meta.dirname, "..");
const pendingPlanPath = path.join(
  backendRoot,
  "deploy/1panel/release-plan.example.json",
);
const releaseId = "release-controller-test";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const silentOutput = () => ({
  isTTY: true,
  write() {},
});

async function temporaryDirectory(t) {
  const canonicalTemporaryRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(
    path.join(canonicalTemporaryRoot, "questions-release-controller-test-"),
  );
  t.after(async () => rm(directory, { recursive: true }));
  return directory;
}

async function pendingPlan() {
  return JSON.parse(await readFile(pendingPlanPath, "utf8"));
}

async function frozenPlan(runnerBytes) {
  const plan = await pendingPlan();
  const sourceManifest = {
    algorithm: "sha256",
    files: [
      {
        path: "deploy/Dockerfile",
        size: 1,
        sha256: "1".repeat(64),
      },
    ],
  };
  return {
    ...plan,
    schemaVersion: 2,
    releasePlanSchemaVersion: 1,
    status: "ready",
    sourceManifest,
    artifact: {
      createdAt: "2026-08-31T00:00:00.000Z",
      operationSheetSha256: "2".repeat(64),
      allowedDeltaSha256: "3".repeat(64),
      executorSha256: sha256(runnerBytes),
      sourceManifestSha256: digestBytes(canonicalJson(sourceManifest)),
      targetImageConfigDigest: `sha256:${"4".repeat(64)}`,
      targetComposeSha256: "5".repeat(64),
      maximumExpandedBytes: 1024 * 1024 * 1024,
      bundleMembers: [
        "pocketbase-image.tar",
        "README.md",
        "deployment-plan.json",
        "allowed-delta.json",
        "release-runner.py",
        "compose.candidate.yaml",
        "release.json",
        "SHA256SUMS",
      ],
    },
  };
}

function sshOptions(argv) {
  const result = new Set();
  for (let index = 0; index < argv.length - 1; index += 1)
    if (argv[index] === "-o") result.add(argv[index + 1]);
  return result;
}

test("SSH and SCP cannot fall back to a new authentication flow", () => {
  const socketPath = "/private/tmp/questions-release/control";
  const common = {
    socketPath,
    sshTarget: "root@example.test",
    sshPort: 22,
  };
  const ssh = buildSshRpcArgs(common);
  const scp = buildScpArgs({
    ...common,
    localPath: "/private/tmp/release.tar.gz",
    remotePath: "/opt/questions/upload/release.tar.gz",
  });
  for (const options of [sshOptions(ssh), sshOptions(scp)]) {
    assert(options.has("BatchMode=yes"));
    assert(options.has("NumberOfPasswordPrompts=0"));
    assert(options.has("PasswordAuthentication=no"));
    assert(options.has("KbdInteractiveAuthentication=no"));
    assert(options.has("PubkeyAuthentication=no"));
    assert(options.has("HostbasedAuthentication=no"));
    assert(options.has("GSSAPIAuthentication=no"));
    assert(options.has("IdentityAgent=none"));
    assert(options.has("IdentitiesOnly=yes"));
    assert(options.has("ProxyCommand=/usr/bin/false"));
  }
  assert(ssh.includes("-S"));
  assert(!scp.includes("-S"));
  assert(!scp.includes("-O"));
  assert(sshOptions(scp).has(`ControlPath=${socketPath}`));
});

test("a dead ControlMaster fails through the closed proxy instead of direct TCP", async () => {
  const startedAt = Date.now();
  const child = spawn(
    "/usr/bin/ssh",
    buildSshRpcArgs({
      socketPath: "/private/tmp/questions-release-missing/control",
      sshTarget: "root@127.0.0.1",
      sshPort: 1,
    }),
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ssh did not fail closed for a missing ControlMaster"));
    }, 5000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.notEqual(exitCode, 0);
  assert(Date.now() - startedAt < 5000);
  assert.doesNotMatch(stderr, /connection refused|connect to host/i);
});

test("local transport timeout kills descendants that retain inherited pipes", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runProcess(
      process.execPath,
      [
        "-e",
        "const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'inherit'}); setTimeout(()=>{},10000);",
      ],
      { timeoutMs: 200 },
    ),
    (error) => error instanceof ReleaseTransportError && error.code === "PROCESS_TIMEOUT",
  );
  assert(Date.now() - startedAt < 1800);
});

function fakeStat({
  uid = 501,
  mode = 0o700,
  directory = false,
  socket = false,
  symlink = false,
} = {}) {
  return {
    uid,
    mode,
    isDirectory: () => directory,
    isSocket: () => socket,
    isSymbolicLink: () => symlink,
  };
}

async function validateFakeSocket({ parent, socket }) {
  const socketPath = "/private/tmp/questions-release-test/control";
  const parentPath = path.dirname(socketPath);
  return validateControlSocket(socketPath, {
    uid: 501,
    lstat: async (target) => (target === parentPath ? parent : socket),
    realpath: async () => parentPath,
  });
}

test("control socket rejects symlinks, foreign ownership, and broad modes", async (t) => {
  const safeParent = fakeStat({ directory: true });
  const safeSocket = fakeStat({ socket: true });
  const cases = [
    {
      name: "symlink parent",
      parent: fakeStat({ directory: true, symlink: true }),
      socket: safeSocket,
      code: "UNSAFE_SOCKET_DIRECTORY",
    },
    {
      name: "foreign parent",
      parent: fakeStat({ directory: true, uid: 502 }),
      socket: safeSocket,
      code: "UNSAFE_SOCKET_DIRECTORY",
    },
    {
      name: "group-readable parent",
      parent: fakeStat({ directory: true, mode: 0o750 }),
      socket: safeSocket,
      code: "UNSAFE_SOCKET_DIRECTORY",
    },
    {
      name: "symlink socket",
      parent: safeParent,
      socket: fakeStat({ socket: true, symlink: true }),
      code: "UNSAFE_CONTROL_SOCKET",
    },
    {
      name: "foreign socket",
      parent: safeParent,
      socket: fakeStat({ socket: true, uid: 502 }),
      code: "UNSAFE_CONTROL_SOCKET",
    },
  ];
  for (const item of cases)
    await t.test(item.name, async () => {
      await assert.rejects(
        validateFakeSocket(item),
        (error) => error instanceof ReleaseTransportError && error.code === item.code,
      );
    });
  await assert.doesNotReject(
    validateFakeSocket({ parent: safeParent, socket: safeSocket }),
  );
});

test("inventory accepts only a pending plan and the tracked runner", async (t) => {
  let headTrustChecks = 0;
  const context = await loadReleaseContext(
    {
      command: "inventory",
      socket: "/private/tmp/control",
      plan: pendingPlanPath,
      runner: TRACKED_RELEASE_RUNNER_PATH,
    },
    {
      async verifyInventoryRunner(runnerPath, runnerBytes) {
        headTrustChecks += 1;
        assert.equal(runnerPath, TRACKED_RELEASE_RUNNER_PATH);
        assert(runnerBytes.length > 0);
      },
    },
  );
  assert.equal(context.plan.schemaVersion, 1);
  assert.equal(context.plan.status, "pending");
  assert.equal(context.bundle, undefined);
  assert.equal(headTrustChecks, 1);

  assert.throws(
    () =>
      parseCliArguments([
        "inventory",
        "--socket",
        "/private/tmp/control",
        "--plan",
        pendingPlanPath,
        "--runner",
        TRACKED_RELEASE_RUNNER_PATH,
        "--checksums",
        "/private/tmp/SHA256SUMS",
      ]),
    (error) => error.code === "USAGE",
  );

  const directory = await temporaryDirectory(t);
  const untrackedRunner = path.join(directory, "release-runner.py");
  await copyFile(TRACKED_RELEASE_RUNNER_PATH, untrackedRunner);
  await assert.rejects(
    loadReleaseContext({
      command: "inventory",
      socket: "/private/tmp/control",
      plan: pendingPlanPath,
      runner: untrackedRunner,
    }),
    (error) => error.code === "UNTRUSTED_INVENTORY_RUNNER",
  );

  const readyPlanPath = path.join(directory, "deployment-plan.json");
  await writeFile(
    readyPlanPath,
    JSON.stringify({ ...(await pendingPlan()), schemaVersion: 2, status: "ready" }),
  );
  await assert.rejects(
    loadReleaseContext({
      command: "inventory",
      socket: "/private/tmp/control",
      plan: readyPlanPath,
      runner: TRACKED_RELEASE_RUNNER_PATH,
    }),
    (error) => error.code === "INVALID_INVENTORY_PLAN",
  );
});

test("inventory runner bytes must match the current Git HEAD blob", () => {
  const bytes = Buffer.from("reviewed runner\n");
  const execute = (_git, args) =>
    args.includes("rev-parse") ? `${path.resolve(backendRoot, "..")}\n` : bytes;
  assert.equal(
    verifyInventoryRunnerAtHead(TRACKED_RELEASE_RUNNER_PATH, bytes, {
      repositoryRoot: path.resolve(backendRoot, ".."),
      execute,
    }),
    true,
  );
  assert.throws(
    () =>
      verifyInventoryRunnerAtHead(
        TRACKED_RELEASE_RUNNER_PATH,
        Buffer.from("working tree edit\n"),
        {
          repositoryRoot: path.resolve(backendRoot, ".."),
          execute,
        },
      ),
    (error) => error.code === "UNTRUSTED_INVENTORY_RUNNER",
  );
});

test("a frozen sidecar checksum failure happens before transport creation", async (t) => {
  const directory = await temporaryDirectory(t);
  const runnerBytes = await readFile(TRACKED_RELEASE_RUNNER_PATH);
  const planBytes = Buffer.from(JSON.stringify(await frozenPlan(runnerBytes)));
  const planPath = path.join(directory, "deployment-plan.json");
  const runnerPath = path.join(directory, "release-runner.py");
  const checksumsPath = path.join(directory, "SHA256SUMS");
  await Promise.all([
    writeFile(planPath, planBytes),
    writeFile(runnerPath, runnerBytes),
    writeFile(
      checksumsPath,
      `${"0".repeat(64)}  deployment-plan.json\n` +
        `${sha256(runnerBytes)}  release-runner.py\n`,
    ),
  ]);
  let transportCreations = 0;
  await assert.rejects(
    runReleaseCommand(
      [
        "status",
        "--socket",
        "/private/tmp/control",
        "--plan",
        planPath,
        "--runner",
        runnerPath,
        "--checksums",
        checksumsPath,
      ],
      {
        createTransport() {
          transportCreations += 1;
          throw new Error("transport must not be created");
        },
      },
    ),
    (error) => error.code === "OUTER_HASH_MISMATCH",
  );
  assert.equal(transportCreations, 0);
  assert.notEqual(sha256(planBytes), "0".repeat(64));
});

test("mutation confirmation requires a TTY and an exact phrase", async () => {
  let promptCreated = false;
  await assert.rejects(
    requireInteractivePhrase("SWITCH release", {
      input: { isTTY: false },
      output: { isTTY: true, write() {} },
      createPrompt() {
        promptCreated = true;
      },
    }),
    (error) => error.code === "TTY_REQUIRED" && error.exitCode === 4,
  );
  assert.equal(promptCreated, false);

  let closed = false;
  await assert.doesNotReject(
    requireInteractivePhrase("SWITCH release", {
      input: { isTTY: true },
      output: silentOutput(),
      createPrompt: () => ({
        question: async () => "SWITCH release",
        close() {
          closed = true;
        },
      }),
    }),
  );
  assert.equal(closed, true);

  await assert.rejects(
    requireInteractivePhrase("SWITCH release", {
      input: { isTTY: true },
      output: silentOutput(),
      createPrompt: () => ({
        question: async () => "switch release",
        close() {},
      }),
    }),
    (error) => error.code === "CONFIRMATION_MISMATCH" && error.exitCode === 4,
  );
});

function controllerPlan() {
  return {
    schemaVersion: 2,
    status: "ready",
    releaseId,
    transport: { sshTarget: "root@example.test", sshPort: 22 },
    server: { uploadRoot: "/opt/questions/uploads" },
    production: { containerName: "questions-pocketbase" },
    migration: { mode: "none" },
  };
}

function validPreflight(phase = "prepared") {
  const plan = controllerPlan();
  return {
    releaseId: plan.releaseId,
    planSha256: digestBytes(canonicalJson(plan)),
    phase,
    ready: true,
    blocked: false,
    blockers: [],
  };
}

test("preflight response shape is fail-closed", () => {
  const plan = controllerPlan();
  assert.throws(() => assertPreflightAllowsProgress({}, plan), /blocker/i);
  assert.throws(
    () =>
      assertPreflightAllowsProgress(
        {
          ...validPreflight(),
          blockers: "none",
        },
        plan,
      ),
    /blocker/i,
  );
  assert.deepEqual(
    assertPreflightAllowsProgress(validPreflight(), plan),
    validPreflight(),
  );
  assert.throws(
    () =>
      assertPreflightAllowsProgress(
        { ...validPreflight(), planSha256: "0".repeat(64) },
        plan,
      ),
    /blocker/i,
  );
});

function releaseStatus(phase, revision, nextOperation, overrides = {}) {
  return {
    releaseId,
    phase,
    running: false,
    terminal: phase === "recorded" || phase === "blocked",
    blocked: phase === "blocked",
    inFlight: null,
    revision,
    lastSafePhase: "prepared",
    snapshotRestoreAllowed: true,
    trafficMayHaveResumed: false,
    updatedAt: "2026-08-31T00:00:00.000Z",
    activeMarker: null,
    nextOperation,
    ...overrides,
  };
}

function controllerContext() {
  return {
    plan: controllerPlan(),
    runnerSource: "# frozen runner",
    bundle: { fileName: "release.tar.gz", sha256: "a".repeat(64), size: 1 },
    localPaths: {},
  };
}

test("deploy advances exactly one dangerous operation", async () => {
  const actions = [];
  const confirmations = [];
  let statusReads = 0;
  const before = releaseStatus("prepared", 7, "backup");
  const completed = releaseStatus("backup-verified", 8, "no_migration");
  const transport = {
    async rpc(request) {
      actions.push(request);
      if (request.action === "status") {
        statusReads += 1;
        return { ok: true, result: statusReads < 3 ? before : completed };
      }
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("prepared") };
      if (request.action === "start_operation")
        return {
          ok: true,
          result: {
            releaseId,
            phase: "prepared",
            running: true,
            operation: "backup",
            unit: "questions-release-backup.service",
            revision: 7,
          },
        };
      throw new Error(`unexpected action ${request.action}`);
    },
    async poll(read, { isDone, timeoutMs }) {
      assert.equal(timeoutMs, OPERATION_POLL_TIMEOUT_MS);
      const value = await read();
      assert.equal(isDone(value), true);
      return value;
    },
    async upload() {
      throw new Error("deploy must not upload");
    },
  };
  const result = await createReleaseController({
    context: controllerContext(),
    transport,
    output: silentOutput(),
    confirm: async (phrase) => confirmations.push(phrase),
  }).deploy();
  assert.equal(result.phase, "backup-verified");
  assert.deepEqual(
    actions.map(({ action }) => action),
    ["status", "preflight", "status", "start_operation", "status"],
  );
  const starts = actions.filter(({ action }) => action === "start_operation");
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0].fields, {
    operation: "backup",
    expectedRevision: 7,
    expectedPhase: "prepared",
  });
  assert.deepEqual(confirmations, [
    `BACKUP ${releaseId} ON questions-pocketbase`,
  ]);
  assert(
    actions
      .filter(({ action }) => action === "preflight")
      .every(({ timeoutMs }) => timeoutMs === RELEASE_RPC_TIMEOUT_MS),
  );
  assert.deepEqual(
    actions.find(({ action }) => action === "preflight").fields.bundle,
    controllerContext().bundle,
  );
});

test("a disconnect after operation submission becomes result-unknown without retry", async () => {
  const before = releaseStatus("prepared", 11, "backup");
  let statusReads = 0;
  let starts = 0;
  let polls = 0;
  const transport = {
    async rpc(request) {
      if (request.action === "status") {
        statusReads += 1;
        return { ok: true, result: before };
      }
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("prepared") };
      if (request.action === "start_operation") {
        starts += 1;
        throw new ReleaseTransportError("connection lost", {
          code: "PROCESS_FAILED",
        });
      }
      throw new Error(`unexpected action ${request.action}`);
    },
    async poll() {
      polls += 1;
    },
    async upload() {},
  };
  await assert.rejects(
    createReleaseController({
      context: controllerContext(),
      transport,
      output: silentOutput(),
      confirm: async () => true,
    }).deploy(),
    (error) => error.code === "OPERATION_RESULT_UNKNOWN" && error.exitCode === 5,
  );
  assert.equal(statusReads, 2);
  assert.equal(starts, 1);
  assert.equal(polls, 0);
});

test("stage uses its long timeout and treats post-stage status loss as result-unknown", async () => {
  const actions = [];
  const uploads = [];
  const context = {
    ...controllerContext(),
    localPaths: {
      bundle: "/private/tmp/release.tar.gz",
      checksums: "/private/tmp/SHA256SUMS",
    },
  };
  const transport = {
    async rpc(request) {
      actions.push(request);
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("not-staged") };
      if (request.action === "prepare_upload")
        return {
          ok: true,
          result: {
            sessionId: "ab".repeat(16),
            uploadDirectory: "/opt/questions/uploads/" + "ab".repeat(16),
            uploadPath:
              "/opt/questions/uploads/" + "ab".repeat(16) + "/release.tar.gz",
            checksumsPath:
              "/opt/questions/uploads/" + "ab".repeat(16) + "/SHA256SUMS",
          },
        };
      if (request.action === "stage")
        return { ok: true, result: { phase: "prepared" } };
      if (request.action === "status")
        throw new ReleaseTransportError("connection lost after stage");
      throw new Error(`unexpected action ${request.action}`);
    },
    async upload(item) {
      uploads.push(item);
    },
    async poll() {},
  };
  await assert.rejects(
    createReleaseController({
      context,
      transport,
      output: silentOutput(),
      confirm: async () => true,
    }).stage(),
    (error) => error.code === "STAGE_RESULT_UNKNOWN" && error.exitCode === 5,
  );
  assert.equal(uploads.length, 2);
  const stageRequest = actions.find(({ action }) => action === "stage");
  assert.equal(stageRequest.timeoutMs, STAGE_RPC_TIMEOUT_MS);
  assert.equal(actions.filter(({ action }) => action === "stage").length, 1);
});

test("a blocked worker ends polling even when forensic inFlight evidence remains", async () => {
  const before = releaseStatus("prepared", 13, "backup");
  const blocked = releaseStatus("blocked", 15, null, {
    running: true,
    inFlight: {
      operation: "backup",
      operationId: "ab".repeat(16),
      outcome: "failed",
    },
  });
  let statusReads = 0;
  const transport = {
    async rpc(request) {
      if (request.action === "status") {
        statusReads += 1;
        return { ok: true, result: statusReads < 3 ? before : blocked };
      }
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("prepared") };
      if (request.action === "start_operation")
        return {
          ok: true,
          result: {
            releaseId,
            phase: "prepared",
            running: true,
            operation: "backup",
            unit: "questions-release-backup.service",
            revision: 13,
          },
        };
      throw new Error(`unexpected action ${request.action}`);
    },
    async poll(read, { isDone }) {
      const value = await read();
      assert.equal(isDone(value), true);
      return value;
    },
    async upload() {},
  };
  await assert.rejects(
    createReleaseController({
      context: controllerContext(),
      transport,
      output: silentOutput(),
      confirm: async () => true,
    }).deploy(),
    (error) => error.code === "RELEASE_BLOCKED" && error.exitCode === 5,
  );
  assert.equal(statusReads, 3);
});

test("a durable active marker prevents recorded or completed status from being accepted", async () => {
  const marker = {
    releaseId,
    operation: "finalize",
    operationId: "ab".repeat(16),
  };
  const recorded = releaseStatus("recorded", 20, null, {
    activeMarker: marker,
  });
  let actions = 0;
  const recordedTransport = {
    async rpc(request) {
      actions += 1;
      assert.equal(request.action, "status");
      return { ok: true, result: recorded };
    },
    async poll() {
      throw new Error("recorded marker must fail before polling");
    },
    async upload() {},
  };
  await assert.rejects(
    createReleaseController({
      context: controllerContext(),
      transport: recordedTransport,
      output: silentOutput(),
      confirm: async () => true,
    }).deploy(),
    (error) => error.code === "OPERATION_IN_FLIGHT" && error.exitCode === 5,
  );
  assert.equal(actions, 1);

  const before = releaseStatus("prepared", 21, "backup");
  const staleCompletion = releaseStatus("backup-verified", 22, "no_migration", {
    activeMarker: { ...marker, operation: "backup" },
  });
  let statusReads = 0;
  const completionTransport = {
    async rpc(request) {
      if (request.action === "status") {
        statusReads += 1;
        return {
          ok: true,
          result: statusReads < 3 ? before : staleCompletion,
        };
      }
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("prepared") };
      if (request.action === "start_operation")
        return {
          ok: true,
          result: {
            releaseId,
            phase: "prepared",
            running: true,
            operation: "backup",
          },
        };
      throw new Error(`unexpected action ${request.action}`);
    },
    async poll(read, { isDone }) {
      const value = await read();
      assert.equal(isDone(value), false);
      throw new ReleaseTransportError("marker remained after phase update");
    },
    async upload() {},
  };
  await assert.rejects(
    createReleaseController({
      context: controllerContext(),
      transport: completionTransport,
      output: silentOutput(),
      confirm: async () => true,
    }).deploy(),
    (error) => error.code === "OPERATION_RESULT_UNKNOWN" && error.exitCode === 5,
  );
});

test("an already-recorded deploy still performs a full read-only preflight", async () => {
  const recorded = releaseStatus("recorded", 30, null);
  const actions = [];
  const transport = {
    async rpc(request) {
      actions.push(request.action);
      if (request.action === "status") return { ok: true, result: recorded };
      if (request.action === "preflight")
        return { ok: true, result: validPreflight("recorded") };
      throw new Error(`unexpected action ${request.action}`);
    },
    async poll() {
      throw new Error("recorded release must not poll");
    },
    async upload() {},
  };
  const result = await createReleaseController({
    context: controllerContext(),
    transport,
    output: silentOutput(),
    confirm: async () => {
      throw new Error("recorded release must not ask for mutation confirmation");
    },
  }).deploy();
  assert.equal(result.phase, "recorded");
  assert.deepEqual(actions, ["status", "preflight"]);
});

test("the real Python runner emits an authenticated bootstrap RPC frame", async () => {
  const runnerSource = await readFile(TRACKED_RELEASE_RUNNER_PATH, "utf8");
  const nonce = createNonce(() => Buffer.alloc(24, 0xab));
  const action = "status";
  const result = await runProcess(
    "/usr/bin/python3",
    ["-c", RPC_BOOTSTRAP_SOURCE],
    {
      input: createRpcEnvelope(runnerSource, {
        protocol: 1,
        nonce,
        action,
        plan: {},
      }),
    },
  );
  assert.equal(result.exitCode, 0, result.stderr.toString("utf8"));
  const response = parseRpcResponse(result.stdout, {
    expectedNonce: nonce,
    expectedAction: action,
  });
  assert.equal(response.protocol, 1);
  assert.equal(response.nonce, nonce);
  assert.equal(response.action, action);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "invalid_schema");
});
