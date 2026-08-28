const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const game = require(`${__hooks}/lib/gameplay.js`);
const admin = require(`${__hooks}/lib/admin.js`);
function readBody(e) {
  return JSON.parse(JSON.stringify(e.requestInfo().body || {}));
}
function profile(e, body) {
  for (const key of Object.keys(body))
    if (!["displayName", "removeAvatar"].includes(key))
      r.fail("INVALID_INPUT", "个人资料包含不允许修改的字段");
  let result;
  e.app.runInTransaction((app) => {
    const player = db.actor(app, e, false, true);
    if (body.displayName !== undefined)
      player.set("displayName", r.text(body.displayName, "昵称", 40));
    // requestInfo() has already parsed multipart fields. PocketBase throws
    // ErrMissingFile for an absent avatar, so check for a file before reading it.
    const form = e.request.multipartForm;
    const avatarHeaders = form && form.file && form.file.avatar;
    const files =
      avatarHeaders && avatarHeaders.length
        ? e.findUploadedFiles("avatar")
        : [];
    if (files.length > 1) r.fail("INVALID_INPUT", "只能上传一张头像");
    if (files.length) player.set("avatar", files);
    else if (body.removeAvatar === true || body.removeAvatar === "true")
      player.set("avatar", "");
    try {
      app.validate(player);
    } catch {
      r.fail("INVALID_INPUT", "资料无效：头像仅支持 JPG、PNG、WebP，最大 2MB");
    }
    app.save(player);
    result = game.me(app, player);
  });
  return result;
}
function changePassword(e, body) {
  r.text(body.oldPassword, "旧密码", 72);
  r.password(body.password, "新密码");
  if (body.password.length < 10 || body.password !== body.passwordConfirm)
    r.fail("INVALID_INPUT", "新密码至少 10 位，且两次输入相同");
  if (body.oldPassword === body.password)
    r.fail("INVALID_INPUT", "新密码不能与旧密码相同");
  let result;
  e.app.runInTransaction((app) => {
    const player = db.actor(app, e, false, true);
    if (!player.validatePassword(body.oldPassword))
      r.fail("INVALID_PASSWORD", "旧密码不正确", 400);
    player.setPassword(body.password);
    player.refreshTokenKey();
    player.set("mustChangePassword", false);
    app.save(player);
    result = { token: player.newAuthToken(), player: game.me(app, player) };
  });
  return result;
}
function notifications(e) {
  const player = db.actor(e.app, e);
  return {
    items: db
      .all(
        e.app,
        "game_notification_receipts",
        "player={:id}",
        { id: player.id },
        "-created,-id",
      )
      .map((receipt) => {
        const note = db.get(
          e.app,
          "game_notifications",
          receipt.getString("notification"),
        );
        if (
          note.getString("status") !== "sent" ||
          (note.getString("expiresAt") &&
            Date.parse(note.getString("expiresAt")) <= Date.now())
        )
          return null;
        return {
          ...db.pick(note, [
            "title",
            "content",
            "popupTitle",
            "buttonText",
            "sentAt",
          ]),
          readAt: receipt.getString("readAt"),
          assignmentId: receipt.getString("assignment"),
        };
      })
      .filter(Boolean),
  };
}
function sendNotification(e, body) {
  return db.command(e, "send-notification", body, true, (app, actor) => {
    let players;
    if (body.target === "all")
      players = db.all(app, "game_players", 'status="active"');
    else if (body.target === "selected")
      players = [...new Set(r.list(body.playerIds, "玩家", 1000))].map((id) =>
        db.get(app, "game_players", id),
      );
    else if (body.target === "session") {
      db.get(app, "game_sessions", body.sessionId);
      const ids = [
        ...new Set(
          db
            .all(
              app,
              "game_assignments",
              'session={:id} && status!="cancelled"',
              { id: body.sessionId },
            )
            .map((a) => a.getString("player")),
        ),
      ];
      players = ids.map((id) => db.get(app, "game_players", id));
    } else r.fail("INVALID_INPUT", "请选择通知接收范围");
    const note = db.create(app, "game_notifications", {
      title: r.text(body.title, "通知标题", 200),
      content: r.text(body.content, "通知正文", 16000),
      popupTitle: r.text(body.popupTitle || "", "弹窗标题", 500, false),
      buttonText: r.text(body.buttonText || "知道了", "按钮文字", 100),
      sentAt: db.now(),
      expiresAt: r.date(body.expiresAt, "过期时间"),
      status: "sent",
      createdBy: actor.id,
    });
    const recipients = players.filter(
      (p) => p.getString("status") === "active",
    );
    for (const player of recipients)
      db.create(app, "game_notification_receipts", {
        notification: note.id,
        player: player.id,
      });
    db.audit(app, actor, "send_notification", note, "", body.requestId, {
      count: recipients.length,
    });
    return { id: note.id, recipientIds: recipients.map((p) => p.id) };
  });
}
function saveNarrative(e, id, body) {
  return db.command(
    e,
    `save-narrative:${id || "new"}`,
    body,
    true,
    (app, actor) => {
      const previous = id ? db.get(app, "game_narratives", id) : null;
      const fields = admin.version(
        app,
        "game_narratives",
        previous,
        body.clone === true,
      );
      const source =
        previous && body.clone
          ? db.pick(previous, ["kind", "title"], ["payload"])
          : body;
      if (!["letter", "bless"].includes(source.kind))
        r.fail("INVALID_INPUT", "未知叙事类型");
      const payload = require(`${__hooks}/lib/narratives.js`).payload(
        source.kind,
        source.payload,
      );
      Object.assign(fields, {
        kind: source.kind,
        title: r.text(source.title, "标题", 200),
        payload,
      });
      let row;
      if (previous && !body.clone) {
        row = previous;
        for (const key of Object.keys(fields)) row.set(key, fields[key]);
        app.save(row);
      } else row = db.create(app, "game_narratives", fields);
      db.audit(app, actor, "save_narrative", row, "", body.requestId);
      return { id: row.id };
    },
  );
}
function saveRanks(e, body) {
  return db.command(e, "save-ranks", body, true, (app, actor) => {
    const entries = r.list(body.levels, "等级", 100),
      existing = game.ranks(app);
    if (
      !entries.length ||
      entries[0].minTotalXp !== 0 ||
      entries.length < existing.length
    )
      r.fail("INVALID_INPUT", "第一级必须从 0 开始，已有等级不能删除");
    let last = -1;
    for (const [index, entry] of entries.entries()) {
      r.integer(entry.minTotalXp, "累计经验");
      if (entry.minTotalXp <= last) r.fail("INVALID_INPUT", "经验下限必须递增");
      last = entry.minTotalXp;
      r.text(entry.name, "等级名称", 60);
      if (existing[index] && entry.id !== existing[index].id)
        r.fail("INVALID_INPUT", "已有等级不能重新排序");
    }
    // Temporary unique values avoid collisions when several thresholds move together.
    for (const [index, entry] of existing.entries()) {
      const row = db.get(app, "game_level_definitions", entry.id);
      row.set("minTotalXp", 10000000 + index);
      app.save(row);
    }
    for (const [index, entry] of entries.entries()) {
      const fields = {
        order: index + 1,
        name: entry.name.trim(),
        minTotalXp: entry.minTotalXp,
        visualConfig: entry.visualConfig || {},
      };
      const row = existing[index]
        ? db.get(app, "game_level_definitions", existing[index].id)
        : db.create(app, "game_level_definitions", fields);
      if (existing[index]) {
        for (const key of Object.keys(fields)) row.set(key, fields[key]);
        app.save(row);
      }
      db.audit(
        app,
        actor,
        "save_rank",
        row,
        r.text(body.reason, "调整原因", 1000),
        body.requestId,
        { minTotalXp: entry.minTotalXp },
      );
    }
    return { changed: entries.length };
  });
}
function manualGrant(e, body) {
  return db.command(e, "manual-grant", body, true, (app, actor) => {
    const player = db.get(app, "game_players", body.playerId),
      reward = db.get(app, "game_rewards", body.rewardId);
    const reason = r.text(body.reason, "发奖原因", 1000);
    const row = db.create(app, "game_player_rewards", {
      player: player.id,
      sourceKey: `manual:${actor.id}:${body.requestId}`,
      reward: reward.id,
      quantity: r.integer(body.quantity || 1, "数量", 1, 100),
      status: "available",
      snapshot: db.pick(reward, [
        "name",
        "image",
        "description",
        "claimMethod",
        "publicInstructions",
      ]),
    });
    db.audit(app, actor, "manual_grant", row, reason, body.requestId);
    return { id: row.id };
  });
}
function handle(e) {
  const path = e.request.pathValue("path").replace(/\/$/, "");
  const parts = path.split("/"),
    method = e.request.method;
  const body = method === "GET" ? {} : readBody(e);
  if (path === "me" && method === "GET")
    return game.me(e.app, db.actor(e.app, e, false, true));
  if (path === "me/profile" && method === "PATCH") return profile(e, body);
  if (path === "me/change-password" && method === "POST")
    return changePassword(e, body);
  if (path === "assignments" && method === "GET") {
    const player = db.actor(e.app, e);
    return {
      items: db
        .all(
          e.app,
          "game_assignments",
          "player={:id}",
          { id: player.id },
          "order,-created,-id",
        )
        .map((row) => game.summary(e.app, row)),
    };
  }
  if (parts[0] === "assignments" && parts[1]) {
    if (parts.length === 2 && method === "GET")
      return game.detail(
        e.app,
        game.assignment(e.app, parts[1], db.actor(e.app, e).id),
      );
    if (parts[2] === "start" && parts.length === 3 && method === "POST")
      return game.start(e, parts[1], body);
    if (parts[2] === "answers" && parts.length === 3 && method === "POST")
      return game.answer(e, parts[1], body);
    if (parts[2] === "narratives" && parts.length === 4 && method === "GET") {
      const row = game.assignment(e.app, parts[1], db.actor(e.app, e).id),
        view = game.detail(e.app, row);
      const completionAccess =
        view.status === "completed" &&
        view.completionTarget &&
        view.completionTarget.kind === "narrative" &&
        view.completionTarget.id === parts[3];
      if (
        !completionAccess &&
        !view.clues.some((clue) => clue.narrative === parts[3])
      )
        r.fail("NOT_FOUND", "内容尚未解锁", 404);
      const narrative = db.get(e.app, "game_narratives", parts[3]);
      return db.pick(narrative, ["kind", "title"], ["payload"]);
    }
  }
  if (path === "rewards" && method === "GET")
    return {
      items: db
        .all(
          e.app,
          "game_player_rewards",
          "player={:id}",
          { id: db.actor(e.app, e).id },
          "-created,-id",
        )
        .map((row) => game.grantDto(row)),
    };
  if (path === "notifications" && method === "GET") return notifications(e);
  if (
    parts[0] === "notifications" &&
    parts[2] === "read" &&
    parts.length === 3 &&
    method === "POST"
  ) {
    const player = db.actor(e.app, e);
    let result;
    e.app.runInTransaction((app) => {
      db.actor(app, e);
      const receipt = db.maybe(
        app,
        "game_notification_receipts",
        "notification={:n} && player={:p}",
        { n: parts[1], p: player.id },
      );
      if (!receipt) r.fail("NOT_FOUND", "通知不存在", 404);
      if (!receipt.getString("readAt")) {
        receipt.set("readAt", db.now());
        app.save(receipt);
      }
      result = { readAt: receipt.getString("readAt") };
    });
    return result;
  }
  if (parts[0] === "admin") {
    db.actor(e.app, e, true);
    if (
      ["questions", "sessions", "narratives"].includes(parts[1]) &&
      parts.length === 4 &&
      parts[3] === "archive" &&
      method === "POST"
    )
      return admin.archive(e, `game_${parts[1]}`, parts[2], body);
    if (path === "admin/me" && method === "GET")
      return db.pick(db.actor(e.app, e, true), ["account", "displayName"]);
    if (path === "admin/catalog" && method === "GET") return admin.catalog(e);
    if (path === "admin/players" && method === "POST")
      return admin.createPlayer(e, body);
    if (
      parts[1] === "players" &&
      parts[3] === "actions" &&
      parts.length === 4 &&
      method === "POST"
    )
      return admin.playerAction(e, parts[2], body);
    if (parts[1] === "questions") {
      if (parts.length === 2 && method === "POST")
        return admin.saveQuestion(e, "", body);
      if (parts.length === 3 && ["POST", "PATCH"].includes(method))
        return admin.saveQuestion(e, parts[2], body);
      if (parts.length === 4 && parts[3] === "publish" && method === "POST")
        return admin.publish(e, "game_questions", parts[2], body);
    }
    if (parts[1] === "sessions") {
      if (parts.length === 2 && method === "POST")
        return admin.saveSession(e, "", body);
      if (parts.length === 3 && ["POST", "PATCH"].includes(method))
        return admin.saveSession(e, parts[2], body);
      if (parts.length === 4 && parts[3] === "publish" && method === "POST")
        return admin.publish(e, "game_sessions", parts[2], body);
    }
    if (parts[1] === "narratives") {
      if (parts.length === 2 && method === "POST")
        return saveNarrative(e, "", body);
      if (parts.length === 3 && ["POST", "PATCH"].includes(method))
        return saveNarrative(e, parts[2], body);
      if (parts.length === 4 && parts[3] === "publish" && method === "POST")
        return admin.publish(e, "game_narratives", parts[2], body);
    }
    if (path === "admin/assignments" && method === "POST")
      return admin.assign(e, body);
    if (path === "admin/assignments" && method === "GET")
      return {
        items: db
          .all(e.app, "game_assignments", "", {}, "-created,-id")
          .map((a) => game.summary(e.app, a)),
      };
    if (parts[1] === "assignments" && parts.length === 3 && method === "GET")
      return game.detail(e.app, game.assignment(e.app, parts[2]));
    if (
      parts[1] === "assignments" &&
      parts.length === 4 &&
      parts[3] === "actions" &&
      method === "POST"
    )
      return admin.assignmentAction(e, parts[2], body);
    if (
      parts[1] === "assignments" &&
      parts.length === 4 &&
      parts[3] === "submissions" &&
      method === "GET"
    )
      return {
        items: db
          .all(
            e.app,
            "game_answer_submissions",
            "assignment={:id}",
            { id: parts[2] },
            "-created,-id",
          )
          .map((s) =>
            db.pick(s, ["sessionLevel", "answer", "result", "submittedAt"]),
          ),
      };
    if (path === "admin/rewards" && method === "POST")
      return admin.saveReward(e, "", body);
    if (parts[1] === "rewards" && parts.length === 3 && method === "PATCH")
      return admin.saveReward(e, parts[2], body);
    if (path === "admin/grants" && method === "GET")
      return {
        items: db
          .all(e.app, "game_player_rewards", "", {}, "-created,-id")
          .map((row) => game.grantDto(row, true)),
      };
    if (path === "admin/grants" && method === "POST")
      return manualGrant(e, body);
    if (
      parts[1] === "grants" &&
      parts.length === 4 &&
      parts[3] === "actions" &&
      method === "POST"
    )
      return admin.rewardAction(e, parts[2], body);
    if (path === "admin/ranks" && method === "POST") return saveRanks(e, body);
    if (path === "admin/notifications" && method === "POST")
      return sendNotification(e, body);
    if (path === "admin/notifications" && method === "GET")
      return {
        items: db
          .all(e.app, "game_notifications", "", {}, "-created,-id")
          .map((n) =>
            db.pick(n, ["title", "content", "status", "sentAt", "expiresAt"]),
          ),
      };
    if (
      parts[1] === "notifications" &&
      parts.length === 4 &&
      parts[3] === "withdraw" &&
      method === "POST"
    )
      return db.command(e, `withdraw:${parts[2]}`, body, true, (app, actor) => {
        const note = db.get(app, "game_notifications", parts[2]);
        note.set("status", "withdrawn");
        app.save(note);
        db.audit(
          app,
          actor,
          "withdraw_notification",
          note,
          r.text(body.reason, "撤回原因", 1000),
          body.requestId,
        );
        return { id: note.id };
      });
    if (path === "admin/audit" && method === "GET")
      return {
        items: db
          .all(e.app, "game_admin_audit_logs", "", {}, "-created,-id")
          .map((a) =>
            db.pick(
              a,
              [
                "actor",
                "action",
                "entityType",
                "entityId",
                "reason",
                "created",
              ],
              ["safeDiff"],
            ),
          ),
      };
  }
  r.fail("NOT_FOUND", "接口不存在", 404);
}
module.exports = { handle };
