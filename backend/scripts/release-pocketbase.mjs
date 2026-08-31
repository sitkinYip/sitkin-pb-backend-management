#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import {
  ReleaseTransportError,
  createReleaseTransport,
  normalizeRemotePath,
  normalizeSshPort,
  normalizeSshTarget,
} from "./lib/release-transport.mjs";
import { canonicalJson, validateReleasePlan } from "./lib/release-plan.mjs";
import { parseStrictJson } from "./lib/strict-json.mjs";

export const RELEASE_COMMANDS = Object.freeze([
  "inventory",
  "preflight",
  "stage",
  "deploy",
  "status",
]);

const PLAN_SCHEMA_VERSION = 2;
const RELEASE_PLAN_SCHEMA_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,63}$/;
const SESSION_ID_PATTERN = /^[0-9a-f]{32}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DEPLOY_OPERATIONS = Object.freeze([
  "backup",
  "migrate",
  "no_migration",
  "switch",
  "finalize",
]);
export const RELEASE_RPC_TIMEOUT_MS = 35 * 60_000;
export const STAGE_RPC_TIMEOUT_MS = RELEASE_RPC_TIMEOUT_MS;
export const OPERATION_POLL_TIMEOUT_MS = 2 * 60 * 60_000;
export const TRACKED_RELEASE_RUNNER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../deploy/1panel/release-runner.py",
);
export const RELEASE_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const USAGE =
  "Usage: node backend/scripts/release-pocketbase.mjs " +
  "inventory|preflight|stage|deploy|status " +
  "--socket /absolute/control --plan /absolute/deployment-plan.json " +
  "--runner /absolute/release-runner.py " +
  "[--bundle /absolute/release.tar.gz] [--checksums /absolute/SHA256SUMS]";

export class ReleaseCliError extends Error {
  constructor(message, { code = "RELEASE_CLI_ERROR", exitCode = 2 } = {}) {
    super(message);
    this.name = "ReleaseCliError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireCondition(condition, message, code = "INVALID_RELEASE_INPUT") {
  if (!condition) throw new ReleaseCliError(message, { code });
}

function requireObject(value, label) {
  requireCondition(isPlainObject(value), `${label} must be a JSON object.`);
  return value;
}

function requireString(value, label, pattern) {
  requireCondition(
    typeof value === "string" && value.length > 0,
    `${label} must be a non-empty string.`,
  );
  if (pattern)
    requireCondition(pattern.test(value), `${label} has an unsafe value.`);
  return value;
}

function requireInteger(value, label, minimum = 0) {
  requireCondition(
    Number.isSafeInteger(value) && value >= minimum,
    `${label} must be an integer greater than or equal to ${minimum}.`,
  );
  return value;
}

function requireRemotePath(value, label) {
  try {
    return normalizeRemotePath(value);
  } catch {
    throw new ReleaseCliError(`${label} must be a normalized safe absolute path.`, {
      code: "INVALID_PLAN_PATH",
    });
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export function normalizeDeploymentPlan(input) {
  const plan = requireObject(input, "deployment-plan.json");
  requireCondition(
    plan.schemaVersion === PLAN_SCHEMA_VERSION,
    `deployment-plan.json schemaVersion must be ${PLAN_SCHEMA_VERSION}.`,
  );
  requireCondition(
    plan.releasePlanSchemaVersion === RELEASE_PLAN_SCHEMA_VERSION,
    `deployment-plan.json releasePlanSchemaVersion must be ${RELEASE_PLAN_SCHEMA_VERSION}.`,
  );
  requireCondition(
    plan.status === "ready",
    "Only a frozen deployment plan with status ready can be used.",
    "PLAN_NOT_READY",
  );
  requireString(plan.releaseId, "releaseId", RELEASE_ID_PATTERN);

  // Reuse the reviewed input-plan validator for the frozen plan projection so
  // source, target, verification and path-containment rules cannot diverge
  // between packaging and the local control plane.
  try {
    validateReleasePlan({
      schemaVersion: 1,
      status: "pending",
      releaseId: plan.releaseId,
      transport: plan.transport,
      server: plan.server,
      production: plan.production,
      source: plan.source,
      target: plan.target,
      migration: plan.migration,
      verification: plan.verification,
      activation: plan.activation,
    });
  } catch (error) {
    throw new ReleaseCliError(
      error instanceof Error
        ? error.message
        : "Frozen deployment plan projection is invalid.",
      { code: "INVALID_FROZEN_PLAN" },
    );
  }

  const transport = requireObject(plan.transport, "transport");
  try {
    normalizeSshTarget(transport.sshTarget);
    normalizeSshPort(transport.sshPort);
  } catch {
    throw new ReleaseCliError(
      "transport.sshTarget or transport.sshPort is unsafe.",
      { code: "INVALID_PLAN_TRANSPORT" },
    );
  }

  const server = requireObject(plan.server, "server");
  requireString(
    server.expectedHostname,
    "server.expectedHostname",
    /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/,
  );
  requireString(
    server.expectedMachineIdSha256,
    "server.expectedMachineIdSha256",
    SHA256_PATTERN,
  );
  for (const field of ["releaseRoot", "backupRoot", "uploadRoot"])
    requireRemotePath(server[field], `server.${field}`);
  requireInteger(server.minimumFreeBytes, "server.minimumFreeBytes", 1);

  const production = requireObject(plan.production, "production");
  for (const field of [
    "projectDirectory",
    "composePath",
    "dataHostPath",
    "dataContainerPath",
    "rootReleasePath",
    "rootChecksumsPath",
  ])
    requireRemotePath(production[field], `production.${field}`);
  requireString(
    production.composeService,
    "production.composeService",
    SAFE_NAME_PATTERN,
  );
  requireString(
    production.containerName,
    "production.containerName",
    SAFE_NAME_PATTERN,
  );
  requireString(
    production.databaseRelativePath,
    "production.databaseRelativePath",
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/,
  );
  requireCondition(
    !path.posix.isAbsolute(production.databaseRelativePath) &&
      !production.databaseRelativePath.split("/").includes("..") &&
      path.posix.normalize(production.databaseRelativePath) ===
        production.databaseRelativePath,
    "production.databaseRelativePath must be a safe relative path.",
  );
  requireCondition(
    production.hostIp === "127.0.0.1",
    "production.hostIp must remain bound to 127.0.0.1.",
    "UNSAFE_PRODUCTION_BIND",
  );
  requireInteger(production.hostPort, "production.hostPort", 1);
  requireInteger(production.containerPort, "production.containerPort", 1);
  requireCondition(
    production.hostPort <= 65535 && production.containerPort <= 65535,
    "Production ports must be valid TCP ports.",
  );

  requireObject(plan.source, "source");
  requireObject(plan.target, "target");
  const migration = requireObject(plan.migration, "migration");
  requireCondition(
    migration.mode === "required" || migration.mode === "none",
    "migration.mode must be required or none.",
  );
  requireCondition(
    Array.isArray(migration.newFiles) &&
      migration.newFiles.every(
        (name) => typeof name === "string" && SAFE_NAME_PATTERN.test(name),
      ),
    "migration.newFiles must contain only safe file names.",
  );
  requireCondition(
    migration.mode === "required"
      ? migration.newFiles.length > 0
      : migration.newFiles.length === 0,
    "migration.mode does not match migration.newFiles.",
  );
  requireObject(plan.verification, "verification");
  requireObject(plan.activation, "activation");
  requireObject(plan.sourceManifest, "sourceManifest");

  const artifact = requireObject(plan.artifact, "artifact");
  requireString(
    artifact.executorSha256,
    "artifact.executorSha256",
    SHA256_PATTERN,
  );
  requireInteger(
    artifact.maximumExpandedBytes,
    "artifact.maximumExpandedBytes",
    1,
  );
  requireCondition(
    artifact.maximumExpandedBytes <= 16 * 1024 * 1024 * 1024,
    "artifact.maximumExpandedBytes exceeds the release expansion cap.",
  );
  return deepFreeze(plan);
}

export function normalizeAbsoluteLocalPath(value, label) {
  requireCondition(
    typeof value === "string" &&
      path.isAbsolute(value) &&
      !value.includes("\0") &&
      path.normalize(value) === value,
    `${label} must be a normalized absolute local path.`,
    "INVALID_LOCAL_PATH",
  );
  return value;
}

export function parseCliArguments(argv) {
  requireCondition(Array.isArray(argv) && argv.length >= 1, USAGE, "USAGE");
  const [command, ...rest] = argv;
  requireCondition(RELEASE_COMMANDS.includes(command), USAGE, "USAGE");
  requireCondition(rest.length % 2 === 0, USAGE, "USAGE");
  const allowed = new Set([
    "--socket",
    "--plan",
    "--runner",
    "--bundle",
    "--checksums",
  ]);
  const values = { command };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    requireCondition(
      allowed.has(flag) &&
        typeof value === "string" &&
        value.length > 0 &&
        !Object.hasOwn(values, flag.slice(2)),
      USAGE,
      "USAGE",
    );
    values[flag.slice(2)] = normalizeAbsoluteLocalPath(value, flag);
  }
  for (const required of ["socket", "plan", "runner"])
    requireCondition(values[required], USAGE, "USAGE");
  if (values.bundle)
    requireCondition(values.checksums, "--bundle requires --checksums.", "USAGE");
  if (["preflight", "stage", "deploy"].includes(command))
    requireCondition(values.bundle && values.checksums, USAGE, "USAGE");
  if (command === "status")
    requireCondition(values.checksums, USAGE, "USAGE");
  if (command === "inventory")
    requireCondition(
      !values.bundle && !values.checksums,
      "inventory accepts only the pending plan, tracked runner, and control socket.",
      "USAGE",
    );
  return Object.freeze(values);
}

async function requireRegularLocalFile(
  filename,
  label,
  { lstatFile = lstat, realpathFile = realpath } = {},
) {
  const stat = await lstatFile(filename);
  requireCondition(
    !stat.isSymbolicLink() && stat.isFile(),
    `${label} must be a regular non-symlink file.`,
    "INVALID_LOCAL_FILE",
  );
  requireCondition(
    (await realpathFile(filename)) === filename,
    `${label} resolves through an unexpected path.`,
    "INVALID_LOCAL_FILE",
  );
  return stat;
}

export async function sha256File(
  filename,
  { createStream = createReadStream } = {},
) {
  const digest = createHash("sha256");
  for await (const chunk of createStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function verifyInventoryRunnerAtHead(
  runnerPath,
  runnerBytes,
  {
    repositoryRoot = RELEASE_REPOSITORY_ROOT,
    gitBinary = "/usr/bin/git",
    execute = execFileSync,
  } = {},
) {
  const relative = path.relative(repositoryRoot, runnerPath).split(path.sep).join("/");
  requireCondition(
    relative && !relative.startsWith("../") && !path.posix.isAbsolute(relative),
    "Inventory runner is outside the release repository.",
    "UNTRUSTED_INVENTORY_RUNNER",
  );
  let topLevel;
  let committedBytes;
  try {
    topLevel = execute(
      gitBinary,
      ["-C", repositoryRoot, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    committedBytes = execute(
      gitBinary,
      ["-C", repositoryRoot, "show", `HEAD:${relative}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch {
    throw new ReleaseCliError(
      "Inventory runner must already exist in the current Git HEAD.",
      { code: "UNTRUSTED_INVENTORY_RUNNER" },
    );
  }
  requireCondition(
    path.resolve(topLevel) === repositoryRoot &&
      Buffer.from(committedBytes).equals(Buffer.from(runnerBytes)),
    "Inventory runner differs from the reviewed file in Git HEAD.",
    "UNTRUSTED_INVENTORY_RUNNER",
  );
  return true;
}

function decodeLocalUtf8(value, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new ReleaseCliError(`${label} is not valid UTF-8.`, {
      code: "INVALID_LOCAL_ENCODING",
    });
  }
}

export function parseOuterChecksums(text) {
  requireCondition(
    typeof text === "string" && text.length <= 1024 * 1024,
    "Outer checksum manifest is empty or too large.",
    "INVALID_CHECKSUMS",
  );
  const entries = new Map();
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  requireCondition(lines.length > 0, "Outer checksum manifest is empty.");
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]{0,254})$/.exec(
      line,
    );
    requireCondition(match, "Outer checksum manifest has an invalid line.", "INVALID_CHECKSUMS");
    requireCondition(
      !entries.has(match[2]),
      "Outer checksum manifest has duplicate file names.",
      "INVALID_CHECKSUMS",
    );
    entries.set(match[2], match[1]);
  }
  return entries;
}

function requireManifestMatch(checksums, filename, sha256, label) {
  const fileName = path.basename(filename);
  requireCondition(
    SAFE_NAME_PATTERN.test(fileName),
    `${label} file name is unsafe.`,
    "INVALID_SIDECAR_NAME",
  );
  requireCondition(
    checksums.get(fileName) === sha256,
    `${label} does not match the outer checksum manifest.`,
    "OUTER_HASH_MISMATCH",
  );
  return fileName;
}

export async function loadReleaseContext(
  options,
  {
    readBytes = (filename) => readFile(filename),
    statFile = requireRegularLocalFile,
    hashFile = sha256File,
    inventoryRunnerPath = TRACKED_RELEASE_RUNNER_PATH,
    verifyInventoryRunner = verifyInventoryRunnerAtHead,
  } = {},
) {
  const planStat = await statFile(options.plan, "--plan");
  const runnerStat = await statFile(options.runner, "--runner");
  requireCondition(
    planStat.size <= 2 * 1024 * 1024,
    "deployment-plan.json exceeds the safety limit.",
    "PLAN_TOO_LARGE",
  );
  requireCondition(
    runnerStat.size <= 2 * 1024 * 1024,
    "release-runner.py exceeds the safety limit.",
    "RUNNER_TOO_LARGE",
  );
  const [planBytes, runnerBytes] = await Promise.all([
    readBytes(options.plan),
    readBytes(options.runner),
  ]);
  requireCondition(
    planBytes.length === planStat.size &&
      runnerBytes.length === runnerStat.size &&
      planBytes.length <= 2 * 1024 * 1024 &&
      runnerBytes.length <= 2 * 1024 * 1024,
    "Plan or runner changed size while it was being read.",
    "LOCAL_FILE_CHANGED",
  );
  const planSource = decodeLocalUtf8(planBytes, "deployment-plan.json");
  const runnerSource = decodeLocalUtf8(runnerBytes, "release-runner.py");
  let parsedPlan;
  try {
    parsedPlan = parseStrictJson(planSource, "deployment-plan.json");
  } catch {
    throw new ReleaseCliError("deployment-plan.json is not valid JSON.", {
      code: "INVALID_PLAN_JSON",
    });
  }
  const pendingInventory =
    options.command === "inventory" &&
    parsedPlan?.schemaVersion === 1 &&
    parsedPlan?.status === "pending";
  if (options.command === "inventory")
    requireCondition(
      pendingInventory,
      "inventory requires a schemaVersion 1 plan with status pending.",
      "INVALID_INVENTORY_PLAN",
    );
  if (pendingInventory)
    requireCondition(
      options.runner === inventoryRunnerPath,
      `inventory runner must be the tracked repository file at ${inventoryRunnerPath}.`,
      "UNTRUSTED_INVENTORY_RUNNER",
    );
  if (pendingInventory)
    await verifyInventoryRunner(options.runner, runnerBytes);

  // The frozen plan contains the SSH destination. Authenticate its local
  // bytes and the runner sidecar before normalizing or exposing any transport
  // fields. Pending inventory is the sole read-only bootstrap exception.
  let checksums;
  let runnerSha256;
  if (!pendingInventory) {
    requireCondition(
      options.checksums,
      "A frozen deployment command requires --checksums as its local trust anchor.",
      "CHECKSUMS_REQUIRED",
    );
    const checksumsStat = await statFile(options.checksums, "--checksums");
    requireCondition(
      checksumsStat.size <= 1024 * 1024,
      "Outer checksum manifest exceeds the safety limit.",
      "CHECKSUMS_TOO_LARGE",
    );
    checksums = parseOuterChecksums(
      decodeLocalUtf8(
        await readBytes(options.checksums),
        "Outer checksum manifest",
      ),
    );
    const planSha256 = sha256Bytes(planBytes);
    runnerSha256 = sha256Bytes(runnerBytes);
    const planName = requireManifestMatch(
      checksums,
      options.plan,
      planSha256,
      "deployment-plan.json",
    );
    const runnerName = requireManifestMatch(
      checksums,
      options.runner,
      runnerSha256,
      "release-runner.py",
    );
    requireCondition(
      planName !== runnerName,
      "Plan and runner sidecars must have distinct file names.",
      "SIDECAR_NAME_COLLISION",
    );
  }

  let plan;
  if (pendingInventory) {
    try {
      plan = deepFreeze(validateReleasePlan(parsedPlan));
    } catch (error) {
      throw new ReleaseCliError(
        error instanceof Error ? error.message : "Pending release plan is invalid.",
        { code: "INVALID_PENDING_PLAN" },
      );
    }
  } else {
    plan = normalizeDeploymentPlan(parsedPlan);
  }
  if (plan.schemaVersion === PLAN_SCHEMA_VERSION)
    requireCondition(
      runnerSha256 === plan.artifact.executorSha256,
      "release-runner.py does not match plan.artifact.executorSha256.",
      "RUNNER_HASH_MISMATCH",
    );

  let bundle;
  if (options.bundle) {
    const bundleStat = await statFile(options.bundle, "--bundle");
    const fileName = path.basename(options.bundle);
    requireCondition(
      SAFE_NAME_PATTERN.test(fileName),
      "Bundle file name is unsafe.",
      "INVALID_BUNDLE_NAME",
    );
    const sha256 = await hashFile(options.bundle);
    requireManifestMatch(checksums, options.bundle, sha256, "Bundle");
    bundle = Object.freeze({ fileName, sha256, size: bundleStat.size });
  }

  return Object.freeze({
    plan,
    runnerSource,
    bundle,
    localPaths: Object.freeze({ ...options }),
  });
}

export function unwrapRpcResponse(response) {
  requireCondition(isPlainObject(response), "Remote response is not an object.", "INVALID_REMOTE_RESPONSE");
  if (!response.ok) {
    const error = isPlainObject(response.error) ? response.error : {};
    const code =
      typeof error.code === "string" && SAFE_NAME_PATTERN.test(error.code)
        ? error.code
        : "REMOTE_REJECTED";
    const message =
      typeof error.message === "string"
        ? error.message
            .replace(/[\u0000-\u001f\u007f]/g, "?")
            .slice(0, 1000)
        : "Remote runner rejected the request.";
    throw new ReleaseCliError(`${code}: ${message}`, {
      code,
      exitCode: 2,
    });
  }
  return requireObject(response.result, "remote result");
}

export function assertPreflightAllowsProgress(result, plan, expectedPhase) {
  requireObject(result, "preflight result");
  requireObject(plan, "frozen release plan");
  const blockers = result.blockers;
  const expectedPlanSha256 = sha256Bytes(canonicalJson(plan));
  requireCondition(
    result.ready === true &&
      result.blocked === false &&
      Array.isArray(blockers) &&
      blockers.length === 0 &&
      result.releaseId === plan.releaseId &&
      result.planSha256 === expectedPlanSha256 &&
      typeof result.phase === "string" &&
      SAFE_NAME_PATTERN.test(result.phase) &&
      (expectedPhase === undefined || result.phase === expectedPhase),
    "Remote preflight reported a blocker; no mutation was started.",
    "PREFLIGHT_BLOCKED",
  );
  return result;
}

export function isPathInside(root, candidate) {
  const relative = path.posix.relative(root, candidate);
  return relative.length > 0 && !relative.startsWith("../") && !path.posix.isAbsolute(relative);
}

export function normalizeUploadSession(result, plan) {
  const sessionId = requireString(
    result.sessionId,
    "prepare_upload.sessionId",
    SESSION_ID_PATTERN,
  );
  const uploadDirectory = requireRemotePath(
    result.uploadDirectory,
    "prepare_upload.uploadDirectory",
  );
  const uploadPath = requireRemotePath(result.uploadPath, "prepare_upload.uploadPath");
  const checksumsPath = requireRemotePath(
    result.checksumsPath,
    "prepare_upload.checksumsPath",
  );
  requireCondition(
    isPathInside(plan.server.uploadRoot, uploadDirectory) &&
      isPathInside(uploadDirectory, uploadPath) &&
      isPathInside(uploadDirectory, checksumsPath) &&
      uploadPath !== checksumsPath,
    "prepare_upload returned a path outside the frozen upload root.",
    "UNSAFE_UPLOAD_SESSION",
  );
  return Object.freeze({ sessionId, uploadDirectory, uploadPath, checksumsPath });
}

export function expectedNextOperation(status, plan) {
  requireObject(status, "status result");
  if (status.blocked === true || status.phase === "blocked") return null;
  if (status.phase === "recorded") return null;
  if (status.phase === "prepared") return "backup";
  if (status.phase === "backup-verified")
    return plan.migration.mode === "required" ? "migrate" : "no_migration";
  if (
    status.phase === "production-migrated" ||
    status.phase === "migration-not-required"
  )
    return "switch";
  if (status.phase === "verified") return "finalize";
  return undefined;
}

export function normalizeStatusResult(result, plan) {
  const status = requireObject(result, "status result");
  requireCondition(
    status.releaseId === plan.releaseId,
    "Remote status belongs to a different release.",
    "STATUS_RELEASE_MISMATCH",
  );
  requireString(status.phase, "status.phase", SAFE_NAME_PATTERN);
  for (const field of [
    "running",
    "terminal",
    "blocked",
    "snapshotRestoreAllowed",
    "trafficMayHaveResumed",
  ])
    requireCondition(
      typeof status[field] === "boolean",
      `status.${field} must be boolean.`,
      "INVALID_STATUS_RESULT",
    );
  requireInteger(status.revision, "status.revision", 0);
  requireCondition(
    status.inFlight === null || isPlainObject(status.inFlight),
    "status.inFlight must be null or an object.",
    "INVALID_STATUS_RESULT",
  );
  requireCondition(
    status.lastSafePhase === null ||
      (typeof status.lastSafePhase === "string" &&
        SAFE_NAME_PATTERN.test(status.lastSafePhase)),
    "status.lastSafePhase is invalid.",
    "INVALID_STATUS_RESULT",
  );
  requireCondition(
    typeof status.updatedAt === "string" &&
      status.updatedAt.length <= 64 &&
      Number.isFinite(Date.parse(status.updatedAt)),
    "status.updatedAt must be an ISO-like timestamp.",
    "INVALID_STATUS_RESULT",
  );
  requireCondition(
    status.activeMarker === null || isPlainObject(status.activeMarker),
    "status.activeMarker must be null or an object.",
    "INVALID_STATUS_RESULT",
  );
  requireCondition(
    status.nextOperation === null ||
      DEPLOY_OPERATIONS.includes(status.nextOperation),
    "status.nextOperation is invalid.",
    "INVALID_STATUS_RESULT",
  );
  return status;
}

export function selectNextOperation(status, plan) {
  requireCondition(
    status.releaseId === plan.releaseId,
    "Remote status belongs to a different release.",
    "STATUS_RELEASE_MISMATCH",
  );
  if (status.blocked === true || status.phase === "blocked")
    throw new ReleaseCliError(
      "The release is blocked. Inspect status and follow an approved recovery plan; do not retry automatically.",
      { code: "RELEASE_BLOCKED", exitCode: 5 },
    );
  if (status.running === true || status.inFlight || status.activeMarker)
    throw new ReleaseCliError(
      "A remote operation or durable active marker is still present or result-unknown. Use status; no retry was started.",
      { code: "OPERATION_IN_FLIGHT", exitCode: 5 },
    );
  if (status.phase === "recorded") return null;
  const localDecision = expectedNextOperation(status, plan);
  requireCondition(
    DEPLOY_OPERATIONS.includes(localDecision),
    `Phase ${String(status.phase)} cannot be advanced automatically.`,
    "UNEXPECTED_REMOTE_PHASE",
  );
  requireCondition(
    status.nextOperation === localDecision,
    "Remote nextOperation disagrees with the frozen local phase plan.",
    "NEXT_OPERATION_MISMATCH",
  );
  return localDecision;
}

export function mutationPhrase(operation, plan) {
  requireCondition(DEPLOY_OPERATIONS.includes(operation), "Unknown deploy operation.");
  const verbs = {
    backup: "BACKUP",
    migrate: "MIGRATE",
    no_migration: "CONFIRM-NO-MIGRATION",
    switch: "SWITCH",
    finalize: "FINALIZE",
  };
  return `${verbs[operation]} ${plan.releaseId} ON ${plan.production.containerName}`;
}

export function stagePhrase(plan) {
  return `STAGE ${plan.releaseId} TO ${plan.transport.sshTarget}`;
}

export async function requireInteractivePhrase(
  phrase,
  {
    input = process.stdin,
    output = process.stdout,
    createPrompt = (options) => createInterface(options),
  } = {},
) {
  if (!input.isTTY || !output.isTTY)
    throw new ReleaseCliError(
      "Production mutations require an interactive TTY; piped confirmation is refused.",
      { code: "TTY_REQUIRED", exitCode: 4 },
    );
  output.write(`\nType this exact phrase to continue:\n${phrase}\n> `);
  const prompt = createPrompt({ input, output, terminal: true });
  let answer;
  try {
    answer = await prompt.question("");
  } finally {
    prompt.close();
  }
  if (answer !== phrase)
    throw new ReleaseCliError("Confirmation did not match; nothing was started.", {
      code: "CONFIRMATION_MISMATCH",
      exitCode: 4,
    });
  return true;
}

function writeJson(output, value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireBundle(context) {
  requireCondition(
    context.plan.schemaVersion === PLAN_SCHEMA_VERSION &&
      context.plan.status === "ready",
    "This command requires a frozen ready deployment plan.",
    "PLAN_NOT_READY",
  );
  requireCondition(context.bundle, "This command requires a verified release bundle.");
  return context.bundle;
}

function statusFinished(status) {
  if (status.blocked === true || status.phase === "blocked") return true;
  if (status.activeMarker !== null) return false;
  return (
    status.phase === "recorded" ||
    (status.running !== true && !status.inFlight)
  );
}

function expectedCompletedPhase(operation) {
  return {
    backup: "backup-verified",
    migrate: "production-migrated",
    no_migration: "migration-not-required",
    switch: "verified",
    finalize: "recorded",
  }[operation];
}

export function createReleaseController({
  context,
  transport,
  confirm = requireInteractivePhrase,
  output = process.stdout,
} = {}) {
  requireObject(context, "release context");
  requireObject(transport, "release transport");
  const { plan, runnerSource } = context;
  const rpc = async (action, fields = {}, options = {}) =>
    unwrapRpcResponse(
      await transport.rpc({
        runnerSource,
        action,
        plan,
        fields,
        timeoutMs: RELEASE_RPC_TIMEOUT_MS,
        ...options,
      }),
    );
  const readStatus = async () => normalizeStatusResult(await rpc("status"), plan);
  const runPreflight = async (expectedPhase) =>
    assertPreflightAllowsProgress(
      await rpc("preflight", { bundle: requireBundle(context) }),
      plan,
      expectedPhase,
    );

  const inventory = async () => {
    const result = await rpc("inventory", {
      paths: [
        plan.production.projectDirectory,
        plan.production.composePath,
        plan.production.dataHostPath,
        plan.production.rootReleasePath,
        plan.production.rootChecksumsPath,
      ],
      bootstrapPaths: [
        plan.server.releaseRoot,
        plan.server.backupRoot,
        plan.server.uploadRoot,
      ],
    });
    writeJson(output, { command: "inventory", releaseId: plan.releaseId, result });
    return result;
  };

  const preflight = async () => {
    requireBundle(context);
    const result = await runPreflight();
    writeJson(output, { command: "preflight", releaseId: plan.releaseId, result });
    return result;
  };

  const stage = async () => {
    const bundle = requireBundle(context);
    const preflightResult = await runPreflight("not-staged");
    writeJson(output, {
      command: "stage-plan",
      environment: "PRODUCTION",
      target: plan.transport.sshTarget,
      releaseId: plan.releaseId,
      bundle,
      preflight: preflightResult,
      effects: [
        "create a private upload session",
        "upload verified release files",
        "load the frozen image into the production host Docker image store",
        "create, start, inspect, and remove an isolated validation container",
        "write a fail-closed stage marker and prepared release state",
      ],
      excludedEffects: ["stop service", "migrate database", "switch image"],
    });
    await confirm(stagePhrase(plan));
    const prepared = normalizeUploadSession(
      await rpc("prepare_upload", { bundle }),
      plan,
    );
    await transport.upload({
      localPath: context.localPaths.bundle,
      remotePath: prepared.uploadPath,
    });
    await transport.upload({
      localPath: context.localPaths.checksums,
      remotePath: prepared.checksumsPath,
    });
    let result;
    let stagedStatus;
    try {
      result = await rpc("stage", {
        sessionId: prepared.sessionId,
        bundle,
      }, { timeoutMs: STAGE_RPC_TIMEOUT_MS });
      stagedStatus = await readStatus();
    } catch (error) {
      throw new ReleaseCliError(
        "Stage did not reach a locally verified prepared result. Its outcome may be unknown; reconnect and run status before any retry.",
        { code: "STAGE_RESULT_UNKNOWN", exitCode: 5 },
      );
    }
    requireCondition(
      stagedStatus.phase === "prepared" &&
        stagedStatus.running === false &&
        stagedStatus.blocked === false &&
        stagedStatus.nextOperation === "backup",
      "Stage completed without a verified prepared phase.",
      "STAGE_NOT_PREPARED",
    );
    writeJson(output, {
      command: "stage",
      releaseId: plan.releaseId,
      result,
      status: stagedStatus,
    });
    return stagedStatus;
  };

  const status = async () => {
    const result = await readStatus();
    writeJson(output, { command: "status", releaseId: plan.releaseId, result });
    return result;
  };

  const deploy = async () => {
    requireBundle(context);
    const before = await readStatus();
    const operation = selectNextOperation(before, plan);
    if (operation === null) {
      const recordedPreflight = await runPreflight("recorded");
      writeJson(output, {
        command: "deploy",
        releaseId: plan.releaseId,
        result: before,
        preflight: recordedPreflight,
        message: "Release is already recorded; no operation was started.",
      });
      return before;
    }
    const preflightResult = await runPreflight(before.phase);
    const phrase = mutationPhrase(operation, plan);
    writeJson(output, {
      command: "deploy-plan",
      environment: "PRODUCTION",
      target: plan.transport.sshTarget,
      container: plan.production.containerName,
      releaseId: plan.releaseId,
      currentPhase: before.phase,
      operation,
      preflight: preflightResult,
      oneDangerousStageOnly: true,
      confirmationPhrase: phrase,
    });
    await confirm(phrase);

    // Preflight is not a lock. Fetch status once more after confirmation and
    // bind the operation to the same revision before asking the runner to start.
    const fresh = await readStatus();
    requireCondition(
      fresh.revision === before.revision &&
        fresh.phase === before.phase &&
        selectNextOperation(fresh, plan) === operation,
      "Remote release state changed while waiting for confirmation; nothing was started.",
      "STATUS_DRIFT",
    );
    let started;
    try {
      started = await rpc("start_operation", {
        operation,
        expectedRevision: fresh.revision,
        expectedPhase: fresh.phase,
      });
    } catch (error) {
      if (!(error instanceof ReleaseTransportError)) throw error;
      throw new ReleaseCliError(
        "The connection failed while submitting the approved operation. It may still be running; reconnect and run status, and do not retry deploy blindly.",
        { code: "OPERATION_RESULT_UNKNOWN", exitCode: 5 },
      );
    }
    if (
      started.releaseId !== plan.releaseId ||
      started.operation !== operation ||
      started.running !== true
    )
      throw new ReleaseCliError(
        "Remote operation acknowledgement is invalid; the operation may still be running. Use status and do not retry blindly.",
        { code: "INVALID_OPERATION_ACK", exitCode: 5 },
      );
    writeJson(output, {
      command: "deploy-started",
      releaseId: plan.releaseId,
      operation,
      result: started,
    });

    let completed;
    try {
      completed = await transport.poll(
        async () => readStatus(),
        {
          isDone: statusFinished,
          intervalMs: 2000,
          timeoutMs: OPERATION_POLL_TIMEOUT_MS,
        },
      );
    } catch {
      throw new ReleaseCliError(
        "The approved remote operation may still be running. Reconnect and use status; this command will not retry it.",
        { code: "OPERATION_RESULT_UNKNOWN", exitCode: 5 },
      );
    }
    writeJson(output, {
      command: "deploy",
      releaseId: plan.releaseId,
      operation,
      result: completed,
    });
    if (completed.blocked === true || completed.phase === "blocked")
      throw new ReleaseCliError(
        "The approved stage entered blocked. Preserve evidence and use status; no retry was attempted.",
        { code: "RELEASE_BLOCKED", exitCode: 5 },
      );
    requireCondition(
      completed.phase === expectedCompletedPhase(operation) &&
        completed.activeMarker === null,
      "The remote operation stopped without its expected verified phase; treat the result as unknown.",
      "RESULT_UNKNOWN",
    );
    return completed;
  };

  return Object.freeze({ inventory, preflight, stage, deploy, status });
}

export async function runReleaseCommand(
  argv,
  {
    loadContext = loadReleaseContext,
    createTransport = createReleaseTransport,
    confirm = requireInteractivePhrase,
    output = process.stdout,
  } = {},
) {
  const options = parseCliArguments(argv);
  const context = await loadContext(options);
  const transport = createTransport({
    socketPath: options.socket,
    sshTarget: context.plan.transport.sshTarget,
    sshPort: context.plan.transport.sshPort,
  });
  const controller = createReleaseController({ context, transport, confirm, output });
  return controller[options.command]();
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[\u0000-\u001f\u007f]/g, "?")
    .slice(0, 2000);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    await runReleaseCommand(argv);
  } catch (error) {
    process.stderr.write(`${safeErrorMessage(error)}\n`);
    if (error instanceof ReleaseCliError) process.exitCode = error.exitCode;
    else if (error instanceof ReleaseTransportError) process.exitCode = 3;
    else process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
