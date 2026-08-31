const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const game = require(`${__hooks}/lib/gameplay.js`);
const policy = require(`${__hooks}/lib/content-policy.js`);
const cluePolicy = require(`${__hooks}/lib/clues.js`);
function playerDto(app, row) {
  return { ...game.me(app, row), status: row.getString("status") };
}
function questionDto(app, row, commonClueCount) {
  const secret = db.maybe(app, "game_answer_keys", "question={:id}", {
    id: row.id,
  });
  return {
    ...db.pick(
      row,
      ["seriesKey", "revision", "status", "kind", "title", "placeholder"],
      ["content", "options"],
    ),
    acceptedAnswers: secret ? db.json(secret, "acceptedAnswers", []) : [],
    commonClueCount:
      commonClueCount === undefined
        ? cluePolicy.questionClues(app, row.id).length
        : commonClueCount,
  };
}
const LIVE_PRESENTATION_FIELDS = [
  "bgmMode",
  "bgmUrl",
  "backgroundMode",
  "backgroundUrl",
  "hideTitle",
];
function livePresentation(value) {
  const result = {};
  for (const key of LIVE_PRESENTATION_FIELDS)
    if (value && value[key] !== undefined) result[key] = value[key];
  return result;
}
function liveSettingsState(dto) {
  return {
    title: dto.title,
    description: dto.description,
    presentation: livePresentation(dto.presentation),
    levels: dto.levels.map((level) => ({
      id: level.id,
      presentationOverride: livePresentation(level.presentationOverride),
    })),
    clues: dto.clues.map((clue) => ({
      id: clue.id,
      position: clue.position,
      content: clue.content,
      autoPlay: clue.autoPlay,
    })),
  };
}
function sessionDto(app, row) {
  const result = {
    ...db.pick(
      row,
      [
        "seriesKey",
        "revision",
        "status",
        "title",
        "description",
        "minLevel",
        "maxLevel",
      ],
      ["presentation", "completionTarget"],
    ),
    levels: db
      .all(
        app,
        "game_session_levels",
        "session={:id}",
        { id: row.id },
        "position",
      )
      .map((step) =>
        db.pick(
          step,
          ["question", "position", "xp", "autoNext"],
          ["penaltyPolicy", "presentationOverride"],
        ),
      ),
    clues: db
      .all(app, "game_clues", "session={:id}", { id: row.id }, "position")
      .map((clue) =>
        db.pick(
          clue,
          [
            "sessionLevel",
            "trigger",
            "position",
            "kind",
            "narrative",
            "autoPlay",
          ],
          ["content"],
        ),
      ),
    rewardRules: db
      .all(app, "game_reward_rules", "session={:id}", { id: row.id })
      .map((rule) =>
        db.pick(rule, ["sessionLevel", "trigger", "reward", "quantity"]),
      ),
  };
  result.liveSettingsVersion = cluePolicy.version(liveSettingsState(result));
  return result;
}
function catalog(e) {
  db.actor(e.app, e, true);
  const references = policy.references(e.app);
  const counts = policy.assignmentCounts(e.app);
  const commonClueCounts = cluePolicy.questionClueCounts(e.app);
  return {
    players: db.all(e.app, "game_players").map((p) => playerDto(e.app, p)),
    ranks: game.ranks(e.app),
    questions: db.all(e.app, "game_questions").map((q) => ({
      ...questionDto(e.app, q, commonClueCounts[q.id] || 0),
      usage: policy.usage(q, references),
    })),
    sessions: db.all(e.app, "game_sessions").map((s) => ({
      ...sessionDto(e.app, s),
      assignmentCounts: counts[s.id] || policy.emptyCounts(),
    })),
    rewards: db
      .all(e.app, "game_rewards")
      .map((reward) =>
        db.pick(reward, [
          "name",
          "image",
          "description",
          "claimMethod",
          "publicInstructions",
          "active",
        ]),
      ),
    narratives: db
      .all(e.app, "game_narratives")
      .map((n) =>
        db.pick(
          n,
          ["seriesKey", "revision", "status", "kind", "title"],
          ["payload"],
        ),
      ),
  };
}
function createPlayer(e, body) {
  return db.command(e, "create-player", body, true, (app, actor) => {
    const account = r.text(body.account, "登录账号", 32).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(account))
      r.fail(
        "INVALID_INPUT",
        "账号须为 3～32 位字母、数字、点、下划线或短横线",
      );
    r.password(body.password, "初始密码");
    if (body.password.length < 10)
      r.fail("INVALID_INPUT", "初始密码至少 10 位");
    if (db.maybe(app, "game_players", "account={:account}", { account }))
      r.fail("ACCOUNT_EXISTS", "登录账号已存在", 409);
    const row = db.create(app, "game_players", {
      account,
      displayName: r.text(body.displayName, "昵称", 40),
      status: "active",
      mustChangePassword: true,
      password: body.password,
    });
    db.create(app, "game_player_stats", { player: row.id, totalXp: 0 });
    db.audit(app, actor, "create_player", row, "", body.requestId);
    return { id: row.id };
  });
}
function playerAction(e, id, body) {
  return db.command(e, `player-action:${id}`, body, true, (app, actor) => {
    const row = db.get(app, "game_players", id);
    const reason = r.text(body.reason, "操作原因", 1000);
    if (body.action === "disable" || body.action === "enable") {
      row.set("status", body.action === "disable" ? "disabled" : "active");
      row.refreshTokenKey();
      app.save(row);
    } else if (body.action === "reset_password") {
      r.password(body.password, "初始密码");
      if (body.password.length < 10) r.fail("INVALID_INPUT", "密码至少 10 位");
      row.setPassword(body.password);
      row.refreshTokenKey();
      row.set("mustChangePassword", true);
      app.save(row);
    } else if (body.action === "adjust_xp") {
      const delta = r.integer(body.delta, "经验变化", -1000000);
      const balance = game.stats(app, row.id),
        next = balance.getInt("totalXp") + delta;
      if (next < 0) r.fail("INVALID_INPUT", "总经验不能小于 0");
      db.create(app, "game_xp_ledger", {
        player: row.id,
        delta,
        sourceType: "adjustment",
        sourceKey: `adjust:${actor.id}:${body.requestId}`,
        reason,
        actor: actor.id,
      });
      balance.set("totalXp", next);
      app.save(balance);
    } else r.fail("INVALID_INPUT", "未知账号操作");
    db.audit(
      app,
      actor,
      body.action,
      row,
      reason,
      body.requestId,
      body.action === "adjust_xp" ? { delta: body.delta } : {},
    );
    return { id: row.id };
  });
}
function version(app, table, previous, clone) {
  if (!previous)
    return {
      seriesKey: $security.randomString(20),
      revision: 1,
      status: "draft",
    };
  if (!clone) {
    if (previous.getString("status") !== "draft")
      r.fail(
        "PUBLISHED_IMMUTABLE",
        "已发布内容不能原地修改，请创建新版本",
        409,
      );
    return {};
  }
  const latest = db.all(
    app,
    table,
    "seriesKey={:key}",
    { key: previous.getString("seriesKey") },
    "-revision",
  )[0];
  return {
    seriesKey: previous.getString("seriesKey"),
    revision: latest.getInt("revision") + 1,
    status: "draft",
  };
}
function contentBlocks(value) {
  return r.list(value, "题面", 100).map((block) => {
    r.object(block, "题面段落");
    return {
      text: r.text(block.text || "", "正文", 16000, false),
      hint: r.text(block.hint || "", "提示", 4000, false),
      imageUrl: r.safeUrl(block.imageUrl || ""),
      imageUrls: r
        .list(block.imageUrls || [], "图片", 30)
        .map((url) => r.safeUrl(url)),
      videoUrl: r.safeUrl(block.videoUrl || ""),
    };
  });
}
function options(value) {
  const entries = r.list(value || [], "选项", 30).map((option) => ({
    key: r.text(option.key, "选项标识", 30),
    text: r.text(option.text || "", "选项文字", 4000, false),
    imageUrl: r.safeUrl(option.imageUrl || ""),
    videoUrl: r.safeUrl(option.videoUrl || ""),
  }));
  if (new Set(entries.map((option) => option.key)).size !== entries.length)
    r.fail("INVALID_INPUT", "选项标识重复");
  return entries;
}
function saveQuestion(e, id, body) {
  return db.command(
    e,
    `save-question:${id || "new"}`,
    body,
    true,
    (app, actor) => {
      const prior = id ? db.get(app, "game_questions", id) : null;
      const updating = prior && body.clone !== true;
      const usage = updating ? policy.requireEditable(app, prior) : null;
      const before = updating ? questionDto(app, prior) : null;
      const reason = r.text(
        body.reason || "",
        "修改原因",
        1000,
        Boolean(usage && usage.historyCount),
      );
      const fields = updating
        ? {}
        : version(app, "game_questions", prior, body.clone === true);
      const source =
        body.clone === true && prior ? questionDto(app, prior) : body;
      if (!["text", "choice"].includes(source.kind))
        r.fail("INVALID_INPUT", "未知题型");
      Object.assign(fields, {
        kind: source.kind,
        title: r.text(source.title, "题目标题", 200),
        placeholder: r.text(source.placeholder || "", "占位提示", 500, false),
        content: contentBlocks(source.content),
        options: options(source.options),
      });
      const answers = r
        .list(source.acceptedAnswers, "答案", 30)
        .map((answer) => r.text(answer, "答案", 4000));
      if (!answers.length) r.fail("INVALID_INPUT", "至少配置一个答案");
      if (
        source.kind === "choice" &&
        (fields.options.length < 2 ||
          answers.some(
            (answer) => !fields.options.some((option) => option.key === answer),
          ))
      )
        r.fail("INVALID_INPUT", "选择题至少两个选项，答案须为选项标识");
      let row;
      if (updating) {
        row = prior;
        for (const key of Object.keys(fields)) row.set(key, fields[key]);
        app.save(row);
      } else row = db.create(app, "game_questions", fields);
      const secret = db.maybe(app, "game_answer_keys", "question={:id}", {
        id: row.id,
      });
      if (secret) {
        secret.set("acceptedAnswers", answers);
        secret.set("normalizationVersion", "nfkc-v1");
        app.save(secret);
      } else
        db.create(app, "game_answer_keys", {
          question: row.id,
          acceptedAnswers: answers,
          normalizationVersion: "nfkc-v1",
        });
      if (body.clone === true && prior)
        for (const clue of cluePolicy.questionClues(app, prior.id))
          db.create(app, "game_question_clues", {
            question: row.id,
            position: clue.getInt("position"),
            kind: clue.getString("kind"),
            content: db.json(clue, "content", {}),
            autoPlay: clue.getBool("autoPlay"),
            status: "active",
          });
      db.audit(
        app,
        actor,
        "save_question",
        row,
        reason,
        body.requestId,
        updating ? { before, after: questionDto(app, row) } : {},
      );
      return { id: row.id };
    },
  );
}
function questionClueSet(e, questionId) {
  db.actor(e.app, e, true);
  db.get(e.app, "game_questions", questionId);
  return cluePolicy.questionClueSet(e.app, questionId);
}
function saveQuestionClues(e, questionId, body) {
  db.command(
    e,
    `save-question-clues:${questionId}`,
    body,
    true,
    (app, actor) => {
      cluePolicy.onlyFields(
        body,
        ["requestId", "reason", "expectedVersion", "clues"],
        "通用线索请求",
      );
      const question = db.get(app, "game_questions", questionId);
      if (question.getString("status") === "archived")
        r.fail("QUESTION_DELETED", "题目已移出题库，不能配置通用线索", 409);
      const reason = r.text(body.reason, "修改原因", 1000);
      const expectedVersion = r.text(
        body.expectedVersion,
        "线索版本",
        100,
      );
      const before = cluePolicy.questionClueSet(app, questionId);
      if (before.version !== expectedVersion)
        r.fail(
          "EDIT_CONFLICT",
          "通用线索已被其他管理员修改，请刷新后重新核对",
          409,
        );
      const existing = cluePolicy.questionClues(app, questionId, true);
      const byId = {};
      for (const clue of existing) byId[clue.id] = clue;
      const retained = new Set();
      for (const [index, input] of r
        .list(body.clues, "通用线索", 100)
        .entries()) {
        cluePolicy.onlyFields(
          input,
          ["id", "position", "kind", "content", "autoPlay"],
          `通用线索 ${index + 1}`,
        );
        if (
          input.position !== undefined &&
          r.integer(input.position, "线索顺序", 0, 99) !== index
        )
          r.fail("INVALID_INPUT", "通用线索顺序须与列表顺序一致");
        const kind = cluePolicy.validateQuestionKind(input.kind);
        const fields = {
          question: question.id,
          position: index,
          kind,
          content: cluePolicy.cleanQuestionContent(kind, input.content),
          autoPlay: input.autoPlay === true,
          status: "active",
        };
        if (!input.id) {
          db.create(app, "game_question_clues", fields);
          continue;
        }
        const id = r.text(input.id, "线索 ID", 30);
        if (retained.has(id)) r.fail("INVALID_INPUT", "通用线索 ID 重复");
        const clue = byId[id];
        if (!clue || clue.getString("question") !== question.id)
          r.fail("INVALID_INPUT", "通用线索不属于当前题目");
        if (clue.getString("status") !== "active")
          r.fail("INVALID_STATE", "已删除线索不能恢复，请新建线索", 409);
        retained.add(id);
        for (const key of Object.keys(fields)) clue.set(key, fields[key]);
        app.save(clue);
      }
      for (const clue of existing)
        if (clue.getString("status") === "active" && !retained.has(clue.id)) {
          clue.set("status", "archived");
          app.save(clue);
        }
      const after = cluePolicy.questionClueSet(app, questionId);
      const beforeIds = new Set(before.items.map((item) => item.id));
      const afterIds = new Set(after.items.map((item) => item.id));
      db.audit(
        app,
        actor,
        "save_question_clues",
        question,
        reason,
        body.requestId,
        {
          beforeVersion: before.version,
          afterVersion: after.version,
          beforeCount: before.items.length,
          afterCount: after.items.length,
          createdIds: after.items
            .filter((item) => !beforeIds.has(item.id))
            .map((item) => item.id),
          updatedIds: after.items
            .filter((item) => beforeIds.has(item.id))
            .map((item) => item.id),
          archivedIds: before.items
            .filter((item) => !afterIds.has(item.id))
            .map((item) => item.id),
        },
      );
      return { questionId, version: after.version };
    },
  );
  return cluePolicy.questionClueSet(e.app, questionId);
}
function presentation(value) {
  const p = r.object(value || {}, "演出配置");
  if (p.bgmMode && !["inherit", "custom", "silent"].includes(p.bgmMode))
    r.fail("INVALID_INPUT", "未知背景音乐模式");
  if (
    p.backgroundMode &&
    !["inherit", "custom", "none"].includes(p.backgroundMode)
  )
    r.fail("INVALID_INPUT", "未知背景图片模式");
  if (p.completionStyle && !["normal", "finale"].includes(p.completionStyle))
    r.fail("INVALID_INPUT", "未知完成演出");
  return {
    backgroundMode: p.backgroundMode || "inherit",
    ...(typeof p.hideTitle === "boolean" ? { hideTitle: p.hideTitle } : {}),
    bgmMode: p.bgmMode || "inherit",
    bgmUrl: r.safeUrl(p.bgmUrl || ""),
    backgroundUrl: r.safeUrl(p.backgroundUrl || ""),
    completionStyle: p.completionStyle || "normal",
  };
}
function patchLivePresentation(current, input, name) {
  cluePolicy.onlyFields(input, LIVE_PRESENTATION_FIELDS, name);
  const next = { ...(current || {}) };
  if (input.bgmMode !== undefined) {
    if (!["inherit", "custom", "silent"].includes(input.bgmMode))
      r.fail("INVALID_INPUT", "未知背景音乐模式");
    next.bgmMode = input.bgmMode;
  }
  if (input.bgmUrl !== undefined) next.bgmUrl = r.safeUrl(input.bgmUrl);
  if (input.backgroundMode !== undefined) {
    if (!["inherit", "custom", "none"].includes(input.backgroundMode))
      r.fail("INVALID_INPUT", "未知背景图片模式");
    next.backgroundMode = input.backgroundMode;
  }
  if (input.backgroundUrl !== undefined)
    next.backgroundUrl = r.safeUrl(input.backgroundUrl);
  if (input.hideTitle !== undefined) {
    if (typeof input.hideTitle !== "boolean")
      r.fail("INVALID_INPUT", "标题显示设置格式不正确");
    next.hideTitle = input.hideTitle;
  }
  return next;
}
function saveSession(e, id, body) {
  return db.command(
    e,
    `save-session:${id || "new"}`,
    body,
    true,
    (app, actor) => {
      const prior = id ? db.get(app, "game_sessions", id) : null;
      const fields = version(app, "game_sessions", prior, body.clone === true);
      const source =
        body.clone === true && prior ? sessionDto(app, prior) : body;
      Object.assign(fields, {
        title: r.text(source.title, "场次标题", 200),
        description: r.text(source.description || "", "场次说明", 2000, false),
        minLevel: source.minLevel || "",
        maxLevel: source.maxLevel || "",
        presentation: presentation(source.presentation),
      });
      for (const levelId of [fields.minLevel, fields.maxLevel].filter(Boolean))
        db.get(app, "game_level_definitions", levelId);
      if (
        fields.minLevel &&
        fields.maxLevel &&
        db.get(app, "game_level_definitions", fields.minLevel).getInt("order") >
          db.get(app, "game_level_definitions", fields.maxLevel).getInt("order")
      )
        r.fail("INVALID_INPUT", "等级范围无效");
      const target = source.completionTarget;
      if (target) {
        r.object(target, "完成目标");
        if (target.kind === "narrative") {
          // Copies preserve historical references for repair; normal saves must
          // replace removed content. Publication rechecks in its transaction.
          if (body.clone === true && prior)
            db.get(app, "game_narratives", target.id);
          else policy.requireNarrativeAvailable(app, target.id);
          fields.completionTarget = { kind: "narrative", id: target.id };
        } else if (target.kind === "link")
          fields.completionTarget = {
            kind: "link",
            url: r.safeUrl(target.url, false),
          };
        else r.fail("INVALID_INPUT", "完成目标无效");
      } else fields.completionTarget = null;
      let row;
      if (prior && !body.clone) {
        row = prior;
        for (const key of Object.keys(fields)) row.set(key, fields[key]);
        app.save(row);
      } else row = db.create(app, "game_sessions", fields);
      if (prior && !body.clone) {
        for (const table of [
          "game_reward_rules",
          "game_clues",
          "game_session_levels",
        ])
          for (const old of db.all(app, table, "session={:id}", { id: row.id }))
            app.delete(old);
      }
      const stepMap = {},
        steps = [];
      for (const [index, input] of r
        .list(source.levels, "小关卡", 100)
        .entries()) {
        db.get(app, "game_questions", input.question);
        const step = db.create(app, "game_session_levels", {
          session: row.id,
          question: input.question,
          position: index + 1,
          xp: r.integer(input.xp, "经验"),
          autoNext: input.autoNext === true,
          penaltyPolicy: r.penaltyPolicy(input.penaltyPolicy),
          presentationOverride: presentation(input.presentationOverride),
        });
        steps.push(step);
        if (input.id) stepMap[input.id] = step.id;
      }
      const resolveStep = (input) => {
        if (Number.isInteger(input.levelIndex))
          return steps[
            r.integer(input.levelIndex, "关卡位置", 0, steps.length - 1)
          ].id;
        return input.sessionLevel ? stepMap[input.sessionLevel] || "" : "";
      };
      for (const input of r.list(source.rewardRules || [], "奖品规则", 100)) {
        db.get(app, "game_rewards", input.reward);
        const sessionLevel = resolveStep(input);
        if (
          !["level_completed", "session_completed"].includes(input.trigger) ||
          (input.trigger === "level_completed" && !sessionLevel) ||
          (input.trigger === "session_completed" && sessionLevel)
        )
          r.fail("INVALID_INPUT", "奖品触发条件与关卡不一致");
        db.create(app, "game_reward_rules", {
          session: row.id,
          sessionLevel,
          trigger: input.trigger,
          reward: input.reward,
          quantity: r.integer(input.quantity || 1, "奖品数量", 1, 100),
        });
      }
      for (const [index, input] of r
        .list(source.clues || [], "线索", 100)
        .entries()) {
        const sessionLevel = resolveStep(input);
        if (
          !["start", "level_completed", "session_completed", "manual"].includes(
            input.trigger,
          ) ||
          (input.trigger === "level_completed" && !sessionLevel)
        )
          r.fail("INVALID_INPUT", "线索触发条件无效");
        if (
          !["text", "image", "video", "link", "letter", "bless"].includes(
            input.kind,
          )
        )
          r.fail("INVALID_INPUT", "线索类型无效");
        if (input.narrative) {
          if (body.clone === true && prior)
            db.get(app, "game_narratives", input.narrative);
          else policy.requireNarrativeAvailable(app, input.narrative);
        }
        if (["letter", "bless"].includes(input.kind) && !input.narrative)
          r.fail("INVALID_INPUT", "请选择叙事内容");
        const clean = cluePolicy.cleanContent(input.content || {});
        db.create(app, "game_clues", {
          session: row.id,
          sessionLevel,
          trigger: input.trigger,
          position: index,
          kind: input.kind,
          content: clean,
          narrative: input.narrative || "",
          autoPlay: input.autoPlay === true,
        });
      }
      db.audit(app, actor, "save_session", row, "", body.requestId);
      return { id: row.id };
    },
  );
}
function updateSessionLiveSettings(e, id, body) {
  return db.command(
    e,
    `update-session-live-settings:${id}`,
    body,
    true,
    (app, actor) => {
      cluePolicy.onlyFields(
        body,
        [
          "requestId",
          "reason",
          "expectedVersion",
          "title",
          "description",
          "presentation",
          "levels",
          "clues",
        ],
        "线上场次设置请求",
      );
      const row = db.get(app, "game_sessions", id);
      if (row.getString("status") !== "published")
        r.fail("INVALID_STATE", "仅线上场次可修改展示设置", 409);
      const reason = r.text(body.reason, "修改原因", 1000);
      const expectedVersion = r.text(
        body.expectedVersion,
        "场次设置版本",
        100,
      );
      const beforeDto = sessionDto(app, row);
      if (beforeDto.liveSettingsVersion !== expectedVersion)
        r.fail(
          "EDIT_CONFLICT",
          "线上场次设置已被其他管理员修改，请刷新后重新核对",
          409,
        );
      if (
        !["title", "description", "presentation", "levels", "clues"].some(
          (key) => body[key] !== undefined,
        )
      )
        r.fail("INVALID_INPUT", "请至少修改一项线上场次设置");
      if (body.title !== undefined)
        row.set("title", r.text(body.title, "场次标题", 200));
      if (body.description !== undefined)
        row.set(
          "description",
          r.text(body.description, "场次说明", 2000, false),
        );
      if (body.presentation !== undefined)
        row.set(
          "presentation",
          patchLivePresentation(
            db.json(row, "presentation", {}),
            body.presentation,
            "场次演出设置",
          ),
        );
      app.save(row);
      const seenLevels = new Set();
      for (const [index, input] of r
        .list(body.levels || [], "关卡展示设置", 100)
        .entries()) {
        cluePolicy.onlyFields(
          input,
          ["id", "presentationOverride"],
          `关卡展示设置 ${index + 1}`,
        );
        const levelId = r.text(input.id, "关卡 ID", 30);
        if (seenLevels.has(levelId)) r.fail("INVALID_INPUT", "关卡 ID 重复");
        seenLevels.add(levelId);
        const level = db.get(app, "game_session_levels", levelId);
        if (level.getString("session") !== row.id)
          r.fail("INVALID_INPUT", "关卡不属于当前场次");
        level.set(
          "presentationOverride",
          patchLivePresentation(
            db.json(level, "presentationOverride", {}),
            input.presentationOverride,
            `第 ${index + 1} 项关卡演出设置`,
          ),
        );
        app.save(level);
      }
      const seenClues = new Set();
      for (const [index, input] of r
        .list(body.clues || [], "场次线索设置", 100)
        .entries()) {
        cluePolicy.onlyFields(
          input,
          ["id", "position", "content", "autoPlay"],
          `场次线索设置 ${index + 1}`,
        );
        const clueId = r.text(input.id, "场次线索 ID", 30);
        if (seenClues.has(clueId)) r.fail("INVALID_INPUT", "场次线索 ID 重复");
        seenClues.add(clueId);
        const clue = db.get(app, "game_clues", clueId);
        if (clue.getString("session") !== row.id)
          r.fail("INVALID_INPUT", "线索不属于当前场次");
        if (typeof input.autoPlay !== "boolean")
          r.fail("INVALID_INPUT", "线索自动展示设置格式不正确");
        clue.set("position", r.integer(input.position, "线索顺序", 0, 1000000));
        const kind = clue.getString("kind");
        clue.set(
          "content",
          cluePolicy.QUESTION_KINDS.includes(kind)
            ? cluePolicy.cleanQuestionContent(kind, input.content)
            : cluePolicy.cleanContent(input.content),
        );
        clue.set("autoPlay", input.autoPlay);
        app.save(clue);
      }
      const finalCluePositions = new Set();
      for (const clue of db.all(
        app,
        "game_clues",
        "session={:id}",
        { id: row.id },
      )) {
        const position = clue.getInt("position");
        if (finalCluePositions.has(position))
          r.fail("INVALID_INPUT", "场次线索顺序不能重复");
        finalCluePositions.add(position);
      }
      const afterDto = sessionDto(app, row);
      db.audit(
        app,
        actor,
        "update_session_live_settings",
        row,
        reason,
        body.requestId,
        {
          beforeVersion: beforeDto.liveSettingsVersion,
          afterVersion: afterDto.liveSettingsVersion,
          changedFields: ["title", "description", "presentation"].filter(
            (key) => body[key] !== undefined,
          ),
          levelIds: (body.levels || []).map((level) => level.id),
          levelFields: body.levels === undefined ? [] : ["presentationOverride"],
          clueIds: (body.clues || []).map((clue) => clue.id),
          clueFields:
            body.clues === undefined ? [] : ["position", "content", "autoPlay"],
        },
      );
      return { id: row.id, version: afterDto.liveSettingsVersion };
    },
  );
}
function publish(e, table, id, body) {
  return db.command(e, `publish:${table}:${id}`, body, true, (app, actor) => {
    const row = db.get(app, table, id);
    if (row.getString("status") === "published") return { id };
    if (row.getString("status") !== "draft")
      r.fail("INVALID_STATE", "归档内容不能重新发布", 409);
    if (table === "game_sessions") {
      const steps = db.all(app, "game_session_levels", "session={:id}", { id });
      if (!steps.length) r.fail("INVALID_INPUT", "场次至少需要一个关卡");
      for (const step of steps)
        if (
          db
            .get(app, "game_questions", step.getString("question"))
            .getString("status") !== "published"
        )
          r.fail("INVALID_INPUT", "请先发布场次内全部题目");
      const target = db.json(row, "completionTarget");
      const narrativeIds = db
        .all(app, "game_clues", "session={:id}", { id })
        .map((clue) => clue.getString("narrative"))
        .filter(Boolean);
      if (target && target.kind === "narrative") narrativeIds.push(target.id);
      for (const contentId of new Set(narrativeIds))
        policy.requireNarrativeAvailable(app, contentId, true);
      for (const rule of db.all(app, "game_reward_rules", "session={:id}", {
        id,
      }))
        if (
          !db
            .get(app, "game_rewards", rule.getString("reward"))
            .getBool("active")
        )
          r.fail("INVALID_INPUT", "场次使用了已停用奖品");
    }
    row.set("status", "published");
    app.save(row);
    db.audit(app, actor, "publish", row, "", body.requestId);
    return { id };
  });
}
function assign(e, body) {
  return db.command(e, "assign", body, true, (app, actor) => {
    const session = db.get(app, "game_sessions", body.sessionId);
    if (session.getString("status") !== "published")
      r.fail("INVALID_INPUT", "只允许下发已发布场次");
    if (!["all", "selected"].includes(body.target))
      r.fail("INVALID_INPUT", "请选择所有用户或指定用户");
    const start = r.date(body.startsAt, "开始时间"),
      end = r.date(body.endsAt, "截止时间");
    if (start && end && Date.parse(start) >= Date.parse(end))
      r.fail("INVALID_INPUT", "截止时间必须晚于开始时间");
    let players;
    if (body.target === "all")
      players = db.all(app, "game_players", 'status="active"', {}, "id");
    else {
      const ids = [...new Set(r.list(body.playerIds, "玩家", 1000))];
      if (!ids.length) r.fail("INVALID_INPUT", "请选择至少一位玩家");
      players = ids.map((id) => db.get(app, "game_players", id));
    }
    const results = [];
    for (const player of players) {
      if (player.getString("status") !== "active") {
        results.push({ playerId: player.id, status: "skipped_disabled" });
        continue;
      }
      const prior = db.all(
        app,
        "game_assignments",
        "player={:p} && seriesKey={:s}",
        { p: player.id, s: session.getString("seriesKey") },
        "-created,-id",
      );
      if (
        prior.some((item) =>
          ["assigned", "active"].includes(item.getString("status")),
        )
      ) {
        results.push({ playerId: player.id, status: "skipped_active" });
        continue;
      }
      if (
        body.reissueCompleted !== true &&
        prior.some((item) => item.getString("status") === "completed")
      ) {
        results.push({ playerId: player.id, status: "skipped_completed" });
        continue;
      }
      const row = db.create(app, "game_assignments", {
        player: player.id,
        session: session.id,
        seriesKey: session.getString("seriesKey"),
        previousAssignment: prior.length ? prior[0].id : "",
        order: r.integer(body.order || 0, "展示顺序"),
        status: "assigned",
        startsAt: start,
        endsAt: end,
        assignedBy: actor.id,
      });
      db.audit(
        app,
        actor,
        "assign",
        row,
        body.reissueCompleted === true ? "管理员明确重新下发" : "",
        body.requestId,
        { target: body.target },
      );
      results.push({
        playerId: player.id,
        status: "assigned",
        assignmentId: row.id,
      });
    }
    return {
      target: body.target,
      recipientIds: players.map((player) => player.id),
      results,
    };
  });
}
function archive(e, table, id, body) {
  return db.command(e, `archive:${table}:${id}`, body, true, (app, actor) => {
    const row = db.get(app, table, id);
    const previous = row.getString("status");
    if (table === "game_sessions") {
      const reason = r.text(body.reason, "下线原因", 1000);
      // Also reconcile records archived under the earlier stop-new-dispatch
      // semantics. Never rewrite progress, submissions or settled rewards.
      const pending = db.all(
        app,
        "game_assignments",
        "session={:id} && (status='assigned' || status='active')",
        { id },
      );
      const counts = { assigned: 0, active: 0 };
      for (const assignment of pending) {
        counts[assignment.getString("status")]++;
        assignment.set("status", "cancelled");
        app.save(assignment);
      }
      if (previous !== "archived") {
        row.set("status", "archived");
        app.save(row);
      }
      if (previous !== "archived" || pending.length)
        db.audit(app, actor, "close_session", row, reason, body.requestId, {
          from: previous,
          to: "archived",
          cancelledCount: pending.length,
          counts,
        });
      return { id, cancelledCount: pending.length };
    }
    if (table === "game_narratives") {
      const reason = r.text(body.reason, "删除原因", 1000);
      // Do not reinterpret or break legacy archives still used by live scenes.
      if (previous === "archived") return { id };
      const refs = policy.requireNarrativeDeletable(app, row);
      row.set("status", "archived");
      app.save(row);
      db.audit(app, actor, "delete_narrative", row, reason, body.requestId, {
        from: previous,
        to: "archived",
        historyCount: refs.length,
      });
      return { id };
    }
    if (previous !== "archived") {
      if (table === "game_questions") policy.requireEditable(app, row, true);
      row.set("status", "archived");
      app.save(row);
      db.audit(
        app,
        actor,
        "archive",
        row,
        r.text(body.reason, "归档原因", 1000),
        body.requestId,
        { from: previous },
      );
    }
    return { id };
  });
}
function assignmentAction(e, id, body) {
  return db.command(
    e,
    `assignment-action:${id}`,
    body,
    true,
    (app, actor) => {
      const row = game.assignment(app, id),
        reason = r.text(body.reason, "操作原因", 1000);
      if (body.action === "cancel") {
        if (row.getString("status") === "completed")
          r.fail("INVALID_STATE", "已完成场次不能撤回", 409);
        row.set("status", "cancelled");
        app.save(row);
      } else if (body.action === "extend") {
        if (!["assigned", "active"].includes(row.getString("status")))
          r.fail("INVALID_STATE", "仅未结束场次可延时", 409);
        const end = r.date(body.endsAt, "截止时间");
        if (
          end &&
          (Date.parse(end) <= Date.now() ||
            (row.getString("startsAt") &&
              Date.parse(end) <= Date.parse(row.getString("startsAt"))))
        )
          r.fail("INVALID_INPUT", "截止时间必须晚于现在和开始时间");
        row.set("endsAt", end);
        app.save(row);
      } else if (body.action === "unlock_clue") {
        if (
          !row.getString("startedAt") ||
          row.getString("status") === "cancelled"
        )
          r.fail("INVALID_STATE", "场次尚未开始或已撤回", 409);
        const clue = db.get(app, "game_clues", body.clueId);
        if (clue.getString("session") !== row.getString("session"))
          r.fail("INVALID_INPUT", "线索不属于本场");
        if (
          !db.maybe(app, "game_clue_unlocks", "assignment={:a} && clue={:c}", {
            a: id,
            c: clue.id,
          })
        )
          db.create(app, "game_clue_unlocks", {
            assignment: id,
            clue: clue.id,
            unlockedAt: db.now(),
            sourceType: "manual",
            actor: actor.id,
          });
      } else if (["clear_penalty", "complete_level"].includes(body.action)) {
        if (row.getString("status") !== "active")
          r.fail("INVALID_STATE", "场次必须进行中", 409);
        const step = game
          .levels(app, row)
          .find((level) => level.id === body.sessionLevelId);
        if (!step) r.fail("NOT_FOUND", "关卡不存在", 404);
        const p = game.progressFor(app, row, step.id);
        if (body.action === "clear_penalty") {
          p.set("locked", false);
          p.set("cooldownUntil", "");
          app.save(p);
        } else {
          const first = game
            .levels(app, row)
            .find(
              (level) =>
                !game.progressFor(app, row, level.id).getString("completedAt"),
            );
          if (!p.getString("completedAt") && (!first || first.id !== step.id))
            r.fail("PREVIOUS_LEVEL_REQUIRED", "请先处理前一关", 409);
          if (!p.getString("completedAt")) {
            const submission = db.create(app, "game_answer_submissions", {
              assignment: id,
              sessionLevel: step.id,
              requestId: body.requestId,
              answer: "",
              result: "manual",
              submittedAt: db.now(),
              rulesRevision: "manual-v1",
            });
            game.complete(app, row, step, p, submission, actor);
          }
        }
      } else r.fail("INVALID_INPUT", "未知场次操作");
      db.audit(app, actor, body.action, row, reason, body.requestId);
      return { id };
    },
    (app) => game.onlineSession(app, game.assignment(app, id)),
  );
}
function saveReward(e, id, body) {
  return db.command(
    e,
    `save-reward:${id || "new"}`,
    body,
    true,
    (app, actor) => {
      if (!["staff", "location", "locker"].includes(body.claimMethod))
        r.fail("INVALID_INPUT", "领取方式无效");
      const fields = {
        name: r.text(body.name, "奖品名称", 200),
        image: r.safeUrl(body.image || ""),
        description: r.text(body.description || "", "说明", 2000, false),
        claimMethod: body.claimMethod,
        publicInstructions: r.text(
          body.publicInstructions || "",
          "领取说明",
          4000,
          false,
        ),
        active: body.active !== false,
      };
      const row = id
        ? db.get(app, "game_rewards", id)
        : db.create(app, "game_rewards", fields);
      if (id) {
        for (const key of Object.keys(fields)) row.set(key, fields[key]);
        app.save(row);
      }
      db.audit(app, actor, "save_reward", row, "", body.requestId);
      return { id: row.id };
    },
  );
}
function rewardAction(e, id, body) {
  return db.command(e, `reward-action:${id}`, body, true, (app, actor) => {
    const row = db.get(app, "game_player_rewards", id),
      reason = r.text(body.reason, "操作原因", 1000);
    const status = row.getString("status");
    if (body.action === "redeem") {
      if (status !== "available")
        r.fail("REWARD_NOT_AVAILABLE", "奖品已核销或已作废", 409);
      row.set("status", "redeemed");
      row.set("redeemedAt", db.now());
      row.set("redeemedBy", actor.id);
    } else if (body.action === "undo_redeem") {
      if (status !== "redeemed")
        r.fail("INVALID_STATE", "只有已核销奖品可以撤销核销", 409);
      row.set("status", "available");
      row.set("redeemedAt", "");
      row.set("redeemedBy", "");
    } else if (body.action === "void") {
      if (status !== "available")
        r.fail("INVALID_STATE", "只有未核销奖品可以作废", 409);
      row.set("status", "voided");
    } else if (body.action === "claim_details") {
      if (status !== "available")
        r.fail("INVALID_STATE", "只有待领取奖品可修改领取信息", 409);
      row.set(
        "claimDetails",
        r.text(body.claimDetails || "", "专属领取信息", 4000, false),
      );
    } else r.fail("INVALID_INPUT", "未知奖品操作");
    app.save(row);
    db.audit(app, actor, body.action, row, reason, body.requestId, {
      from: status,
      to: row.getString("status"),
    });
    return { id: row.id };
  });
}
module.exports = {
  catalog,
  playerDto,
  questionDto,
  sessionDto,
  createPlayer,
  playerAction,
  saveQuestion,
  questionClueSet,
  saveQuestionClues,
  saveSession,
  updateSessionLiveSettings,
  publish,
  assign,
  assignmentAction,
  saveReward,
  rewardAction,
  version,
  archive,
};
