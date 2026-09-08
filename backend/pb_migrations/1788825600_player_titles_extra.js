/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const text = (name, max = 100, required = true) => ({
      name,
      type: "text",
      max,
      required,
    });
    const relation = (name, table, required = true) => ({
      name,
      type: "relation",
      collectionId: app.findCollectionByNameOrId(table).id,
      maxSelect: 1,
      required,
      cascadeDelete: false,
    });
    const select = (name, values) => ({
      name,
      type: "select",
      values,
      maxSelect: 1,
      required: true,
    });
    const json = (name, maxSize = 16384) => ({ name, type: "json", maxSize });
    const create = (name, fields, indexes) =>
      app.save(
        new Collection({
          name,
          type: "base",
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          fields: [
            {
              name: "created",
              type: "autodate",
              onCreate: true,
              onUpdate: false,
            },
            {
              name: "updated",
              type: "autodate",
              onCreate: true,
              onUpdate: true,
            },
            {
              name: "revision",
              type: "number",
              onlyInt: true,
              min: 1,
              required: true,
            },
            ...fields,
          ],
          indexes,
        }),
      );
    create(
      "game_player_level_titles",
      [
        relation("player", "game_players"),
        relation("level", "game_level_definitions"),
        text("name", 60),
        select("status", ["active", "revoked"]),
        json("extra"),
      ],
      [
        "CREATE UNIQUE INDEX idx_game_player_level_titles_owner ON game_player_level_titles (player, level)",
      ],
    );
    create(
      "game_extra_definitions",
      [
        text("key", 60),
        text("label", 100),
        select("status", ["active", "disabled"]),
        json("schema"),
      ],
      [
        "CREATE UNIQUE INDEX idx_game_extra_definitions_key ON game_extra_definitions (key)",
      ],
    );
    create(
      "game_extra_configs",
      [
        relation("definition", "game_extra_definitions"),
        text("scopeType", 30),
        text("scopeId", 30, false),
        relation("assignment", "game_assignments", false),
        relation("player", "game_players", false),
        text("targetKey", 100),
        text("recipientKey", 40),
        json("extra"),
        select("mode", ["value", "suppress"]),
        select("status", ["active", "revoked"]),
        text("lastRequestId", 100),
      ],
      [
        "CREATE UNIQUE INDEX idx_game_extra_configs_binding ON game_extra_configs (definition, targetKey, recipientKey)",
        "CREATE INDEX idx_game_extra_configs_lookup ON game_extra_configs (targetKey, recipientKey, status)",
        "CREATE INDEX idx_game_extra_configs_request ON game_extra_configs (lastRequestId)",
      ],
    );
  },
  () => {
    throw new Error(
      "Player titles and extra configuration downgrade is intentionally disabled. Keep additive tables when rolling back application code.",
    );
  },
);
