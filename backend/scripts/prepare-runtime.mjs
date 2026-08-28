import { mkdir, writeFile, mkdtemp, rm, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { backendRoot, version } from "./runtime.mjs";

// Values from the official v0.40.1 checksums.txt; deliberately pinned in source.
const hashes = {
  amd64: "0f3442d2e57b03b56fbff0d09289e4a30b4f561a44338c38d2dcd4a1a0cfa91e",
  arm64: "8e15eb6080de5ae7fcf789ac963d5c3c9328a491d5f7a24eb13c93a2f4bae4f1",
};
const arch = process.argv[2];
if (!hashes[arch])
  throw new Error(
    "Usage: node scripts/prepare-runtime.mjs amd64|arm64 (choose the deployment server CPU, not automatically your laptop CPU)",
  );
const name = `pocketbase_${version}_linux_${arch}.zip`;
const temp = await mkdtemp(path.join(os.tmpdir(), "questions-pb-download-"));
try {
  const response = await fetch(
    `https://github.com/pocketbase/pocketbase/releases/download/v${version}/${name}`,
    { signal: AbortSignal.timeout(120000) },
  );
  if (!response.ok)
    throw new Error(
      `Official runtime download failed: HTTP ${response.status}`,
    );
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== hashes[arch])
    throw new Error("SHA256 mismatch; runtime was not installed.");
  const archive = path.join(temp, name);
  await writeFile(archive, bytes);
  const directory = path.join(backendRoot, "deploy/runtime");
  await mkdir(directory, { recursive: true });
  execFileSync("unzip", ["-o", archive, "pocketbase", "-d", directory], {
    stdio: "ignore",
  });
  await chmod(path.join(directory, "pocketbase"), 0o755);
  await writeFile(
    path.join(directory, "verified.json"),
    JSON.stringify(
      { version, arch, sha256: hashes[arch], source: name },
      null,
      2,
    ),
  );
  console.log(`Verified and installed PocketBase ${version} linux/${arch}.`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
