import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const inputFile = process.argv[2];
const base = (process.env.PB_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
const url = new URL(base);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) &&
  (!process.argv.includes("--allow-remote") || url.protocol !== "https:")
)
  throw new Error(
    "Remote imports require HTTPS and explicit --allow-remote. Prefer an isolated instance first.",
  );
if (
  !inputFile ||
  !process.env.QUESTIONS_ADMIN_ACCOUNT ||
  !process.env.QUESTIONS_ADMIN_PASSWORD
)
  throw new Error(
    "Provide an input JSON file and QUESTIONS_ADMIN_ACCOUNT / QUESTIONS_ADMIN_PASSWORD via environment.",
  );
const bytes = await readFile(inputFile),
  data = JSON.parse(bytes.toString());
if (data.schemaVersion !== 1)
  throw new Error("Unsupported content import format");
const fingerprint = createHash("sha256").update(bytes).digest("hex");
async function post(route, body, token) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const code = failure.error?.code || "REQUEST_FAILED";
    const message = failure.error?.message || "Check configuration";
    throw new Error(
      `Import failed: ${route} HTTP ${response.status} (${code}: ${message}). Re-running the same file reuses request IDs; credentials and content are not logged.`,
    );
  }
  return response.json();
}
const auth = await post("/api/collections/game_admins/auth-with-password", {
  identity: process.env.QUESTIONS_ADMIN_ACCOUNT.toLowerCase(),
  password: process.env.QUESTIONS_ADMIN_PASSWORD,
});
const refs = new Map();
const command = (route, key, body = {}) =>
  post(
    `/api/questions/v1/admin/${route}`,
    {
      ...body,
      requestId: createHash("sha256")
        .update(`${fingerprint}:${key}`)
        .digest("hex"),
    },
    auth.token,
  );
const resolve = (key) => {
  const id = refs.get(key);
  if (!id) throw new Error(`Unresolved import reference: ${key}`);
  return id;
};
for (const [table, rows] of [
  ["narratives", data.narratives || []],
  ["questions", data.questions || []],
]) {
  for (const { legacyKey, ...content } of rows) {
    const result = await command(table, legacyKey, content);
    refs.set(legacyKey, result.id);
    if (process.argv.includes("--publish"))
      await command(`${table}/${result.id}/publish`, `${legacyKey}:publish`);
  }
}
for (const { legacyKey, ...content } of data.sessions || []) {
  const body = {
    ...content,
    levels: content.levels.map(({ questionKey, ...step }) => ({
      ...step,
      question: resolve(questionKey),
    })),
    clues: content.clues.map(({ narrativeKey, ...clue }) => ({
      ...clue,
      narrative: narrativeKey ? resolve(narrativeKey) : "",
    })),
    completionTarget: content.completionTarget?.narrativeKey
      ? {
          kind: "narrative",
          id: resolve(content.completionTarget.narrativeKey),
        }
      : content.completionTarget,
  };
  const result = await command("sessions", legacyKey, body);
  refs.set(legacyKey, result.id);
  if (process.argv.includes("--publish"))
    await command(`sessions/${result.id}/publish`, `${legacyKey}:publish`);
}
if (process.env.QUESTIONS_IMPORT_REPORT) {
  await writeFile(
    process.env.QUESTIONS_IMPORT_REPORT,
    JSON.stringify({ fingerprint, records: Object.fromEntries(refs) }, null, 2),
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    importedRecords: refs.size,
    published: process.argv.includes("--publish"),
    warningsToReview: data.warnings?.length || 0,
  }),
);
