/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("game_push_notice_contexts");
    const session = collection.fields.getByName("session");
    if (!session || collection.fields.getByName("kind")) throw new Error("Unexpected Push notice context schema");
    // Existing rows retain their exact session and meaning; the new account variant has no session.
    session.required = false;
    collection.fields.add(new SelectField({ name: "kind", values: ["session", "account"], maxSelect: 1 }));
    app.save(collection);
    for (let offset = 0; ; offset += 500) {
      const rows = app.findRecordsByFilter(collection.id, "", "id", 500, offset);
      for (const row of rows) {
        if (!row.getString("session")) throw new Error("Legacy Push context is missing its session");
        row.set("kind", "session"); app.save(row);
      }
      if (rows.length < 500) break;
    }
    collection.fields.getByName("kind").required = true;
    app.save(collection);
  },
  () => { throw new Error("Personal journey notice downgrade is disabled; retain directed notices and their context."); },
);
