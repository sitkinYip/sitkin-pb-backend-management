const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);

function references(app, questionId = "") {
  const sessions = {};
  for (const session of db.all(app, "game_sessions"))
    sessions[session.id] = db.pick(session, ["title", "revision", "status"]);
  const result = {};
  for (const step of db.all(
    app,
    "game_session_levels",
    questionId ? "question={:id}" : "",
    questionId ? { id: questionId } : {},
  )) {
    const id = step.getString("question");
    if (!result[id]) result[id] = {};
    const session = sessions[step.getString("session")];
    if (session) result[id][session.id] = session;
  }
  return result;
}

function usage(question, map) {
  const refs = Object.values(map[question.id] || {});
  const online = refs.filter((s) => s.status === "published");
  const drafts = refs.filter((s) => s.status === "draft");
  const deleted = question.getString("status") === "archived";
  return {
    online,
    drafts,
    historyCount: refs.filter((s) => s.status === "archived").length,
    canEdit: !deleted && online.length === 0,
    canDelete: !deleted && online.length === 0 && drafts.length === 0,
  };
}

function requireEditable(app, question, deleting = false) {
  if (question.getString("status") === "archived")
    r.fail("QUESTION_DELETED", "题目已移出题库，不能修改；可复制为新题", 409);
  const result = usage(question, references(app, question.id));
  const blockers = deleting
    ? result.online.concat(result.drafts)
    : result.online;
  if (blockers.length) {
    const names = blockers
      .slice(0, 3)
      .map((s) => `${s.title}（v${s.revision}）`)
      .join("、");
    r.fail(
      "QUESTION_IN_USE",
      `题目被${names}${blockers.length > 3 ? "等场次" : ""}引用；${deleting ? "请先下线线上场次并解除草稿引用，再删除" : "请先下线所有引用它的线上场次，再修改"}`,
      409,
    );
  }
  return result;
}

function narrativeReferences(app, narrativeId) {
  const sessions = {},
    refs = {};
  for (const row of db.all(app, "game_sessions")) {
    const session = db.pick(row, ["title", "revision", "status"]);
    sessions[row.id] = session;
    const target = db.json(row, "completionTarget");
    if (target && target.kind === "narrative" && target.id === narrativeId)
      refs[row.id] = session;
  }
  for (const clue of db.all(app, "game_clues", "narrative={:id}", {
    id: narrativeId,
  })) {
    const session = sessions[clue.getString("session")];
    if (session) refs[session.id] = session;
  }
  return Object.values(refs);
}

function requireNarrativeDeletable(app, narrative) {
  const refs = narrativeReferences(app, narrative.id);
  const blockers = refs.filter((s) => s.status !== "archived");
  if (blockers.length) {
    const names = blockers
      .slice(0, 3)
      .map(
        (s) =>
          `${s.title}（v${s.revision}，${s.status === "published" ? "线上" : "草稿"}）`,
      )
      .join("、");
    r.fail(
      "NARRATIVE_IN_USE",
      `内容被${names}${blockers.length > 3 ? "等场次" : ""}引用；请先下线线上场次，并替换或移除草稿引用（也可作废草稿），再删除`,
      409,
    );
  }
  return refs;
}

function requireNarrativeAvailable(app, id, publishing = false) {
  const row = db.get(app, "game_narratives", id);
  if (row.getString("status") === "archived")
    r.fail(
      "NARRATIVE_DELETED",
      `“${row.getString("title")}”（v${row.getInt("revision")}）已移出内容库，请替换或移除引用；如需沿用内容，请先复制为新版本`,
      409,
    );
  if (publishing && row.getString("status") !== "published")
    r.fail(
      "INVALID_INPUT",
      `请先发布关联内容“${row.getString("title")}”（v${row.getInt("revision")}）`,
    );
  return row;
}

function assignmentCounts(app) {
  const result = {};
  for (const row of db.all(app, "game_assignments")) {
    const id = row.getString("session");
    if (!result[id]) result[id] = emptyCounts();
    result[id].total++;
    result[id][row.getString("status")]++;
  }
  return result;
}
function emptyCounts() {
  return { total: 0, assigned: 0, active: 0, completed: 0, cancelled: 0 };
}

module.exports = {
  references,
  usage,
  requireEditable,
  narrativeReferences,
  requireNarrativeDeletable,
  requireNarrativeAvailable,
  assignmentCounts,
  emptyCounts,
};
