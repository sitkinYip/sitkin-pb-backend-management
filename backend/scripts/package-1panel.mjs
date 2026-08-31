import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  copyFile,
  open,
  writeFile,
  readFile,
  readdir,
  lstat,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { backendRoot, version } from "./runtime.mjs";
import {
  ALLOWED_DELTA_SCHEMA_VERSION,
  DEPLOYMENT_PLAN_SCHEMA_VERSION,
  canonicalJson,
  createComposeCandidate,
  digestBytes,
  validateAllowedDelta,
  validateOperationSheet,
  validateReleasePlan,
} from "./lib/release-plan.mjs";
import { parseStrictJson } from "./lib/strict-json.mjs";

// Local packaging only: never contacts a production server or includes pb_data.
const args = process.argv.slice(2);
const usage =
  "Usage: node scripts/package-1panel.mjs /new/output-directory [--upgrade --plan /reviewed/release-plan.json --allowed-delta /reviewed/allowed-delta.json] (upgrade requires PB_DOCKER_IMAGE)";
let upgrade = false;
let planArgument;
let allowedDeltaArgument;
const positional = [];
for (let index = 0; index < args.length; index++) {
  const argument = args[index];
  if (argument === "--upgrade") {
    if (upgrade) throw new Error(usage);
    upgrade = true;
  } else if (argument === "--plan" || argument === "--allowed-delta") {
    const value = args[++index];
    if (!value || value.startsWith("-")) throw new Error(usage);
    if (argument === "--plan") {
      if (planArgument) throw new Error(usage);
      planArgument = value;
    } else {
      if (allowedDeltaArgument) throw new Error(usage);
      allowedDeltaArgument = value;
    }
  } else if (argument.startsWith("-")) throw new Error(usage);
  else positional.push(argument);
}
if (positional.length !== 1 || positional[0].startsWith("-"))
  throw new Error(usage);
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
if (upgrade && (!planArgument || !allowedDeltaArgument))
  throw new Error(
    "Upgrade packaging requires explicit --plan and --allowed-delta reviewed files.",
  );
if (!upgrade && (planArgument || allowedDeltaArgument)) throw new Error(usage);

const MAX_REVIEWED_FILE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 128 * 1024 * 1024;
// SHA256 of the `pocketbase` member extracted from the official v0.40.1
// linux_amd64 zip whose archive checksum is pinned in prepare-runtime.mjs.
const PINNED_LINUX_AMD64_RUNTIME_SHA256 =
  "bfdc715d14d922f3dfcb8333cc439e7eb1d44ed602456662299bf14f4d6387b8";
const stableFingerprint = (info) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");
const readStableRegularFile = async (filename, label, maximumBytes) => {
  const resolved = path.resolve(filename);
  const initial = await lstat(resolved, { bigint: true });
  if (!initial.isFile() || initial.isSymbolicLink())
    throw new Error(`${label} must be a regular, non-symlink file.`);
  if (initial.size > BigInt(maximumBytes))
    throw new Error(`${label} exceeds its reviewed file size limit.`);
  if ((await realpath(resolved)) !== resolved)
    throw new Error(`${label} resolves through an unexpected path.`);
  const handle = await open(
    resolved,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== initial.dev ||
      before.ino !== initial.ino ||
      stableFingerprint(before) !== stableFingerprint(initial)
    )
      throw new Error(`${label} changed while it was being opened.`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const finalPath = await lstat(resolved, { bigint: true });
    if (
      bytes.length !== Number(before.size) ||
      stableFingerprint(after) !== stableFingerprint(before) ||
      stableFingerprint(finalPath) !== stableFingerprint(before) ||
      (await realpath(resolved)) !== resolved
    )
      throw new Error(`${label} changed while it was being read.`);
    return { resolved, bytes };
  } finally {
    await handle.close();
  }
};
const readStableDirectoryNames = async (filename, label) => {
  const resolved = path.resolve(filename);
  const before = await lstat(resolved, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new Error(`${label} must be a regular, non-symlink directory.`);
  if ((await realpath(resolved)) !== resolved)
    throw new Error(`${label} resolves through an unexpected path.`);
  const names = (await readdir(resolved)).sort();
  const after = await lstat(resolved, { bigint: true });
  if (
    stableFingerprint(after) !== stableFingerprint(before) ||
    (await realpath(resolved)) !== resolved
  )
    throw new Error(`${label} changed while it was being enumerated.`);
  return names;
};
const readReviewedFile = async (
  filename,
  label,
  maximumBytes = MAX_REVIEWED_FILE_BYTES,
) => readStableRegularFile(filename, label, maximumBytes);
const sourceManifestForRelease = async () => {
  const files = [];
  const visit = async (relative) => {
    const absolute = path.join(backendRoot, relative);
    const info = await lstat(absolute, { bigint: true });
    if (info.isSymbolicLink())
      throw new Error(`Image source input cannot be a symlink: ${relative}`);
    if (info.isDirectory()) {
      const names = await readStableDirectoryNames(
        absolute,
        `Image source directory ${relative}`,
      );
      for (const name of names) await visit(path.join(relative, name));
      return;
    }
    if (!info.isFile())
      throw new Error(`Image source input must be a regular file: ${relative}`);
    const { bytes } = await readStableRegularFile(
      absolute,
      `Image source input ${relative}`,
      MAX_SOURCE_FILE_BYTES,
    );
    const normalized = relative.split(path.sep).join("/");
    files.push({
      path: normalized,
      size: bytes.length,
      sha256: digestBytes(bytes),
    });
  };
  for (const input of [
    "deploy/Dockerfile",
    "deploy/runtime/pocketbase",
    "pb_hooks",
    "pb_migrations",
  ])
    await visit(input);
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  return { algorithm: "sha256", files };
};
const parseJson = (bytes, label) => {
  try {
    return parseStrictJson(bytes, label);
  } catch (error) {
    throw new Error(`${label} is not valid strict JSON: ${error.message}`);
  }
};

const template = path.join(backendRoot, "deploy/1panel");
let plan;
let operationSheetBytes;
let allowedDeltaBytes;
let runnerBytes;
let composeCandidate;
if (upgrade) {
  const reviewedPlan = await readReviewedFile(planArgument, "Release plan");
  const reviewedDelta = await readReviewedFile(
    allowedDeltaArgument,
    "Allowed delta",
  );
  plan = validateReleasePlan(parseJson(reviewedPlan.bytes, "Release plan"), {
    expectedPocketbaseVersion: version,
    expectedTargetImageTag: image,
  });
  if (
    plan.releaseId.includes("example") ||
    plan.transport.sshTarget.includes("replace-with-") ||
    plan.server.expectedHostname.includes("replace-with-") ||
    /^0{64}$/.test(plan.server.expectedMachineIdSha256) ||
    /^0{64}$/.test(plan.source.migrationLedgerSha256)
  )
    throw new Error(
      "Release plan still contains example placeholders; inventory and review the real production identity before packaging.",
    );
  validateAllowedDelta(
    parseJson(reviewedDelta.bytes, "Allowed delta"),
    plan,
  );
  allowedDeltaBytes = reviewedDelta.bytes;
  operationSheetBytes = (
    await readReviewedFile(
      path.join(template, "UPGRADE.md"),
      "Upgrade operation sheet",
    )
  ).bytes;
  validateOperationSheet(operationSheetBytes.toString("utf8"), plan);
  runnerBytes = (
    await readReviewedFile(
      path.join(template, "release-runner.py"),
      "Frozen release runner",
    )
  ).bytes;
  if (!runnerBytes.length) throw new Error("Frozen release runner is empty.");
  const composeBytes = (
    await readReviewedFile(
      path.join(template, "compose.production.yaml"),
      "Production Compose template",
    )
  ).bytes;
  composeCandidate = createComposeCandidate(composeBytes.toString("utf8"), plan);
  const repositoryMigrations = (
    await readStableDirectoryNames(
      path.join(backendRoot, "pb_migrations"),
      "Repository migrations directory",
    )
  )
    .filter((name) => name.endsWith(".js"))
    .sort();
  const plannedMigrations = [
    ...plan.source.requiredMigrationFiles,
    ...plan.migration.newFiles,
  ].sort();
  if (JSON.stringify(repositoryMigrations) !== JSON.stringify(plannedMigrations))
    throw new Error(
      "Release plan source migrations plus new migrations must exactly match the repository.",
    );
}
const initialSourceManifest = await sourceManifestForRelease();
const runtimeSource = initialSourceManifest.files.find(
  (item) => item.path === "deploy/runtime/pocketbase",
);
if (runtimeSource?.sha256 !== PINNED_LINUX_AMD64_RUNTIME_SHA256)
  throw new Error(
    "The ignored PocketBase runtime does not match the pinned official Linux AMD64 binary.",
  );
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const info = JSON.parse(docker(["image", "inspect", image]))[0];
if (info.Os !== "linux" || info.Architecture !== "amd64")
  throw new Error("Expected Linux AMD64 release image.");
const initialImageId = info.Id;
if (!/^sha256:[0-9a-f]{64}$/.test(initialImageId || ""))
  throw new Error("Docker returned an invalid immutable image ID.");
const descriptorMediaType = info.Descriptor?.mediaType;
const dockerReportsManifestId =
  info.Descriptor?.digest === initialImageId &&
  [
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
  ].includes(descriptorMediaType);
const expectedRuntimeCommand = [
  "serve",
  "--http=0.0.0.0:8090",
  "--dir=/pb/pb_data",
  "--hooksDir=/pb/pb_hooks",
  "--migrationsDir=/pb/pb_migrations",
  "--automigrate=false",
];
const validateRuntimeConfig = (config, label) => {
  if (
    JSON.stringify(config?.Entrypoint) !== JSON.stringify(["/pb/pocketbase"]) ||
    JSON.stringify(config?.Cmd) !== JSON.stringify(expectedRuntimeCommand) ||
    config?.WorkingDir !== "/pb" ||
    ![undefined, null, "", "0", "root"].includes(config?.User) ||
    JSON.stringify(config?.ExposedPorts) !== JSON.stringify({ "8090/tcp": {} }) ||
    (config?.Healthcheck && Object.keys(config.Healthcheck).length > 0)
  )
    throw new Error(`${label} does not match the reviewed PocketBase runtime contract.`);
};
validateRuntimeConfig(info.Config, "Inspected image config");
const actualVersion = docker([
  "run",
  "--rm",
  "--platform",
  "linux/amd64",
  "--network",
  "none",
  initialImageId,
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
  initialImageId,
  "-c",
  "cmp /pb/pocketbase /verify-source/deploy/runtime/pocketbase && diff -qr /pb/pb_hooks /verify-source/pb_hooks && diff -qr /pb/pb_migrations /verify-source/pb_migrations",
]);
if (
  canonicalJson(await sourceManifestForRelease()) !==
  canonicalJson(initialSourceManifest)
)
  throw new Error("Backend image source changed during image verification.");
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

// Refuse to overwrite an earlier release. Build the complete handoff directory
// beside its destination and publish it with one final rename so a failed
// verification cannot leave a directory that looks ready to deploy.
try {
  await lstat(output);
  throw new Error(`Refusing to overwrite an existing release output: ${output}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const outputStaging = await mkdtemp(
  path.join(path.dirname(output), `.${path.basename(output)}.tmp-`),
);
let outputCommitted = false;
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
  const tagAfterSave = JSON.parse(docker(["image", "inspect", image]))[0];
  if (tagAfterSave.Id !== initialImageId)
    throw new Error("Target image tag changed while the frozen archive was being produced.");
  if (!upgrade) {
    await copyFile(
      path.join(template, "compose.yaml"),
      path.join(staging, "compose.yaml"),
    );
    await copyFile(
      path.join(template, "README.md"),
      path.join(staging, "README.md"),
    );
  } else {
    await writeFile(path.join(staging, "README.md"), operationSheetBytes);
    await writeFile(
      path.join(staging, "allowed-delta.json"),
      allowedDeltaBytes,
    );
    await writeFile(path.join(staging, "release-runner.py"), runnerBytes);
    await writeFile(
      path.join(staging, "compose.candidate.yaml"),
      composeCandidate.content,
    );
    docker([
      "compose",
      "--env-file",
      "/dev/null",
      "-f",
      path.join(staging, "compose.candidate.yaml"),
      "config",
      "--quiet",
    ]);
  }
  const archiveManifest = JSON.parse(
    execFileSync(
      "tar",
      ["-xOf", path.join(staging, "pocketbase-image.tar"), "manifest.json"],
      { encoding: "utf8" },
    ),
  );
  if (archiveManifest.length !== 1)
    throw new Error("Expected exactly one exported image.");
  if (JSON.stringify(archiveManifest[0].RepoTags) !== JSON.stringify([image]))
    throw new Error("Exported image archive must contain only the target tag.");
  const configBytes = execFileSync("tar", [
    "-xOf",
    path.join(staging, "pocketbase-image.tar"),
    archiveManifest[0].Config,
  ]);
  const config = JSON.parse(configBytes);
  if (config.architecture !== "amd64" || config.os !== "linux")
    throw new Error("Exported image architecture mismatch.");
  validateRuntimeConfig(config.config, "Exported image config");
  if (
    JSON.stringify(config.rootfs?.diff_ids) !==
    JSON.stringify(info.RootFS?.Layers)
  )
    throw new Error(
      "Exported image root filesystem differs from the immutable image that passed verification.",
    );
  const createdAt = new Date().toISOString();
  const targetImageConfigDigest = `sha256:${digestBytes(configBytes)}`;
  // Classic Docker reports the config digest as Image.Id. Docker Desktop's
  // containerd image store reports the single-platform manifest digest instead.
  // In the latter case, bind the saved config to the inspected image through
  // the exact RootFS diff IDs above and refuse indexes or unknown descriptors.
  if (targetImageConfigDigest !== initialImageId && !dockerReportsManifestId)
    throw new Error(
      "Exported image differs from the immutable image that passed verification.",
    );
  const migrationFiles = (await readdir(path.join(backendRoot, "pb_migrations")))
    .filter((name) => name.endsWith(".js"))
    .sort();
  const upgradeMembers = [
    "pocketbase-image.tar",
    "README.md",
    "deployment-plan.json",
    "allowed-delta.json",
    "release-runner.py",
    "compose.candidate.yaml",
    "release.json",
    "SHA256SUMS",
  ];
  let maximumExpandedBytes;
  if (upgrade) {
    let knownExpandedBytes = 0;
    for (const member of [
      "pocketbase-image.tar",
      "README.md",
      "allowed-delta.json",
      "release-runner.py",
      "compose.candidate.yaml",
    ])
      knownExpandedBytes += (await lstat(path.join(staging, member))).size;
    // deployment-plan.json and release.json each have an 8 MiB server cap;
    // keep additional room for SHA256SUMS and deterministic JSON formatting.
    maximumExpandedBytes = knownExpandedBytes + 20 * 1024 * 1024;
    if (maximumExpandedBytes > 16 * 1024 * 1024 * 1024)
      throw new Error("Release bundle exceeds the server expansion safety cap.");
  }
  let deploymentPlanSha256;
  let sourceManifest;
  let sourceManifestSha256;
  let operationSheetSha256;
  let allowedDeltaSha256;
  let executorSha256;
  if (upgrade) {
    sourceManifest = initialSourceManifest;
    sourceManifestSha256 = digestBytes(canonicalJson(sourceManifest));
    operationSheetSha256 = digestBytes(operationSheetBytes);
    allowedDeltaSha256 = digestBytes(allowedDeltaBytes);
    executorSha256 = digestBytes(runnerBytes);
    const deploymentPlan = {
      ...plan,
      schemaVersion: DEPLOYMENT_PLAN_SCHEMA_VERSION,
      releasePlanSchemaVersion: plan.schemaVersion,
      status: "ready",
      sourceManifest,
      artifact: {
        createdAt,
        operationSheetSha256,
        allowedDeltaSha256,
        executorSha256,
        sourceManifestSha256,
        targetImageConfigDigest,
        targetComposeSha256: composeCandidate.targetSha256,
        maximumExpandedBytes,
        bundleMembers: upgradeMembers,
      },
    };
    const deploymentPlanBytes = Buffer.from(
      JSON.stringify(deploymentPlan, null, 2) + "\n",
    );
    deploymentPlanSha256 = digestBytes(deploymentPlanBytes);
    await writeFile(
      path.join(staging, "deployment-plan.json"),
      deploymentPlanBytes,
    );
  }
  const release = {
    ...(upgrade ? { schemaVersion: 2, releaseId: plan.releaseId } : {}),
    pocketbaseVersion: version,
    platform: "linux/amd64",
    imageTag: image,
    imageConfigDigest: targetImageConfigDigest,
    sourceLocalImageId: info.Id,
    createdAt,
    containsBusinessData: false,
    containsCredentials: false,
    containsFrontendBuilds: false,
    deploymentMode: upgrade ? "upgrade-in-place" : "initial-install",
    containsComposeTemplate: !upgrade,
    ...(upgrade ? { containsComposeCandidate: true } : {}),
    migrationFiles,
    imageCodeMatchesRepository: true,
    ...(upgrade
      ? {
          newMigrationFiles: plan.migration.newFiles,
          deploymentPlanFile: "deployment-plan.json",
          deploymentPlanSha256,
          operationSheetSha256,
          allowedDeltaFile: "allowed-delta.json",
          allowedDeltaSchemaVersion: ALLOWED_DELTA_SCHEMA_VERSION,
          allowedDeltaSha256,
          executorFile: "release-runner.py",
          executorSha256,
          composeCandidateFile: "compose.candidate.yaml",
          sourceComposeSha256: composeCandidate.sourceSha256,
          targetComposeSha256: composeCandidate.targetSha256,
          sourceManifestSha256,
          sourceManifest,
          maximumExpandedBytes,
        }
      : {}),
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
    ...(upgrade
      ? [
          "deployment-plan.json",
          "allowed-delta.json",
          "release-runner.py",
          "compose.candidate.yaml",
        ]
      : []),
    "release.json",
  ];
  const checksums = [];
  for (const name of files)
    checksums.push(`${await hash(path.join(staging, name))}  ${name}`);
  await writeFile(
    path.join(staging, "SHA256SUMS"),
    checksums.join("\n") + "\n",
  );
  if (upgrade) {
    let actualExpandedBytes = 0;
    for (const member of [...files, "SHA256SUMS"])
      actualExpandedBytes += (await lstat(path.join(staging, member))).size;
    if (actualExpandedBytes > maximumExpandedBytes)
      throw new Error("Release bundle expanded size exceeds its frozen budget.");
  }
  const name = upgrade
    ? `${image.replace(":", "-")}-upgrade.tar.gz`
    : `questions-game-v1-pb-${version}-linux-amd64.tar.gz`;
  const archive = path.join(outputStaging, name);
  execFileSync(
    "tar",
    ["-czf", archive, "-C", staging, ...files, "SHA256SUMS"],
    { env: { ...process.env, COPYFILE_DISABLE: "1" } },
  );
  await copyFile(
    path.join(staging, "README.md"),
    path.join(outputStaging, "README.md"),
  );
  await copyFile(
    path.join(staging, "release.json"),
    path.join(outputStaging, "release.json"),
  );
  if (upgrade)
    for (const sidecar of [
      "deployment-plan.json",
      "allowed-delta.json",
      "release-runner.py",
    ])
      await copyFile(
        path.join(staging, sidecar),
        path.join(outputStaging, sidecar),
      );
  const outerFiles = [
    name,
    ...(upgrade
      ? [
          "README.md",
          "release.json",
          "deployment-plan.json",
          "allowed-delta.json",
          "release-runner.py",
        ]
      : []),
  ];
  const outerChecksums = [];
  for (const outerFile of outerFiles)
    outerChecksums.push(
      `${await hash(path.join(outputStaging, outerFile))}  ${outerFile}`,
    );
  await writeFile(
    path.join(outputStaging, "SHA256SUMS"),
    outerChecksums.join("\n") + "\n",
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
  for (const line of (
    await readFile(path.join(outputStaging, "SHA256SUMS"), "utf8")
  )
    .trim()
    .split("\n")) {
    const [expected, outerName] = line.split("  ");
    if ((await hash(path.join(outputStaging, outerName))) !== expected)
      throw new Error(`Outer release verification failed: ${outerName}`);
  }
  if (
    canonicalJson(await sourceManifestForRelease()) !==
    canonicalJson(initialSourceManifest)
  )
    throw new Error("Backend image source changed while the release was packaged.");
  await rename(outputStaging, output);
  outputCommitted = true;
  console.log(`Verified release archive: ${path.join(output, name)}`);
} finally {
  await rm(staging, { recursive: true, force: true });
  if (!outputCommitted)
    await rm(outputStaging, { recursive: true, force: true });
}
