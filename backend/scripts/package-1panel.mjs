import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  copyFile,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { backendRoot, version } from "./runtime.mjs";

// Local packaging only: never contacts a production server or includes pb_data.
const args = process.argv.slice(2);
const upgrade = args.includes("--upgrade");
const positional = args.filter((arg) => arg !== "--upgrade");
if (positional.length !== 1 || positional[0].startsWith("-"))
  throw new Error(
    "Usage: node scripts/package-1panel.mjs /new/output-directory [--upgrade] (upgrade requires PB_DOCKER_IMAGE)",
  );
const output = path.resolve(positional[0]);
const image = upgrade
  ? process.env.PB_DOCKER_IMAGE
  : `questions-pocketbase:${version}-v1.1-amd64`;
if (
  !image ||
  !image.startsWith(`questions-pocketbase:${version}-`) ||
  !/^questions-pocketbase:[a-z0-9][a-z0-9._-]*-amd64$/.test(image)
)
  throw new Error(
    "Expected an explicit, versioned questions-pocketbase AMD64 image tag.",
  );
if (upgrade && image === `questions-pocketbase:${version}-v1.1-amd64`)
  throw new Error(
    "Use a new upgrade image tag; do not overwrite the original release.",
  );
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const info = JSON.parse(docker(["image", "inspect", image]))[0];
if (info.Os !== "linux" || info.Architecture !== "amd64")
  throw new Error("Expected Linux AMD64 release image.");
const actualVersion = docker([
  "run",
  "--rm",
  "--platform",
  "linux/amd64",
  "--network",
  "none",
  image,
  "--version",
]);
if (actualVersion !== `pocketbase version ${version}`)
  throw new Error("Unexpected PocketBase version.");
docker([
  "run",
  "--rm",
  "--platform",
  "linux/amd64",
  "--network",
  "none",
  "--mount",
  `type=bind,source=${backendRoot},target=/verify-source,readonly`,
  "--entrypoint",
  "sh",
  image,
  "-c",
  "diff -qr /pb/pb_hooks /verify-source/pb_hooks && diff -qr /pb/pb_migrations /verify-source/pb_migrations",
]);
const template = path.join(backendRoot, "deploy/1panel");
if (!upgrade)
  docker([
    "compose",
    "--env-file",
    "/dev/null",
    "-f",
    path.join(template, "compose.yaml"),
    "config",
    "--quiet",
  ]);

// Refuse to overwrite an earlier release.
await mkdir(output, { mode: 0o700 });
const staging = await mkdtemp(path.join(os.tmpdir(), "questions-release-"));
const hash = async (filename) => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
};
try {
  docker([
    "image",
    "save",
    "--platform",
    "linux/amd64",
    "--output",
    path.join(staging, "pocketbase-image.tar"),
    image,
  ]);
  if (!upgrade)
    await copyFile(
      path.join(template, "compose.yaml"),
      path.join(staging, "compose.yaml"),
    );
  await copyFile(
    path.join(template, upgrade ? "UPGRADE.md" : "README.md"),
    path.join(staging, "README.md"),
  );
  const archiveManifest = JSON.parse(
    execFileSync(
      "tar",
      ["-xOf", path.join(staging, "pocketbase-image.tar"), "manifest.json"],
      { encoding: "utf8" },
    ),
  );
  if (archiveManifest.length !== 1)
    throw new Error("Expected exactly one exported image.");
  const configBytes = execFileSync("tar", [
    "-xOf",
    path.join(staging, "pocketbase-image.tar"),
    archiveManifest[0].Config,
  ]);
  const config = JSON.parse(configBytes);
  if (config.architecture !== "amd64" || config.os !== "linux")
    throw new Error("Exported image architecture mismatch.");
  const release = {
    pocketbaseVersion: version,
    platform: "linux/amd64",
    imageTag: image,
    imageConfigDigest: `sha256:${createHash("sha256").update(configBytes).digest("hex")}`,
    sourceLocalImageId: info.Id,
    createdAt: new Date().toISOString(),
    containsBusinessData: false,
    containsCredentials: false,
    containsFrontendBuilds: false,
    deploymentMode: upgrade ? "upgrade-in-place" : "initial-install",
    containsComposeTemplate: !upgrade,
    migrationFiles: (await readdir(path.join(backendRoot, "pb_migrations")))
      .filter((name) => name.endsWith(".js"))
      .sort(),
    imageCodeMatchesRepository: true,
    note: "Docker engines may report an index or config digest as image ID. Verify archive SHA256, platform and runtime version after loading.",
  };
  await writeFile(
    path.join(staging, "release.json"),
    JSON.stringify(release, null, 2) + "\n",
  );
  const files = [
    "pocketbase-image.tar",
    ...(!upgrade ? ["compose.yaml"] : []),
    "README.md",
    "release.json",
  ];
  const checksums = [];
  for (const name of files)
    checksums.push(`${await hash(path.join(staging, name))}  ${name}`);
  await writeFile(
    path.join(staging, "SHA256SUMS"),
    checksums.join("\n") + "\n",
  );
  const name = upgrade
    ? `${image.replace(":", "-")}-upgrade.tar.gz`
    : `questions-game-v1-pb-${version}-linux-amd64.tar.gz`;
  const archive = path.join(output, name);
  execFileSync(
    "tar",
    ["-czf", archive, "-C", staging, ...files, "SHA256SUMS"],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  await writeFile(
    path.join(output, "SHA256SUMS"),
    `${await hash(archive)}  ${name}\n`,
  );
  await copyFile(
    path.join(staging, "README.md"),
    path.join(output, "README.md"),
  );
  await copyFile(
    path.join(staging, "release.json"),
    path.join(output, "release.json"),
  );
  // Verify the actual compressed artifact, not just its staging directory.
  const extracted = path.join(staging, "verify");
  await mkdir(extracted);
  execFileSync("tar", ["-xzf", archive, "-C", extracted]);
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" })
    .trim()
    .split("\n")
    .sort();
  if (JSON.stringify(names) !== JSON.stringify([...files, "SHA256SUMS"].sort()))
    throw new Error("Unexpected release archive contents.");
  for (const line of (
    await readFile(path.join(extracted, "SHA256SUMS"), "utf8")
  )
    .trim()
    .split("\n")) {
    const [expected, name] = line.split("  ");
    if ((await hash(path.join(extracted, name))) !== expected)
      throw new Error(`Release verification failed: ${name}`);
  }
  console.log(`Verified release archive: ${archive}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
