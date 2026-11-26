const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);

const table = "game_push_settings";
const settingsId = "harmonypushconf";
const playerIdPattern = /^[a-z0-9]{15}$/;
const maxPlayers = 1000;
const enabled = () => $os.getenv("STARWARD_PUSH_ENABLED") === "1";
const testMode = () => $os.getenv("STARWARD_PUSH_TEST_MODE") !== "0";
const empty = () => ({ audience: "allowlist", playerIds: [], revision: 0 });
const validAudience = (value) => ["allowlist", "all"].includes(value);
const validIds = (values) => Array.isArray(values) && values.length <= maxPlayers &&
  values.every((id) => typeof id === "string" && playerIdPattern.test(id));

function readRecord(app) {
  return db.maybe(app, table, "id={:id}", { id: settingsId });
}

function policy(row) {
  if (!row) return empty();
  const revision = row.getInt("revision");
  const audience = row.getString("audience");
  let playerIds;
  try { playerIds = db.json(row, "playerIds"); } catch {}
  if (!validAudience(audience) || !validIds(playerIds))
    return { ...empty(), revision };
  return { audience, playerIds, revision };
}

function permitted(app, playerId) {
  if (testMode())
    return Boolean(playerId) && $os.getenv("STARWARD_PUSH_TEST_PLAYER_ID") === playerId;
  const { audience, playerIds } = policy(readRecord(app));
  return audience === "all" || playerIds.includes(playerId);
}

function withRuntimeState(data) {
  return { ...data, serverEnabled: enabled(), testMode: testMode(),
    subscriptionApproved: $os.getenv("STARWARD_PUSH_SUBSCRIPTION_APPROVED") === "1" };
}

function read(app) {
  return withRuntimeState(policy(readRecord(app)));
}

function auditView({ audience, playerIds, revision }) {
  return { audience, playerCount: playerIds.length, revision };
}

function discardExcluded(app, playerIds) {
  // One transaction with the new policy; a later expansion won't revive
  // these jobs. Already handed to the provider cannot be withdrawn here.
  for (const table of ["game_push_deliveries", "game_progress_deliveries"]) app.db().newQuery(`
    UPDATE ${table}
    SET status = 'discarded', lease = ''
    WHERE status IN ('pending', 'sending')
      AND binding IN (
        SELECT id FROM game_push_bindings
        WHERE player NOT IN (SELECT value FROM json_each({:playerIds}))
      )
  `).bind({ playerIds: JSON.stringify(playerIds) }).execute();
}

function save(e, body) {
  const fields = ["requestId", "audience", "playerIds", "expectedRevision", "reason"];
  if (Object.keys(body).length !== fields.length || !fields.every((field) => Object.hasOwn(body, field)))
    r.fail("INVALID_INPUT", "消息推送配置包含不支持或缺少的字段");
  const reason = r.text(body.reason, "修改原因", 200);
  if (!validAudience(body.audience) || !validIds(body.playerIds) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    r.fail("INVALID_INPUT", "消息推送范围、玩家名单或版本无效");
  const playerIds = Array.from(new Set(body.playerIds)).sort();
  return withRuntimeState(db.command(e, "save-push-settings", body, true, (app, actor) => {
    let row = readRecord(app);
    const before = policy(row);
    if (body.expectedRevision !== before.revision)
      r.fail("PUSH_SETTINGS_CONFLICT", "消息推送配置已更新，请重新加载后再保存", 409);
    for (const id of playerIds)
      if (!db.maybe(app, "game_players", "id={:id}", { id }))
        r.fail("INVALID_INPUT", "玩家名单包含不存在的账号，请重新选择");
    const audience = body.audience;
    if (before.audience === audience &&
        JSON.stringify([...before.playerIds].sort()) === JSON.stringify(playerIds)) return before;
    const next = { audience, playerIds, revision: before.revision + 1 };
    if (!row) row = db.create(app, table, { id: settingsId, ...next });
    else {
      for (const key of Object.keys(next)) row.set(key, next[key]);
      app.save(row);
    }
    if (!testMode() && audience === "allowlist" &&
        (before.audience === "all" || before.playerIds.some((id) => !playerIds.includes(id))))
      discardExcluded(app, playerIds);
    db.audit(app, actor, "update_push_settings", row, reason, body.requestId, {
      before: auditView(before), after: auditView(next),
    });
    return next;
  }));
}

module.exports = { enabled, testMode, permitted, read, save };
