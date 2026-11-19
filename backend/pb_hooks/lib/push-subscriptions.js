const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const game = require(`${__hooks}/lib/gameplay.js`);

const table = "game_push_subscriptions";
const contexts = "game_push_notice_contexts";
const deliveryContexts = "game_push_notice_deliveries";
const approved = () => $os.getenv("STARWARD_PUSH_SUBSCRIPTION_APPROVED") === "1";

function record(app, assignmentId, playerId) {
  return db.maybe(app, table, "assignment={:a} && player={:p}", { a: assignmentId, p: playerId });
}
function dto(assignmentId, row) {
  return {
    assignmentId, subscribed: row ? row.getBool("subscribed") : false,
    pushEnabled: row ? row.getBool("pushEnabled") : false,
    revision: row ? row.getInt("revision") : 0,
  };
}
function read(e, id) {
  const player = db.actor(e.app, e);
  const assignment = game.assignment(e.app, id, player.id);
  return dto(id, record(e.app, assignment.id, player.id));
}
function list(e) {
  const player = db.actor(e.app, e);
  return {
    items: db.all(e.app, table, "player={:p}", { p: player.id }, "id").map((row) => {
      // A damaged historical relation must not hide every other subscription.
      // Never expose another player's assignment even if a private row is corrupt.
      const assignment = db.maybe(e.app, "game_assignments", "id={:id} && player={:p}",
        { id: row.getString("assignment"), p: player.id });
      if (!assignment) return null;
      const session = db.maybe(e.app, "game_sessions", "id={:id}", { id: assignment.getString("session") });
      if (!session) return null;
      return { ...dto(assignment.id, row), title: session.getString("title") };
    }).filter(Boolean),
    subscriptionApproved: approved(),
  };
}
function available(app, assignment, time) {
  const session = db.get(app, "game_sessions", assignment.getString("session"));
  if (session.getString("status") !== "published") return false;
  return assignment.getString("status") !== "cancelled" &&
    (!assignment.getString("endsAt") || Date.parse(assignment.getString("endsAt")) > time);
}
function discard(app, subscriptionId) {
  for (const meta of db.all(app, deliveryContexts,
      "subscription={:id} && (delivery.status='pending' || delivery.status='sending')",
      { id: subscriptionId }, "id")) {
    const job = db.maybe(app, "game_push_deliveries", "id={:id}", { id: meta.getString("delivery") });
    if (job) { job.set("status", "discarded"); job.set("lease", ""); app.save(job); }
  }
}
function save(e, id, body) {
  const names = ["requestId", "subscribed", "pushEnabled", "expectedRevision"];
  if (Object.keys(body).length !== names.length || !names.every((name) => Object.hasOwn(body, name)) ||
      typeof body.subscribed !== "boolean" || typeof body.pushEnabled !== "boolean" ||
      (body.pushEnabled && !body.subscribed) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    r.fail("INVALID_INPUT", "场次订阅参数不正确");
  return db.command(e, "push-subscription:" + id, body, false, (app, player) => {
    const assignment = game.assignment(app, id, player.id);
    let row = record(app, id, player.id);
    const before = dto(id, row);
    if (before.revision !== body.expectedRevision)
      r.fail("PUSH_SUBSCRIPTION_CONFLICT", "场次订阅已更新，请重新加载后再试", 409);
    if (body.subscribed && (!before.subscribed || body.pushEnabled)) {
      game.onlineSession(app, assignment);
      if (assignment.getString("status") === "cancelled")
        r.fail("ASSIGNMENT_CANCELLED", "本次场次已撤回", 409);
      if (assignment.getString("endsAt") && Date.parse(assignment.getString("endsAt")) <= Date.now())
        r.fail("EXPIRED", "本次场次已结束", 409);
    }
    if (body.pushEnabled && !before.subscribed)
      r.fail("PUSH_SUBSCRIPTION_CONFIRMATION_REQUIRED", "请先订阅此场次，再单独确认接收订阅通知", 409);
    if (before.subscribed === body.subscribed && before.pushEnabled === body.pushEnabled) return before;
    const next = { subscribed: body.subscribed, pushEnabled: body.pushEnabled, revision: before.revision + 1 };
    if (!row) row = db.create(app, table, { player: player.id, assignment: id, ...next });
    else { for (const key of Object.keys(next)) row.set(key, next[key]); app.save(row); }
    // Any preference transition retires pending jobs from the previous consent version.
    discard(app, row.id);
    return dto(id, row);
  }, (app, player) => { game.assignment(app, id, player.id); });
}
function noticeContext(app, notificationId) {
  return db.maybe(app, contexts, "notification={:id}", { id: notificationId });
}
function noticePurpose(app, notificationId) {
  return noticeContext(app, notificationId) ? "journey" : "announcement";
}
function notice(app, notification, sessionId) {
  db.create(app, contexts, { notification: notification.id, session: sessionId });
}
function eligibility(app, playerId, receipt, time) {
  const context = noticeContext(app, receipt.getString("notification"));
  if (!context) return { category: "MARKETING" };
  const assignment = db.maybe(app, "game_assignments",
    "id={:a} && player={:p} && session={:s}",
    { a: receipt.getString("assignment"), p: playerId, s: context.getString("session") });
  if (!assignment || !available(app, assignment, time)) return null;
  const subscription = record(app, assignment.id, playerId);
  if (!subscription || !subscription.getBool("subscribed") || !subscription.getBool("pushEnabled")) return null;
  return { category: approved() ? "SUBSCRIPTION" : "MARKETING", subscription };
}
function attach(app, delivery, eligibility) {
  if (!eligibility.subscription) return;
  db.create(app, deliveryContexts, {
    delivery: delivery.id, subscription: eligibility.subscription.id,
    revision: eligibility.subscription.getInt("revision"), category: eligibility.category,
  });
}
function delivery(app, row, playerId, time) {
  const meta = db.maybe(app, deliveryContexts, "delivery={:id}", { id: row.id });
  const receipt = db.maybe(app, "game_notification_receipts", "id={:id} && player={:p}",
    { id: row.getString("targetId"), p: playerId });
  if (!receipt) return null;
  if (!meta) return noticeContext(app, receipt.getString("notification")) ? null : { category: "MARKETING" };
  const current = eligibility(app, playerId, receipt, time);
  if (!current || !current.subscription || current.subscription.id !== meta.getString("subscription") ||
      current.subscription.getInt("revision") !== meta.getInt("revision")) return null;
  const category = meta.getString("category");
  if (category !== "MARKETING" && category !== "SUBSCRIPTION") return null;
  if (category === "SUBSCRIPTION" && !approved()) return null;
  return { category, subscribed: true };
}

module.exports = { approved, read, list, save, notice, noticePurpose, eligibility, attach, delivery };
