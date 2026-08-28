import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

export const backendRoot = fileURLToPath(new URL("..", import.meta.url));
export const version = "0.40.1";
export const binary =
  process.env.PB_BINARY ||
  path.join(os.tmpdir(), "questions-pb-runtime", "pocketbase");
export function assertVersion() {
  const actual = execFileSync(binary, ["--version"], {
    encoding: "utf8",
  }).trim();
  if (!actual.includes(` ${version}`))
    throw new Error(`Expected PocketBase ${version}, got ${actual}`);
}
export function argumentsFor(dataDir) {
  return [
    `--dir=${dataDir}`,
    `--migrationsDir=${path.join(backendRoot, "pb_migrations")}`,
    `--hooksDir=${path.join(backendRoot, "pb_hooks")}`,
    "--automigrate=false",
  ];
}
