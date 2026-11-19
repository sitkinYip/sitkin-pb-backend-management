/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const relation = (name, target) => ({
      name, type: "relation", collectionId: app.findCollectionByNameOrId(target).id,
      maxSelect: 1, required: true, cascadeDelete: true,
    });
    const revision = () => ({ name: "revision", type: "number", min: 1, onlyInt: true, required: true });
    const create = (name, fields, indexes) => app.save(new Collection({
      name, type: "base", listRule: null, viewRule: null, createRule: null,
      updateRule: null, deleteRule: null, fields, indexes,
    }));
    create("game_push_subscriptions", [
      relation("player", "game_players"), relation("assignment", "game_assignments"),
      { name: "subscribed", type: "bool" }, { name: "pushEnabled", type: "bool" },
      revision(),
    ], [
      "CREATE UNIQUE INDEX idx_game_push_subscriptions_assignment ON game_push_subscriptions (assignment)",
      "CREATE INDEX idx_game_push_subscriptions_player ON game_push_subscriptions (player)",
    ]);
    create("game_push_notice_contexts", [
      relation("notification", "game_notifications"), relation("session", "game_sessions"),
    ], [
      "CREATE UNIQUE INDEX idx_game_push_notice_contexts_notification ON game_push_notice_contexts (notification)",
    ]);
    create("game_push_notice_deliveries", [
      relation("delivery", "game_push_deliveries"), relation("subscription", "game_push_subscriptions"),
      revision(),
      { name: "category", type: "select", values: ["MARKETING", "SUBSCRIPTION"], maxSelect: 1, required: true },
    ], [
      "CREATE UNIQUE INDEX idx_game_push_notice_deliveries_delivery ON game_push_notice_deliveries (delivery)",
      "CREATE INDEX idx_game_push_notice_deliveries_subscription ON game_push_notice_deliveries (subscription)",
    ]);
  },
  () => { throw new Error("Push subscription downgrade is disabled; retain its additive private tables."); },
);
