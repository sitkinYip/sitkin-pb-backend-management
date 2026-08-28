const rules = require(`${__hooks}/lib/rules.js`);
function all(app, table, filter = "", params = {}, sort = "created,id") {
  return app.findRecordsByFilter(table, filter, sort, 0, 0, params);
}
function maybe(app, table, filter, params = {}) {
  const records = app.findRecordsByFilter(table, filter, "", 1, 0, params);
  return records.length ? records[0] : null;
}
function get(app, table, id) {
  const result = maybe(app, table, "id = {:id}", { id });
  if (!result) rules.fail("NOT_FOUND", "记录不存在", 404);
  return result;
}
function create(app, table, fields) {
  const record = new Record(app.findCollectionByNameOrId(table));
  for (const name of Object.keys(fields)) record.set(name, fields[name]);
  app.save(record);
  return record;
}
function json(record, field, fallback = null) {
  const value = record.getString(field);
  return value ? JSON.parse(value) : fallback;
}
function pick(record, fields, jsonFields = []) {
  const value = { id: record.id };
  for (const key of fields) value[key] = record.get(key);
  for (const key of jsonFields) value[key] = json(record, key);
  return value;
}
function actor(app, e, admin = false, allowPasswordChange = false) {
  const expected = admin ? "game_admins" : "game_players";
  if (!e.auth || e.auth.collection().name !== expected)
    rules.fail("AUTH_REQUIRED", "请使用正确类型的账号登录", 401);
  const result = get(app, expected, e.auth.id);
  if (result.getString("status") !== "active")
    rules.fail("ACCOUNT_DISABLED", "账号已停用", 403);
  if (!admin && !allowPasswordChange && result.getBool("mustChangePassword"))
    rules.fail("PASSWORD_CHANGE_REQUIRED", "请先修改初始密码", 403);
  return result;
}
function command(e, operation, input, admin, execute, beforeReplay) {
  const requestId = rules.text(input.requestId, "请求标识", 100);
  const hash = $security.sha256(rules.canonical(input));
  let result;
  e.app.runInTransaction((app) => {
    const owner = actor(app, e, admin);
    // Some commands lose authorization when their session is closed. Check
    // inside the transaction even when an earlier successful receipt exists.
    if (beforeReplay) beforeReplay(app, owner);
    const collection = owner.collection().name;
    const prior = maybe(
      app,
      "game_command_receipts",
      "actorCollection={:collection} && actorId={:owner} && operation={:operation} && requestId={:requestId}",
      { collection, owner: owner.id, operation, requestId },
    );
    if (prior) {
      if (prior.getString("requestHash") !== hash)
        rules.fail("IDEMPOTENCY_CONFLICT", "请求标识已用于不同内容", 409);
      result = json(prior, "resultRefs");
      return;
    }
    result = execute(app, owner);
    create(app, "game_command_receipts", {
      actorCollection: collection,
      actorId: owner.id,
      operation,
      requestId,
      requestHash: hash,
      resultRefs: result,
    });
  });
  return result;
}
function audit(app, actor, action, entity, reason, requestId, safeDiff = {}) {
  create(app, "game_admin_audit_logs", {
    actor: actor.id,
    action,
    entityType: entity.collection().name,
    entityId: entity.id,
    reason: reason || "",
    requestId: requestId || "",
    safeDiff,
  });
}
function now() {
  return new Date().toISOString();
}
module.exports = {
  all,
  maybe,
  get,
  create,
  json,
  pick,
  actor,
  command,
  audit,
  now,
};
