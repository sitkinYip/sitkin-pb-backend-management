import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createTestServer } from "../tests/server.mjs";
import { backendRoot } from "./runtime.mjs";

const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Provide the private converted-game-v1.json path. This command uses an isolated disposable database.",
  );
const data = JSON.parse(await readFile(filename, "utf8"));
const server = await createTestServer();
try {
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["scripts/import-content.mjs", filename, "--publish"],
        {
          cwd: backendRoot,
          env: {
            ...process.env,
            PB_URL: server.base,
            QUESTIONS_ADMIN_ACCOUNT: server.adminAccount,
            QUESTIONS_ADMIN_PASSWORD: server.adminPassword,
          },
          stdio: "inherit",
        },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Content validation failed")),
      );
    });
  }
  const catalog = await server.request("/api/questions/v1/admin/catalog", {
    token: server.adminToken,
  });
  if (catalog.status !== 200) throw new Error("Cannot read imported catalog");
  for (const table of ["questions", "narratives", "sessions"]) {
    if (
      catalog.data[table].length !== data[table].length ||
      catalog.data[table].some((row) => row.status !== "published")
    )
      throw new Error(`Import/publish/retry verification failed for ${table}`);
  }
  console.log(
    "Private content passed publication validation and idempotent import; no production data changed.",
  );
} finally {
  await server.stop();
}
