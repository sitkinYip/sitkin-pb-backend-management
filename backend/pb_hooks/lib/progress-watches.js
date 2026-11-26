const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const pushSettings = require(`${__hooks}/lib/push-settings.js`);

const watches = "game_progress_watches";
const deliveries = "game_progress_deliveries";
const eventKinds = ["correct", "incorrect", "completed"];
const approved = () => $os.getenv("STARWARD_PUSH_PROGRESS_APPROVED") === "1";
const pushAvailable = (app, playerId) => approved() && pushSettings.enabled() && pushSettings.permitted(app, playerId);
const date = (ms) => new Date(ms).toISOString().replace("T", " ");
const isActive = (player) => player && player.getString("status") === "active";

function fields(body, expected) {
  if (Object.keys(body).length !== expected.length || !expected.every((name) => Object.hasOwn(body, name)))
    r.fail("INVALID_INPUT", "进度订阅参数不正确");
}

function scene(app, assignmentId) {
  const assignment = db.maybe(app, "game_assignments", "id={:id} && status!='cancelled'", { id: assignmentId });
  if (!assignment) return null;
  const player = db.maybe(app, "game_players", "id={:id}", { id: assignment.getString("player") });
  const session = db.maybe(app, "game_sessions", "id={:id} && status='published'",
    { id: assignment.getString("session") });
  return session && isActive(player) ? { assignment, player, session } : null;
}

function active(watch, now) {
  return watch && !watch.getBool("revoked") && Date.parse(watch.getString("expiresAt")) > now;
}

function authorized(app, watcherId, id, time = Date.now()) {
  const watch = db.maybe(app, watches, "id={:id} && watcher={:watcher}", { id, watcher: watcherId });
  const watchedScene = active(watch, time) ? scene(app, watch.getString("assignment")) : null;
  if (!watchedScene) return null;
  return { watch, ...watchedScene };
}

function summary({ watch, assignment, player, session }) {
  return {
    id: watch.id, assignmentId: assignment.id,
    playerName: player.getString("displayName") || "玩家",
    title: session.getString("title"), expiresAt: new Date(watch.getString("expiresAt")).toISOString(),
    status: assignment.getString("status"), subscribed: watch.getBool("subscribed"),
    pushEnabled: watch.getBool("pushEnabled"), eventKinds: db.json(watch, "eventKinds", []),
    revision: watch.getInt("revision"),
  };
}

function list(e) {
  const watcher = db.actor(e.app, e);
  const items = [];
  for (const watch of db.all(e.app, watches, "watcher={:id} && revoked=false && expiresAt>{:now}",
      { id: watcher.id, now: date(Date.now()) }, "expiresAt,id")) {
    const watchedScene = scene(e.app, watch.getString("assignment"));
    if (watchedScene) items.push(summary({ watch, ...watchedScene }));
  }
  return { items };
}

function requireWatch(app, watcher, id) {
  const context = authorized(app, watcher.id, id);
  if (!context) r.fail("PROGRESS_WATCH_UNAVAILABLE", "该场次的进度授权已失效", 404);
  return context;
}

function detail(app, context) {
  const { watch, assignment, session } = context;
  const levels = db.all(app, "game_session_levels", "session={:id}", { id: session.id }, "position");
  const positions = new Map(levels.map((level) => [level.id, level.getInt("position")]));
  const solved = new Set(db.all(app, "game_level_progress", "assignment={:id} && completedAt!=''",
    { id: assignment.id }).map((row) => row.getString("sessionLevel")));
  const current = assignment.getString("status") === "active" ? levels.find((level) => !solved.has(level.id)) : null;
  const recent = app.findRecordsByFilter("game_answer_submissions",
    "assignment={:id} && (result='correct' || result='incorrect')", "-submittedAt,-id", 20, 0,
    { id: assignment.id }).map((row) => ({ id: row.id, position: positions.get(row.getString("sessionLevel")),
    result: row.getString("result"), submittedAt: new Date(row.getString("submittedAt")).toISOString() }));
  const completedAt = assignment.getString("completedAt");
  return { watch: summary(context), pushAvailable: pushAvailable(app, watch.getString("watcher")),
    solved: solved.size, total: levels.length, currentPosition: current ? current.getInt("position") : 0,
    completedAt: completedAt ? new Date(completedAt).toISOString() : "", recent };
}

function read(e, id) {
  return detail(e.app, requireWatch(e.app, db.actor(e.app, e), id));
}

function discard(app, id) {
  app.db().newQuery(`UPDATE ${deliveries} SET status='discarded', lease=''
    WHERE watch={:id} AND status IN ('pending', 'sending')`).bind({ id }).execute();
}

function save(e, id, body) {
  fields(body, ["requestId", "expectedRevision", "subscribed", "pushEnabled", "eventKinds"]);
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1 ||
      typeof body.subscribed !== "boolean" || typeof body.pushEnabled !== "boolean" ||
      !Array.isArray(body.eventKinds) || body.eventKinds.length > eventKinds.length ||
      new Set(body.eventKinds).size !== body.eventKinds.length || !body.eventKinds.every((kind) => eventKinds.includes(kind)) ||
      (body.subscribed ? body.eventKinds.length === 0 : body.pushEnabled || body.eventKinds.length !== 0))
    r.fail("INVALID_INPUT", "请选择要订阅的答题事件");
  const selection = eventKinds.filter((kind) => body.eventKinds.includes(kind));
  db.command(e, `progress-watch:${id}`, body, false, (app, watcher) => {
    const { watch } = requireWatch(app, watcher, id);
    if (body.expectedRevision !== watch.getInt("revision"))
      r.fail("PROGRESS_WATCH_CONFLICT", "进度订阅已更新，请刷新后再保存", 409);
    const currentKinds = JSON.stringify(db.json(watch, "eventKinds", []));
    if (body.pushEnabled && !watch.getBool("pushEnabled") &&
        (!watch.getBool("subscribed") || currentKinds !== JSON.stringify(selection)))
      r.fail("PROGRESS_WATCH_CONFIRMATION_REQUIRED", "请先保存订阅，再单独开启通知", 409);
    if (body.pushEnabled && !watch.getBool("pushEnabled") && !pushAvailable(app, watcher.id))
      r.fail("PROGRESS_PUSH_UNAVAILABLE", "场次进度通知暂未启用", 409);
    if (watch.getBool("subscribed") === body.subscribed && watch.getBool("pushEnabled") === body.pushEnabled &&
        currentKinds === JSON.stringify(selection)) return { id };
    watch.set("subscribed", body.subscribed);
    watch.set("pushEnabled", body.pushEnabled);
    watch.set("eventKinds", selection);
    watch.set("revision", watch.getInt("revision") + 1);
    app.save(watch);
    discard(app, id);
    return { id };
  }, (app, watcher) => requireWatch(app, watcher, id));
  return read(e, id);
}

function adminView(app, watch) {
  const assignment = db.get(app, "game_assignments", watch.getString("assignment"));
  const session = db.get(app, "game_sessions", assignment.getString("session"));
  return { ...db.pick(watch, ["watcher", "assignment", "revoked", "revision", "subscribed", "pushEnabled"]),
    player: assignment.getString("player"), title: session.getString("title"),
    expiresAt: new Date(watch.getString("expiresAt")).toISOString() };
}

function adminList(app) {
  return { items: db.all(app, watches, "", {}, "-expiresAt,id").map((watch) => adminView(app, watch)) };
}

function adminSave(e, body) {
  fields(body, ["requestId", "watcher", "assignment", "expiresAt", "revoked", "expectedRevision", "reason"]);
  const watcherId = r.text(body.watcher, "接收提醒的账号", 30);
  const assignmentId = r.text(body.assignment, "场次", 30);
  const reason = r.text(body.reason, "变更原因", 200);
  const expiresAt = r.date(body.expiresAt, "授权截止时间");
  if (typeof body.revoked !== "boolean" || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
      !expiresAt || (!body.revoked && Date.parse(expiresAt) <= Date.now()))
    r.fail("INVALID_INPUT", "请选择未来的授权截止时间");
  const result = db.command(e, "save-progress-watch", body, true, (app, actor) => {
    let watch = db.maybe(app, watches, "watcher={:watcher} && assignment={:assignment}",
      { watcher: watcherId, assignment: assignmentId });
    const revision = watch ? watch.getInt("revision") : 0;
    if (body.expectedRevision !== revision)
      r.fail("PROGRESS_WATCH_CONFLICT", "授权或订阅已更新，请刷新后重试", 409);
    if (body.revoked) {
      if (!watch) r.fail("NOT_FOUND", "授权不存在", 404);
      if (watch.getBool("revoked")) return { id: watch.id };
    } else {
      const watcher = db.get(app, "game_players", watcherId);
      const watchedScene = scene(app, assignmentId);
      if (!isActive(watcher) || !watchedScene || watchedScene.player.id === watcherId)
        r.fail("INVALID_INPUT", "请选择有效的提醒账号及另一位玩家的已发布场次");
      if (watch && !watch.getBool("revoked") && Date.parse(watch.getString("expiresAt")) === Date.parse(expiresAt))
        return { id: watch.id };
    }
    const next = { expiresAt: body.revoked ? watch.getString("expiresAt") : expiresAt, revoked: body.revoked,
      subscribed: false, pushEnabled: false, eventKinds: [], revision: revision + 1 };
    if (watch) {
      for (const key of Object.keys(next)) watch.set(key, next[key]);
      app.save(watch);
      discard(app, watch.id);
    } else watch = db.create(app, watches, { watcher: watcherId, assignment: assignmentId, ...next });
    db.audit(app, actor, body.revoked ? "revoke_progress_watch" : "authorize_progress_watch", watch, reason,
      body.requestId, { watcher: watcherId, assignment: assignmentId, expiresAt: next.expiresAt, revision: next.revision });
    return { id: watch.id };
  });
  return adminView(e.app, db.get(e.app, watches, result.id));
}

function recipients(app, assignment, submission, completed, time) {
  const result = submission.getString("result");
  const eligible = db.all(app, watches,
    "assignment={:id} && revoked=false && subscribed=true && pushEnabled=true && expiresAt>{:now}",
    { id: assignment.id, now: date(time) }, "id");
  const recipients = [];
  for (const watch of eligible) {
    const kinds = db.json(watch, "eventKinds", []);
    const outcome = completed && kinds.includes("completed") ? "completed" : result;
    const watcherId = watch.getString("watcher");
    if (!kinds.includes(outcome) || !pushAvailable(app, watcherId)) continue;
    const watcher = db.maybe(app, "game_players", "id={:id}", { id: watcherId });
    if (isActive(watcher) && !watcher.getBool("mustChangePassword")) recipients.push({ watch, watcher, outcome });
  }
  return recipients;
}

function delivery(app, job, playerId, time) {
  if (!pushAvailable(app, playerId)) return null;
  const source = authorized(app, playerId, job.getString("watch"), time);
  if (!source || !source.watch.getBool("subscribed") || !source.watch.getBool("pushEnabled") ||
      source.watch.getInt("revision") !== job.getInt("revision")) return null;
  const outcome = job.getString("outcome");
  if (!db.json(source.watch, "eventKinds", []).includes(outcome)) return null;
  const answer = db.maybe(app, "game_answer_submissions", "id={:id} && assignment={:assignment}",
    { id: job.getString("submission"), assignment: source.assignment.id });
  if (!answer) return null;
  const level = db.maybe(app, "game_session_levels", "id={:id} && session={:session}",
    { id: answer.getString("sessionLevel"), session: source.session.id });
  if (!level || (outcome === "completed" ? answer.getString("result") !== "correct" ||
    source.assignment.getString("status") !== "completed" : answer.getString("result") !== outcome)) return null;
  const body = outcome === "completed" ? "场次已通关，打开查看进度。" :
    `第 ${level.getInt("position")} 关${outcome === "correct" ? "答对" : "答错"}，打开查看进度。`;
  return { kind: "progress", targetId: source.watch.id, title: `进度订阅 · ${source.session.getString("title")}`,
    body, category: "SUBSCRIPTION", subscribed: true };
}

module.exports = { deliveries, approved, list, read, save, adminList, adminSave, recipients, delivery };
