import { test } from "node:test";
import assert from "node:assert/strict";
import { constants, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createTestServer } from "./server.mjs";

const root = "/api/questions/v1";
const testHooks = [
  'routerAdd("POST", "/__test/push-dispatch", e => {',
  ' const push = require(`${__hooks}/lib/push.js`);',
  ' const cloud = require(`${__hooks}/lib/huawei-push.js`);',
  ' const messages = [];',
  ' push.dispatch(e.app, job => {',
  '   const body = cloud.message(job, push.testMode());',
  '   const state = e.requestInfo().body.state;',
  '   messages.push({notification: body.payload.notification, pushOptions: body.pushOptions});',
  '   if (state === "timeout") throw new Error("simulated timeout");',
  '   if (state === "invalid") return cloud.classify({statusCode: 400, json: {code: "80300007", msg: JSON.stringify({illegalTokens: {tokenFormatError: [job.token]}})}}, job.token);',
  '   return cloud.classify({statusCode: 200, json: {code: state === "rejected" ? "80300007" : "80000000"}});',
  ' });',
  ' return e.json(200, { messages });',
  '}, $apis.requireAuth("_superusers"));',
  'routerAdd("POST", "/__test/push-jwt", e => {',
  ' const cloud = require(`${__hooks}/lib/huawei-push.js`);',
  ' return e.json(200, { jwt: cloud.signJWT(e.requestInfo().body) });',
  '}, $apis.requireAuth("_superusers"));',
  'routerAdd("POST", "/__test/legacy-push-binding", e => {',
  ' const db = require(`${__hooks}/lib/db.js`);',
  ' const {playerId, install} = e.requestInfo().body;',
  ' const player = db.get(e.app, "game_players", playerId);',
  ' db.create(e.app, "game_push_bindings", {',
  '   player: player.id, accountKey: $security.sha256(player.getString("tokenKey")),',
  '   installationId: install.installationId, profileId: install.profileId, token: install.token,',
  '   expiresAt: new Date(Date.now() + 3600000).toISOString(),',
  '   revokeTicket: $security.randomString(48),',
  ' });',
  ' return e.json(200, {});',
  '}, $apis.requireAuth("_superusers"));',
].join("\n");

const settingsRoute = root + "/admin/push-settings";
const newInstall = () => ({
  installationId: randomUUID(), token: "test-" + randomUUID(), profileId: randomUUID(),
});
const success = (result, operation = "isolated API") => {
  assert.equal(result.status, 200, `${operation}: ${result.data.error?.code || "unexpected status"}`);
  return result.data;
};

function audienceFixture(server) {
  const read = (token = server.adminToken) => server.request(settingsRoute, { token });
  const write = (body, token = server.adminToken) => server.request(settingsRoute, {
    method: "PATCH", token, body,
  });
  const configure = (expectedRevision, audience, playerIds, reason = "调整隔离测试的推送范围") => ({
    requestId: randomUUID(), expectedRevision, audience, playerIds, reason,
  });
  const register = (token, body) => server.request(root + "/me/push/register", {
    method: "POST", token, body,
  });
  const publishNote = (playerIds) => server.request(root + "/admin/notifications", {
    method: "POST", token: server.adminToken,
    body: {
      requestId: randomUUID(), target: "selected", playerIds, title: "隔离推送", content: "合成通知",
    },
  });
  const collection = (name) => "/api/collections/" + name + "/records";
  const records = async (name) => success(await server.request(collection(name), {
    token: server.superToken,
  }), "inspect isolated records").items;
  const dispatch = async () => success(await server.request("/__test/push-dispatch", {
    method: "POST", token: server.superToken, body: { state: "accepted" },
  }), "dispatch via test provider").messages;
  const player = async (account, id = "") => {
    const password = "T-" + randomUUID();
    const created = success(await server.request(collection("game_players"), {
      method: "POST", token: server.superToken,
      body: { ...(id ? { id } : {}), account, password, passwordConfirm: password,
        displayName: "合成验证玩家", status: "active", mustChangePassword: false },
    }), "create synthetic player");
    const auth = success(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }), "synthetic player login");
    return { id: created.id, token: auth.token };
  };
  return { read, write, configure, register, publishNote, records, dispatch, player, collection };
}

test("real PocketBase: push binding, assignment and inbox outbox, retries and revocation", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({
    env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" },
    testHooks,
  });
  t.after(() => server.stop());
  const delta = JSON.parse(readFileSync(new URL(
    "../deploy/1panel/allowed-delta.harmony-push.json", import.meta.url,
  ), "utf8"));
  const actualSchema = JSON.parse(execFileSync("python3", ["-c", `
import json, sqlite3, sys
db = sqlite3.connect('file:' + sys.argv[1] + '/data.db?mode=ro', uri=True)
db.row_factory = sqlite3.Row
probed = ("game_push_bindings", "game_push_deliveries", "game_push_settings")
assert all(db.execute('SELECT count(*) FROM "' + table + '"').fetchone()[0] == 0 for table in probed)
print(json.dumps([dict(row) for row in db.execute(
    'SELECT type, name, tbl_name AS "table" FROM sqlite_master WHERE tbl_name IN (?, ?, ?) ORDER BY type, name', probed
)]))
`, server.dataDirectory()], { encoding: "utf8" }));
  assert.deepEqual(actualSchema, delta.newSchemaObjects);
  const ok = ({ status, data }) => {
    assert.equal(status, 200, `${JSON.stringify(data)}\n${server.logs()}`);
    return data;
  };
  const call = (route, token, body) =>
    server.request(root + route, { token, method: body ? "POST" : "GET", body });
  const admin = (route, body, requestId = randomUUID()) =>
    call(route, server.adminToken, { requestId, ...body });
  const send = (target, requestId) => admin("/admin/notifications", {
    title: "私密通知标题", content: "私密通知正文", target: "selected", playerIds: [target],
  }, requestId);
  async function player(account) {
    const password = "T-" + randomUUID(), next = "N-" + randomUUID();
    const { id } = ok(await admin("/admin/players", { account, displayName: account, password }));
    const before = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    })).token;
    const first = () => call("/me/change-password", before, {
      oldPassword: password, password: next, passwordConfirm: next,
    });
    return { id, before, first };
  }
  const a = await player("push_alice");
  const b = await player("push_bob");
  const install = { installationId: randomUUID(), token: "device-" + randomUUID(), profileId: randomUUID() };
  const register = (playerToken, data = install) => call("/me/push/register", playerToken, data);
  const revoke = (revokeTicket) => call("/push/revoke", undefined, {
    installationId: install.installationId, revokeTicket,
  });
  assert.equal((await register(undefined)).status, 401);
  assert.equal((await register(server.adminToken)).status, 401);
  assert.equal((await register(a.before)).data.error.code, "PASSWORD_CHANGE_REQUIRED");
  const alice = ok(await a.first()).token;
  const bob = ok(await b.first()).token;
  assert.equal((await register(alice, { ...install, playerId: b.id })).status, 400);
  assert.deepEqual(ok(await register(alice)), { registered: false });
  ok(await server.request(root + "/admin/push-settings", {
    method: "PATCH", token: server.adminToken,
    body: { requestId: randomUUID(), audience: "all", playerIds: [], expectedRevision: 0, reason: "开放隔离 Push 测试" },
  }));
  const first = ok(await register(alice));
  assert.match(first.revokeTicket, /^[a-zA-Z0-9]{48}$/);
  assert.deepEqual(ok(await register(alice)), first);
  assert.equal((await server.request("/api/collections/game_push_bindings/records", { token: alice })).status, 403);
  assert.deepEqual(ok(await call("/me/push/unregister", bob,
    { installationId: install.installationId })), { registered: false });
  assert.deepEqual(ok(await register(alice)), first);
  assert.deepEqual(ok(await revoke("a".repeat(48))), { registered: false });
  assert.deepEqual(ok(await register(alice)), first);

  const q = ok(await admin("/admin/questions", {
    kind: "text", title: "私密题目", content: [{ text: "私密内容" }], acceptedAnswers: ["北星"],
  }));
  ok(await admin(`/admin/questions/${q.id}/publish`, {}));
  const s = ok(await admin("/admin/sessions", {
    title: "私密场次名", levels: [{ question: q.id, xp: 0 }],
  }));
  ok(await admin(`/admin/sessions/${s.id}/publish`, {}));
  const assignInput = { sessionId: s.id, target: "selected", playerIds: [a.id, b.id] };
  const assignId = randomUUID();
  const assigned = ok(await admin("/admin/assignments", assignInput, assignId));
  assert.deepEqual(ok(await admin("/admin/assignments", assignInput, assignId)), assigned);
  const assignAgain = ok(await admin("/admin/assignments", assignInput));
  assert.deepEqual(assignAgain.results.map((item) => item.status), ["skipped_active", "skipped_active"]);
  const assignment = assigned.results[0].assignmentId;
  const noteId = randomUUID();
  const note = ok(await send(a.id, noteId));
  assert.deepEqual(ok(await send(a.id, noteId)), note);
  ok(await send(b.id));
  const withdrawn = ok(await send(a.id));
  ok(await admin(`/admin/notifications/${withdrawn.id}/withdraw`, { reason: "撤回验证" }));
  const read = ok(await send(a.id));
  ok(await call(`/notifications/${read.id}/read`, alice, {}));
  const dispatch = async (state = "accepted") => ok(await server.request("/__test/push-dispatch", {
    token: server.superToken, method: "POST", body: { state },
  })).messages;
  const messages = await dispatch();
  assert.equal(messages.length, 2);
  assert.deepEqual(new Set(messages.map(({ notification }) =>
    notification.clickAction.data.starwardPushKind)), new Set(["assignment", "inbox"]));
  for (const { notification, pushOptions } of messages) {
    assert.equal(notification.title, "赴星之约");
    assert.equal(notification.body, "旅途有新消息，打开应用查看。");
    assert.equal(notification.profileId, install.profileId);
    assert.equal(notification.foregroundShow, true);
    const data = notification.clickAction.data;
    assert.equal(notification.clickAction.action, "com.sitkin.starward.action.PUSH_OPEN");
    assert.equal(data.starwardPushVersion, "1");
    assert.equal(data.starwardPushProfileId, install.profileId);
    assert.equal(data.starwardPushEventId, notification.appMessageId);
    assert.equal(data.starwardPushTargetId, data.starwardPushKind === "assignment" ? assignment : undefined);
    assert.equal(pushOptions.testMessage, false);
    assert.ok(pushOptions.ttl >= 1 && pushOptions.ttl <= 600);
  }
  assert.deepEqual(await dispatch(), []);

  ok(await send(a.id));
  const timedOut = await dispatch("timeout");
  assert.equal(timedOut.length, 1);
  assert.deepEqual(await dispatch(), []);
  const collection = "/api/collections/game_push_deliveries/records";
  const meta = ok(await server.request(`${collection}/${timedOut[0].notification.appMessageId}`, {
    token: server.superToken,
  }));
  assert.equal(meta.status, "pending");
  assert.equal(meta.providerCode, "NETWORK");
  ok(await server.request(`${collection}/${meta.id}`, {
    token: server.superToken, method: "PATCH", body: { availableAt: new Date(Date.now() - 1000).toISOString() },
  }));
  const again = await dispatch("rejected");
  assert.equal(again.length, 1);
  assert.equal(again[0].notification.appMessageId, timedOut[0].notification.appMessageId);
  assert.deepEqual(await dispatch(), []);

  ok(await send(a.id));
  const rotated = { ...install, token: "new-" + randomUUID() };
  const refreshed = ok(await register(alice, rotated));
  assert.equal(refreshed.revokeTicket, first.revokeTicket);
  assert.equal((await dispatch()).length, 1);
  ok(await send(a.id));
  ok(await revoke(first.revokeTicket));
  assert.deepEqual(await dispatch(), []);
  const beforeSwitch = ok(await register(alice, rotated));
  assert.notEqual(beforeSwitch.revokeTicket, refreshed.revokeTicket);
  ok(await send(a.id));
  const changed = { ...rotated, profileId: randomUUID() };
  const switched = ok(await register(bob, changed));
  assert.notEqual(switched.revokeTicket, beforeSwitch.revokeTicket);
  ok(await revoke(beforeSwitch.revokeTicket));
  ok(await call("/me/push/unregister", alice, { installationId: install.installationId }));
  assert.deepEqual(await dispatch(), []);
  ok(await send(b.id));
  assert.equal((await dispatch()).length, 1);
  ok(await send(b.id));
  ok(await revoke(switched.revokeTicket));
  ok(await revoke(switched.revokeTicket));
  assert.deepEqual(await dispatch(), []);

  ok(await register(alice));
  ok(await send(a.id));
  ok(await admin(`/admin/players/${a.id}/actions`, { action: "disable", reason: "推送账号边界" }));
  ok(await admin(`/admin/players/${a.id}/actions`, { action: "enable", reason: "验证旧绑定失效" }));
  assert.deepEqual(await dispatch(), []);

  const untilInvalid = ok(await register(bob, changed));
  ok(await send(b.id));
  assert.equal((await dispatch("invalid")).length, 1);
  ok(await send(b.id));
  assert.deepEqual(await dispatch(), []);
  assert.notEqual(ok(await register(bob, changed)).revokeTicket, untilInvalid.revokeTicket);
});

test("PocketBase JSVM signs an AGC PS256 JWT using the image's OpenSSL", {
  skip: process.env.PB_PUSH_VALIDATE_OPENSSL !== "1",
  timeout: 120000,
}, async (t) => {
  const server = await createTestServer({ testHooks });
  t.after(() => server.stop());
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const result = await server.request("/__test/push-jwt", {
    method: "POST", token: server.superToken,
    body: {
      key_id: "synthetic-test-key",
      sub_account: "synthetic-service@example.test",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    },
  });
  assert.equal(result.status, 200);
  const [header, body, sig] = result.data.jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url")), {
    alg: "PS256", typ: "JWT", kid: "synthetic-test-key",
  });
  const claims = JSON.parse(Buffer.from(body, "base64url"));
  assert.equal(claims.aud, "https://oauth-login.cloud.huawei.com/oauth2/v3/token");
  assert.equal(claims.iss, "synthetic-service@example.test");
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(verify("sha256", Buffer.from(`${header}.${body}`), {
    key: publicKey, padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }, Buffer.from(sig, "base64url")), true);
});

test("production Push settings require admin, default closed, and discard excluded jobs permanently", {
  timeout: 120000,
}, async (t) => {
  const server = await createTestServer({
    env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" }, testHooks,
  });
  t.after(() => server.stop());
  const f = audienceFixture(server);
  const alice = await f.player("audience_alice");
  const bob = await f.player("audience_bob");
  const a = newInstall(), b = newInstall();
  const defaultSettings = {
    audience: "allowlist", playerIds: [], revision: 0, serverEnabled: true, testMode: false, subscriptionApproved: false,
  };
  assert.equal((await f.read(alice.token)).status, 401);
  assert.equal((await server.request(settingsRoute)).status, 401);
  assert.equal((await f.write(f.configure(0, "all", []), alice.token)).status, 401);
  assert.equal((await server.request(f.collection("game_push_settings"), { token: alice.token })).status, 403);
  assert.deepEqual(success(await f.read()), defaultSettings);
  assert.deepEqual(success(await f.register(alice.token, a)), { registered: false });
  assert.deepEqual(success(await f.write(f.configure(0, "allowlist", []))), defaultSettings);
  assert.deepEqual(await f.records("game_push_settings"), []);
  for (const invalid of [
    f.configure(0, "all", [], "  "),
    f.configure(0, "allowlist", ["malformed"]),
    f.configure(0, "allowlist", ["zzzzzzzzzzzzzzz"]),
    { ...f.configure(0, "all", []), serverEnabled: true },
  ]) assert.equal((await f.write(invalid)).status, 400);
  const scoped = f.configure(0, "allowlist", [alice.id, alice.id], " 单账号正式验收 ");
  const configured = success(await f.write(scoped));
  assert.deepEqual(configured, { ...defaultSettings, playerIds: [alice.id], revision: 1 });
  assert.deepEqual(success(await f.write(scoped)), configured);
  const stale = await f.write(f.configure(0, "all", []));
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, "PUSH_SETTINGS_CONFLICT");
  assert.deepEqual(success(await f.read()), configured);
  assert.equal(success(await f.register(alice.token, a)).registered, true);
  assert.deepEqual(success(await f.register(bob.token, b)), { registered: false });
  success(await f.publishNote([alice.id, bob.id]));
  const scopedMessages = await f.dispatch();
  assert.deepEqual(scopedMessages.map((msg) => msg.notification.profileId), [a.profileId]);
  assert.equal(scopedMessages[0].pushOptions.testMessage, false);
  const bobInbox = async () => success(await server.request(root + "/notifications", {
    token: bob.token,
  })).items;
  assert.equal((await bobInbox()).length, 1);

  assert.deepEqual(success(await f.write(f.configure(1, "all", [alice.id]))),
    { ...configured, audience: "all", revision: 2 });
  assert.equal(success(await f.register(bob.token, b)).registered, true);
  assert.deepEqual(await f.dispatch(), []); // Opening the scope does not backfill an earlier note.
  success(await f.publishNote([alice.id, bob.id]));
  assert.equal((await f.records("game_push_deliveries")).filter((row) => row.status === "pending").length, 2);
  assert.deepEqual(success(await f.write(f.configure(2, "allowlist", [alice.id]))),
    { ...configured, revision: 3 });
  const narrowedRows = await f.records("game_push_deliveries");
  assert.equal(narrowedRows.filter((row) => row.status === "discarded").length, 1);
  assert.equal(narrowedRows.filter((row) => row.status === "pending").length, 1);
  assert.deepEqual(success(await f.register(bob.token, b)), { registered: false });

  success(await f.write(f.configure(3, "all", [alice.id])));
  assert.deepEqual((await f.dispatch()).map((msg) => msg.notification.profileId), [a.profileId]);
  success(await f.publishNote([alice.id, bob.id]));
  assert.deepEqual(new Set((await f.dispatch()).map((msg) => msg.notification.profileId)),
    new Set([a.profileId, b.profileId]));

  const closed = success(await f.write(f.configure(4, "allowlist", [])));
  assert.deepEqual(closed, { ...defaultSettings, revision: 5 });
  success(await f.publishNote([alice.id, bob.id]));
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await bobInbox()).length, 4);
  await server.restart();
  assert.deepEqual(success(await f.read()), closed);
  const audit = (await f.records("game_admin_audit_logs")).filter((row) => row.action === "update_push_settings");
  assert.equal(audit.length, 5);
  const firstAudit = audit.find((row) => row.safeDiff.after.revision === 1);
  assert.equal(firstAudit.reason, "单账号正式验收");
  assert.deepEqual(firstAudit.safeDiff, {
    before: { audience: "allowlist", playerCount: 0, revision: 0 },
    after: { audience: "allowlist", playerCount: 1, revision: 1 },
  });
});

test("audience migration on an existing database is empty, and existing denied bindings cannot send", {
  timeout: 120000,
}, async (t) => {
  const migration = "1794988860_push_audience.js";
  const migrationNames = readdirSync(new URL("../pb_migrations/", import.meta.url))
    .filter((name) => name.endsWith(".js"));
  const server = await createTestServer({
    migrationNames: migrationNames.filter((name) => name !== migration),
    env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0" },
    testHooks,
  });
  t.after(() => server.stop());
  const f = audienceFixture(server);
  const oldPlayer = await f.player("audience_legacy");
  const install = newInstall();
  success(await server.request("/__test/legacy-push-binding", {
    method: "POST", token: server.superToken, body: { playerId: oldPlayer.id, install },
  }));
  // Mimic an existing outbox row left by the earlier implementation.
  const bindingId = (await f.records("game_push_bindings"))[0].id;
  const adminId = (await f.records("game_admins"))[0].id;
  const note = success(await server.request(f.collection("game_notifications"), {
    method: "POST", token: server.superToken,
    body: { title: "可发送的旧通知", content: "迁移前的合成来信",
      status: "sent", createdBy: adminId, sentAt: new Date().toISOString() },
  }));
  const receipt = success(await server.request(f.collection("game_notification_receipts"), {
    method: "POST", token: server.superToken,
    body: { player: oldPlayer.id, notification: note.id },
  }));
  success(await server.request(f.collection("game_push_deliveries"), {
    method: "POST", token: server.superToken,
    body: {
      binding: bindingId, kind: "inbox", targetId: receipt.id, status: "pending",
      availableAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  }));
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: migrationNames });
  assert.deepEqual(success(await f.read()), {
    audience: "allowlist", playerIds: [], revision: 0, serverEnabled: true, testMode: false, subscriptionApproved: false,
  });
  assert.deepEqual(await f.records("game_push_settings"), []);
  assert.equal((await f.records("game_push_bindings")).length, 1);
  assert.equal(success(await server.request(root + "/notifications", { token: oldPlayer.token })).items.length, 1);
  assert.deepEqual(success(await f.register(oldPlayer.token, install)), { registered: false });
  assert.deepEqual(await f.dispatch(), []);
  assert.equal((await f.records("game_push_deliveries"))[0].status, "discarded");
});

test("server master defaults off independently of a saved audience", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_TEST_MODE: "0" }, testHooks });
  t.after(() => server.stop());
  const f = audienceFixture(server);
  const player = await f.player("audience_server_off");
  const saved = success(await f.write(f.configure(0, "all", [])));
  assert.deepEqual(saved, {
    audience: "all", playerIds: [], revision: 1, serverEnabled: false, testMode: false, subscriptionApproved: false,
  });
  assert.deepEqual(success(await f.register(player.token, newInstall())), { registered: false });
  success(await f.publishNote([player.id]));
  assert.deepEqual(await f.records("game_push_deliveries"), []);
  assert.deepEqual(await f.dispatch(), []);
});

test("developer test messages ignore production audience and still require the exact test player", {
  timeout: 120000,
}, async (t) => {
  const developerId = "pushaudiencetest".slice(0, 15);
  const server = await createTestServer({
    env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "1",
      STARWARD_PUSH_TEST_PLAYER_ID: developerId }, testHooks,
  });
  t.after(() => server.stop());
  const f = audienceFixture(server);
  const tester = await f.player("audience_tester", developerId);
  const other = await f.player("audience_other");
  const install = newInstall();
  const all = success(await f.write(f.configure(0, "all", [])));
  assert.equal(all.testMode, true);
  assert.equal(Object.hasOwn(all, "testPlayerId"), false);
  assert.equal(success(await f.register(tester.token, install)).registered, true);
  assert.deepEqual(success(await f.register(other.token, newInstall())), { registered: false });
  success(await f.publishNote([tester.id, other.id]));
  success(await f.write(f.configure(1, "allowlist", [other.id])));
  const testMessages = await f.dispatch();
  assert.deepEqual(testMessages.map((msg) => msg.notification.profileId), [install.profileId]);
  assert.equal(testMessages[0].pushOptions.testMessage, true);
});
