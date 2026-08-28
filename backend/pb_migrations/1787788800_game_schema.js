/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const t = (name, required = false, max = 500) => ({
      name,
      type: "text",
      required,
      max,
    });
    const n = (name, min = 0) => ({ name, type: "number", onlyInt: true, min });
    const s = (name, values) => ({
      name,
      type: "select",
      required: true,
      maxSelect: 1,
      values,
    });
    const j = (name) => ({ name, type: "json", maxSize: 200000 });
    const d = (name) => ({ name, type: "date" });
    const b = (name) => ({ name, type: "bool" });
    const relation = (name, collection, required = true) => ({
      name,
      type: "relation",
      collection,
      required,
    });
    const version = () => [
      t("seriesKey", true, 50),
      n("revision", 1),
      s("status", ["draft", "published", "archived"]),
    ];
    const unique = (table, suffix, fields) =>
      `CREATE UNIQUE INDEX idx_${table}_${suffix} ON ${table} (${fields})`;
    const specs = {
      game_players: {
        auth: true,
        fields: [
          t("displayName", true, 40),
          b("mustChangePassword"),
          {
            name: "avatar",
            type: "file",
            maxSelect: 1,
            maxSize: 2097152,
            mimeTypes: ["image/jpeg", "image/png", "image/webp"],
            protected: true,
            thumbs: ["128x128"],
          },
        ],
      },
      game_admins: { auth: true, fields: [t("displayName", true, 40)] },
      game_player_stats: {
        fields: [relation("player", "game_players"), n("totalXp")],
        unique: [["player", "player"]],
      },
      game_level_definitions: {
        fields: [
          n("order", 1),
          t("name", true, 60),
          n("minTotalXp"),
          j("visualConfig"),
        ],
        unique: [
          ["order", '"order"'],
          ["xp", "minTotalXp"],
        ],
      },
      game_questions: {
        fields: [
          ...version(),
          s("kind", ["text", "choice"]),
          t("title", true, 200),
          j("content"),
          j("options"),
          t("placeholder"),
        ],
        unique: [["revision", "seriesKey, revision"]],
      },
      game_answer_keys: {
        fields: [
          relation("question", "game_questions"),
          j("acceptedAnswers"),
          t("normalizationVersion", true),
        ],
        unique: [["question", "question"]],
      },
      game_narratives: {
        fields: [
          ...version(),
          s("kind", ["letter", "bless"]),
          t("title", true, 200),
          j("payload"),
        ],
        unique: [["revision", "seriesKey, revision"]],
      },
      game_sessions: {
        fields: [
          ...version(),
          t("title", true, 200),
          t("description", false, 2000),
          relation("minLevel", "game_level_definitions", false),
          relation("maxLevel", "game_level_definitions", false),
          j("presentation"),
          j("completionTarget"),
        ],
        unique: [["revision", "seriesKey, revision"]],
      },
      game_session_levels: {
        fields: [
          relation("session", "game_sessions"),
          relation("question", "game_questions"),
          n("position", 1),
          n("xp"),
          j("penaltyPolicy"),
          b("autoNext"),
          j("presentationOverride"),
        ],
        unique: [["position", "session, position"]],
      },
      game_assignments: {
        fields: [
          relation("player", "game_players"),
          relation("session", "game_sessions"),
          t("seriesKey", true),
          relation("previousAssignment", "game_assignments", false),
          n("order"),
          s("status", ["assigned", "active", "completed", "cancelled"]),
          d("startsAt"),
          d("endsAt"),
          d("startedAt"),
          d("completedAt"),
          j("admissionSnapshot"),
          relation("assignedBy", "game_admins"),
        ],
      },
      game_level_progress: {
        fields: [
          relation("assignment", "game_assignments"),
          relation("sessionLevel", "game_session_levels"),
          d("completedAt"),
          n("wrongCount"),
          d("cooldownUntil"),
          b("locked"),
          t("lastSubmission"),
        ],
        unique: [["level", "assignment, sessionLevel"]],
      },
      game_answer_submissions: {
        fields: [
          relation("assignment", "game_assignments"),
          relation("sessionLevel", "game_session_levels"),
          t("requestId", true, 100),
          t("answer", false, 4000),
          s("result", ["correct", "incorrect", "manual"]),
          d("submittedAt"),
          t("rulesRevision", true),
        ],
      },
      game_xp_ledger: {
        fields: [
          relation("player", "game_players"),
          relation("assignment", "game_assignments", false),
          relation("sessionLevel", "game_session_levels", false),
          { ...n("delta"), min: null },
          t("sourceType", true),
          t("sourceKey", true, 250),
          t("reason", false, 1000),
          relation("actor", "game_admins", false),
        ],
        unique: [["source", "sourceKey"]],
      },
      game_rewards: {
        fields: [
          t("name", true, 200),
          t("image", false, 2000),
          t("description", false, 2000),
          s("claimMethod", ["staff", "location", "locker"]),
          t("publicInstructions", false, 4000),
          b("active"),
        ],
      },
      game_reward_rules: {
        fields: [
          relation("session", "game_sessions"),
          relation("sessionLevel", "game_session_levels", false),
          s("trigger", ["level_completed", "session_completed"]),
          relation("reward", "game_rewards"),
          n("quantity", 1),
        ],
      },
      game_player_rewards: {
        fields: [
          relation("player", "game_players"),
          relation("assignment", "game_assignments", false),
          relation("rule", "game_reward_rules", false),
          t("sourceKey", true, 250),
          relation("reward", "game_rewards"),
          j("snapshot"),
          n("quantity", 1),
          s("status", ["available", "redeemed", "voided"]),
          t("claimDetails", false, 4000),
          d("redeemedAt"),
          relation("redeemedBy", "game_admins", false),
        ],
        unique: [["source", "sourceKey"]],
      },
      game_clues: {
        fields: [
          relation("session", "game_sessions"),
          relation("sessionLevel", "game_session_levels", false),
          s("trigger", [
            "start",
            "level_completed",
            "session_completed",
            "manual",
          ]),
          n("position"),
          s("kind", ["text", "image", "video", "link", "letter", "bless"]),
          j("content"),
          relation("narrative", "game_narratives", false),
          b("autoPlay"),
        ],
      },
      game_clue_unlocks: {
        fields: [
          relation("assignment", "game_assignments"),
          relation("clue", "game_clues"),
          d("unlockedAt"),
          t("sourceType", true),
          relation("actor", "game_admins", false),
        ],
        unique: [["clue", "assignment, clue"]],
      },
      game_notifications: {
        fields: [
          t("title", true, 200),
          t("content", true, 16000),
          t("popupTitle"),
          t("buttonText"),
          d("sentAt"),
          d("expiresAt"),
          s("status", ["sent", "withdrawn"]),
          relation("createdBy", "game_admins"),
        ],
      },
      game_notification_receipts: {
        fields: [
          relation("notification", "game_notifications"),
          relation("player", "game_players"),
          relation("assignment", "game_assignments", false),
          d("readAt"),
        ],
        unique: [["recipient", "notification, player"]],
      },
      game_admin_audit_logs: {
        fields: [
          relation("actor", "game_admins"),
          t("action", true),
          t("entityType", true),
          t("entityId", true),
          t("reason", false, 1000),
          j("safeDiff"),
          t("requestId", false, 100),
        ],
      },
      game_command_receipts: {
        fields: [
          t("actorCollection", true),
          t("actorId", true),
          t("operation", true, 200),
          t("requestId", true, 100),
          t("requestHash", true, 100),
          j("resultRefs"),
        ],
        unique: [["request", "actorCollection, actorId, operation, requestId"]],
      },
    };
    const collections = {};
    for (const name of Object.keys(specs)) {
      const spec = specs[name];
      const fields = [
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ];
      const config = {
        name,
        type: spec.auth ? "auth" : "base",
        fields,
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
      };
      if (spec.auth) {
        fields.push(
          { ...t("account", true, 32), pattern: "^[a-z0-9][a-z0-9._-]{2,31}$" },
          s("status", ["active", "disabled"]),
        );
        config.indexes = [unique(name, "account", "account")];
        config.passwordAuth = { enabled: true, identityFields: ["account"] };
        config.authRule = 'status = "active"';
        config.authToken = { duration: 86400 };
        config.authAlert = { enabled: false };
        config.manageRule = null;
      }
      const collection = new Collection(config);
      try {
        app.save(collection);
      } catch (error) {
        throw new Error(`${name}: ${error}`);
      }
      collections[name] = collection;
    }
    for (const name of Object.keys(specs)) {
      const collection = collections[name];
      const spec = specs[name];
      if (spec.auth) collection.fields.getByName("email").required = false;
      for (const definition of spec.fields) {
        const field = Object.assign({}, definition);
        if (field.type === "relation") {
          field.collectionId = collections[field.collection].id;
          field.maxSelect = 1;
          field.cascadeDelete = false;
          delete field.collection;
        }
        const constructors = {
          text: TextField,
          number: NumberField,
          select: SelectField,
          json: JSONField,
          date: DateField,
          bool: BoolField,
          file: FileField,
          relation: RelationField,
        };
        collection.fields.add(new constructors[field.type](field));
      }
      for (const [suffix, fields] of spec.unique || [])
        collection.addIndex(`idx_${name}_${suffix}`, true, fields, "");
      if (name === "game_assignments") {
        collection.addIndex(
          "idx_game_assignments_player",
          false,
          "player, status",
          "",
        );
        collection.addIndex(
          "idx_game_assignments_active",
          true,
          "player, seriesKey",
          "status = 'assigned' OR status = 'active'",
        );
      }
      if (name === "game_players")
        collection.viewRule =
          '@request.auth.collectionName = "game_players" && @request.auth.status = "active" && id = @request.auth.id';
      try {
        app.save(collection);
      } catch (error) {
        throw new Error(`${name}: ${error}`);
      }
    }
    [0, 100, 250, 500, 1000].forEach((xp, index) => {
      const record = new Record(collections.game_level_definitions);
      record.set("order", index + 1);
      record.set("name", `旅行者 ${index + 1}`);
      record.set("minTotalXp", xp);
      app.save(record);
    });
  },
  () => {
    throw new Error(
      "Game schema downgrade is intentionally disabled. Restore a verified backup instead of deleting gameplay history.",
    );
  },
);
