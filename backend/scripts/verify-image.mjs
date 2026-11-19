import { execFileSync } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { version } from "./runtime.mjs";

// Exercise the code embedded in the release image, not bind-mounted source.
// An offline copy is restored into a different directory after stopping writes.
const image = process.env.PB_DOCKER_IMAGE;
if (!image) throw new Error("Set PB_DOCKER_IMAGE to the built release image.");
const directory = await mkdtemp(
  path.join(os.tmpdir(), "questions-image-test-"),
);
const container = `questions-image-test-${randomUUID()}`;
const password = `Test-${randomUUID()}`;
let running = false;
const docker = (args) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
// Use the caller's identity for every write into the temporary Linux bind mount.
const mount = [
  "--user", `${process.getuid()}:${process.getgid()}`,
  "--mount", `type=bind,source=${directory},target=/test`,
];
const flags = (folder) => [
  `--dir=/test/${folder}`,
  "--hooksDir=/pb/pb_hooks",
  "--migrationsDir=/pb/pb_migrations",
  "--automigrate=false",
];
const stop = () => {
  if (running) {
    docker(["stop", "--time=5", container]);
    running = false;
  }
};
async function start(folder) {
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-p",
    "127.0.0.1::8090",
    ...mount,
    image,
    "serve",
    "--http=0.0.0.0:8090",
    ...flags(folder),
  ]);
  running = true;
  const base = `http://${docker(["port", container, "8090/tcp"])}`;
  for (let n = 0; n < 200; n++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return base;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Packaged image did not become healthy");
}
async function request(base, route, method = "GET", body, token) {
  const response = await fetch(base + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 200, `${route}: HTTP ${response.status}`);
  return response.json();
}
try {
  assert.match(
    docker(["run", "--rm", "--network=none", image, "--version"]),
    new RegExp(version.replaceAll(".", "\\.")),
  );
  docker([
    "run",
    "--rm",
    "--network=none",
    ...mount,
    image,
    "migrate",
    "up",
    ...flags("original"),
  ]);
  docker([
    "run",
    "--rm",
    "--network=none",
    ...mount,
    image,
    "superuser",
    "upsert",
    "restore@example.test",
    password,
    ...flags("original"),
  ]);
  const base = await start("original");
  const auth = await request(
    base,
    "/api/collections/_superusers/auth-with-password",
    "POST",
    { identity: "restore@example.test", password },
  );
  const admin = await request(
    base,
    "/api/collections/game_admins/records",
    "POST",
    {
      account: "restore_test",
      displayName: "恢复演练管理员",
      status: "active",
      password,
      passwordConfirm: password,
    },
    auth.token,
  );
  const token = (
    await request(
      base,
      "/api/collections/game_admins/auth-with-password",
      "POST",
      { identity: admin.account, password },
    )
  ).token;
  const reward = await request(
    base,
    "/api/questions/v1/admin/rewards",
    "POST",
    {
      requestId: randomUUID(),
      name: "恢复演练奖品",
      description: "本地虚构数据",
      claimMethod: "staff",
      publicInstructions: "",
      active: true,
    },
    token,
  );
  stop();
  await cp(path.join(directory, "original"), path.join(directory, "restored"), {
    recursive: true,
  });
  const restoredBase = await start("restored");
  const restoredToken = (
    await request(
      restoredBase,
      "/api/collections/game_admins/auth-with-password",
      "POST",
      { identity: admin.account, password },
    )
  ).token;
  const catalog = await request(
    restoredBase,
    "/api/questions/v1/admin/catalog",
    "GET",
    undefined,
    restoredToken,
  );
  assert.ok(
    catalog.rewards.some(
      (row) => row.id === reward.id && row.name === "恢复演练奖品",
    ),
  );
  assert.equal(
    (await fetch(restoredBase + "/api/questions/v1/admin/catalog")).status,
    401,
  );
  console.log(
    "Packaged image: version, empty-database migration, authenticated hooks, container restart and offline database-copy restoration verified.",
  );
} finally {
  stop();
  await rm(directory, { recursive: true, force: true });
}
