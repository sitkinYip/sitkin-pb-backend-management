import { spawn as nodeSpawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstat as nodeLstat, realpath as nodeRealpath } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";
import { parseStrictJson } from "./strict-json.mjs";

export const RELEASE_RPC_PROTOCOL = 1;
export const RELEASE_RPC_PREFIX = "QUESTIONS_RELEASE_RPC/1 ";
export const DEFAULT_RPC_OUTPUT_LIMIT = 1024 * 1024;
export const DEFAULT_RPC_INPUT_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_RPC_TIMEOUT_MS = 120_000;
export const MAX_RPC_TIMEOUT_MS = 45 * 60_000;

const SSH_BINARY = "/usr/bin/ssh";
const SCP_BINARY = "/usr/bin/scp";
const REMOTE_PYTHON = "/usr/bin/python3";

// The remote command is intentionally constant. OpenSSH sends remote commands
// through the account shell, so all changing data is carried in stdin JSON.
export const RPC_BOOTSTRAP_SOURCE = String.raw`import base64
import io
import json
import sys

limit = 8 * 1024 * 1024
raw = sys.stdin.buffer.read(limit + 1)
if len(raw) > limit:
    raise SystemExit(64)
def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON object key")
        value[key] = item
    return value
envelope = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object)
if sorted(envelope.keys()) != ["program", "request"]:
    raise SystemExit(65)
program = base64.b64decode(envelope["program"], validate=True).decode("utf-8")
request = envelope["request"]
sys.stdin = io.StringIO(json.dumps(request, separators=(",", ":"), ensure_ascii=False))
sys.argv = ["release-runner.py"]
scope = {
    "__name__": "__main__",
    "__file__": "<release-runner>",
    "BOOTSTRAP_REQUEST": request,
}
exec(compile(program, "<release-runner>", "exec"), scope, scope)
`;

export function quotePosixLiteral(value) {
  if (typeof value !== "string" || value.includes("\0"))
    throw new TypeError("Expected a NUL-free string.");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export const REMOTE_RPC_COMMAND = `${REMOTE_PYTHON} -c ${quotePosixLiteral(
  RPC_BOOTSTRAP_SOURCE,
)}`;

export class ReleaseTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReleaseTransportError";
    this.code = details.code;
    this.exitCode = details.exitCode;
    this.signal = details.signal;
    this.diagnostic = details.diagnostic;
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

function stripControlCharacters(value) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "?")
    .slice(0, 4096);
}

function decodeUtf8(buffer, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ReleaseTransportError(`${label} was not valid UTF-8.`, {
      code: "INVALID_UTF8",
    });
  }
}

export function normalizeSshTarget(target) {
  if (
    typeof target !== "string" ||
    !/^[a-z_][a-z0-9_.-]{0,31}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(
      target,
    ) ||
    target.includes("..")
  )
    throw new ReleaseTransportError("deployment-plan.json has an unsafe sshTarget.", {
      code: "INVALID_SSH_TARGET",
    });
  return target;
}

export function normalizeSshPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ReleaseTransportError("deployment-plan.json has an invalid sshPort.", {
      code: "INVALID_SSH_PORT",
    });
  return port;
}

export function normalizeRemotePath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 1024 ||
    !/^\/[A-Za-z0-9._/-]+$/.test(value) ||
    value.includes("//") ||
    value.split("/").includes("..") ||
    path.posix.normalize(value) !== value
  )
    throw new ReleaseTransportError("Refusing an unsafe remote path.", {
      code: "INVALID_REMOTE_PATH",
    });
  return value;
}

export function buildSshHardeningOptions(socketPath) {
  return [
    "-o",
    "ControlMaster=no",
    "-o",
    "ControlPersist=no",
    "-o",
    "BatchMode=yes",
    "-o",
    "NumberOfPasswordPrompts=0",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "PubkeyAuthentication=no",
    "-o",
    "HostbasedAuthentication=no",
    "-o",
    "GSSAPIAuthentication=no",
    "-o",
    "IdentityAgent=none",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "HostKeyAlgorithms=ssh-ed25519",
    "-o",
    "UpdateHostKeys=no",
    "-o",
    "CanonicalizeHostname=no",
    "-o",
    // Multiplexed sessions never invoke ProxyCommand. If the reviewed master
    // disappears between the socket check and this command, /usr/bin/false
    // makes a fresh TCP connection impossible instead of falling back to a
    // new authentication flow.
    "ProxyCommand=/usr/bin/false",
    "-o",
    "ProxyJump=none",
    "-o",
    "CheckHostIP=yes",
    "-o",
    "VerifyHostKeyDNS=no",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "ForwardX11=no",
    "-o",
    "PermitLocalCommand=no",
    "-o",
    "RequestTTY=no",
    "-o",
    "EscapeChar=none",
    "-o",
    "ConnectionAttempts=1",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "LogLevel=ERROR",
    "-S",
    socketPath,
  ];
}

export function buildSshCheckArgs({ socketPath, sshTarget, sshPort }) {
  return [
    "-F",
    "/dev/null",
    "-S",
    socketPath,
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-O",
    "check",
    "-p",
    String(normalizeSshPort(sshPort)),
    normalizeSshTarget(sshTarget),
  ];
}

export function buildSshRpcArgs({ socketPath, sshTarget, sshPort }) {
  return [
    "-F",
    "/dev/null",
    ...buildSshHardeningOptions(socketPath),
    "-p",
    String(normalizeSshPort(sshPort)),
    normalizeSshTarget(sshTarget),
    REMOTE_RPC_COMMAND,
  ];
}

function scpHardeningOptions(socketPath) {
  const sshOptions = buildSshHardeningOptions(socketPath);
  const result = [];
  for (let index = 0; index < sshOptions.length; index += 2) {
    const flag = sshOptions[index];
    const value = sshOptions[index + 1];
    if (flag === "-S") {
      result.push("-o", `ControlPath=${value}`);
    } else {
      result.push(flag, value);
    }
  }
  return result;
}

export function buildScpArgs({
  socketPath,
  sshTarget,
  sshPort,
  localPath,
  remotePath,
}) {
  if (!path.isAbsolute(localPath) || localPath.includes("\0"))
    throw new ReleaseTransportError("SCP source must be an absolute local path.", {
      code: "INVALID_LOCAL_PATH",
    });
  const target = normalizeSshTarget(sshTarget);
  const destination = `${target}:${normalizeRemotePath(remotePath)}`;
  const args = [
    "-F",
    "/dev/null",
    "-B",
    "-q",
    ...scpHardeningOptions(socketPath),
    "-P",
    String(normalizeSshPort(sshPort)),
    localPath,
    destination,
  ];
  if (args.includes("-S") || args.includes("-O"))
    throw new ReleaseTransportError("Internal error: unsafe SCP option generated.", {
      code: "UNSAFE_SCP_OPTIONS",
    });
  return args;
}

export async function validateControlSocket(
  socketPath,
  {
    lstat = nodeLstat,
    realpath = nodeRealpath,
    uid = typeof process.getuid === "function" ? process.getuid() : undefined,
  } = {},
) {
  if (
    typeof socketPath !== "string" ||
    !path.isAbsolute(socketPath) ||
    socketPath.includes("%") ||
    socketPath.includes("\0") ||
    path.normalize(socketPath) !== socketPath
  )
    throw new ReleaseTransportError(
      "ControlMaster socket must be a normalized absolute path without %.",
      { code: "INVALID_SOCKET_PATH" },
    );
  if (!Number.isInteger(uid) || uid < 0)
    throw new ReleaseTransportError("Cannot determine the current local UID.", {
      code: "UID_UNAVAILABLE",
    });

  const parent = path.dirname(socketPath);
  let parentStat;
  try {
    parentStat = await lstat(parent);
  } catch {
    throw new ReleaseTransportError(
      "ControlMaster parent directory is unavailable; establish the user-managed tunnel first.",
      { code: "CONTROL_SOCKET_UNAVAILABLE" },
    );
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory())
    throw new ReleaseTransportError(
      "ControlMaster parent must be a real directory, not a symlink.",
      { code: "UNSAFE_SOCKET_DIRECTORY" },
    );
  if (parentStat.uid !== uid || (parentStat.mode & 0o777) !== 0o700)
    throw new ReleaseTransportError(
      "ControlMaster parent must be owned by the current UID with mode 0700.",
      { code: "UNSAFE_SOCKET_DIRECTORY" },
    );
  let resolvedParent;
  try {
    resolvedParent = await realpath(parent);
  } catch {
    throw new ReleaseTransportError(
      "ControlMaster parent directory cannot be resolved safely.",
      { code: "UNSAFE_SOCKET_DIRECTORY" },
    );
  }
  if (resolvedParent !== parent)
    throw new ReleaseTransportError(
      "ControlMaster parent resolves through an unexpected path.",
      { code: "UNSAFE_SOCKET_DIRECTORY" },
    );

  let socketStat;
  try {
    socketStat = await lstat(socketPath);
  } catch {
    throw new ReleaseTransportError(
      "ControlMaster socket is unavailable; establish the user-managed tunnel first.",
      { code: "CONTROL_SOCKET_UNAVAILABLE" },
    );
  }
  if (
    socketStat.isSymbolicLink() ||
    !socketStat.isSocket() ||
    socketStat.uid !== uid
  )
    throw new ReleaseTransportError(
      "ControlMaster control must be a Unix socket owned by the current UID.",
      { code: "UNSAFE_CONTROL_SOCKET" },
    );
  return { socketPath, parent, uid };
}

export function createNonce(random = randomBytes) {
  return random(24).toString("hex");
}

export function createRpcEnvelope(runnerSource, request) {
  if (typeof runnerSource !== "string" || runnerSource.length === 0)
    throw new ReleaseTransportError("Runner source is empty.", {
      code: "EMPTY_RUNNER",
    });
  if (!isPlainObject(request))
    throw new ReleaseTransportError("RPC request must be a plain object.", {
      code: "INVALID_RPC_REQUEST",
    });
  const value = `${JSON.stringify({
    program: Buffer.from(runnerSource, "utf8").toString("base64"),
    request,
  })}\n`;
  if (Buffer.byteLength(value) > DEFAULT_RPC_INPUT_LIMIT)
    throw new ReleaseTransportError("RPC input exceeds the safety limit.", {
      code: "RPC_INPUT_TOO_LARGE",
    });
  return value;
}

export function parseRpcResponse(
  stdout,
  { expectedNonce, expectedAction, maxBytes = DEFAULT_RPC_OUTPUT_LIMIT } = {},
) {
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (bytes.length > maxBytes)
    throw new ReleaseTransportError("RPC response exceeds the safety limit.", {
      code: "RPC_OUTPUT_TOO_LARGE",
    });
  const text = decodeUtf8(bytes, "RPC response");
  if (!text.startsWith(RELEASE_RPC_PREFIX))
    throw new ReleaseTransportError("Remote response used an unknown protocol.", {
      code: "INVALID_RPC_PREFIX",
    });
  const payload = text.slice(RELEASE_RPC_PREFIX.length).trimEnd();
  if (!payload || payload.includes("\n"))
    throw new ReleaseTransportError("RPC response must contain exactly one JSON line.", {
      code: "INVALID_RPC_FRAME",
    });
  let response;
  try {
    response = parseStrictJson(payload, "RPC response");
  } catch {
    throw new ReleaseTransportError("RPC response JSON is invalid.", {
      code: "INVALID_RPC_JSON",
    });
  }
  if (
    !isPlainObject(response) ||
    response.protocol !== RELEASE_RPC_PROTOCOL ||
    typeof response.ok !== "boolean" ||
    response.nonce !== expectedNonce ||
    (expectedAction !== undefined && response.action !== expectedAction)
  )
    throw new ReleaseTransportError("RPC response identity check failed.", {
      code: "RPC_IDENTITY_MISMATCH",
    });
  return response;
}

export function runProcess(
  program,
  args,
  {
    input,
    timeoutMs = 60_000,
    maxStdoutBytes = DEFAULT_RPC_OUTPUT_LIMIT,
    maxStderrBytes = 256 * 1024,
    spawnImpl = nodeSpawn,
    env = process.env,
  } = {},
) {
  if (typeof program !== "string" || !Array.isArray(args))
    return Promise.reject(new TypeError("runProcess requires a program and argv array."));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(program, [...args], {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        // This release client targets macOS/Linux OpenSSH. A dedicated process
        // group lets timeout handling terminate scp and its ssh descendant,
        // including any inherited stdio pipes, as one bounded operation.
        detached: process.platform !== "win32",
        env,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError;
    let settled = false;
    let forcedCloseTimer;
    const killProcessGroup = () => {
      if (
        process.platform !== "win32" &&
        Number.isInteger(child.pid) &&
        child.pid > 0
      ) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Fall through to the direct-child fallback. The bounded rejection
          // below still prevents inherited pipes from hanging the controller.
        }
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // The child may already have exited while a descendant retained pipes.
      }
    };
    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedCloseTimer);
      reject(error);
    };
    const terminate = (error) => {
      if (terminalError) return;
      terminalError = error;
      killProcessGroup();
      forcedCloseTimer = setTimeout(() => finishError(error), 2000);
    };
    const timer = setTimeout(() => {
      terminate(
        new ReleaseTransportError("Process exceeded its timeout.", {
          code: "PROCESS_TIMEOUT",
        }),
      );
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (chunk) => {
      const value = Buffer.from(chunk);
      stdoutBytes += value.length;
      if (stdoutBytes > maxStdoutBytes && !terminalError) {
        terminate(
          new ReleaseTransportError(
            "Process stdout exceeded the safety limit.",
            { code: "STDOUT_TOO_LARGE" },
          ),
        );
        return;
      }
      if (!terminalError) stdout.push(value);
    });
    child.stderr.on("data", (chunk) => {
      const value = Buffer.from(chunk);
      stderrBytes += value.length;
      if (stderrBytes > maxStderrBytes && !terminalError) {
        terminate(
          new ReleaseTransportError(
            "Process stderr exceeded the safety limit.",
            { code: "STDERR_TOO_LARGE" },
          ),
        );
        return;
      }
      if (!terminalError) stderr.push(value);
    });
    child.once("error", finishError);
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forcedCloseTimer);
      if (terminalError) {
        reject(terminalError);
        return;
      }
      resolve({
        exitCode,
        signal,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") terminate(error);
    });
    child.stdin.end(input);
  });
}

function processFailure(label, result) {
  const diagnostic = stripControlCharacters(
    Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr || ""),
  ).trim();
  return new ReleaseTransportError(
    `${label} failed with exit status ${String(result.exitCode)}${
      diagnostic ? `: ${diagnostic}` : ""
    }`,
    {
      code: "PROCESS_FAILED",
      exitCode: result.exitCode,
      signal: result.signal,
      diagnostic,
    },
  );
}

export function createReleaseTransport({
  socketPath,
  sshTarget,
  sshPort,
  sshBinary = SSH_BINARY,
  scpBinary = SCP_BINARY,
  spawnImpl = nodeSpawn,
  lstat = nodeLstat,
  realpath = nodeRealpath,
  uid = typeof process.getuid === "function" ? process.getuid() : undefined,
  now = () => Date.now(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  normalizeSshTarget(sshTarget);
  normalizeSshPort(sshPort);

  const run = (program, args, options) =>
    runProcess(program, args, { ...options, spawnImpl });

  const assertControlMaster = async () => {
    await validateControlSocket(socketPath, { lstat, realpath, uid });
    const result = await run(
      sshBinary,
      buildSshCheckArgs({ socketPath, sshTarget, sshPort }),
      { timeoutMs: 15_000, maxStdoutBytes: 16 * 1024, maxStderrBytes: 16 * 1024 },
    );
    if (result.exitCode !== 0) throw processFailure("ControlMaster check", result);
    return true;
  };

  const rpc = async ({
    runnerSource,
    action,
    plan,
    fields = {},
    timeoutMs = DEFAULT_RPC_TIMEOUT_MS,
  }) => {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(action))
      throw new ReleaseTransportError("Refusing an unsafe RPC action.", {
        code: "INVALID_RPC_ACTION",
      });
    if (!isPlainObject(plan) || !isPlainObject(fields))
      throw new ReleaseTransportError("RPC plan and fields must be objects.", {
        code: "INVALID_RPC_REQUEST",
      });
    for (const reserved of ["protocol", "nonce", "action", "plan"])
      if (Object.hasOwn(fields, reserved))
        throw new ReleaseTransportError(
          `RPC field ${reserved} is reserved by the transport protocol.`,
          { code: "RESERVED_RPC_FIELD" },
        );
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1000 ||
      timeoutMs > MAX_RPC_TIMEOUT_MS
    )
      throw new ReleaseTransportError("RPC timeout is outside the safety range.", {
        code: "INVALID_RPC_TIMEOUT",
      });
    await assertControlMaster();
    const nonce = createNonce();
    const request = {
      protocol: RELEASE_RPC_PROTOCOL,
      nonce,
      action,
      plan,
      ...fields,
    };
    const result = await run(
      sshBinary,
      buildSshRpcArgs({ socketPath, sshTarget, sshPort }),
      {
        input: createRpcEnvelope(runnerSource, request),
        timeoutMs,
        maxStdoutBytes: DEFAULT_RPC_OUTPUT_LIMIT,
        maxStderrBytes: 256 * 1024,
      },
    );
    if (result.exitCode !== 0) throw processFailure(`Remote ${action} RPC`, result);
    return parseRpcResponse(result.stdout, {
      expectedNonce: nonce,
      expectedAction: action,
    });
  };

  const upload = async ({ localPath, remotePath, timeoutMs = 30 * 60_000 }) => {
    await assertControlMaster();
    let source;
    try {
      source = await lstat(localPath);
    } catch {
      throw new ReleaseTransportError("SCP source is unavailable.", {
        code: "INVALID_LOCAL_FILE",
      });
    }
    if (source.isSymbolicLink() || !source.isFile())
      throw new ReleaseTransportError("SCP source must be a regular non-symlink file.", {
        code: "INVALID_LOCAL_FILE",
      });
    const result = await run(
      scpBinary,
      buildScpArgs({ socketPath, sshTarget, sshPort, localPath, remotePath }),
      { timeoutMs, maxStdoutBytes: 64 * 1024, maxStderrBytes: 256 * 1024 },
    );
    if (result.exitCode !== 0) throw processFailure("Release upload", result);
    return { remotePath, bytes: source.size };
  };

  const poll = async (
    read,
    { isDone, intervalMs = 2000, timeoutMs = 30 * 60_000 } = {},
  ) => {
    if (typeof read !== "function" || typeof isDone !== "function")
      throw new TypeError("poll requires read and isDone functions.");
    const deadline = now() + timeoutMs;
    while (true) {
      const value = await read();
      if (isDone(value)) return value;
      if (now() >= deadline)
        throw new ReleaseTransportError(
          "Remote operation is still running; use status after reconnecting.",
          { code: "POLL_TIMEOUT" },
        );
      await sleep(intervalMs);
    }
  };

  return {
    assertControlMaster,
    rpc,
    upload,
    poll,
    target: Object.freeze({ sshTarget, sshPort }),
  };
}
