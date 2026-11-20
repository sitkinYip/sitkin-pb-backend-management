import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createTestServer } from "./server.mjs";

const root = "/api/questions/v1";
const migration = "1795075320_push_personal_journey_notices.js";
const scope = "personal_journey_v1";
const hooks = [
  'routerAdd("POST", "/__test/personal-dispatch", e => {',
  ' const push = require(`${__hooks}/lib/push.js`), cloud = require(`${__hooks}/lib/huawei-push.js`);',
  ' const messages = []; push.dispatch(e.app, job => {',
  '   messages.push(cloud.message(job, push.testMode()).payload.notification);',
  '   return { accepted: true, retry: false, code: "80000000" };',
  ' }); return e.json(200, { messages });',
  '}, $apis.requireAuth("_superusers"));',
  'routerAdd("POST", "/__test/personal-corrupt-context", e => {',
  ' const body = e.requestInfo().body;',
  ' if (!/^[a-z0-9]{15}$/.test(body.notification || "") || !["unknown", ""].includes(body.kind)) return e.json(400, {});',
  ' e.app.db().newQuery("UPDATE game_push_notice_contexts SET kind={:kind} WHERE notification={:id}")',
  '   .bind({kind: body.kind, id: body.notification}).execute();',
  ' return e.json(200, {changed: true});',
  '}, $apis.requireAuth("_superusers"));',
].join("\n");
const enabled = { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0", STARWARD_PUSH_SUBSCRIPTION_APPROVED: "1" };
function ok(response) {
  assert.equal(response.status, 200, response.data.error?.code || response.data.message || "unexpected isolated status");
  return response.data;
}
function fixture(server) {
  const call = (path, token, body, method = body ? "POST" : "GET") => server.request(root + path, { token, body, method });
  const raw = (table, body, id = "", method = body ? "POST" : "GET") => server.request(
    `/api/collections/${table}/records${id ? "/" + id : "?perPage=500&sort=id"}`, { token: server.superToken, body, method });
  const records = async (table) => ok(await raw(table)).items;
  const remove = async (table, id) => {
    const response = await fetch(`${server.base}/api/collections/${table}/records/${id}`, {
      method: "DELETE", headers: { Authorization: server.superToken },
    });
    assert.equal(response.status, 204);
  };
  const command = (path, body = {}) => call(path, server.adminToken, { requestId: randomUUID(), ...body });
  const player = async (account) => {
    const password = "S-" + randomUUID();
    const row = ok(await raw("game_players", { account, displayName: "星港旅人", status: "active",
      mustChangePassword: false, password, passwordConfirm: password }));
    const auth = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }));
    return { id: row.id, token: auth.token };
  };
  const save = (token, subscribed, pushEnabled, expectedRevision) => call("/me/push/journey-subscription", token,
    { requestId: randomUUID(), scope, subscribed, pushEnabled, expectedRevision }, "PUT");
  const subscribe = async (token, revision = 0) => {
    ok(await save(token, true, false, revision)); return ok(await save(token, true, true, revision + 1));
  };
  const register = (token) => call("/me/push/register", token, {
    installationId: randomUUID(), token: "synthetic-" + randomUUID(), profileId: randomUUID(),
  });
  const noteBody = (playerIds, extra = {}) => ({ requestId: randomUUID(), target: "selected", playerIds,
    messagePurpose: "personal_journey", title: "星港为你留了一封信", content: "合成的个人剧情内容", ...extra });
  const note = async (playerIds, extra = {}) => ok(await call("/admin/notifications", server.adminToken, noteBody(playerIds, extra)));
  const dispatch = async () => ok(await server.request("/__test/personal-dispatch", {
    token: server.superToken, method: "POST", body: {},
  })).messages;
  const setup = async () => {
    ok(await call("/admin/push-settings", server.adminToken, { requestId: randomUUID(), audience: "all", playerIds: [],
      expectedRevision: 0, reason: "隔离定向旅途验证" }, "PATCH"));
    return { a: await player("personal_alice"), b: await player("personal_bob") };
  };
  const receipt = async (noteId) => (await records("game_notification_receipts")).find((r) => r.notification === noteId);
  const context = async (noteId) => (await records("game_push_notice_contexts")).find((r) => r.notification === noteId);
  return { call, raw, records, remove, command, player, save, subscribe, register, noteBody, note, dispatch, setup, receipt, context };
}

test("real PocketBase: directed journey letters require account consent and selected players, without assignments", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: enabled, testHooks: hooks }); t.after(() => server.stop());
  const f = fixture(server), { a, b } = await f.setup(); ok(await f.register(a.token)); ok(await f.register(b.token));
  await f.note([a.id, b.id]); assert.deepEqual(await f.records("game_push_deliveries"), []);
  ok(await f.save(a.token, true, false, 0)); await f.note([a.id]);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  ok(await f.save(a.token, true, true, 1));
  const body = f.noteBody([a.id, a.id, b.id]);
  const first = ok(await f.call("/admin/notifications", server.adminToken, body));
  assert.deepEqual(ok(await f.call("/admin/notifications", server.adminToken, body)), first);
  assert.equal((await f.records("game_push_deliveries")).length, 1);
  const receipts = (await f.records("game_notification_receipts")).filter((r) => r.notification === first.id);
  assert.equal(receipts.length, 2); assert.ok(receipts.every((r) => r.assignment === ""));
  const context = await f.context(first.id); assert.equal(context.kind, "account"); assert.equal(context.session, "");
  const messages = await f.dispatch(); assert.equal(messages.length, 1);
  assert.equal(messages[0].title, "星港为你留了一封信");
  assert.equal(messages[0].category, "SUBSCRIPTION"); assert.match(messages[0].body, /订阅/);
  assert.ok(!messages[0].body.includes("合成") && !messages[0].body.includes("星港为你"));
  assert.equal(messages[0].clickAction.data.starwardPushKind, "inbox");
  assert.equal(messages[0].clickAction.data.starwardPushTargetId, undefined);
  const listed = ok(await f.call("/admin/notifications", server.adminToken)).items;
  assert.equal(listed.find((n) => n.id === first.id).messagePurpose, "personal_journey");
  assert.equal(ok(await f.call("/notifications", b.token)).items.length, 2); // Application inbox remains independent of Push consent.
  for (const extra of [{ target: "all" }, { target: "session", sessionId: "invalid" }, { playerIds: [] }, { messagePurpose: "important" }])
    assert.equal((await f.call("/admin/notifications", server.adminToken, f.noteBody([a.id], extra))).status, 400);
  assert.equal((await f.call("/admin/notifications", server.adminToken, f.noteBody([a.id], { messagePurpose: "journey" }))).status, 400);
  assert.equal((await f.call("/admin/notifications", a.token, f.noteBody([a.id]))).status, 401);
  await f.note([a.id], { messagePurpose: undefined });
  const announcement = (await f.dispatch())[0];
  assert.equal(announcement.category, "MARKETING"); // Missing purpose retains the legacy announcement default.
  assert.equal(announcement.title, "星港为你留了一封信");
  for (const table of ["game_assignments", "game_answer_submissions", "game_level_progress"])
    assert.deepEqual(await f.records(table), []);
});

test("real PocketBase: push titles use the current authorized source only and never persist message content", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: enabled, testHooks: hooks }); t.after(() => server.stop());
  const f = fixture(server), { a } = await f.setup(); ok(await f.register(a.token)); await f.subscribe(a.token);
  const note = await f.note([a.id], { title: "排队时的旧标题", content: "不应进入任何Push字段的正文" });
  ok(await f.raw("game_notifications", { title: "  新信\n\t👩‍🚀\u0007\u202e  " }, note.id, "PATCH"));
  let messages = await f.dispatch(); assert.equal(messages.length, 1);
  assert.equal(messages[0].title, "新信 👩‍🚀");
  assert.equal(messages[0].body, "你订阅的旅途动态有新消息，打开应用查看。");
  assert.ok(!JSON.stringify(messages).includes("不应进入任何Push字段的正文"));
  assert.ok(!JSON.stringify(messages[0].clickAction.data).includes("新信"));
  const longTitle = "星".repeat(59) + "🙂尾";
  await f.note([a.id], { title: longTitle });
  messages = await f.dispatch(); assert.equal(messages[0].title, "星".repeat(59) + "🙂");
  assert.equal([...messages[0].title].length, 60);
  for (const row of await f.records("game_push_deliveries")) {
    assert.equal(Object.hasOwn(row, "title"), false);
    assert.equal(Object.hasOwn(row, "content"), false);
  }
  const unavailable = await f.note([a.id], { title: "已撤回来源不能进入Push" });
  ok(await f.command(`/admin/notifications/${unavailable.id}/withdraw`, { reason: "隔离标题失效验证" }));
  assert.deepEqual(await f.dispatch(), []);
  assert.ok((await f.records("game_push_deliveries")).some((row) => row.status === "discarded"));
});

test("real PocketBase: approval pending suppresses directed journeys without a marketing fallback", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { ...enabled, STARWARD_PUSH_SUBSCRIPTION_APPROVED: "0" }, testHooks: hooks });
  t.after(() => server.stop()); const f = fixture(server), { a } = await f.setup();
  ok(await f.register(a.token)); await f.subscribe(a.token); await f.note([a.id]);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  // Even a retained job with authentic account metadata must recheck current approval.
  const note = await f.note([a.id]), receipt = await f.receipt(note.id);
  const binding = (await f.records("game_push_bindings"))[0], consent = (await f.records("game_push_journey_subscriptions"))[0];
  const job = ok(await f.raw("game_push_deliveries", { binding: binding.id, kind: "inbox", targetId: receipt.id,
    status: "pending", availableAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }));
  ok(await f.raw("game_push_journey_deliveries", { delivery: job.id, subscription: consent.id, scope, revision: consent.revision, category: "SUBSCRIPTION" }));
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries")).find((j) => j.id === job.id).status, "discarded");
  await f.note([a.id], { messagePurpose: "announcement" }); assert.equal((await f.dispatch())[0].category, "MARKETING");
});

test("real PocketBase: directed journey queues fail closed for cancellation, missing context, read, withdrawal and expiry", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: enabled, testHooks: hooks }); t.after(() => server.stop());
  const f = fixture(server), { a, b } = await f.setup(); ok(await f.register(a.token)); await f.subscribe(a.token);
  const cancelled = await f.note([a.id]), missing = await f.note([a.id]);
  await f.remove("game_push_notice_contexts", (await f.context(missing.id)).id);
  ok(await f.save(a.token, false, false, 2)); await f.subscribe(a.token, 3);
  const retired = await f.records("game_push_deliveries");
  assert.equal(retired.length, 2); assert.ok(retired.every((j) => j.status === "discarded"));
  assert.deepEqual(await f.dispatch(), []);
  assert.ok(await f.receipt(cancelled.id));
  const missingAtClaim = await f.note([a.id]);
  await f.remove("game_push_notice_contexts", (await f.context(missingAtClaim.id)).id);
  assert.deepEqual(await f.dispatch(), []); // No reinterpretation as a marketing notice.
  const read = await f.note([a.id]); ok(await f.call(`/notifications/${read.id}/read`, a.token, {}));
  const withdrawn = await f.note([a.id]); ok(await f.command(`/admin/notifications/${withdrawn.id}/withdraw`, { reason: "隔离撤回" }));
  const expired = await f.note([a.id]); ok(await f.raw("game_notifications", { expiresAt: new Date(Date.now() - 1000).toISOString() }, expired.id, "PATCH"));
  const moved = await f.note([a.id]); ok(await f.raw("game_notification_receipts", { player: b.id }, (await f.receipt(moved.id)).id, "PATCH"));
  const unknown = await f.note([a.id]);
  // Corrupt through an isolated-only in-process SQL hook, never a host writer against live Docker SQLite.
  ok(await server.request("/__test/personal-corrupt-context", { token: server.superToken, method: "POST",
    body: { notification: unknown.id, kind: "unknown" } }));
  assert.equal((await f.context(unknown.id)).kind, "unknown");
  const absentKind = await f.note([a.id]);
  ok(await server.request("/__test/personal-corrupt-context", { token: server.superToken, method: "POST",
    body: { notification: absentKind.id, kind: "" } }));
  assert.deepEqual(await f.dispatch(), []);
  assert.ok((await f.records("game_push_deliveries")).every((j) => j.status === "discarded"));
  assert.equal((await f.records("game_notification_receipts")).filter((r) => r.readAt).length, 1);
  for (const table of ["game_assignments", "game_answer_submissions", "game_level_progress"])
    assert.deepEqual(await f.records(table), []);
});

test("real PocketBase: context migration backfills session meaning and preserves all other business data", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((n) => n !== migration) }); t.after(() => server.stop());
  const f = fixture(server), { a } = await f.setup();
  const q = ok(await f.command("/admin/questions", { title: "合成题目", kind: "text", content: [{ text: "合成题面" }], acceptedAnswers: ["星"] }));
  ok(await f.command(`/admin/questions/${q.id}/publish`));
  const session = ok(await f.command("/admin/sessions", { title: "原有旅途场次", levels: [{ question: q.id, xp: 0 }] }));
  ok(await f.command(`/admin/sessions/${session.id}/publish`));
  const assignment = ok(await f.command("/admin/assignments", { sessionId: session.id, target: "selected", playerIds: [a.id] })).results[0].assignmentId;
  const admin = (await f.records("game_admins"))[0];
  const note = ok(await f.raw("game_notifications", { title: "原有剧情来信", content: "原有合成内容", status: "sent", createdBy: admin.id, sentAt: new Date().toISOString() }));
  ok(await f.raw("game_notification_receipts", { player: a.id, notification: note.id, assignment }));
  const legacy = ok(await f.raw("game_push_notice_contexts", { notification: note.id, session: session.id }));
  const snapshot = () => JSON.parse(execFileSync("python3", ["-c", `import sqlite3,sys,json
db=sqlite3.connect('file:'+sys.argv[1]+'/data.db?mode=ro',uri=True);db.row_factory=sqlite3.Row
business={r['name']:[dict(x) for x in db.execute('SELECT * FROM "'+r['name']+'" ORDER BY id')] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'game_%' AND name!='game_push_notice_contexts'")}
collections={r['name']:dict(r) for r in db.execute('SELECT * FROM _collections') if r['name']!='game_push_notice_contexts'}
ledger=[dict(r) for r in db.execute('SELECT * FROM _migrations ORDER BY file')]
schema=[dict(r) for r in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT IN ('game_push_notice_contexts','_migrations') ORDER BY type,name")]
print(json.dumps({'business':business,'collections':collections,'ledger':ledger,'schema':schema}))
`, server.dataDirectory()], { encoding: "utf8" }));
  const before = snapshot();
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names });
  const after = snapshot();
  assert.deepEqual(after.business, before.business); assert.deepEqual(after.collections, before.collections); assert.deepEqual(after.schema, before.schema);
  assert.deepEqual(after.ledger.filter((r) => r.file !== migration), before.ledger);
  assert.equal(after.ledger.filter((r) => r.file === migration).length, 1);
  const contexts = await f.records("game_push_notice_contexts");
  assert.equal(contexts.length, 1); assert.deepEqual({ ...contexts[0], kind: undefined }, { ...legacy, kind: undefined });
  assert.equal(contexts[0].kind, "session"); assert.equal(contexts[0].session, session.id);
  const schema = ok(await server.request("/api/collections/game_push_notice_contexts", { token: server.superToken }));
  assert.equal(schema.fields.find((field) => field.name === "session").required, false);
  assert.deepEqual(schema.fields.find((field) => field.name === "kind").values, ["session", "account"]);
  assert.equal(schema.fields.find((field) => field.name === "kind").required, true);
  for (const rule of ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"]) assert.equal(schema[rule], null);
  assert.equal((await f.call("/admin/notifications", server.adminToken)).data.items.find((n) => n.id === note.id).messagePurpose, "journey");
  await server.restart(); assert.equal((await f.context(note.id)).kind, "session");
});
