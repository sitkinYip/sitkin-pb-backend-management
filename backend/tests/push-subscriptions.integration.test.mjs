import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createTestServer } from "./server.mjs";

const root = "/api/questions/v1";
const migration = "1795075200_push_subscriptions.js";
const privateTables = ["game_push_subscriptions", "game_push_notice_contexts", "game_push_notice_deliveries"];
const testHooks = [
  'routerAdd("POST", "/__test/subscription-dispatch", e => {',
  ' const push = require(`${__hooks}/lib/push.js`);',
  ' const cloud = require(`${__hooks}/lib/huawei-push.js`);',
  ' const messages = [];',
  ' push.dispatch(e.app, job => {',
  '   const body = cloud.message(job, push.testMode());',
  '   messages.push(body.payload.notification);',
  '   return { accepted: true, retry: false, code: "80000000" };',
  ' });',
  ' return e.json(200, { messages });',
  '}, $apis.requireAuth("_superusers"));',
].join("\n");
function ok(response) {
  assert.equal(response.status, 200, `isolated API: ${response.data.error?.code || "unexpected status"}`);
  return response.data;
}
function fixture(server) {
  const call = (route, token, body, method = body ? "POST" : "GET") =>
    server.request(root + route, { token, body, method });
  const command = async (route, body) => ok(await call(route, server.adminToken, { requestId: randomUUID(), ...body }));
  const records = async (name) => ok(await server.request(`/api/collections/${name}/records`, { token: server.superToken })).items;
  const patch = async (name, id, body) => ok(await server.request(`/api/collections/${name}/records/${id}`, {
    token: server.superToken, method: "PATCH", body,
  }));
  const player = async (account) => {
    const password = "S-" + randomUUID();
    const row = ok(await server.request("/api/collections/game_players/records", {
      token: server.superToken, method: "POST",
      body: { account, displayName: "订阅验收玩家", status: "active", mustChangePassword: false, password, passwordConfirm: password },
    }));
    const auth = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }));
    return { id: row.id, token: auth.token };
  };
  const setup = async () => {
    ok(await call("/admin/push-settings", server.adminToken, {
      requestId: randomUUID(), audience: "all", playerIds: [], expectedRevision: 0, reason: "隔离订阅验收",
    }, "PATCH"));
    const a = await player("subscription_alice"), b = await player("subscription_bob");
    const q = await command("/admin/questions", { kind: "text", title: "合成订阅题目", content: [{ text: "隔离题目" }], acceptedAnswers: ["北星"] });
    await command(`/admin/questions/${q.id}/publish`, {});
    const session = await command("/admin/sessions", { title: "订阅验收场次", levels: [{ question: q.id, xp: 0 }] });
    await command(`/admin/sessions/${session.id}/publish`, {});
    const assigned = await command("/admin/assignments", { sessionId: session.id, target: "selected", playerIds: [a.id, b.id] });
    return { a, b, session, assignment: assigned.results[0].assignmentId, otherAssignment: assigned.results[1].assignmentId };
  };
  const get = async (id, token) => ok(await call(`/assignments/${id}/push-subscription`, token));
  const save = (id, token, value) => call(`/assignments/${id}/push-subscription`, token, { requestId: randomUUID(), ...value }, "PUT");
  const subscribe = async (id, token, revision = 0) => {
    ok(await save(id, token, { subscribed: true, pushEnabled: false, expectedRevision: revision }));
    return ok(await save(id, token, { subscribed: true, pushEnabled: true, expectedRevision: revision + 1 }));
  };
  const register = async (token) => ok(await call("/me/push/register", token, {
    installationId: randomUUID(), profileId: randomUUID(), token: "synthetic-" + randomUUID(),
  }));
  const note = (sessionId, extra = {}) => command("/admin/notifications", {
    target: "session", sessionId, messagePurpose: "journey", title: "合成来信", content: "隔离剧情更新", ...extra,
  });
  const dispatch = async () => ok(await server.request("/__test/subscription-dispatch", {
    token: server.superToken, method: "POST", body: {},
  })).messages;
  return { call, command, records, patch, player, setup, get, save, subscribe, register, note, dispatch };
}

test("real PocketBase: subscription requires separate consent, ownership, versions and replay safety", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" }, testHooks });
  t.after(() => server.stop());
  const f = fixture(server), { a, b, session, assignment } = await f.setup();
  assert.deepEqual(await f.get(assignment, a.token), { assignmentId: assignment, subscribed: false, pushEnabled: false, revision: 0 });
  assert.deepEqual(ok(await f.call("/me/push/subscriptions", a.token)), { items: [], subscriptionApproved: false });
  assert.equal((await f.call(`/assignments/${assignment}/push-subscription`)).status, 401);
  assert.equal((await f.call(`/assignments/${assignment}/push-subscription`, b.token)).status, 404);
  assert.equal((await f.call(`/assignments/${assignment}/push-subscription`, server.adminToken)).status, 401);
  for (const name of privateTables)
    assert.equal((await server.request(`/api/collections/${name}/records`, { token: a.token })).status, 403);
  const direct = await f.save(assignment, a.token, { subscribed: true, pushEnabled: true, expectedRevision: 0 });
  assert.equal(direct.status, 409);
  assert.equal(direct.data.error.code, "PUSH_SUBSCRIPTION_CONFIRMATION_REQUIRED");
  for (const body of [
    { subscribed: false, pushEnabled: true, expectedRevision: 0 },
    { subscribed: true, pushEnabled: false, expectedRevision: -1 },
    { subscribed: "true", pushEnabled: false, expectedRevision: 0 },
    { subscribed: true, pushEnabled: false, expectedRevision: 0, playerId: b.id },
  ]) assert.equal((await f.save(assignment, a.token, body)).status, 400);
  const request = { requestId: randomUUID(), subscribed: true, pushEnabled: false, expectedRevision: 0 };
  const route = `/assignments/${assignment}/push-subscription`;
  const first = ok(await f.call(route, a.token, request, "PUT"));
  assert.deepEqual(first, { assignmentId: assignment, subscribed: true, pushEnabled: false, revision: 1 });
  assert.deepEqual(ok(await f.call(route, a.token, request, "PUT")), first);
  assert.equal((await f.call(route, a.token, { ...request, pushEnabled: true }, "PUT")).data.error.code, "IDEMPOTENCY_CONFLICT");
  const conflict = await f.save(assignment, a.token, { subscribed: true, pushEnabled: true, expectedRevision: 0 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "PUSH_SUBSCRIPTION_CONFLICT");
  const enabled = ok(await f.save(assignment, a.token, { subscribed: true, pushEnabled: true, expectedRevision: 1 }));
  assert.equal(enabled.revision, 2);
  assert.deepEqual(ok(await f.call("/me/push/subscriptions", a.token)), {
    items: [{ ...enabled, title: session.title || "订阅验收场次" }], subscriptionApproved: false,
  });
  assert.deepEqual(ok(await f.call("/me/push/subscriptions", b.token)).items, []);
  // Replay is an operation snapshot; a new read remains authoritative after cancellation.
  const cancelled = ok(await f.save(assignment, a.token, { subscribed: false, pushEnabled: false, expectedRevision: 2 }));
  assert.equal(cancelled.revision, 3);
  assert.deepEqual(ok(await f.call(route, a.token, request, "PUT")), first);
  assert.deepEqual(await f.get(assignment, a.token), cancelled);
  await server.restart();
  assert.deepEqual(await f.get(assignment, a.token), cancelled);
  await f.patch("game_sessions", session.id, { status: "archived" });
  assert.equal(ok(await f.call("/me/push/subscriptions", a.token)).items[0].assignmentId, assignment);
  assert.equal((await f.save(assignment, a.token, { subscribed: true, pushEnabled: false, expectedRevision: 3 })).data.error.code, "SESSION_OFFLINE");
  assert.deepEqual(ok(await f.save(assignment, a.token, { subscribed: false, pushEnabled: false, expectedRevision: 3 })), cancelled);
  assert.deepEqual(await f.records("game_answer_submissions"), []);
  assert.deepEqual(await f.records("game_level_progress"), []);
  assert.deepEqual(await f.records("game_notification_receipts"), []);
});

test("real PocketBase: only opted-in scene messages use approved SUBSCRIPTION; queued consent is never revived", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0", STARWARD_PUSH_SUBSCRIPTION_APPROVED: "1" }, testHooks });
  t.after(() => server.stop());
  const f = fixture(server), { a, b, session, assignment, otherAssignment } = await f.setup();
  await f.register(a.token); await f.register(b.token);
  await f.note(session.id);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  ok(await f.save(assignment, a.token, { subscribed: true, pushEnabled: false, expectedRevision: 0 }));
  await f.note(session.id);
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  ok(await f.save(assignment, a.token, { subscribed: true, pushEnabled: true, expectedRevision: 1 }));
  await f.note(session.id);
  const messages = await f.dispatch();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].category, "SUBSCRIPTION");
  assert.match(messages[0].body, /订阅/);
  assert.equal(messages[0].clickAction.data.starwardPushKind, "inbox");
  assert.ok(!JSON.stringify(messages).includes("合成来信"));
  const inbox = ok(await f.call("/notifications", a.token)).items;
  assert.equal(inbox.length, 3);
  assert.ok(inbox.every((item) => item.assignmentId === assignment && !item.readAt));
  assert.ok(ok(await f.call("/notifications", b.token)).items.every((item) => item.assignmentId === otherAssignment));
  await f.note(session.id);
  ok(await f.save(assignment, a.token, { subscribed: false, pushEnabled: false, expectedRevision: 2 }));
  await f.subscribe(assignment, a.token, 3);
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries")).find((row) => row.status !== "accepted").status, "discarded");
  const read = await f.note(session.id);
  ok(await f.call(`/notifications/${read.id}/read`, a.token, {}));
  const withdrawn = await f.note(session.id);
  await f.command(`/admin/notifications/${withdrawn.id}/withdraw`, { reason: "合成撤回" });
  assert.deepEqual(await f.dispatch(), []);
  // Announcements remain marketing even for subscribed users; the initial assignment event does too.
  await f.note(session.id, { messagePurpose: "announcement" });
  const announcements = await f.dispatch();
  assert.equal(announcements.length, 2);
  assert.ok(announcements.every((message) => message.category === "MARKETING" && !message.body.includes("订阅")));
  const c = await f.player("subscription_new_assignment");
  await f.register(c.token);
  await f.command("/admin/assignments", { sessionId: session.id, target: "selected", playerIds: [c.id] });
  const initial = await f.dispatch();
  assert.equal(initial.length, 1);
  assert.equal(initial[0].category, "MARKETING");
  assert.equal(initial[0].clickAction.data.starwardPushKind, "assignment");
  // Cross-purpose payloads cannot use the subscriber category without a specific session.
  assert.equal((await f.call("/admin/notifications", server.adminToken, {
    requestId: randomUUID(), target: "selected", playerIds: [a.id], messagePurpose: "journey", title: "合成", content: "合成",
  })).status, 400);
  assert.equal((await f.call("/admin/notifications", server.adminToken, {
    requestId: randomUUID(), target: "session", sessionId: session.id, messagePurpose: "IM", title: "合成", content: "合成",
  })).status, 400);
  assert.deepEqual(await f.records("game_answer_submissions"), []);
  assert.deepEqual(await f.records("game_level_progress"), []);
});

test("real PocketBase: unapproved subscriptions stay marketing, cancelled/unavailable scenes do not leak", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" }, testHooks });
  t.after(() => server.stop());
  const f = fixture(server), { a, b, session, assignment, otherAssignment } = await f.setup();
  await f.register(a.token);
  await f.subscribe(assignment, a.token);
  await f.note(session.id);
  const messages = await f.dispatch();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].category, "MARKETING");
  assert.match(messages[0].body, /订阅/);
  assert.equal(ok(await f.call("/admin/push-settings", server.adminToken)).subscriptionApproved, false);
  const entitlementRevoked = await f.note(session.id);
  const pending = (await f.records("game_push_deliveries")).find((row) => row.status === "pending");
  const meta = (await f.records("game_push_notice_deliveries")).find((row) => row.delivery === pending.id);
  // Mimic a previously approved queue retained while the entitlement gate is now closed.
  await f.patch("game_push_notice_deliveries", meta.id, { category: "SUBSCRIPTION" });
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries")).find((row) => row.id === pending.id).status, "discarded");
  assert.ok(entitlementRevoked.id);
  await f.note(session.id);
  await f.patch("game_assignments", assignment, { status: "cancelled" });
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.save(assignment, a.token, { subscribed: true, pushEnabled: true, expectedRevision: 2 })).data.error.code, "ASSIGNMENT_CANCELLED");
  // Turning notifications off is always allowed, even for a withdrawn scene.
  ok(await f.save(assignment, a.token, { subscribed: true, pushEnabled: false, expectedRevision: 2 }));
  ok(await f.save(assignment, a.token, { subscribed: false, pushEnabled: false, expectedRevision: 3 }));
  await f.patch("game_assignments", otherAssignment, { endsAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await f.save(otherAssignment, b.token, { subscribed: true, pushEnabled: false, expectedRevision: 0 })).data.error.code, "EXPIRED");
  await f.patch("game_players", b.id, { mustChangePassword: true });
  assert.equal((await f.call(`/assignments/${otherAssignment}/push-subscription`, b.token)).data.error.code, "PASSWORD_CHANGE_REQUIRED");
  await f.patch("game_players", b.id, { mustChangePassword: false, status: "disabled" });
  assert.equal((await f.call("/me/push/subscriptions", b.token)).data.error.code, "ACCOUNT_DISABLED");
});

test("real PocketBase: additive subscription migration preserves existing business and starts empty", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((name) => name !== migration) });
  t.after(() => server.stop());
  const f = fixture(server), p = await f.player("subscription_migration");
  const snapshot = () => JSON.parse(execFileSync("python3", ["-c", `
import json, sqlite3, sys
db=sqlite3.connect('file:' + sys.argv[1] + '/data.db?mode=ro', uri=True)
db.row_factory=sqlite3.Row
print(json.dumps({row['name']: dict(row) for row in db.execute('SELECT * FROM _collections') if row['name'] not in ${JSON.stringify(privateTables)}}))
`, server.dataDirectory()], { encoding: "utf8" }));
  const before = snapshot();
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names });
  assert.deepEqual(snapshot(), before);
  const actualObjects = JSON.parse(execFileSync("python3", ["-c", `
import json, sqlite3, sys
db=sqlite3.connect('file:' + sys.argv[1] + '/data.db?mode=ro', uri=True)
db.row_factory=sqlite3.Row
print(json.dumps([dict(row) for row in db.execute('SELECT type,name,tbl_name AS "table" FROM sqlite_master WHERE tbl_name IN (?,?,?) ORDER BY type,name', ${JSON.stringify(privateTables)})]))
`, server.dataDirectory()], { encoding: "utf8" }));
  const delta = JSON.parse(readFileSync(new URL("../deploy/1panel/allowed-delta.push-subscriptions.json", import.meta.url), "utf8"));
  assert.deepEqual(actualObjects, delta.newSchemaObjects);
  for (const name of privateTables) assert.deepEqual(await f.records(name), []);
  assert.deepEqual(ok(await f.call("/me/push/subscriptions", p.token)), { items: [], subscriptionApproved: false });
  await server.restart();
  for (const name of privateTables) assert.deepEqual(await f.records(name), []);
});
