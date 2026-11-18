/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    app.save(new Collection({
      name: "game_push_settings", type: "base",
      listRule: null, viewRule: null, createRule: null,
      updateRule: null, deleteRule: null,
      fields: [
        { name: "audience", type: "select", values: ["allowlist", "all"], maxSelect: 1, required: true },
        { name: "playerIds", type: "json", maxSize: 20000 },
        { name: "revision", type: "number", min: 1, onlyInt: true, required: true },
      ],
    }));
  },
  () => {
    throw new Error("Push audience downgrade is disabled; retain its additive settings table.");
  },
);
