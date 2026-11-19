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

export async function createTestServer({
  migrationNames,
  env = {},
  testHooks = "",
  pushSmokeSecretFile,
} = {}) {
  const containerImage = process.env.PB_DOCKER_IMAGE;
  if (pushSmokeSecretFile && (!containerImage || !path.isAbsolute(pushSmokeSecretFile) ||
      /[\r\n,]/.test(pushSmokeSecretFile) || env.STARWARD_PUSH_ENABLED !== "1" ||
      env.STARWARD_PUSH_TEST_MODE !== "1" ||
      !/^[a-z0-9]{15}$/.test(env.STARWARD_PUSH_TEST_PLAYER_ID || "")))
    throw new Error("Push smoke credential mount is limited to one isolated test player");
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
  let dataDir = path.join(directory, "pb_data");
  const migrationsDir = path.join(directory, "pb_migrations");
  const copyMigrations = () =>
    cp(path.join(backendRoot, "pb_migrations"), migrationsDir, {
      recursive: true,
      filter: (source) =>
        !migrationNames ||
        path.basename(source) === "pb_migrations" ||
        migrationNames.includes(path.basename(source)),
    });
  await copyMigrations();
  await cp(
    path.join(backendRoot, "pb_hooks"),
    path.join(directory, "pb_hooks"),
    { recursive: true },
  );
  await writeFile(
    path.join(directory, "pb_hooks", "test-only.pb.js"),
    'routerAdd("POST", "/__test/normalize", e => e.json(200, { value: require(`${__hooks}/lib/rules.js`).normalizeAnswer(e.requestInfo().body.value) }), $apis.requireAuth("_superusers"));\n' +
      testHooks,
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
        "--migrationsDir=/test-data/pb_migrations",
        "--hooksDir=/test-data/pb_hooks",
        "--automigrate=false",
      ]
    : argumentsFor(dataDir).map((arg) =>
        arg.startsWith("--hooksDir=")
          ? `--hooksDir=${path.join(directory, "pb_hooks")}`
          : arg.startsWith("--migrationsDir=")
            ? `--migrationsDir=${migrationsDir}`
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
  const isolatedEnv = {
    STARWARD_PUSH_ENABLED: "0",
    STARWARD_PUSH_TEST_MODE: "1",
    STARWARD_PUSH_TEST_PLAYER_ID: "",
    STARWARD_PUSH_PROJECT_ID: "",
    STARWARD_PUSH_SERVICE_ACCOUNT_FILE: "",
    STARWARD_PUSH_SUBSCRIPTION_APPROVED: "0",
    ...env,
    ...(pushSmokeSecretFile ? {
      STARWARD_PUSH_SERVICE_ACCOUNT_FILE: "/run/secrets/starward-push-service-account.json",
    } : {}),
  };
  const spawnServer = () =>
    containerImage
      ? spawn(
          "docker",
          [
            "run",
            "--rm",
            "--name",
            containerName,
            "-p",
            `127.0.0.1:${port}:8090`,
            ...Object.entries(isolatedEnv).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
            ...mountArgs,
            ...(pushSmokeSecretFile ? [
              "--mount",
              `type=bind,source=${pushSmokeSecretFile},target=/run/secrets/starward-push-service-account.json,readonly`,
            ] : []),
            containerImage,
            "serve",
            "--http=0.0.0.0:8090",
            ...runtimeArgs,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        )
      : spawn(binary, ["serve", `--http=127.0.0.1:${port}`, ...runtimeArgs], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...isolatedEnv },
        });
  let logs = "";
  let child;
  const startProcess = () => {
    child = spawnServer();
    child.stdout.on("data", (data) => {
      logs = (logs + data).slice(-10000);
    });
    child.stderr.on("data", (data) => {
      logs = (logs + data).slice(-10000);
    });
  };
  startProcess();
  const base = `http://127.0.0.1:${port}`;
  const stopProcess = async () => {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      if (containerImage)
        execFileSync("docker", ["stop", "--time=5", containerName], {
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
      await exited;
    }
  };
  const stop = async () => {
    await stopProcess();
    await rm(directory, { recursive: true, force: true });
  };
  const waitReady = async () => {
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
  };
  const upgradeMigrations = async ({
    restoreCopy = false,
    targetMigrationNames,
  } = {}) => {
    await stopProcess();
    if (restoreCopy) {
      const restored = path.join(directory, "restored_pb_data");
      await cp(dataDir, restored, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      dataDir = restored;
      const index = runtimeArgs.findIndex((arg) => arg.startsWith("--dir="));
      runtimeArgs[index] = containerImage
        ? "--dir=/test-data/restored_pb_data"
        : `--dir=${restored}`;
    }
    migrationNames = targetMigrationNames;
    await copyMigrations();
    invoke(["migrate", "up", ...runtimeArgs]);
    startProcess();
    await waitReady();
  };
  try {
    await waitReady();
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
      upgradeMigrations,
      restart: async () => {
        await stopProcess();
        startProcess();
        await waitReady();
      },
      dataDirectory: () => dataDir,
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
