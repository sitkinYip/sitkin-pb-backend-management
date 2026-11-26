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

cronAdd("starward-progress-deliveries", "* * * * *", () => {
  const push = require(`${__hooks}/lib/push.js`);
  if (!push.enabled()) return;
  const watches = require(`${__hooks}/lib/progress-watches.js`);
  if (!watches.approved()) return;
  try {
    const stopAt = Date.now() + 58000;
    let send;
    // PocketBase schedules in minutes. Sleep in this job's goroutine between
    // bounded sweeps so answer requests never wait for an external Push call.
    while (Date.now() < stopAt) {
      if (push.hasPending($app, watches.deliveries)) {
        send = send || require(`${__hooks}/lib/huawei-push.js`).sender(push.testMode());
        push.dispatch($app, send, watches.deliveries, stopAt);
      }
      const remaining = stopAt - Date.now();
      if (remaining > 0) sleep(Math.min(2000, remaining));
    }
  } catch {
    $app.logger().error("Starward progress dispatch unavailable");
  }
});

cronAdd("starward-push-purge", "*/10 * * * *", () => {
  try {
    require(`${__hooks}/lib/push.js`).purge($app);
  } catch {
    $app.logger().error("Starward Push purge unavailable");
  }
});
