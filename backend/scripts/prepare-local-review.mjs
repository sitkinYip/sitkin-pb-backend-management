import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

// This convenience tool is deliberately restricted to the disposable local demo.
const [statePath, contentPath] = process.argv.slice(2);
if (!statePath || !contentPath)
  throw new Error(
    "Usage: node scripts/prepare-local-review.mjs /private/demo-state.json /private/converted-game-v1.json",
  );
const state = JSON.parse(await readFile(statePath, "utf8"));
if (!["127.0.0.1", "localhost"].includes(new URL(state.base).hostname))
  throw new Error("Review setup only permits a local demo backend");
const reportPath = path.join(
  path.dirname(statePath),
  "questions-local-review.local.json",
);
const previous = await readFile(reportPath, "utf8")
  .then(JSON.parse)
  .catch(() => null);
const refsPath = path.join(
  path.dirname(statePath),
  "questions-import-refs.local.json",
);
execFileSync(
  process.execPath,
  [
    new URL("./import-content.mjs", import.meta.url).pathname,
    contentPath,
    "--publish",
  ],
  {
    env: {
      ...process.env,
      PB_URL: state.base,
      QUESTIONS_ADMIN_ACCOUNT: state.adminAccount,
      QUESTIONS_ADMIN_PASSWORD: state.adminPassword,
      QUESTIONS_IMPORT_REPORT: refsPath,
    },
    stdio: "inherit",
  },
);
const { fingerprint, records } = JSON.parse(await readFile(refsPath, "utf8"));
async function request(route, body, token) {
  const response = await fetch(state.base + route, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `Review setup failed: ${route}, HTTP ${response.status}, ${data.error?.code || "UNKNOWN"}`,
    );
  return data;
}
const auth = await request("/api/collections/game_admins/auth-with-password", {
  identity: state.adminAccount,
  password: state.adminPassword,
});
const currentIds = new Set(Object.values(records));
// Only withdraw untouched assignments created by the preceding run of this tool.
// Never reset a started/completed review or unrelated demo assignments.
for (const prior of previous?.sessions || []) {
  if (!prior.assignmentId || currentIds.has(prior.sessionId)) continue;
  const detail = await request(
    `/api/questions/v1/admin/assignments/${prior.assignmentId}`,
    undefined,
    auth.token,
  );
  if (
    detail.status !== "assigned" ||
    detail.startedAt ||
    detail.player !== state.playerId
  )
    continue;
  await request(
    `/api/questions/v1/admin/assignments/${prior.assignmentId}/actions`,
    {
      requestId: createHash("sha256")
        .update(`replace-review:${fingerprint}:${prior.assignmentId}`)
        .digest("hex"),
      action: "cancel",
      reason: "本地视觉验收内容更新，撤回尚未开始的旧测试版本",
    },
    auth.token,
  );
}
const source = JSON.parse(await readFile(contentPath, "utf8"));
const sessions = [];
for (const session of source.sessions) {
  const sessionId = records[session.legacyKey];
  const batch = await request(
    "/api/questions/v1/admin/assignments",
    {
      requestId: createHash("sha256")
        .update(`review:${fingerprint}:${sessionId}:${state.playerId}`)
        .digest("hex"),
      sessionId,
      target: "selected",
      playerIds: [state.playerId],
      reissueCompleted: false,
    },
    auth.token,
  );
  const assigned = batch.results.find((row) => row.playerId === state.playerId);
  sessions.push({
    legacyKey: session.legacyKey,
    title: session.title,
    questions: session.levels.length,
    sessionId,
    assignmentId: assigned.assignmentId,
    status: assigned.status,
  });
}
await writeFile(
  reportPath,
  JSON.stringify(
    {
      fingerprint,
      base: state.base,
      playerAccount: state.playerAccount,
      sessions,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    reviewSessions: sessions.length,
    reportPath,
    assigned: sessions.filter((row) => row.assignmentId).length,
  }),
);
