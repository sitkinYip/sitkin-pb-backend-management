/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const questions = app.findCollectionByNameOrId("game_questions");
    const collection = new Collection({
      name: "game_question_settings",
      type: "base",
      fields: [
        { name: "created", type: "autodate", onCreate: true, onUpdate: false },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        {
          name: "question",
          type: "relation",
          collectionId: questions.id,
          required: true,
          maxSelect: 1,
          cascadeDelete: false,
        },
        {
          name: "answerMatchMode",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["exact", "contains_all"],
        },
        { name: "groupName", type: "text", required: true, max: 60 },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_game_question_settings_question ON game_question_settings (question)",
      ],
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(collection);
  },
  () => {
    throw new Error(
      "Question settings downgrade is intentionally disabled. Keep the additive collection or restore a verified pre-upgrade backup.",
    );
  },
);
