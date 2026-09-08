const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);
const v = require(`${__hooks}/lib/extra-validation.js`);
const TABLE = "game_extra_configs";
const DEFS = "game_extra_definitions";
const MAX_BATCH = 100;
function available(app) {
  try {
    app.findCollectionByNameOrId(TABLE);
    app.findCollectionByNameOrId(DEFS);
    return true;
  } catch (_) {
    return false;
  }
}
function ready(app) {
  if (!available(app)) r.fail("BACKEND_NOT_READY", "扩展配置尚未完成迁移", 409);
}
function hash(value) {
  return $security.sha256(r.canonical(value));
}
function definition(row) {
  return db.pick(
    row,
    ["key", "label", "status", "revision", "updated"],
    ["schema"],
  );
}
function definitions(app) {
  ready(app);
  return { items: db.all(app, DEFS, "", {}, "key").map(definition) };
}
function compatible(before, after) {
  const a = { ...before },
    b = { ...after };
  delete a.properties;
  delete b.properties;
  if (r.canonical(a) !== r.canonical(b)) return false;
  if (!before.properties) return true;
  return (
    Object.keys(before.properties).every(
      (k) =>
        after.properties[k] &&
        compatible(before.properties[k], after.properties[k]),
    ) &&
    Object.keys(after.properties).every(
      (k) => before.properties[k] || !after.properties[k].required,
    )
  );
}
function saveDefinition(e, body) {
  return db.command(e, "save-extra-definition", body, true, (app, actor) => {
    ready(app);
    v.only(
      body,
      [
        "requestId",
        "id",
        "key",
        "label",
        "status",
        "schema",
        "expectedRevision",
        "reason",
      ],
      "字段定义",
    );
    let row = body.id ? db.get(app, DEFS, body.id) : null;
    const revision = row ? row.getInt("revision") : 0;
    if (r.integer(body.expectedRevision, "版本") !== revision)
      r.fail("EDIT_CONFLICT", "字段定义已修改，请刷新", 409);
    const key = v.key(body.key),
      schema = v.schema(body.schema),
      reason = r.text(body.reason, "原因", 1000);
    if (!row && db.all(app, DEFS).length >= 100)
      r.fail("INVALID_INPUT", "首版最多 100 个字段定义");
    if (!["active", "disabled"].includes(body.status))
      r.fail("INVALID_INPUT", "定义状态无效");
    if (row && key !== row.getString("key"))
      r.fail("INVALID_INPUT", "字段标识不可改名，请创建新定义");
    const collision = db.maybe(app, DEFS, "key={:key}", { key });
    if (collision && (!row || collision.id !== row.id))
      r.fail("INVALID_INPUT", "字段标识已存在");
    const before = row ? definition(row) : null;
    if (row && db.maybe(app, TABLE, "definition={:id}", { id: row.id })) {
      const previous = db.json(row, "schema", {});
      const a = { ...previous },
        b = { ...schema };
      delete a.fields;
      delete b.fields;
      if (
        r.canonical(a) !== r.canonical(b) ||
        !compatible(previous.fields, schema.fields)
      )
        r.fail(
          "INVALID_INPUT",
          "已有下发记录，仅允许增加可选属性；其他变化请创建新字段定义",
        );
      // Revalidate stored values, including defaults added to an existing definition.
      for (const config of db.all(
        app,
        TABLE,
        "definition={:id} && mode='value'",
        { id: row.id },
      ))
        v.bounded(v.value(schema.fields, db.json(config, "extra", {})));
    }
    const fields = {
      key,
      label: r.text(body.label, "名称", 100),
      status: body.status,
      schema,
      revision: revision + 1,
    };
    if (row) {
      for (const k of Object.keys(fields)) row.set(k, fields[k]);
      app.save(row);
    } else row = db.create(app, DEFS, fields);
    db.audit(app, actor, "save_extra_definition", row, reason, body.requestId, {
      before,
      after: definition(row),
    });
    return definition(row);
  });
}
function target(app, input) {
  const scopeType = input.scopeType;
  if (!v.SCOPES.includes(scopeType))
    r.fail("INVALID_INPUT", "不支持的目标范围");
  const scopeId = r.text(input.scopeId || "", "目标 ID", 30, false);
  const assignmentId = r.text(input.assignmentId || "", "任务 ID", 30, false);
  if (scopeType === "global") {
    if (scopeId || assignmentId)
      r.fail("INVALID_INPUT", "全局配置不能携带目标 ID");
    return {
      scopeType,
      scopeId: "",
      assignment: "",
      targetKey: "global",
      owner: "",
    };
  }
  if (scopeType !== "assignment_level" && assignmentId)
    r.fail("INVALID_INPUT", "当前范围不接受附加任务 ID");
  const tables = {
    rank: "game_level_definitions",
    question: "game_questions",
    session: "game_sessions",
    assignment: "game_assignments",
    session_level: "game_session_levels",
    assignment_level: "game_session_levels",
  };
  const row = db.get(app, tables[scopeType], scopeId);
  let owner = "";
  if (scopeType === "assignment" || scopeType === "assignment_level") {
    const a =
      scopeType === "assignment"
        ? row
        : db.get(app, "game_assignments", assignmentId);
    owner = a.getString("player");
    if (
      scopeType === "assignment_level" &&
      row.getString("session") !== a.getString("session")
    )
      r.fail("INVALID_INPUT", "关卡不属于该次任务的场次");
  }
  return {
    scopeType,
    scopeId,
    assignment: assignmentId,
    targetKey:
      scopeType === "assignment_level"
        ? `assignment_level:${assignmentId}:${scopeId}`
        : `${scopeType}:${scopeId}`,
    owner,
  };
}
function recipients(app, input, dest) {
  if (input.audience === "public") {
    if (dest.owner || (input.playerIds && input.playerIds.length))
      r.fail("INVALID_INPUT", "公共配置不能绑定任务或指定用户");
    return { ids: [""], skipped: [] };
  }
  if (!["all", "selected"].includes(input.audience))
    r.fail("INVALID_INPUT", "接收范围无效");
  if (
    input.audience === "all" &&
    (dest.owner || (input.playerIds && input.playerIds.length))
  )
    r.fail("INVALID_INPUT", "全部用户不适用于专属任务，也不能携带指定名单");
  let players;
  if (input.audience === "all") {
    players = app.findRecordsByFilter(
      "game_players",
      "status='active'",
      "id",
      MAX_BATCH + 1,
      0,
    );
    if (players.length > MAX_BATCH)
      r.fail("INVALID_INPUT", `单次最多 ${MAX_BATCH} 位用户，请选择较小范围`);
  } else {
    const ids = [...new Set(r.list(input.playerIds, "玩家", MAX_BATCH))].sort();
    if (!ids.length) r.fail("INVALID_INPUT", "请选择接收用户");
    players = ids.map((id) => db.get(app, "game_players", id));
  }
  if (dest.owner && players.some((p) => p.id !== dest.owner))
    r.fail("INVALID_INPUT", "任务配置只能下发给任务所属用户");
  return {
    ids: players
      .filter((p) => p.getString("status") === "active")
      .map((p) => p.id)
      .sort(),
    skipped: players
      .filter((p) => p.getString("status") !== "active")
      .map((p) => p.id)
      .sort(),
  };
}
function binding(row) {
  return db.pick(
    row,
    [
      "definition",
      "scopeType",
      "scopeId",
      "assignment",
      "player",
      "targetKey",
      "recipientKey",
      "mode",
      "status",
      "revision",
      "lastRequestId",
      "updated",
    ],
    ["extra"],
  );
}
function prepare(app, body) {
  ready(app);
  v.only(
    body,
    [
      "requestId",
      "definitionId",
      "scopeType",
      "scopeId",
      "assignmentId",
      "audience",
      "playerIds",
      "action",
      "extra",
      "reason",
      "expectedVersion",
    ],
    "下发配置",
  );
  const def = db.get(app, DEFS, body.definitionId),
    schema = v.schema(db.json(def, "schema", {}));
  if (!["value", "suppress", "revoke"].includes(body.action))
    r.fail("INVALID_INPUT", "未知下发操作");
  if (def.getString("status") !== "active" && body.action !== "revoke")
    r.fail("INVALID_INPUT", "字段定义已停用");
  const dest = target(app, body);
  if (!schema.scopes.includes(dest.scopeType))
    r.fail("INVALID_INPUT", "字段不支持该目标范围");
  const audience = recipients(app, body, dest);
  if (!audience.ids.length) r.fail("INVALID_INPUT", "没有有效接收用户");
  const extra =
    body.action === "value"
      ? v.bounded(v.value(schema.fields, r.object(body.extra, "配置值")))
      : {};
  if (body.action !== "value" && body.extra !== undefined)
    r.fail("INVALID_INPUT", "撤销或屏蔽不接受配置值");
  const reason = r.text(body.reason, "操作原因", 1000);
  const candidates = db.all(app, TABLE, "definition={:d} && targetKey={:t}", {
    d: def.id,
    t: dest.targetKey,
  });
  const items = audience.ids.map((id) => {
    const existing = candidates.find(
      (row) => row.getString("recipientKey") === (id || "public"),
    );
    return {
      playerId: id,
      row: existing || null,
      before: existing ? binding(existing) : null,
    };
  });
  // Fingerprint actual recipients and row revisions, not just submitted form values.
  const version = hash({
    definition: definition(def),
    dest,
    audience,
    action: body.action,
    extra,
    reason,
    rows: items.map((i) => i.before),
  });
  return { def, dest, audience, extra, reason, items, version };
}
function preview(e, body) {
  db.actor(e.app, e, true);
  const p = prepare(e.app, body);
  return {
    version: p.version,
    recipientIds: p.audience.ids,
    skippedIds: p.audience.skipped,
    normalizedExtra: p.extra,
    items: p.items.map((i) => ({
      playerId: i.playerId,
      before: i.before,
      action: body.action,
    })),
  };
}
function dispatch(e, body) {
  return db.command(e, "dispatch-extra", body, true, (app, actor) => {
    const p = prepare(app, body);
    if (body.expectedVersion !== p.version)
      r.fail("EDIT_CONFLICT", "接收名单或配置已变化，请重新预览", 409);
    const results = [];
    for (const item of p.items) {
      let row = item.row;
      if (!row && body.action === "revoke") {
        results.push({ playerId: item.playerId, status: "skipped_missing" });
        continue;
      }
      const fields = {
        definition: p.def.id,
        scopeType: p.dest.scopeType,
        scopeId: p.dest.scopeId,
        assignment: p.dest.assignment,
        player: item.playerId,
        targetKey: p.dest.targetKey,
        recipientKey: item.playerId || "public",
        extra: body.action === "revoke" ? db.json(row, "extra", {}) : p.extra,
        mode: body.action === "revoke" ? row.getString("mode") : body.action,
        status: body.action === "revoke" ? "revoked" : "active",
        revision: (row ? row.getInt("revision") : 0) + 1,
        lastRequestId: body.requestId,
      };
      if (row) {
        for (const k of Object.keys(fields)) row.set(k, fields[k]);
        app.save(row);
      } else row = db.create(app, TABLE, fields);
      db.audit(
        app,
        actor,
        body.action === "revoke"
          ? "revoke_extra_config"
          : "dispatch_extra_config",
        row,
        p.reason,
        body.requestId,
        { before: item.before, after: binding(row) },
      );
      results.push({
        id: row.id,
        playerId: item.playerId,
        revision: fields.revision,
        status: fields.status,
      });
    }
    return {
      requestId: body.requestId,
      recipientIds: p.audience.ids,
      skippedIds: p.audience.skipped,
      results,
    };
  });
}
function query(e, body) {
  db.actor(e.app, e, true);
  ready(e.app);
  v.only(
    body,
    ["definitionId", "playerId", "scopeType", "page", "batchId"],
    "查询",
  );
  const clauses = [],
    params = {};
  for (const [input, field] of [
    ["definitionId", "definition"],
    ["playerId", "player"],
    ["scopeType", "scopeType"],
    ["batchId", "lastRequestId"],
  ])
    if (body[input]) {
      clauses.push(`${field}={:${input}}`);
      params[input] = r.text(body[input], "筛选值", 100);
    }
  const page = r.integer(body.page || 1, "页码", 1, 10000);
  const rows = e.app.findRecordsByFilter(
    TABLE,
    clauses.join(" && "),
    "-updated,-id",
    21,
    (page - 1) * 20,
    params,
  );
  return {
    items: rows.slice(0, 20).map(binding),
    hasMore: rows.length > 20,
    page,
  };
}
function revokeBatch(e, body) {
  return db.command(e, "revoke-extra-batch", body, true, (app, actor) => {
    ready(app);
    v.only(body, ["requestId", "batchId", "reason", "records"], "批次撤销");
    const reason = r.text(body.reason, "原因", 1000),
      batchId = r.text(body.batchId, "批次", 100);
    const records = r.list(body.records, "记录", MAX_BATCH);
    if (
      !records.length ||
      new Set(records.map((i) => i.id)).size !== records.length
    )
      r.fail("INVALID_INPUT", "记录列表为空或重复");
    const rows = records.map((i) => {
      const row = db.get(app, TABLE, i.id);
      if (
        row.getString("lastRequestId") !== batchId ||
        row.getInt("revision") !== i.revision ||
        row.getString("status") !== "active"
      )
        r.fail("EDIT_CONFLICT", "批次中的配置已变化，请重新查询", 409);
      return row;
    });
    for (const row of rows) {
      const before = binding(row);
      row.set("status", "revoked");
      row.set("revision", row.getInt("revision") + 1);
      row.set("lastRequestId", body.requestId);
      app.save(row);
      db.audit(app, actor, "revoke_extra_config", row, reason, body.requestId, {
        before,
        after: binding(row),
      });
    }
    return { changed: rows.length };
  });
}
// Request-local resolver. Only exact target keys and this recipient are loaded.
function reader(app, playerId, targetKeys) {
  if (!available(app))
    return () => ({ extra: {}, extraDisplay: [], sources: {} });
  const defs = db
    .all(app, DEFS, "status='active'", {}, "key")
    .flatMap((row) => {
      try {
        const item = definition(row);
        v.key(item.key);
        return [{ ...item, schema: v.schema(item.schema) }];
      } catch (_) {
        return [];
      }
    });
  const keys = [...new Set(["global", ...targetKeys])],
    params = { player: playerId || "" };
  const terms = keys.map((key, i) => {
    params[`t${i}`] = key;
    return `targetKey={:t${i}}`;
  });
  const rows = db.all(
    app,
    TABLE,
    `status='active' && (recipientKey='public' || player={:player}) && (${terms.join(" || ")})`,
    params,
  );
  const byBinding = Object.create(null);
  for (const row of rows)
    byBinding[
      `${row.getString("definition")}|${row.getString("targetKey")}|${row.getString("recipientKey")}`
    ] = row;
  let responseBytes = 0;
  return (context, chain, includeAdmin = false) => {
    const extra = {},
      extraDisplay = [],
      sources = {};
    for (const def of defs) {
      if (
        (!includeAdmin && def.schema.visibility !== "player") ||
        !def.schema.contexts.includes(context)
      )
        continue;
      let chosen;
      for (const key of ["global", ...chain])
        for (const recipient of ["public", playerId]) {
          if (!recipient) continue;
          const row = byBinding[`${def.id}|${key}|${recipient}`];
          if (row) chosen = row;
        }
      if (!chosen) continue;
      sources[def.key] = {
        id: chosen.id,
        targetKey: chosen.getString("targetKey"),
        recipientKey: chosen.getString("recipientKey"),
        mode: chosen.getString("mode"),
        revision: chosen.getInt("revision"),
      };
      if (chosen.getString("mode") === "suppress") continue;
      try {
        const data = v.bounded(
          v.value(def.schema.fields, db.json(chosen, "extra", {})),
        );
        const displayBytes =
          def.schema.renderer === "text"
            ? v.bytes({ key: def.key, label: def.label, text: data.text || "" })
            : 0;
        const dataBytes = v.bytes({ [def.key]: data }) + displayBytes;
        if (
          responseBytes + dataBytes > 262144 ||
          v.bytes({ ...extra, [def.key]: data }) > 65536
        )
          continue;
        responseBytes += dataBytes;
        extra[def.key] = data;
        if (
          def.schema.renderer === "text" &&
          typeof data.text === "string" &&
          data.text
        )
          extraDisplay.push({
            key: def.key,
            label: def.label,
            text: data.text,
          });
      } catch (_) {
        /* Bad optional configuration must not interrupt gameplay. */
      }
    }
    return { extra, extraDisplay, sources };
  };
}
function publicResult(result) {
  return { extra: result.extra, extraDisplay: result.extraDisplay };
}
function inspect(e, body) {
  db.actor(e.app, e, true);
  ready(e.app);
  v.only(
    body,
    ["playerId", "context", "assignmentId", "sessionLevelId"],
    "效果预览",
  );
  const player = db.get(e.app, "game_players", body.playerId);
  let chain = [];
  if (body.context === "profile") {
    const stats = db.maybe(e.app, "game_player_stats", "player={:id}", {
      id: player.id,
    });
    const rank = db.all(
      e.app,
      "game_level_definitions",
      "minTotalXp<={:xp}",
      { xp: stats.getInt("totalXp") },
      "-order",
    )[0];
    chain = [`rank:${rank.id}`];
  } else if (["assignment", "level"].includes(body.context)) {
    const a = db.get(e.app, "game_assignments", body.assignmentId);
    if (a.getString("player") !== player.id)
      r.fail("INVALID_INPUT", "任务不属于此用户");
    chain = [`session:${a.getString("session")}`, `assignment:${a.id}`];
    if (body.context === "level") {
      const step = db.get(e.app, "game_session_levels", body.sessionLevelId);
      if (step.getString("session") !== a.getString("session"))
        r.fail("INVALID_INPUT", "关卡不属于该任务");
      chain = [
        `question:${step.getString("question")}`,
        ...chain,
        `session_level:${step.id}`,
        `assignment_level:${a.id}:${step.id}`,
      ];
    }
  } else r.fail("INVALID_INPUT", "输出位置无效");
  return reader(e.app, player.id, chain)(body.context, chain);
}
module.exports = {
  available,
  definitions,
  saveDefinition,
  preview,
  dispatch,
  query,
  revokeBatch,
  reader,
  publicResult,
  inspect,
};
