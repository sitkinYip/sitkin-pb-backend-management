import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL(
    "../pb_migrations/1788176000_question_settings.js",
    import.meta.url,
  ),
  "utf8",
);
const allowedDelta = JSON.parse(
  readFileSync(
    new URL("./fixtures/allowed-delta-question-settings.json", import.meta.url),
    "utf8",
  ),
);
let up;
let down;
class TestCollection {
  constructor(options) {
    Object.assign(this, options);
  }
}
vm.runInNewContext(source, {
  Collection: TestCollection,
  migrate: (forward, reverse) => {
    up = forward;
    down = reverse;
  },
});

test("question settings migration is additive, private and uniquely related", () => {
  let saved;
  up({
    findCollectionByNameOrId: (name) => {
      assert.equal(name, "game_questions");
      return { id: "questions_collection" };
    },
    save: (collection) => {
      saved = collection;
    },
  });
  assert.equal(saved.name, "game_question_settings");
  assert.equal(saved.type, "base");
  assert.equal(saved.listRule, null);
  assert.equal(saved.viewRule, null);
  assert.equal(saved.createRule, null);
  assert.equal(saved.updateRule, null);
  assert.equal(saved.deleteRule, null);
  assert.equal(
    saved.fields.find((field) => field.name === "question").collectionId,
    "questions_collection",
  );
  assert.deepEqual(
    Array.from(
      saved.fields.find((field) => field.name === "answerMatchMode").values,
    ),
    ["exact", "contains_all"],
  );
  assert.match(saved.indexes[0], /UNIQUE INDEX.*\(question\)/i);
});

test("question settings migration refuses a destructive downgrade", () => {
  assert.throws(() => down(), /downgrade is intentionally disabled/i);
});

test("question settings release delta enumerates its explicit and SQLite-generated indexes", () => {
  assert.deepEqual(allowedDelta.newSchemaObjects, [
    {
      type: "index",
      name: "idx_game_question_settings_question",
      table: "game_question_settings",
    },
    {
      type: "index",
      name: "sqlite_autoindex_game_question_settings_1",
      table: "game_question_settings",
    },
    {
      type: "table",
      name: "game_question_settings",
      table: "game_question_settings",
    },
  ]);
});
