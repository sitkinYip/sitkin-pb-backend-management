import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createTestServer } from "./server.mjs";
import { loadNativeProgressWatchContract } from "./progress-watch-native-contract.mjs";

const watches = "game_progress_watches";
const deliveries = "game_progress_deliveries";
const adminRoute = "/admin/progress-watches";
const playerRoute = "/me/progress-watches";
const migration = "1795680000_progress_watches.js";
const allEvents = ["correct", "incorrect", "completed"];
const expires = () => new Date(Date.now() + 3600000).toISOString();
const sceneTitle = "合成生日场次";
const wrongChoiceLabel = "一条松树旁的小路";
const testHooks = `routerAdd("POST", "/__test/progress-dispatch", e => {
  const progress = require(__hooks + "/lib/progress-watches.js");
  const push = require(__hooks + "/lib/push.js");
  const cloud = require(__hooks + "/lib/huawei-push.js");
  const messages = [];
  push.dispatch(e.app, job => {
    messages.push(cloud.message(job, true));
    return { accepted: true, retry: false, code: "80000000" };
  }, progress.deliveries);
  return e.json(200, { messages });
}, $apis.requireAuth("_superusers"));
routerAdd("POST", "/__test/progress-read-race", e => {
  const progress = require(__hooks + "/lib/progress-watches.js");
  const game = require(__hooks + "/lib/gameplay.js");
  const input = e.requestInfo().body;
  const watcher = e.app.findRecordById("game_players", input.watcher);
  const solver = e.app.findRecordById("game_players", input.solver);
  const finish = () => game.answer({ app: e.app, auth: solver }, input.assignment, input.command, () => {});
  // Commit the last answer as soon as an unprotected assignment read returns,
  // or as soon as a protected snapshot closes.
  const app = {
    findRecordsByFilter(table, ...args) {
      const rows = e.app.findRecordsByFilter(table, ...args);
      if (table === "game_assignments") finish();
      return rows;
    },
    runInTransaction(read) {
      e.app.runInTransaction(read);
      finish();
    },
  };
  return e.json(200, progress.read({ app, auth: watcher }, input.watch));
}, $apis.requireAuth("_superusers"));`;

function fixture(server) {
  function ok(response) {
    assert.equal(response.status, 200, `${JSON.stringify(response.data.error)}\n${server.logs()}`);
    return response.data;
  }
  const call = (path, token, body, method = body ? "POST" : "GET") =>
    server.request(`/api/questions/v1${path}`, { token, body, method });
  const raw = (table, body, id, method = body ? "POST" : "GET") => server.request(
    `/api/collections/${table}/records${id ? "/" + id : "?perPage=100"}`, { token: server.superToken, body, method });
  const command = async (path, body, token = server.adminToken) =>
    ok(await call(path, token, { requestId: randomUUID(), ...body }));
  async function player(account, displayName = account) {
    const password = `T-${randomUUID()}`;
    const row = ok(await raw("game_players", { account, displayName, status: "active", mustChangePassword: false,
      password, passwordConfirm: password }));
    ok(await raw("game_player_stats", { player: row.id, totalXp: 0 }));
    const auth = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }));
    return { id: row.id, token: auth.token };
  }
  async function assign(playerId, { title = sceneTitle, choiceAtLastLevel = false } = {}) {
    const levels = [];
    for (const position of [1, 2]) {
      const choice = choiceAtLastLevel && position === 2;
      const question = await command("/admin/questions", { title: `合成题目 ${position}`, kind: choice ? "choice" : "text",
        content: [{ text: "隔离谜面" }], acceptedAnswers: [`星光${position}`],
        ...(choice ? { options: [{ key: "星光2", text: "正确选项的文字" }, { key: "B", text: wrongChoiceLabel }] } : {}) });
      await command(`/admin/questions/${question.id}/publish`, {});
      levels.push({ question: question.id, xp: 0 });
    }
    const session = await command("/admin/sessions", { title, levels });
    await command(`/admin/sessions/${session.id}/publish`, {});
    const response = await command("/admin/assignments", { sessionId: session.id, target: "selected", playerIds: [playerId] });
    return response.results[0].assignmentId;
  }
  const grant = (watcher, assignment, extra = {}, token = server.adminToken) => call(adminRoute, token, {
    requestId: randomUUID(), watcher, assignment, expiresAt: expires(), revoked: false, expectedRevision: 0,
    reason: "隔离验证生日进度", ...extra,
  }, "PUT");
  const save = (token, id, expectedRevision, options) => call(`${playerRoute}/${id}`, token, {
    requestId: randomUUID(), expectedRevision, subscribed: true, pushEnabled: false, eventKinds: allEvents, ...options,
  }, "PUT");
  const register = async (token) => {
    const profileId = randomUUID();
    assert.equal(ok(await call("/me/push/register", token, {
      installationId: randomUUID(), token: `isolated-${randomUUID()}`, profileId,
    })).registered, true);
    return profileId;
  };
  const messages = async () => ok(await server.request("/__test/progress-dispatch", {
    token: server.superToken, method: "POST", body: {},
  })).messages;
  const allowAll = async () => ok(await call("/admin/push-settings", server.adminToken,
    { requestId: randomUUID(), audience: "all", playerIds: [], reason: "隔离通知", expectedRevision: 0 }, "PATCH"));
  return { ok, call, raw, player, assign, grant, save, messages, allowAll, register, command };
}

test("progress watches scope read and writes to the authorized account and scene", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0",
    STARWARD_PUSH_SUBSCRIPTION_APPROVED: "1" } });
  t.after(() => server.stop());
  const f = fixture(server);
  const watcher = await f.player("progresswatcher");
  const solver = await f.player("progresssolver");
  const assignment = await f.assign(solver.id);
  assert.equal((await f.call(playerRoute)).status, 401);
  assert.equal((await f.call(adminRoute, watcher.token)).status, 401);
  assert.equal((await f.grant(watcher.id, assignment, {}, watcher.token)).status, 401);
  assert.equal((await f.grant(solver.id, assignment)).status, 400);
  assert.deepEqual(f.ok(await f.call(playerRoute, watcher.token)), { items: [] });

  const watch = f.ok(await f.grant(watcher.id, assignment));
  assert.equal(watch.subscribed, false);
  assert.equal(watch.pushEnabled, false);
  assert.deepEqual(f.ok(await f.call(playerRoute, solver.token)).items, []);
  assert.equal((await f.call(`${playerRoute}/${watch.id}`, solver.token)).status, 404);
  assert.equal((await f.save(solver.token, watch.id, 1)).status, 404);
  assert.equal((await server.request(`/api/collections/${watches}/records`, { token: watcher.token })).status, 403);
  assert.equal((await server.request(`/api/collections/${deliveries}/records`, { token: watcher.token })).status, 403);
  assert.equal((await f.save(watcher.token, watch.id, 1, { pushEnabled: true })).data.error.code,
    "PROGRESS_WATCH_CONFIRMATION_REQUIRED");
  assert.equal((await f.save(watcher.token, watch.id, 1, { eventKinds: ["correct", "correct"] })).status, 400);
  const detail = f.ok(await f.save(watcher.token, watch.id, 1));
  assert.equal(detail.watch.revision, 2);
  assert.deepEqual(detail.recent, []);
  assert.equal(detail.total, 2);
  assert.equal(detail.pushAvailable, false);
  assert.equal((await f.grant(watcher.id, assignment, { revoked: true, expectedRevision: 1 })).status, 409);
  assert.equal((await f.save(watcher.token, watch.id, 2, { pushEnabled: true })).data.error.code,
    "PROGRESS_PUSH_UNAVAILABLE");
  f.ok(await f.raw(watches, { expiresAt: new Date(Date.now() - 5000).toISOString() }, watch.id, "PATCH"));
  assert.deepEqual(f.ok(await f.call(playerRoute, watcher.token)).items, []);
  assert.equal((await f.call(`${playerRoute}/${watch.id}`, watcher.token)).status, 404);
  assert.equal((await f.save(watcher.token, watch.id, 2, { subscribed: false, eventKinds: [] })).status, 404);
});

test("real commits generate only selected notifications, target the watcher device, and stop after revocation", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ env: { STARWARD_PUSH_ENABLED: "1", STARWARD_PUSH_TEST_MODE: "0",
    STARWARD_PUSH_PROGRESS_APPROVED: "1" }, testHooks });
  t.after(() => server.stop());
  const f = fixture(server);
  await f.allowAll();
  const watcher = await f.player("deliverywatcher");
  const solverName = "合成解谜玩家";
  const solver = await f.player("deliverysolver", solverName);
  const watchProfile = await f.register(watcher.token);
  await f.register(solver.token);
  const assignment = await f.assign(solver.id, { choiceAtLastLevel: true });
  const watch = f.ok(await f.grant(watcher.id, assignment));
  const opened = await f.command(`/assignments/${assignment}/start`, {}, solver.token);
  const [first, last] = opened.levels;
  const answer = (level, text, requestId = randomUUID()) => f.call(`/assignments/${assignment}/answers`, solver.token,
    { requestId, sessionLevelId: level.id, answer: text });

  assert.equal(f.ok(await answer(first, "审批前合成错答")).result, "incorrect");
  assert.deepEqual(f.ok(await f.raw(deliveries)).items, []);
  f.ok(await f.save(watcher.token, watch.id, 1));
  f.ok(await f.save(watcher.token, watch.id, 2, { pushEnabled: true }));
  const idempotent = randomUUID();
  const wrongText = "一次合成错答 🚀";
  assert.equal(f.ok(await answer(first, wrongText, idempotent)).result, "incorrect");
  assert.equal(f.ok(await answer(first, wrongText, idempotent)).result, "incorrect");
  assert.equal(f.ok(await answer(first, "星光1")).result, "correct");
  assert.equal(f.ok(await answer(last, "B")).result, "incorrect");
  assert.equal(f.ok(await answer(last, "星光2")).assignment.status, "completed");
  assert.equal(f.ok(await answer(last, "星光2")).result, "already_completed");
  const outbox = f.ok(await f.raw(deliveries));
  const outcomes = outbox.items.map((job) => job.outcome).sort();
  assert.deepEqual(outcomes, ["completed", "correct", "incorrect", "incorrect"]);
  const requests = await f.messages();
  const messages = requests.map((request) => request.payload.notification);
  assert.deepEqual(messages.map((message) => message.body).sort(), [
    `${sceneTitle} · 已通关`, `${sceneTitle} · 第 1 题答对`, `${sceneTitle} · 第 1 题答错`, `${sceneTitle} · 第 2 题答错`,
  ].sort());
  for (const message of messages) {
    assert.equal(message.category, "SUBSCRIPTION");
    assert.equal(message.profileId, watchProfile);
    assert.equal(message.clickAction.data.starwardPushKind, "progress");
    assert.equal(message.clickAction.data.starwardPushTargetId, watch.id);
    assert.equal(message.title, `进度订阅 · ${solverName}`);
  }
  assert.doesNotMatch(JSON.stringify(requests), /合成错答|星光[12]|正确选项|松树|submittedAnswer|submittedOptionLabel|deliverysolver/);
  const audit = f.ok(await f.raw("game_admin_audit_logs"));
  assert.doesNotMatch(JSON.stringify([outbox, audit]), /submittedAnswer|submittedOptionLabel|合成错答|松树/);
  assert.deepEqual(await f.messages(), []);
  const detail = f.ok(await f.call(`${playerRoute}/${watch.id}`, watcher.token));
  const list = f.ok(await f.call(playerRoute, watcher.token));
  assert.deepEqual(list, { items: [detail.watch] });
  assert.equal(detail.solved, 2);
  assert.equal(detail.watch.status, "completed");
  assert.equal(detail.recent.length, 5);
  assert.ok(detail.recent.every((item) => !Object.hasOwn(item, "answer")));
  assert.ok(detail.recent.some((attempt) => attempt.result === "incorrect" && attempt.position === 1 &&
    attempt.submittedAnswer === wrongText && !Object.hasOwn(attempt, "submittedOptionLabel")));
  assert.ok(detail.recent.some((attempt) => attempt.result === "incorrect" && attempt.position === 2 &&
    attempt.submittedAnswer === "B" && attempt.submittedOptionLabel === wrongChoiceLabel));
  assert.doesNotMatch(JSON.stringify(detail.recent.filter((attempt) => attempt.result === "correct")),
    /submittedAnswer|submittedOptionLabel/);
  assert.doesNotMatch(JSON.stringify(detail), /星光[12]|正确选项/);
  assert.doesNotMatch(JSON.stringify(list), /submittedAnswer|submittedOptionLabel|合成错答|松树/);
  const forbidden = await f.call(`${playerRoute}/${watch.id}`, solver.token);
  assert.equal(forbidden.status, 404);
  assert.doesNotMatch(JSON.stringify(forbidden.data), /submittedAnswer|submittedOptionLabel|合成错答|松树/);

  const nativeCheckout = process.env.STARWARD_PROGRESS_NATIVE_CHECKOUT;
  await t.test("PocketBase JSON round-trips through the checked-out HarmonyOS decoder and command",
    { skip: nativeCheckout ? false : "set STARWARD_PROGRESS_NATIVE_CHECKOUT to the HarmonyOS checkout" }, async () => {
      const native = await loadNativeProgressWatchContract(nativeCheckout);
      const decodedList = native.decodeProgressWatchList(JSON.stringify(list));
      assert.deepEqual(JSON.parse(JSON.stringify(decodedList)), list);
      const decoded = JSON.parse(JSON.stringify(native.decodeProgressWatchDetail(JSON.stringify(detail), watch.id)));
      assert.deepEqual(decoded, { ...detail,
        recent: detail.recent.map((item) => ({ submittedAnswer: "", submittedOptionLabel: "", ...item })),
      });
      const body = new native.ProgressWatchCommand(randomUUID(), detail.watch.revision, true, true, allEvents);
      assert.deepEqual(f.ok(await f.call(`${playerRoute}/${watch.id}`, watcher.token,
        JSON.parse(JSON.stringify(body)), "PUT")), detail);
    });

  const another = await f.player("deliveryother");
  const longTitle = "星".repeat(85);
  const secondAssignment = await f.assign(another.id, { title: longTitle });
  const secondWatch = f.ok(await f.grant(watcher.id, secondAssignment));
  f.ok(await f.save(watcher.token, secondWatch.id, 1, { eventKinds: ["incorrect"] }));
  f.ok(await f.save(watcher.token, secondWatch.id, 2, { pushEnabled: true, eventKinds: ["incorrect"] }));
  const second = await f.command(`/assignments/${secondAssignment}/start`, {}, another.token);
  await f.command(`/assignments/${secondAssignment}/answers`, { sessionLevelId: second.levels[0].id, answer: "星光1" }, another.token);
  assert.equal(f.ok(await f.raw(deliveries)).items.length, 4);
  await f.command(`/assignments/${secondAssignment}/answers`, { sessionLevelId: second.levels[1].id, answer: "合成错答" }, another.token);
  const [longNotification] = await f.messages();
  assert.equal(longNotification.payload.notification.body, `${"星".repeat(60)} · 第 2 题答错`);
  await f.command(`/assignments/${secondAssignment}/answers`, { sessionLevelId: second.levels[1].id, answer: "另一次错答" }, another.token);
  f.ok(await f.grant(watcher.id, secondAssignment, { revoked: true, expectedRevision: 3 }));
  assert.deepEqual(await f.messages(), []);
  assert.ok(f.ok(await f.raw(deliveries)).items.some((job) => job.watch === secondWatch.id && job.status === "discarded"));
  assert.equal((await f.call(`${playerRoute}/${secondWatch.id}`, watcher.token)).status, 404);
  assert.equal(f.ok(await f.call(playerRoute, watcher.token)).items.length, 1);
  f.ok(await f.raw(watches, { expiresAt: new Date(Date.now() - 5000).toISOString() }, watch.id, "PATCH"));
  const expired = await f.call(`${playerRoute}/${watch.id}`, watcher.token);
  assert.equal(expired.status, 404);
  assert.doesNotMatch(JSON.stringify(expired.data), /submittedAnswer|submittedOptionLabel|合成错答|松树/);
});

test("admin authorization replays its saved result after the original deadline and a renewal", { timeout: 120000 }, async (t) => {
  const server = await createTestServer();
  t.after(() => server.stop());
  const f = fixture(server);
  const watcher = await f.player("receiptwatcher");
  const solver = await f.player("receiptsolver");
  const assignment = await f.assign(solver.id);
  const deadline = Date.now() + 3000;
  const request = { requestId: randomUUID(), expiresAt: new Date(deadline).toISOString() };
  const original = f.ok(await f.grant(watcher.id, assignment, request));
  const renewed = f.ok(await f.grant(watcher.id, assignment, { expectedRevision: original.revision }));
  await delay(Math.max(0, deadline - Date.now()) + 20);

  assert.deepEqual(f.ok(await f.grant(watcher.id, assignment, request)), original);
  const reusedRequest = await f.grant(watcher.id, assignment, { ...request, reason: "同一请求的不同内容" });
  assert.equal(reusedRequest.data.error.code, "IDEMPOTENCY_CONFLICT");
  const invalid = await f.grant(watcher.id, assignment, { ...request, requestId: randomUUID(), expectedRevision: renewed.revision });
  assert.equal(invalid.data.error.code, "INVALID_INPUT");
  assert.deepEqual(f.ok(await f.call(adminRoute, server.adminToken)), { items: [renewed] });

  const receipts = "game_command_receipts";
  const oldReceipt = f.ok(await f.raw(receipts)).items.find((row) => row.requestId === request.requestId);
  f.ok(await f.raw(receipts, { resultRefs: { id: original.id } }, oldReceipt.id, "PATCH"));
  assert.deepEqual(f.ok(await f.grant(watcher.id, assignment, request)), renewed);
});

test("detail holds authorization and gameplay reads in a snapshot across the last answer", { timeout: 120000 }, async (t) => {
  const server = await createTestServer({ testHooks });
  t.after(() => server.stop());
  const f = fixture(server);
  const watcher = await f.player("snapshotwatcher");
  const solver = await f.player("snapshotsolver");
  const assignment = await f.assign(solver.id);
  const watch = f.ok(await f.grant(watcher.id, assignment));
  const [first, last] = (await f.command(`/assignments/${assignment}/start`, {}, solver.token)).levels;
  await f.command(`/assignments/${assignment}/answers`, { sessionLevelId: first.id, answer: "星光1" }, solver.token);
  const snapshot = f.ok(await server.request("/__test/progress-read-race", {
    token: server.superToken, method: "POST", body: { watcher: watcher.id, solver: solver.id, assignment, watch: watch.id,
      command: { requestId: randomUUID(), sessionLevelId: last.id, answer: "星光2" } },
  }));
  assert.equal(snapshot.watch.status, "active");
  assert.equal(snapshot.solved, 1);
  assert.equal(snapshot.currentPosition, 2);
  assert.equal(snapshot.completedAt, "");
  assert.deepEqual(snapshot.recent.map((attempt) => attempt.position), [1]);

  const completed = f.ok(await f.call(`${playerRoute}/${watch.id}`, watcher.token));
  assert.equal(completed.watch.status, "completed");
  assert.equal(completed.solved, 2);
  assert.equal(completed.currentPosition, 0);
  assert.ok(completed.completedAt);
  assert.deepEqual(completed.recent.map((attempt) => attempt.position).sort(), [1, 2]);
});

test("progress watch migration preserves existing assignments on an isolated restored copy", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations/", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((name) => name !== migration) });
  t.after(() => server.stop());
  const f = fixture(server);
  const solver = await f.player("upgradesolver");
  const id = await f.assign(solver.id);
  const before = f.ok(await f.raw("game_assignments", undefined, id));
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names });
  assert.deepEqual(f.ok(await f.raw("game_assignments", undefined, id)), before);
  for (const table of [watches, deliveries]) assert.deepEqual(f.ok(await f.raw(table)).items, []);
  await server.restart();
  assert.deepEqual(f.ok(await f.call(playerRoute, solver.token)).items, []);
});
