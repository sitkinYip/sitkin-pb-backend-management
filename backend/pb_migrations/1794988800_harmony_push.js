/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const text = (name, max, hidden = false) => ({
      name, type: "text", max, required: true, hidden,
    });
    const relation = (name, table) => ({
      name, type: "relation",
      collectionId: app.findCollectionByNameOrId(table).id,
      maxSelect: 1, required: true, cascadeDelete: true,
    });
    const date = (name) => ({ name, type: "date", required: true });
    const select = (name, values) => ({
      name, type: "select", values, maxSelect: 1, required: true,
    });
    const index = (suffix, table, fields, unique = false) =>
      `CREATE ${unique ? "UNIQUE " : ""}INDEX idx_${table}_${suffix} ON ${table} (${fields})`;
    const create = (name, fields, indexes) =>
      app.save(new Collection({
        name, type: "base",
        listRule: null, viewRule: null, createRule: null,
        updateRule: null, deleteRule: null,
        fields, indexes,
      }));
    const bindings = "game_push_bindings";
    create(bindings, [
      relation("player", "game_players"),
      text("installationId", 80, true),
      text("token", 4096, true),
      text("profileId", 64, true),
      text("revokeTicket", 48, true),
      text("accountKey", 64, true),
      date("expiresAt"),
    ], [
      index("installation", bindings, "installationId", true),
      index("token", bindings, "token", true),
      index("profile", bindings, "profileId", true),
      index("player", bindings, "player, expiresAt"),
      index("expiry", bindings, "expiresAt"),
    ]);
    const deliveries = "game_push_deliveries";
    create(deliveries, [
      relation("binding", bindings),
      select("kind", ["assignment", "inbox"]),
      text("targetId", 40),
      select("status", ["pending", "sending", "accepted", "discarded", "failed"]),
      date("availableAt"),
      date("expiresAt"),
      { name: "attempts", type: "number", min: 0, onlyInt: true },
      { name: "lease", type: "text", max: 48, hidden: true },
      { name: "providerCode", type: "text", max: 8 },
    ], [
      index("event", deliveries, "binding, kind, targetId", true),
      index("ready", deliveries, "status, availableAt"),
      index("expiry", deliveries, "expiresAt"),
    ]);
  },
  () => {
    throw new Error(
      "Harmony Push downgrade is disabled. Keep additive tables when rolling back application code.",
    );
  },
);
