import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { binary, assertVersion, argumentsFor } from "./runtime.mjs";

assertVersion();
const dataDir =
  process.env.PB_DATA_DIR ||
  path.join(os.tmpdir(), "questions-pb-dev.local", "pb_data");
const listen = process.env.PB_LISTEN || "127.0.0.1:8090";
const child = spawn(
  binary,
  ["serve", `--http=${listen}`, ...argumentsFor(dataDir)],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
