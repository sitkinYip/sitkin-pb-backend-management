import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { randomUUID } from "node:crypto";
import {
  binary,
  assertVersion,
  argumentsFor,
  backendRoot,
  version,
} from "../scripts/runtime.mjs";

export async function createTestServer() {
  const containerImage = process.env.PB_DOCKER_IMAGE;
  if (containerImage) {
    const actual = execFileSync(
      "docker",
      ["run", "--rm", "--network=none", containerImage, "--version"],
      { encoding: "utf8" },
    );
    if (!actual.includes(` ${version}`))
      throw new Error(`Expected PocketBase ${version}`);
  } else assertVersion();
  const directory = await mkdtemp(path.join(os.tmpdir(), "questions-pb-test-"));
  const dataDir = path.join(directory, "pb_data");
  await cp(
    path.join(backendRoot, "pb_hooks"),
    path.join(directory, "pb_hooks"),
    { recursive: true },
  );
  await writeFile(
    path.join(directory, "pb_hooks", "test-only.pb.js"),
    'routerAdd("POST", "/__test/normalize", e => e.json(200, { value: require(`${__hooks}/lib/rules.js`).normalizeAnswer(e.requestInfo().body.value) }), $apis.requireAuth("_superusers"));',
  );
  const password = `T-${randomUUID()}`;
  const mountArgs = [
    "--mount",
    `type=bind,source=${directory},target=/test-data`,
    "--mount",
    `type=bind,source=${backendRoot},target=/backend,readonly`,
  ];
  const runtimeArgs = containerImage
    ? [
        "--dir=/test-data/pb_data",
        "--migrationsDir=/backend/pb_migrations",
        "--hooksDir=/test-data/pb_hooks",
        "--automigrate=false",
      ]
    : argumentsFor(dataDir).map((arg) =>
        arg.startsWith("--hooksDir=")
          ? `--hooksDir=${path.join(directory, "pb_hooks")}`
          : arg,
      );
  const invoke = (args) =>
    containerImage
      ? execFileSync(
          "docker",
          [
            "run",
            "--rm",
            "--network=none",
            ...mountArgs,
            containerImage,
            ...args,
          ],
          { stdio: "pipe" },
        )
      : execFileSync(binary, args, { stdio: "pipe" });
  try {
    invoke(["migrate", "up", ...runtimeArgs]);
    invoke([
      "superuser",
      "upsert",
      "test@example.test",
      password,
      ...runtimeArgs,
    ]);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw new Error(
      `Cannot prepare isolated database: ${error.stderr?.toString() || error.stdout?.toString() || error.message}`,
    );
  }
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const value = server.address().port;
      server.close(() => resolve(value));
    });
  });
  const containerName = `questions-pb-test-${randomUUID()}`;
  const child = containerImage
    ? spawn(
        "docker",
        [
          "run",
          "--rm",
          "--name",
          containerName,
          "-p",
          `127.0.0.1:${port}:8090`,
          ...mountArgs,
          containerImage,
          "serve",
          "--http=0.0.0.0:8090",
          ...runtimeArgs,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      )
    : spawn(binary, ["serve", `--http=127.0.0.1:${port}`, ...runtimeArgs], {
        stdio: ["ignore", "pipe", "pipe"],
      });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs = (logs + data).slice(-10000);
  });
  child.stderr.on("data", (data) => {
    logs = (logs + data).slice(-10000);
  });
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      if (containerImage)
        execFileSync("docker", ["stop", "--time=5", containerName], {
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 400; i++) {
      if (child.exitCode !== null)
        throw new Error(`PocketBase exited early: ${logs}`);
      try {
        if ((await fetch(`${base}/api/health`)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`PocketBase did not become ready: ${logs}`);
    async function request(route, options = {}) {
      const response = await fetch(base + route, {
        method: options.method || "GET",
        headers: {
          ...(options.token ? { Authorization: options.token } : {}),
          ...(options.body && !options.form
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body:
          options.form ||
          (options.body ? JSON.stringify(options.body) : undefined),
      });
      const data = await response.json();
      return { status: response.status, data };
    }
    const auth = await request(
      "/api/collections/_superusers/auth-with-password",
      { method: "POST", body: { identity: "test@example.test", password } },
    );
    if (auth.status !== 200)
      throw new Error("Cannot authenticate isolated test superuser");
    const adminPassword = `A-${randomUUID()}`;
    const created = await request("/api/collections/game_admins/records", {
      token: auth.data.token,
      method: "POST",
      body: {
        account: "test_admin",
        displayName: "测试管理员",
        status: "active",
        password: adminPassword,
        passwordConfirm: adminPassword,
      },
    });
    if (created.status !== 200)
      throw new Error(
        `Cannot bootstrap isolated administrator: ${JSON.stringify(created.data)}`,
      );
    const admin = await request(
      "/api/collections/game_admins/auth-with-password",
      {
        method: "POST",
        body: { identity: "test_admin", password: adminPassword },
      },
    );
    if (admin.status !== 200)
      throw new Error("Cannot authenticate test administrator");
    return {
      base,
      request,
      stop,
      superToken: auth.data.token,
      adminToken: admin.data.token,
      logs: () => logs,
      directory,
      adminAccount: "test_admin",
      adminPassword,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
