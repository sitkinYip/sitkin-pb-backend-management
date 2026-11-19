/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const relation = (name, target) => ({ name, type: "relation", collectionId: app.findCollectionByNameOrId(target).id,
      maxSelect: 1, required: true, cascadeDelete: true });
    const scope = () => ({ name: "scope", type: "select", values: ["personal_journey_v1"], maxSelect: 1, required: true });
    const revision = () => ({ name: "revision", type: "number", min: 1, onlyInt: true, required: true });
    const create = (name, fields, indexes) => app.save(new Collection({ name, type: "base", listRule: null,
      viewRule: null, createRule: null, updateRule: null, deleteRule: null, fields, indexes }));
    create("game_push_journey_subscriptions", [relation("player", "game_players"), scope(),
      { name: "subscribed", type: "bool" }, { name: "pushEnabled", type: "bool" }, revision()], [
      "CREATE UNIQUE INDEX idx_game_push_journey_subscriptions_player_scope ON game_push_journey_subscriptions (player, scope)",
    ]);
    create("game_push_journey_deliveries", [relation("delivery", "game_push_deliveries"),
      relation("subscription", "game_push_journey_subscriptions"), scope(), revision(),
      { name: "category", type: "select", values: ["SUBSCRIPTION"], maxSelect: 1, required: true }], [
      "CREATE UNIQUE INDEX idx_game_push_journey_deliveries_delivery ON game_push_journey_deliveries (delivery)",
      "CREATE INDEX idx_game_push_journey_deliveries_subscription ON game_push_journey_deliveries (subscription)",
    ]);
    // No conversion of legacy per-assignment consent: the wider scope starts empty.
  },
  () => { throw new Error("Journey subscription downgrade is disabled; retain additive private tables."); },
);
