import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../pb_migrations/1788143000_question_clues.js", import.meta.url),
  "utf8",
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

test("question clue migration is additive, private and indexed", () => {
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
  assert.equal(saved.name, "game_question_clues");
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
    Array.from(saved.fields.find((field) => field.name === "kind").values),
    ["text", "image", "video", "link"],
  );
  assert.match(saved.indexes[0], /question, status, position, id/);
});

test("question clue migration refuses a destructive downgrade", () => {
  assert.throws(() => down(), /downgrade is intentionally disabled/i);
});
