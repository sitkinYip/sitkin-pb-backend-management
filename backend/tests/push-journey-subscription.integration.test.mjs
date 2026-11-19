import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createTestServer } from "./server.mjs";

const root = "/api/questions/v1";
const route = "/me/push/journey-subscription";
const scope = "personal_journey_v1";
const migration = "1795075260_push_journey_subscription.js";
const privateTables = ["game_push_journey_deliveries", "game_push_journey_subscriptions"];
const testHooks = [
  'routerAdd("POST", "/__test/journey-dispatch", e => {',
  ' const push = require(`${__hooks}/lib/push.js`); const cloud = require(`${__hooks}/lib/huawei-push.js`);',
  ' const messages = []; push.dispatch(e.app, job => {',
  '   messages.push(cloud.message(job, push.testMode()).payload.notification);',
  '   return { accepted: true, retry: false, code: "80000000" };',
  ' }); return e.json(200, { messages });',
  '}, $apis.requireAuth("_superusers"));',
].join("\n");
function ok(response) {
  assert.equal(response.status, 200, response.data.error?.code || "unexpected isolated status");
  return response.data;
}
function fixture(server) {
  const call = (path, token, body, method = body ? "POST" : "GET") => server.request(root + path, { token, body, method });
  const raw = (table, body, id = "", method = body ? "POST" : "GET") => server.request(
    `/api/collections/${table}/records${id ? "/" + id : "?perPage=500&sort=id"}`,
    { token: server.superToken, body, method });
  const records = async (table) => ok(await raw(table)).items;
  const command = async (path, body = {}) => ok(await call(path, server.adminToken, { requestId: randomUUID(), ...body }));
  const player = async (account) => {
    const password = "S-" + randomUUID();
    const row = ok(await raw("game_players", { account, displayName: "合成旅途订阅玩家", status: "active",
      mustChangePassword: false, password, passwordConfirm: password }));
    const auth = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }));
    return { id: row.id, token: auth.token };
  };
  const session = async (title = "合成旅途场次") => {
    const q = await command("/admin/questions", { title: "合成题目", kind: "text", content: [{ text: "合成谜面" }], acceptedAnswers: ["北星"] });
    await command(`/admin/questions/${q.id}/publish`);
    const s = await command("/admin/sessions", { title, levels: [{ question: q.id, xp: 0 }] });
    await command(`/admin/sessions/${s.id}/publish`);
    return s;
  };
  const assign = (sessionId, playerIds) => command("/admin/assignments", { sessionId, target: "selected", playerIds });
  const save = (token, subscribed, pushEnabled, expectedRevision, extra = {}) => call(route, token, {
    requestId: randomUUID(), scope, subscribed, pushEnabled, expectedRevision, ...extra,
  }, "PUT");
  const subscribe = async (token, revision = 0) => {
    ok(await save(token, true, false, revision));
    return ok(await save(token, true, true, revision + 1));
  };
  const register = (token) => call("/me/push/register", token, {
    installationId: randomUUID(), token: "synthetic-" + randomUUID(), profileId: randomUUID(),
  });
  const note = (sessionId, extra = {}) => command("/admin/notifications", {
    target: "session", sessionId, messagePurpose: "journey", title: "合成剧情来信", content: "合成关卡动态", ...extra,
  });
  const dispatch = async () => ok(await server.request("/__test/journey-dispatch", {
    token: server.superToken, method: "POST", body: {},
  })).messages;
  const setup = async () => {
    ok(await call("/admin/push-settings", server.adminToken, { requestId: randomUUID(), audience: "all", playerIds: [],
      expectedRevision: 0, reason: "隔离一次订阅验收" }, "PATCH"));
    return { a: await player("journey_alice"), b: await player("journey_bob") };
  };
  return { call, raw, records, command, player, session, assign, save, subscribe, register, note, dispatch, setup };
}

test("real PocketBase: account journey consent is default-off, separate, versioned, isolated and replay-safe", { timeout: 120000 }, async (t) => {
  const server = await createTestServer(); t.after(() => server.stop());
  const f = fixture(server), { a, b } = await f.setup();
  const off = { scope, subscribed: false, pushEnabled: false, revision: 0, subscriptionApproved: false };
  assert.deepEqual(ok(await f.call(route, a.token)), off);
  assert.equal((await f.call(route)).status, 401);
  assert.equal((await f.call(route, server.adminToken)).status, 401);
  for (const table of privateTables) assert.equal((await server.request(`/api/collections/${table}/records`, { token: a.token })).status, 403);
  assert.equal((await f.save(a.token, true, true, 0)).data.error.code, "PUSH_JOURNEY_SUBSCRIPTION_CONFIRMATION_REQUIRED");
  for (const extra of [{ scope: "all_messages" }, { playerId: b.id }, { expectedRevision: -1 }, { pushEnabled: true, subscribed: false }, { subscribed: "true" }])
    assert.equal((await f.save(a.token, true, false, 0, extra)).status, 400);
  const request = { requestId: randomUUID(), scope, subscribed: true, pushEnabled: false, expectedRevision: 0 };
  const first = ok(await f.call(route, a.token, request, "PUT"));
  assert.deepEqual(first, { ...off, subscribed: true, revision: 1 });
  assert.deepEqual(ok(await f.call(route, a.token, request, "PUT")), first);
  assert.equal((await f.call(route, a.token, { ...request, pushEnabled: true }, "PUT")).data.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await f.save(a.token, true, true, 0)).data.error.code, "PUSH_JOURNEY_SUBSCRIPTION_CONFLICT");
  assert.equal(ok(await f.save(a.token, true, true, 1)).revision, 2);
  const cancelled = ok(await f.save(a.token, false, false, 2));
  assert.deepEqual(cancelled, { ...off, revision: 3 });
  assert.deepEqual(ok(await f.call(route, a.token, request, "PUT")), first);
  assert.deepEqual(ok(await f.call(route, a.token)), cancelled);
  assert.deepEqual(ok(await f.call(route, b.token)), off);
  // Explicit refusal is stored even when no previous account consent existed.
  assert.equal(ok(await f.save(b.token, false, false, 0)).revision, 1);
  await server.restart();
  assert.deepEqual(ok(await f.call(route, a.token)), cancelled);
  await f.raw("game_players", { mustChangePassword: true }, b.id, "PATCH");
  assert.equal((await f.call(route, b.token)).data.error.code, "PASSWORD_CHANGE_REQUIRED");
  await f.raw("game_players", { mustChangePassword: false, status: "disabled" }, b.id, "PATCH");
  assert.equal((await f.call(route, b.token)).data.error.code, "ACCOUNT_DISABLED");
  for (const table of ["game_answer_submissions", "game_level_progress", "game_notification_receipts", "game_assignments"])
    assert.deepEqual(await f.records(table), []);
});

test("real PocketBase: one account consent covers future assignments and story notices, never legacy or announcements", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0", STARWARD_PUSH_SUBSCRIPTION_APPROVED: "1" }, testHooks });
  t.after(() => server.stop()); const f = fixture(server), { a, b } = await f.setup();
  ok(await f.register(a.token)); ok(await f.register(b.token));
  const s = await f.session(); const assigned = await f.assign(s.id, [a.id, b.id]);
  const assignment = assigned.results[0].assignmentId;
  await f.raw("game_push_subscriptions", { player: a.id, assignment, subscribed: true, pushEnabled: true, revision: 2 });
  await f.note(s.id);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  for (const [path, body, method] of [[`/assignments/${assignment}/push-subscription`, undefined, "GET"],
    ["/me/push/subscriptions", undefined, "GET"],
    [`/assignments/${assignment}/push-subscription`, { requestId: randomUUID(), subscribed: true, pushEnabled: true, expectedRevision: 2 }, "PUT"],
    [`/assignments/${assignment}/push-subscription`, { requestId: randomUUID(), subscribed: false, pushEnabled: false, expectedRevision: 2 }, "PUT"]]) {
    const response = await f.call(path, a.token, body, method);
    assert.equal(response.status, 409); assert.equal(response.data.error.code, "PUSH_SUBSCRIPTION_SCOPE_CHANGED");
  }
  ok(await f.save(a.token, true, false, 0)); await f.note(s.id);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  ok(await f.save(a.token, true, true, 1));
  await f.note(s.id);
  const future = await f.session("订阅后新分配场次");
  await f.assign(future.id, [a.id, b.id]);
  const messages = await f.dispatch(); assert.equal(messages.length, 2);
  assert.deepEqual(new Set(messages.map((m) => m.clickAction.data.starwardPushKind)), new Set(["assignment", "inbox"]));
  assert.ok(messages.every((m) => m.category === "SUBSCRIPTION" && /订阅/.test(m.body)));
  assert.ok(messages.every((m) => !m.body.includes("合成") && !m.body.includes("北星")));
  await f.note(s.id, { messagePurpose: "announcement" });
  assert.equal((await f.dispatch()).filter((m) => m.category === "MARKETING" && !/订阅/.test(m.body)).length, 2);
  // Pending account jobs are retired in the cancellation transaction; re-enable is a new incarnation.
  await f.note(s.id); const another = await f.session("待发送时取消的新场次"); await f.assign(another.id, [a.id]);
  const pending = (await f.records("game_push_deliveries")).filter((j) => j.status === "pending");
  assert.equal(pending.length, 2);
  ok(await f.save(a.token, false, false, 2));
  await f.subscribe(a.token, 3); assert.deepEqual(await f.dispatch(), []);
  const afterCancel = await f.records("game_push_deliveries");
  assert.ok(pending.every((job) => afterCancel.find((j) => j.id === job.id).status === "discarded"));
  const read = await f.note(s.id); const receipt = (await f.records("game_notification_receipts")).find((r) => r.notification === read.id && r.player === a.id);
  ok(await f.call(`/notifications/${read.id}/read`, a.token, {}));
  assert.ok(receipt); assert.deepEqual(await f.dispatch(), []);
  await f.note(s.id); await f.raw("game_sessions", { status: "archived" }, s.id, "PATCH");
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.call("/admin/notifications", server.adminToken, { requestId: randomUUID(), target: "selected", playerIds: [a.id], messagePurpose: "journey", title: "合成", content: "合成" })).status, 400);
  for (const table of ["game_answer_submissions", "game_level_progress"]) assert.deepEqual(await f.records(table), []);
});

test("real PocketBase: approval pending suppresses journey delivery without marketing fallback, including retained queues", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" }, testHooks });
  t.after(() => server.stop()); const f = fixture(server), { a } = await f.setup(); ok(await f.register(a.token));
  const s = await f.session(); const assigned = await f.assign(s.id, [a.id]); const assignment = assigned.results[0].assignmentId;
  await f.raw("game_push_subscriptions", { player: a.id, assignment, subscribed: true, pushEnabled: true, revision: 2 });
  const legacyNote = await f.note(s.id); const receipt = (await f.records("game_notification_receipts")).find((r) => r.notification === legacyNote.id);
  const binding = (await f.records("game_push_bindings"))[0];
  // Jobs queued by an earlier server must not treat legacy or absent consent as account consent.
  for (const [kind, targetId] of [["assignment", assignment], ["inbox", receipt.id]])
    ok(await f.raw("game_push_deliveries", { binding: binding.id, kind, targetId, status: "pending", availableAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }));
  assert.deepEqual(await f.dispatch(), []);
  await f.subscribe(a.token); const future = await f.session("未批分类的新分配"); const futureAssigned = await f.assign(future.id, [a.id]); await f.note(s.id);
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries")).length, 2); // Only discarded legacy jobs.
  // Mimic an already-approved event whose rights are now disabled at dispatch time.
  const consent = (await f.records("game_push_journey_subscriptions"))[0];
  const job = ok(await f.raw("game_push_deliveries", { binding: binding.id, kind: "assignment", targetId: futureAssigned.results[0].assignmentId,
    status: "pending", availableAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString() }));
  ok(await f.raw("game_push_journey_deliveries", { delivery: job.id, subscription: consent.id, scope,
    revision: consent.revision, category: "SUBSCRIPTION" }));
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries")).find((j) => j.id === job.id).status, "discarded");
  ok(await f.save(a.token, false, false, 2)); await f.note(s.id);
  const afterOff = await f.session("关闭后分配"); await f.assign(afterOff.id, [a.id]);
  assert.deepEqual(await f.dispatch(), []);
  await f.note(s.id, { messagePurpose: "announcement" }); assert.equal((await f.dispatch())[0].category, "MARKETING");
});

test("real PocketBase: account subscription migration is additive, empty and never expands legacy consent", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((name) => name !== migration) }); t.after(() => server.stop());
  const f = fixture(server), p = await f.player("journey_migration"); const s = await f.session(); const a = await f.assign(s.id, [p.id]);
  ok(await f.raw("game_push_subscriptions", { player: p.id, assignment: a.results[0].assignmentId, subscribed: true, pushEnabled: true, revision: 2 }));
  const snapshot = () => JSON.parse(execFileSync("python3", ["-c", `
import json,sqlite3,sys
db=sqlite3.connect('file:'+sys.argv[1]+'/data.db?mode=ro',uri=True);db.row_factory=sqlite3.Row
print(json.dumps({r['name']:dict(r) for r in db.execute('SELECT * FROM _collections') if r['name'] not in ${JSON.stringify(privateTables)}}))
`, server.dataDirectory()], { encoding: "utf8" }));
  const before = snapshot(); const legacy = await f.records("game_push_subscriptions");
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names }); assert.deepEqual(snapshot(), before);
  assert.deepEqual(await f.records("game_push_subscriptions"), legacy);
  const objects = JSON.parse(execFileSync("python3", ["-c", `
import json,sqlite3,sys
db=sqlite3.connect('file:'+sys.argv[1]+'/data.db?mode=ro',uri=True);db.row_factory=sqlite3.Row
print(json.dumps([dict(r) for r in db.execute('SELECT type,name,tbl_name AS "table" FROM sqlite_master WHERE tbl_name IN (?,?) ORDER BY type,name',${JSON.stringify(privateTables)})]))
`, server.dataDirectory()], { encoding: "utf8" }));
  assert.deepEqual(objects, JSON.parse(readFileSync(new URL("../deploy/1panel/allowed-delta.push-journey-subscription.json", import.meta.url), "utf8")).newSchemaObjects);
  for (const table of privateTables) assert.deepEqual(await f.records(table), []);
  assert.deepEqual(ok(await f.call(route, p.token)), { scope, subscribed: false, pushEnabled: false, revision: 0, subscriptionApproved: false });
  await server.restart(); for (const table of privateTables) assert.deepEqual(await f.records(table), []);
});
