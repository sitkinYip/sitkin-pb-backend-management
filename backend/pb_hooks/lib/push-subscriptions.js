const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const game = require(`${__hooks}/lib/gameplay.js`);
const journey = require(`${__hooks}/lib/push-journey-subscription.js`);

const contexts = "game_push_notice_contexts";
function scopeChanged() {
  r.fail("PUSH_SUBSCRIPTION_SCOPE_CHANGED", "订阅范围已更新，请使用新版在设置中管理旅途订阅", 409);
}
// Historical per-assignment rows remain private audit data, never wider consent.
function read(e, id) { game.assignment(e.app, id, db.actor(e.app, e).id); scopeChanged(); }
function list(e) { db.actor(e.app, e); scopeChanged(); }
function save(e, id) { game.assignment(e.app, id, db.actor(e.app, e).id); scopeChanged(); }
function noticeContext(app, notificationId) {
  return db.maybe(app, contexts, "notification={:id}", { id: notificationId });
}
function noticePurpose(app, notificationId) {
  const context = noticeContext(app, notificationId);
  if (!context) return "announcement";
  const kind = validKind(context);
  if (kind === "session") return "journey";
  if (kind === "account") return "personal_journey";
  return "unknown";
}
function validKind(context) {
  const kind = context.getString("kind"), session = context.getString("session");
  if (kind === "session" && session) return kind;
  if (kind === "account" && !session) return kind;
  return "";
}
function notice(app, notification, kind, sessionId = "") {
  if (!((kind === "session" && sessionId) || (kind === "account" && !sessionId)))
    r.fail("INVALID_INPUT", "旅途消息上下文不正确");
  db.create(app, contexts, { notification: notification.id, kind, session: sessionId });
}
function available(app, assignment, time) {
  const session = db.get(app, "game_sessions", assignment.getString("session"));
  return session.getString("status") === "published" && assignment.getString("status") !== "cancelled" &&
    (!assignment.getString("endsAt") || Date.parse(assignment.getString("endsAt")) > time);
}
function eligibility(app, playerId, receipt, time) {
  if (receipt.getString("player") !== playerId) return null;
  const context = noticeContext(app, receipt.getString("notification"));
  if (!context) return receipt.getString("assignment") ? null : { category: "MARKETING" };
  const kind = validKind(context);
  if (!kind) return null;
  if (kind === "account") return receipt.getString("assignment") ? null : journey.eligibility(app, playerId);
  const assignment = db.maybe(app, "game_assignments", "id={:a} && player={:p} && session={:s}",
    { a: receipt.getString("assignment"), p: playerId, s: context.getString("session") });
  return assignment && available(app, assignment, time) ? journey.eligibility(app, playerId) : null;
}
function delivery(app, row, playerId, time) {
  const receipt = db.maybe(app, "game_notification_receipts", "id={:id} && player={:p}",
    { id: row.getString("targetId"), p: playerId });
  if (!receipt) return null;
  if (!noticeContext(app, receipt.getString("notification"))) {
    // Missing private metadata must not reclassify an already subscribed event as marketing.
    if (receipt.getString("assignment") ||
        db.maybe(app, "game_push_journey_deliveries", "delivery={:id}", { id: row.id }) ||
        db.maybe(app, "game_push_notice_deliveries", "delivery={:id}", { id: row.id })) return null;
    return { category: "MARKETING" };
  }
  if (!eligibility(app, playerId, receipt, time)) return null;
  return journey.delivery(app, row, playerId);
}
module.exports = { approved: journey.approved, read, list, save, notice, noticePurpose, eligibility,
  attach: journey.attach, delivery };
