import { writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { createTestServer } from "../tests/server.mjs";
import { seedDemo } from "../fixtures/demo.mjs";

const server = await createTestServer();
try {
  const demo = await seedDemo(server);
  const file =
    process.env.PB_DEMO_STATE ||
    path.join(server.directory, "demo-state.local.json");
  await writeFile(
    file,
    JSON.stringify(
      {
        base: server.base,
        adminAccount: server.adminAccount,
        adminPassword: server.adminPassword,
        ...demo,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await chmod(file, 0o600);
  console.log(
    `Isolated demo ready: ${server.base}\nLocal test credentials: ${file}\nStop this process to remove only this demo container and its temporary database.`,
  );
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  await server.stop();
  throw error;
}
