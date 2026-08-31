const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);

const DEFAULT_GROUP = "其他";
const EXACT = "exact";
const CONTAINS_ALL = "contains_all";

function available(app) {
  try {
    app.findCollectionByNameOrId("game_question_settings");
    return true;
  } catch (_) {
    return false;
  }
}

function read(app, questionId) {
  if (!available(app))
    return {
      row: null,
      answerMatchMode: EXACT,
      groupName: DEFAULT_GROUP,
    };
  const row = db.maybe(app, "game_question_settings", "question={:id}", {
    id: questionId,
  });
  return {
    row,
    answerMatchMode: row ? row.getString("answerMatchMode") : EXACT,
    groupName: row ? row.getString("groupName") || DEFAULT_GROUP : DEFAULT_GROUP,
  };
}

function upsert(app, questionId, value) {
  if (!available(app)) {
    if (value.answerMatchMode === EXACT && value.groupName === DEFAULT_GROUP)
      return null;
    r.fail("BACKEND_NOT_READY", "题目设置尚未完成迁移", 409);
  }
  const current = read(app, questionId);
  if (current.row) {
    current.row.set("answerMatchMode", value.answerMatchMode);
    current.row.set("groupName", value.groupName);
    app.save(current.row);
    return current.row;
  }
  return db.create(app, "game_question_settings", {
    question: questionId,
    answerMatchMode: value.answerMatchMode,
    groupName: value.groupName,
  });
}

module.exports = {
  DEFAULT_GROUP,
  EXACT,
  CONTAINS_ALL,
  read,
  upsert,
};
