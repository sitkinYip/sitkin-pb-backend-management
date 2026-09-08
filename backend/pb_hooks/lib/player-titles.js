const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const v = require(`${__hooks}/lib/extra-validation.js`);
function available(app) {
  try {
    app.findCollectionByNameOrId("game_player_level_titles");
    return true;
  } catch (_) {
    return false;
  }
}
function rows(app, playerId) {
  return available(app)
    ? db.all(
        app,
        "game_player_level_titles",
        playerId ? "player={:player}" : "",
        playerId ? { player: playerId } : {},
      )
    : [];
}
function rank(level, titles, playerId) {
  if (!level) return null;
  const title = titles.find(
    (row) =>
      row.getString("player") === playerId &&
      row.getString("level") === level.id &&
      row.getString("status") === "active",
  );
  return {
    ...level,
    defaultName: level.name,
    customTitle: title ? title.getString("name") : null,
    name: title ? title.getString("name") : level.name,
  };
}
function list(app, playerId) {
  db.get(app, "game_players", playerId);
  return {
    items: rows(app, playerId).map((row) =>
      db.pick(row, [
        "player",
        "level",
        "name",
        "status",
        "revision",
        "updated",
      ]),
    ),
  };
}
function save(e, playerId, body) {
  return db.command(e, `player-title:${playerId}`, body, true, (app, actor) => {
    if (!available(app))
      r.fail("BACKEND_NOT_READY", "专属头衔尚未完成迁移", 409);
    v.only(
      body,
      ["requestId", "levelId", "name", "action", "expectedRevision", "reason"],
      "头衔配置",
    );
    db.get(app, "game_players", playerId);
    db.get(app, "game_level_definitions", body.levelId);
    const reason = r.text(body.reason, "操作原因", 1000);
    if (!["save", "revoke"].includes(body.action))
      r.fail("INVALID_INPUT", "未知头衔操作");
    let row = db.maybe(
      app,
      "game_player_level_titles",
      "player={:p} && level={:l}",
      { p: playerId, l: body.levelId },
    );
    const revision = row ? row.getInt("revision") : 0;
    if (r.integer(body.expectedRevision, "版本") !== revision)
      r.fail("EDIT_CONFLICT", "头衔已被修改，请刷新后重试", 409);
    if (!row && body.action === "revoke")
      r.fail("NOT_FOUND", "没有可撤销的专属头衔", 404);
    const before = row ? db.pick(row, ["name", "status", "revision"]) : null;
    const fields = {
      player: playerId,
      level: body.levelId,
      name:
        body.action === "save"
          ? r.text(body.name, "专属名称", 60)
          : row.getString("name"),
      status: body.action === "save" ? "active" : "revoked",
      revision: revision + 1,
    };
    if (row) {
      for (const k of Object.keys(fields)) row.set(k, fields[k]);
      app.save(row);
    } else
      row = db.create(app, "game_player_level_titles", {
        ...fields,
        extra: {},
      });
    db.audit(
      app,
      actor,
      body.action === "save" ? "save_player_title" : "revoke_player_title",
      row,
      reason,
      body.requestId,
      { before, after: fields },
    );
    return { id: row.id, revision: revision + 1 };
  });
}
module.exports = { available, rows, rank, list, save };
