/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("game_admin_audit_logs");
    const field = collection.fields.getByName("safeDiff");
    if (!field) throw new Error("Missing game_admin_audit_logs.safeDiff field");
    // Keep the original field ID and any larger limit configured in the future.
    // A full before/after question configuration spans several JSON columns.
    if (field.maxSize >= 2000000) return;
    field.maxSize = 2000000;
    app.save(collection);
  },
  () => {
    throw new Error(
      "Audit capacity downgrade is intentionally disabled: existing audit records may exceed 200000 bytes. Keep the expanded limit when rolling back application code.",
    );
  },
);
