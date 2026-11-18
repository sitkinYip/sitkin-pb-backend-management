cronAdd("starward-push-deliveries", "* * * * *", () => {
  const push = require(`${__hooks}/lib/push.js`);
  if (!push.enabled()) return;
  try {
    if (!push.hasPending($app)) return;
    const sender = require(`${__hooks}/lib/huawei-push.js`).sender(push.testMode());
    push.dispatch($app, sender);
  } catch {
    // Lower-level errors may contain file paths, request headers or tokens.
    $app.logger().error("Starward Push dispatch unavailable");
  }
});

cronAdd("starward-push-purge", "*/10 * * * *", () => {
  try {
    require(`${__hooks}/lib/push.js`).purge($app);
  } catch {
    $app.logger().error("Starward Push purge unavailable");
  }
});
