const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);

const scope = "personal_journey_v1";
const table = "game_push_journey_subscriptions";
const deliveryTable = "game_push_journey_deliveries";
const approved = () => $os.getenv("STARWARD_PUSH_SUBSCRIPTION_APPROVED") === "1";
const record = (app, playerId) => db.maybe(app, table, "player={:p} && scope={:s}", { p: playerId, s: scope });

function dto(row) {
  return {
    scope, subscribed: row ? row.getBool("subscribed") : false,
    pushEnabled: row ? row.getBool("pushEnabled") : false,
    revision: row ? row.getInt("revision") : 0, subscriptionApproved: approved(),
  };
}
function read(e) { return dto(record(e.app, db.actor(e.app, e).id)); }
function isJourney(app, job) {
  if (job.getString("kind") === "assignment") return true;
  const receipt = db.maybe(app, "game_notification_receipts", "id={:id}", { id: job.getString("targetId") });
  return Boolean(receipt && db.maybe(app, "game_push_notice_contexts", "notification={:n}",
    { n: receipt.getString("notification") }));
}
function discard(app, playerId) {
  for (const job of db.all(app, "game_push_deliveries",
      "binding.player={:p} && (status='pending' || status='sending')", { p: playerId }, "id")) {
    if (!isJourney(app, job)) continue;
    job.set("status", "discarded"); job.set("lease", ""); app.save(job);
  }
}
function save(e, body) {
  const fields = ["requestId", "scope", "subscribed", "pushEnabled", "expectedRevision"];
  if (Object.keys(body).length !== fields.length || !fields.every((key) => Object.hasOwn(body, key)) ||
      body.scope !== scope || typeof body.subscribed !== "boolean" || typeof body.pushEnabled !== "boolean" ||
      (body.pushEnabled && !body.subscribed) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)
    r.fail("INVALID_INPUT", "旅途订阅参数不正确");
  return db.command(e, "push-journey-subscription", body, false, (app, player) => {
    let row = record(app, player.id);
    const before = dto(row);
    if (before.revision !== body.expectedRevision)
      r.fail("PUSH_JOURNEY_SUBSCRIPTION_CONFLICT", "旅途订阅已更新，请重新读取后再试", 409);
    if (body.pushEnabled && !before.subscribed)
      r.fail("PUSH_JOURNEY_SUBSCRIPTION_CONFIRMATION_REQUIRED", "请先订阅旅途动态，再单独确认接收通知", 409);
    if (row && before.subscribed === body.subscribed && before.pushEnabled === body.pushEnabled) return before;
    const next = { subscribed: body.subscribed, pushEnabled: body.pushEnabled, revision: before.revision + 1 };
    if (!row) row = db.create(app, table, { player: player.id, scope, ...next });
    else { for (const key of Object.keys(next)) row.set(key, next[key]); app.save(row); }
    // Old per-scene queues and earlier account-consent incarnations never revive.
    discard(app, player.id);
    return dto(row);
  });
}
function eligibility(app, playerId) {
  if (!approved()) return null;
  const subscription = record(app, playerId);
  if (!subscription || !subscription.getBool("subscribed") || !subscription.getBool("pushEnabled")) return null;
  return { category: "SUBSCRIPTION", subscription };
}
function attach(app, delivery, eligible) {
  if (!eligible.subscription) return;
  db.create(app, deliveryTable, {
    delivery: delivery.id, subscription: eligible.subscription.id, scope,
    revision: eligible.subscription.getInt("revision"), category: eligible.category,
  });
}
function delivery(app, job, playerId) {
  const meta = db.maybe(app, deliveryTable, "delivery={:id} && scope={:s}", { id: job.id, s: scope });
  const current = eligibility(app, playerId);
  if (!meta || !current || current.subscription.id !== meta.getString("subscription") ||
      current.subscription.getInt("revision") !== meta.getInt("revision")) return null;
  const category = meta.getString("category");
  if (category !== "SUBSCRIPTION" || !approved()) return null;
  return { category, subscribed: true };
}

module.exports = { scope, approved, read, save, eligibility, attach, delivery };
