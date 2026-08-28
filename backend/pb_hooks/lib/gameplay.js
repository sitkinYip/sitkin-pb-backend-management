const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
function stats(app, playerId) {
  const record = db.maybe(app, "game_player_stats", "player={:id}", {
    id: playerId,
  });
  if (!record) r.fail("ACCOUNT_NOT_READY", "账号尚未初始化", 409);
  return record;
}
function ranks(app) {
  return db
    .all(app, "game_level_definitions", "", {}, "order")
    .map((row) =>
      db.pick(row, ["order", "name", "minTotalXp"], ["visualConfig"]),
    );
}
function me(app, player) {
  const totalXp = stats(app, player.id).getInt("totalXp");
  const levels = ranks(app);
  const eligible = levels.filter((level) => level.minTotalXp <= totalXp);
  return {
    id: player.id,
    account: player.getString("account"),
    displayName: player.getString("displayName"),
    avatar: player.getString("avatar"),
    mustChangePassword: player.getBool("mustChangePassword"),
    totalXp,
    level: eligible[eligible.length - 1],
    nextLevel: levels.find((level) => level.minTotalXp > totalXp) || null,
  };
}
function assignment(app, id, playerId) {
  const row = db.get(app, "game_assignments", id);
  if (playerId && row.getString("player") !== playerId)
    r.fail("NOT_FOUND", "场次不存在", 404);
  return row;
}
function onlineSession(app, row) {
  const session = db.get(app, "game_sessions", row.getString("session"));
  if (session.getString("status") !== "published")
    r.fail("SESSION_OFFLINE", "该场次已下线", 409);
  return session;
}
function availability(row, time) {
  if (row.getString("status") === "cancelled")
    r.fail("ASSIGNMENT_CANCELLED", "本次场次已撤回", 409);
  const start = row.getString("startsAt"),
    end = row.getString("endsAt");
  if (start && time < Date.parse(start))
    r.fail("NOT_STARTED", "场次尚未开放", 409);
  if (end && time >= Date.parse(end)) r.fail("EXPIRED", "本次场次已结束", 409);
}
function levels(app, row) {
  return db.all(
    app,
    "game_session_levels",
    "session={:id}",
    { id: row.getString("session") },
    "position",
  );
}
function progress(app, row) {
  return db.all(app, "game_level_progress", "assignment={:id}", { id: row.id });
}
function progressFor(app, row, levelId) {
  return db.maybe(
    app,
    "game_level_progress",
    "assignment={:a} && sessionLevel={:l}",
    { a: row.id, l: levelId },
  );
}
function summary(app, row, privileged = false) {
  const session = db.get(app, "game_sessions", row.getString("session"));
  const minimum = session.getString("minLevel")
    ? db
        .get(app, "game_level_definitions", session.getString("minLevel"))
        .getInt("order")
    : 1;
  const maximum = session.getString("maxLevel")
    ? db
        .get(app, "game_level_definitions", session.getString("maxLevel"))
        .getInt("order")
    : null;
  return {
    ...db.pick(row, [
      "player",
      "session",
      "status",
      "order",
      "startsAt",
      "endsAt",
      "startedAt",
      "completedAt",
      "previousAssignment",
    ]),
    ...(privileged ? { sessionStatus: session.getString("status") } : {}),
    title: session.getString("title"),
    description: session.getString("description"),
    minLevel: minimum,
    maxLevel: maximum,
    completedLevels: progress(app, row).filter((p) =>
      p.getString("completedAt"),
    ).length,
    totalLevels: levels(app, row).length,
  };
}
function detail(app, row, privileged = false) {
  const session = privileged
    ? db.get(app, "game_sessions", row.getString("session"))
    : onlineSession(app, row);
  const steps = levels(app, row);
  const records = progress(app, row);
  const byId = {};
  for (const p of records) byId[p.getString("sessionLevel")] = p;
  let currentIndex = steps.findIndex(
    (step) => !byId[step.id] || !byId[step.id].getString("completedAt"),
  );
  if (currentIndex < 0) currentIndex = Math.max(0, steps.length - 1);
  const unlocked =
    privileged ||
    (row.getString("startedAt") && row.getString("status") !== "cancelled");
  const clues = unlocked
    ? db
        .all(app, "game_clue_unlocks", "assignment={:id}", { id: row.id })
        .map((unlock) => {
          const clue = db.get(app, "game_clues", unlock.getString("clue"));
          return {
            ...db.pick(
              clue,
              [
                "sessionLevel",
                "trigger",
                "kind",
                "position",
                "narrative",
                "autoPlay",
              ],
              ["content"],
            ),
            unlockedAt: unlock.getString("unlockedAt"),
          };
        })
        .sort((a, b) => a.position - b.position)
    : [];
  return {
    ...summary(app, row, privileged),
    presentation: db.json(session, "presentation", {}),
    completionTarget:
      row.getString("status") === "completed"
        ? db.json(session, "completionTarget")
        : null,
    currentIndex,
    clues,
    levels: steps.map((step, index) => {
      const p = byId[step.id];
      const base = {
        id: step.id,
        position: step.getInt("position"),
        xp: step.getInt("xp"),
        autoNext: step.getBool("autoNext"),
        completedAt: p ? p.getString("completedAt") : "",
        wrongCount: p ? p.getInt("wrongCount") : 0,
        cooldownUntil: p ? p.getString("cooldownUntil") : "",
        locked: p ? p.getBool("locked") : false,
        presentationOverride: db.json(step, "presentationOverride", {}),
      };
      if (!privileged && (!unlocked || index > currentIndex))
        return { ...base, question: null, lastAnswer: "" };
      const q = db.get(app, "game_questions", step.getString("question"));
      const last =
        p && p.getString("lastSubmission")
          ? db.get(
              app,
              "game_answer_submissions",
              p.getString("lastSubmission"),
            )
          : null;
      return {
        ...base,
        question: db.pick(
          q,
          ["kind", "title", "placeholder"],
          ["content", "options"],
        ),
        lastAnswer: last ? last.getString("answer") : "",
      };
    }),
    serverTime: db.now(),
  };
}
function unlock(app, row, trigger, levelId, actor) {
  const clues = db.all(
    app,
    "game_clues",
    "session={:id} && trigger={:trigger}",
    { id: row.getString("session"), trigger },
  );
  for (const clue of clues) {
    if (
      trigger === "level_completed" &&
      clue.getString("sessionLevel") !== levelId
    )
      continue;
    if (
      db.maybe(app, "game_clue_unlocks", "assignment={:a} && clue={:c}", {
        a: row.id,
        c: clue.id,
      })
    )
      continue;
    db.create(app, "game_clue_unlocks", {
      assignment: row.id,
      clue: clue.id,
      unlockedAt: db.now(),
      sourceType: trigger,
      actor: actor ? actor.id : "",
    });
  }
}
function award(app, row, trigger, levelId) {
  const ids = [];
  const rules = db.all(
    app,
    "game_reward_rules",
    "session={:id} && trigger={:trigger}",
    { id: row.getString("session"), trigger },
  );
  for (const rule of rules) {
    if (
      trigger === "level_completed" &&
      rule.getString("sessionLevel") !== levelId
    )
      continue;
    const sourceKey = `${row.id}:${rule.id}`;
    if (
      db.maybe(app, "game_player_rewards", "sourceKey={:key}", {
        key: sourceKey,
      })
    )
      continue;
    const reward = db.get(app, "game_rewards", rule.getString("reward"));
    const grant = db.create(app, "game_player_rewards", {
      player: row.getString("player"),
      assignment: row.id,
      rule: rule.id,
      sourceKey,
      reward: reward.id,
      quantity: rule.getInt("quantity"),
      status: "available",
      snapshot: db.pick(reward, [
        "name",
        "image",
        "description",
        "claimMethod",
        "publicInstructions",
      ]),
    });
    ids.push(grant.id);
  }
  return ids;
}
function start(e, id, body) {
  db.command(
    e,
    `start:${id}`,
    body,
    false,
    (app, player) => {
      const row = assignment(app, id, player.id);
      availability(row, Date.now());
      if (row.getString("startedAt")) return { assignmentId: row.id };
      const user = me(app, player),
        configuration = summary(app, row);
      if (
        user.level.order < configuration.minLevel ||
        (configuration.maxLevel !== null &&
          user.level.order > configuration.maxLevel)
      )
        r.fail("LEVEL_NOT_ELIGIBLE", "当前等级不符合参与要求", 409);
      row.set("status", "active");
      row.set("startedAt", db.now());
      row.set("admissionSnapshot", {
        level: user.level.order,
        totalXp: user.totalXp,
        minLevel: configuration.minLevel,
        maxLevel: configuration.maxLevel,
      });
      app.save(row);
      for (const step of levels(app, row))
        db.create(app, "game_level_progress", {
          assignment: row.id,
          sessionLevel: step.id,
        });
      unlock(app, row, "start", "");
      return { assignmentId: row.id };
    },
    (app, player) => onlineSession(app, assignment(app, id, player.id)),
  );
  const player = db.actor(e.app, e);
  return detail(e.app, assignment(e.app, id, player.id));
}
function complete(app, row, step, p, submission, actor) {
  if (p.getString("completedAt")) return { xpDelta: 0, rewardIds: [] };
  const sourceKey = `${row.id}:${step.id}:completion`;
  const xp = step.getInt("xp");
  p.set("completedAt", db.now());
  p.set("cooldownUntil", "");
  p.set("locked", false);
  p.set("lastSubmission", submission.id);
  app.save(p);
  const balance = stats(app, row.getString("player"));
  db.create(app, "game_xp_ledger", {
    player: row.getString("player"),
    assignment: row.id,
    sessionLevel: step.id,
    delta: xp,
    sourceType: actor ? "manual_completion" : "completion",
    sourceKey,
    actor: actor ? actor.id : "",
  });
  balance.set("totalXp", balance.getInt("totalXp") + xp);
  app.save(balance);
  let rewardIds = award(app, row, "level_completed", step.id);
  unlock(app, row, "level_completed", step.id, actor);
  if (progress(app, row).every((record) => record.getString("completedAt"))) {
    row.set("status", "completed");
    row.set("completedAt", db.now());
    app.save(row);
    rewardIds = rewardIds.concat(award(app, row, "session_completed", ""));
    unlock(app, row, "session_completed", "", actor);
  }
  return { xpDelta: xp, rewardIds };
}
function answer(e, id, body) {
  const answer = r.text(body.answer, "回答", 4000);
  const stepId = r.text(body.sessionLevelId, "关卡", 30);
  const result = db.command(
    e,
    `answer:${id}`,
    body,
    false,
    (app, player) => {
      const row = assignment(app, id, player.id);
      availability(row, Date.now());
      if (!row.getString("startedAt"))
        r.fail("NOT_STARTED", "请先进入场次", 409);
      const step = levels(app, row).find((level) => level.id === stepId);
      if (!step) r.fail("NOT_FOUND", "关卡不存在", 404);
      const p = progressFor(app, row, stepId);
      if (p.getString("completedAt"))
        return { result: "already_completed", xpDelta: 0, rewardIds: [] };
      const first = levels(app, row).find(
        (level) => !progressFor(app, row, level.id).getString("completedAt"),
      );
      if (!first || first.id !== stepId)
        r.fail("PREVIOUS_LEVEL_REQUIRED", "请先完成前一关", 409);
      if (p.getBool("locked"))
        r.fail("LOCKED", "本关已锁定，请联系工作人员", 409);
      if (
        p.getString("cooldownUntil") &&
        Date.parse(p.getString("cooldownUntil")) > Date.now()
      )
        r.fail("COOLDOWN", "请等待冷却结束", 409);
      const recent = db.all(
        app,
        "game_answer_submissions",
        "assignment={:a} && submittedAt>{:since}",
        { a: row.id, since: new Date(Date.now() - 60000).toISOString() },
      );
      if (recent.length >= 30)
        r.fail("RATE_LIMITED", "提交过于频繁，请稍后再试", 429);
      const q = db.get(app, "game_questions", step.getString("question"));
      if (
        q.getString("kind") === "choice" &&
        !db.json(q, "options", []).some((option) => option.key === answer)
      )
        r.fail("INVALID_INPUT", "请选择有效选项");
      const key = db.maybe(app, "game_answer_keys", "question={:id}", {
        id: q.id,
      });
      const isCorrect = r.correct(
        q.getString("kind"),
        answer,
        db.json(key, "acceptedAnswers", []),
      );
      const submission = db.create(app, "game_answer_submissions", {
        assignment: row.id,
        sessionLevel: step.id,
        requestId: body.requestId,
        answer,
        result: isCorrect ? "correct" : "incorrect",
        submittedAt: db.now(),
        rulesRevision: key.getString("normalizationVersion"),
      });
      if (isCorrect)
        return {
          result: "correct",
          ...complete(app, row, step, p, submission),
        };
      p.set("lastSubmission", submission.id);
      if (q.getString("kind") === "choice") {
        const count = p.getInt("wrongCount") + 1;
        p.set("wrongCount", count);
        const policy = db.json(step, "penaltyPolicy", []);
        const penalty = policy[Math.min(count - 1, policy.length - 1)];
        if (penalty && penalty.type === "lock") p.set("locked", true);
        else if (penalty)
          p.set(
            "cooldownUntil",
            new Date(Date.now() + penalty.seconds * 1000).toISOString(),
          );
      }
      app.save(p);
      return { result: "incorrect", xpDelta: 0, rewardIds: [] };
    },
    (app, player) => onlineSession(app, assignment(app, id, player.id)),
  );
  const player = db.actor(e.app, e);
  return {
    ...result,
    assignment: detail(e.app, assignment(e.app, id, player.id)),
    player: me(e.app, player),
  };
}
function grantDto(row, privileged = false) {
  return {
    ...db.pick(
      row,
      [
        "player",
        "assignment",
        "quantity",
        "status",
        "claimDetails",
        "redeemedAt",
        "created",
      ],
      ["snapshot"],
    ),
    claimDetails:
      privileged || row.getString("status") === "available"
        ? row.getString("claimDetails")
        : "",
  };
}
module.exports = {
  stats,
  ranks,
  me,
  assignment,
  onlineSession,
  availability,
  levels,
  progress,
  progressFor,
  summary,
  detail,
  unlock,
  award,
  complete,
  start,
  answer,
  grantDto,
};
