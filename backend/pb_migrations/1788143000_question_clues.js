/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const questions = app.findCollectionByNameOrId("game_questions");
    const collection = new Collection({
      name: "game_question_clues",
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
        { name: "position", type: "number", onlyInt: true, min: 0 },
        {
          name: "kind",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["text", "image", "video", "link"],
        },
        { name: "content", type: "json", maxSize: 200000 },
        { name: "autoPlay", type: "bool" },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["active", "archived"],
        },
      ],
      indexes: [
        "CREATE INDEX idx_game_question_clues_query ON game_question_clues (question, status, position, id)",
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
      "Question clue downgrade is intentionally disabled. Keep the additive collection or restore a verified pre-upgrade backup.",
    );
  },
);
