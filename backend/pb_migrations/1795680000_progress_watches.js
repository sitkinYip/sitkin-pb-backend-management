/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const watches = "game_progress_watches";
  const deliveries = "game_progress_deliveries";
  const relation = (name, target) => ({ name, type: "relation", required: true,
    collectionId: app.findCollectionByNameOrId(target).id, maxSelect: 1, cascadeDelete: true });
  const date = (name) => ({ name, type: "date", required: true });
  const integer = (name, min = 0) => ({ name, type: "number", onlyInt: true, min });
  const flag = (name) => ({ name, type: "bool" });
  const select = (name, values) => ({ name, type: "select", required: true, maxSelect: 1, values });
  const create = (name, fields, indexes) => app.save(new Collection({
    name, type: "base", listRule: null, viewRule: null, createRule: null,
    updateRule: null, deleteRule: null, fields, indexes,
  }));
  create(watches, [relation("watcher", "game_players"), relation("assignment", "game_assignments"),
    date("expiresAt"), flag("revoked"), flag("subscribed"), flag("pushEnabled"),
    { name: "eventKinds", type: "json", maxSize: 150 }, integer("revision", 1)], [
    `CREATE UNIQUE INDEX idx_${watches}_watcher_assignment ON ${watches} (watcher, assignment)`,
    `CREATE INDEX idx_${watches}_assignment_expiry ON ${watches} (assignment, expiresAt)`,
  ]);
  create(deliveries, [relation("binding", "game_push_bindings"), relation("watch", watches),
    relation("submission", "game_answer_submissions"), integer("revision", 1),
    select("outcome", ["correct", "incorrect", "completed"]),
    select("status", ["pending", "sending", "accepted", "discarded", "failed"]),
    date("availableAt"), date("expiresAt"), integer("attempts"),
    { name: "lease", type: "text", max: 48, hidden: true }, { name: "providerCode", type: "text", max: 8 }], [
    `CREATE UNIQUE INDEX idx_${deliveries}_event ON ${deliveries} (binding, watch, submission)`,
    `CREATE INDEX idx_${deliveries}_ready ON ${deliveries} (status, availableAt)`,
    `CREATE INDEX idx_${deliveries}_expiry ON ${deliveries} (expiresAt)`,
    `CREATE INDEX idx_${deliveries}_watch ON ${deliveries} (watch, status)`,
  ]);
}, () => {
  throw new Error("Progress watch records require a forward migration.");
});
