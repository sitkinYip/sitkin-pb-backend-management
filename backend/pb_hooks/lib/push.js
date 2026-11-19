const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const { enabled, testMode, permitted } = require(`${__hooks}/lib/push-settings.js`);
const subscriptions = require(`${__hooks}/lib/push-subscriptions.js`);
const journeySubscription = require(`${__hooks}/lib/push-journey-subscription.js`);

const bindings = "game_push_bindings";
const deliveries = "game_push_deliveries";
const bindingTTL = 30 * 86400000;
const deliveryTTL = 10 * 60000;
const leaseTime = 90 * 1000;
const maxAttempts = 3;
const date = (ms) => new Date(ms).toISOString().replace("T", " ");
const now = () => date(Date.now());

function expectFields(body, names) {
  if (Object.keys(body).length !== names.length ||
      !names.every((name) => Object.hasOwn(body, name)))
    r.fail("INVALID_INPUT", "通知设置参数不正确");
}
function installation(value, max = 80) {
  if (typeof value !== "string" || value.length < 16 || value.length > max ||
      /[^a-zA-Z0-9_-]/.test(value))
    r.fail("INVALID_INPUT", "通知设备标识无效");
  return value;
}
function accountKey(player) {
  return $security.sha256(player.getString("tokenKey"));
}

function register(e, body) {
  expectFields(body, ["installationId", "token", "profileId"]);
  const installationId = installation(body.installationId);
  const profileId = installation(body.profileId, 64);
  const token = body.token;
  if (typeof token !== "string" || token.length < 16 || token.length > 4096 ||
      /[^!-~]/.test(token))
    r.fail("INVALID_INPUT", "通知令牌无效");
  let receipt;
  e.app.runInTransaction((app) => {
    const player = db.actor(app, e);
    if (!enabled() || !permitted(app, player.id)) {
      receipt = { registered: false };
      return;
    }
    const key = accountKey(player);
    const existing = db.all(app, bindings,
      "installationId={:i} || token={:t} || profileId={:p}",
      { i: installationId, t: token, p: profileId }, "id");
    // The same account/profile keeps its revocation ticket even when the
    // provider token rotates or the response is lost. A different account or
    // profile always gets a new binding incarnation and ticket.
    let row = existing.find((record) =>
      record.getString("installationId") === installationId &&
      record.getString("profileId") === profileId &&
      record.getString("player") === player.id);
    const expiresAt = date(Date.now() + bindingTTL);
    for (const record of existing) {
      if (row && record.id === row.id) continue;
      // The anonymous profile ID must not relocate a different installation.
      if (record.getString("profileId") === profileId &&
          record.getString("installationId") !== installationId &&
          record.getString("token") !== token)
        r.fail("PUSH_PROFILE_CONFLICT", "通知设备标识已使用", 409);
      app.delete(record);
    }
    if (row) {
      if (row.getString("accountKey") !== key ||
          Date.parse(row.getString("expiresAt")) <= Date.now()) {
        for (const job of db.all(app, deliveries, "binding={:id}", { id: row.id }))
          app.delete(job);
        row.set("accountKey", key);
      }
      row.set("token", token);
      row.set("expiresAt", expiresAt);
      app.save(row);
    } else {
      if (app.findRecordsByFilter(bindings,
          "player={:p} && expiresAt>{:now}", "id", 20, 0,
          { p: player.id, now: now() }).length >= 20)
        r.fail("PUSH_BINDING_LIMIT", "已达到通知设备数量上限", 409);
      row = db.create(app, bindings, {
        player: player.id, accountKey: key, installationId, profileId, token,
        expiresAt, revokeTicket: $security.randomString(48),
      });
    }
    receipt = { registered: true, revokeTicket: row.getString("revokeTicket") };
  });
  return receipt;
}

function unregister(e, body) {
  expectFields(body, ["installationId"]);
  const id = installation(body.installationId);
  e.app.runInTransaction((app) => {
    const player = db.actor(app, e, false, true);
    const row = db.maybe(app, bindings, "installationId={:id} && player={:p}",
      { id, p: player.id });
    if (row) app.delete(row);
  });
  return { registered: false };
}

function revoke(e, body) {
  expectFields(body, ["installationId", "revokeTicket"]);
  const id = installation(body.installationId);
  const ticket = body.revokeTicket;
  if (typeof ticket !== "string" || !/^[a-zA-Z0-9]{48}$/.test(ticket))
    r.fail("INVALID_INPUT", "通知解绑凭据无效");
  e.app.runInTransaction((app) => {
    const row = db.maybe(app, bindings, "installationId={:id}", { id });
    if (row && $security.equal(row.getString("revokeTicket"), ticket))
      app.delete(row);
  });
  return { registered: false };
}

// Called inside the existing business transaction. A replay returns the
// existing command receipt before this runs; no event for skipped recipients.
function enqueue(app, player, kind, target, businessEndsAt = "") {
  if (!enabled() || !permitted(app, player.id) || player.getBool("mustChangePassword")) return;
  const time = Date.now();
  const deadline = businessEndsAt ? Date.parse(businessEndsAt) : Infinity;
  if (deadline <= time) return;
  const eligibility = kind === "inbox" ? subscriptions.eligibility(app, player.id, target, time)
    : journeySubscription.eligibility(app, player.id);
  if (!eligibility) return;
  for (const binding of db.all(app, bindings,
      "player={:p} && expiresAt>{:now} && accountKey={:key}",
      { p: player.id, now: date(time), key: accountKey(player) }, "id")) {
    const delivery = db.create(app, deliveries, {
      binding: binding.id, kind, targetId: target.id, status: "pending",
      availableAt: date(time), expiresAt: date(Math.min(time + deliveryTTL, deadline)),
    });
    subscriptions.attach(app, delivery, eligibility);
  }
}

function stillAuthorized(app, row, binding, time) {
  if (!binding || Date.parse(binding.getString("expiresAt")) <= time) return false;
  const playerId = binding.getString("player");
  if (!permitted(app, playerId)) return false;
  const player = db.maybe(app, "game_players", "id={:id}", { id: playerId });
  if (!player || player.getString("status") !== "active" ||
      player.getBool("mustChangePassword") ||
      binding.getString("accountKey") !== accountKey(player)) return false;
  const id = row.getString("targetId");
  if (row.getString("kind") === "assignment") {
    const assignment = db.maybe(app, "game_assignments",
      "id={:id} && player={:p} && status='assigned' && session.status='published'",
      { id, p: playerId });
    return Boolean(assignment && (!assignment.getString("endsAt") ||
      Date.parse(assignment.getString("endsAt")) > time));
  }
  const receipt = db.maybe(app, "game_notification_receipts",
    "id={:id} && player={:p} && readAt='' && notification.status='sent'",
    { id, p: playerId });
  const note = receipt && db.maybe(app, "game_notifications", "id={:id}",
    { id: receipt.getString("notification") });
  return Boolean(note && (!note.getString("expiresAt") ||
    Date.parse(note.getString("expiresAt")) > time));
}

function claim(app, id) {
  let job;
  app.runInTransaction((tx) => {
    const row = db.maybe(tx, deliveries, "id={:id}", { id });
    const time = Date.now();
    if (!row || !["pending", "sending"].includes(row.getString("status")) ||
        Date.parse(row.getString("availableAt")) > time) return;
    const binding = db.maybe(tx, bindings, "id={:id}", { id: row.getString("binding") });
    const expiresAt = Date.parse(row.getString("expiresAt"));
    const attempt = row.getInt("attempts") + 1;
    const classification = row.getString("kind") === "inbox" && binding
      ? subscriptions.delivery(tx, row, binding.getString("player"), time)
      : binding ? journeySubscription.delivery(tx, row, binding.getString("player")) : null;
    if (!classification || expiresAt <= time || attempt > maxAttempts || !stillAuthorized(tx, row, binding, time)) {
      row.set("status", "discarded");
      row.set("lease", "");
      tx.save(row);
      return;
    }
    const lease = $security.randomString(48);
    row.set("lease", lease);
    row.set("attempts", attempt);
    row.set("status", "sending");
    row.set("availableAt", date(time + leaseTime));
    tx.save(row);
    job = {
      id, lease, bindingId: binding.id, token: binding.getString("token"),
      profileId: binding.getString("profileId"),
      kind: row.getString("kind"), targetId: row.getString("targetId"),
      expiresAt, attempt,
      category: classification.category, subscribed: classification.subscribed === true,
    };
  });
  return job;
}

function finish(app, job, result) {
  app.runInTransaction((tx) => {
    const row = db.maybe(tx, deliveries, "id={:id} && lease={:lease}",
      { id: job.id, lease: job.lease });
    if (!row) return; // Registration/revocation may have removed the binding.
    if (result.invalidToken) {
      // Do not let an old provider response remove a freshly rotated token.
      const binding = db.maybe(tx, bindings, "id={:id} && token={:token}",
        { id: job.bindingId, token: job.token });
      if (binding) {
        tx.delete(binding);
        return;
      }
      result = { ...result, retry: true };
    }
    const delay = job.attempt * 60 * 1000;
    const retryAt = Date.now() + delay;
    const retry = result.retry && job.attempt < maxAttempts && retryAt < job.expiresAt;
    row.set("status", result.accepted ? "accepted" : retry ? "pending" : "failed");
    row.set("providerCode", result.code);
    row.set("lease", "");
    if (retry) row.set("availableAt", date(retryAt));
    tx.save(row);
  });
}

function dispatch(app, send) {
  if (!enabled()) return;
  const jobs = app.findRecordsByFilter(deliveries,
    "(status='pending' || status='sending') && availableAt<={:now}",
    "availableAt,id", 20, 0, { now: now() });
  // A minute-level worker and a short provider timeout bound this run.
  const stopAt = Date.now() + 45000;
  for (const row of jobs) {
    if (Date.now() >= stopAt) break;
    const job = claim(app, row.id);
    if (!job) continue;
    let result;
    try {
      result = send(job);
    } catch {
      result = { accepted: false, retry: true, code: "NETWORK" };
    }
    finish(app, job, result);
  }
}

function hasPending(app) {
  return Boolean(db.maybe(app, deliveries,
    "(status='pending' || status='sending') && availableAt<={:now}",
    { now: now() }));
}

function purge(app) {
  for (const [table, cutoff] of [[bindings, now()], [deliveries, date(Date.now() - 86400000)]])
    for (const row of app.findRecordsByFilter(table, "expiresAt<={:cutoff}",
      "expiresAt", 100, 0, { cutoff })) {
      // Re-read after taking a write lock so a fresh registration is never purged.
      app.runInTransaction((tx) => {
        const current = db.maybe(tx, table, "id={:id} && expiresAt<={:cutoff}",
          { id: row.id, cutoff });
        if (current) tx.delete(current);
      });
    }
}

module.exports = { enabled, testMode, register, unregister, revoke, enqueue, hasPending, dispatch, purge };
