import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function reconciliationPlan(catalog, selectedIds = []) {
  const selected = new Set(selectedIds);
  for (const id of selected) {
    const scene = catalog.sessions.find((s) => s.id === id);
    if (!scene || scene.status !== "archived")
      throw new Error(
        "Only explicitly selected, already archived sessions can be reconciled: " +
          id,
      );
  }
  return catalog.sessions
    .filter(
      (s) => s.status === "archived" && (!selected.size || selected.has(s.id)),
    )
    .map((s) => {
      if (!s.assignmentCounts)
        throw new Error(
          "Upgrade the backend before reconciliation; assignment counts are missing.",
        );
      return {
        id: s.id,
        title: s.title,
        revision: s.revision,
        ...s.assignmentCounts,
        pending: s.assignmentCounts.assigned + s.assignmentCounts.active,
      };
    });
}

export async function reconcile(
  {
    base,
    account,
    password,
    apply = false,
    selectedIds = [],
    allowRemote = false,
  },
  request = fetch,
) {
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error(
      "PB_URL must be a root URL without credentials or query parameters.",
    );
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) &&
    (!allowRemote || url.protocol !== "https:")
  )
    throw new Error(
      "Remote access requires HTTPS and explicit --allow-remote.",
    );
  if (!account || !password)
    throw new Error(
      "Provide QUESTIONS_ADMIN_ACCOUNT and QUESTIONS_ADMIN_PASSWORD via environment.",
    );
  if (selectedIds.some((id) => !/^[a-z0-9]{15}$/.test(id)))
    throw new Error("Invalid session ID.");
  if (apply && !selectedIds.length)
    throw new Error(
      "--apply requires explicit --session=<id> targets; no apply-all mode is provided.",
    );
  const origin = url.origin;
  async function call(path, token, body) {
    const response = await request(origin + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        "Reconciliation request failed: HTTP " +
          response.status +
          " (" +
          (data.error?.code || "REQUEST_FAILED") +
          ")",
      );
    return data;
  }
  const auth = await call(
    "/api/collections/game_admins/auth-with-password",
    "",
    { identity: account, password },
  );
  const catalog = await call("/api/questions/v1/admin/catalog", auth.token);
  if (catalog.sessions.some((s) => !s.assignmentCounts)) {
    if (apply)
      throw new Error("Upgrade the backend before applying reconciliation.");
    // Pre-deployment preview must also work against the old backend, before
    // changing what archived sessions mean for existing players.
    const assignments = await call(
      "/api/questions/v1/admin/assignments",
      auth.token,
    );
    for (const session of catalog.sessions) {
      const counts = {
        total: 0,
        assigned: 0,
        active: 0,
        completed: 0,
        cancelled: 0,
      };
      for (const row of assignments.items.filter(
        (a) => a.session === session.id,
      )) {
        counts.total++;
        counts[row.status]++;
      }
      session.assignmentCounts = counts;
    }
  }
  const plan = reconciliationPlan(catalog, selectedIds);
  if (!apply) return { mode: "preview", sessions: plan };
  const results = [];
  for (const scene of plan) {
    if (!scene.pending) {
      results.push({ id: scene.id, cancelledCount: 0 });
      continue;
    }
    const requestId = createHash("sha256")
      .update(JSON.stringify(["reconcile-closed-session-v1", scene]))
      .digest("hex");
    results.push(
      await call(
        "/api/questions/v1/admin/sessions/" + scene.id + "/archive",
        auth.token,
        {
          requestId,
          reason: "补齐旧归档场次：结束未完成下发，保留进度和已结算权益",
        },
      ),
    );
  }
  return { mode: "applied", sessions: results };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (
    args.some(
      (arg) =>
        !["--apply", "--allow-remote"].includes(arg) &&
        !arg.startsWith("--session="),
    )
  )
    throw new Error(
      "Usage: node scripts/reconcile-closed-sessions.mjs [--session=<id> ...] [--apply] [--allow-remote]",
    );
  const result = await reconcile({
    base: process.env.PB_URL || "http://127.0.0.1:8090",
    account: process.env.QUESTIONS_ADMIN_ACCOUNT,
    password: process.env.QUESTIONS_ADMIN_PASSWORD,
    apply: args.includes("--apply"),
    allowRemote: args.includes("--allow-remote"),
    selectedIds: args
      .filter((arg) => arg.startsWith("--session="))
      .map((arg) => arg.slice(10)),
  });
  console.log(JSON.stringify(result, null, 2));
}
