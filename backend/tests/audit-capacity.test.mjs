import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../pb_migrations/1787911200_expand_audit_diff.js", import.meta.url),
  "utf8",
);
let up, down;
vm.runInNewContext(source, {
  migrate: (forward, reverse) => {
    up = forward;
    down = reverse;
  },
});

test("audit migration preserves field identity and does not shrink an already larger limit", () => {
  for (const maxSize of [200000, 2000000, 4000000]) {
    const field = { id: "original_json_field", maxSize };
    const collection = {
      fields: {
        getByName: (name) => {
          assert.equal(name, "safeDiff");
          return field;
        },
      },
    };
    let saves = 0;
    up({
      findCollectionByNameOrId: (name) => {
        assert.equal(name, "game_admin_audit_logs");
        return collection;
      },
      save: (value) => {
        assert.equal(value, collection);
        saves++;
      },
    });
    assert.equal(field.id, "original_json_field");
    assert.equal(field.maxSize, Math.max(maxSize, 2000000));
    assert.equal(saves, maxSize < 2000000 ? 1 : 0);
  }
});

test("audit migration refuses a missing field or a potentially unsafe downgrade", () => {
  assert.throws(
    () =>
      up({
        findCollectionByNameOrId: () => ({ fields: { getByName: () => null } }),
        save: () => assert.fail("must not save a malformed schema"),
      }),
    /Missing.*safeDiff/,
  );
  assert.throws(() => down(), /downgrade is intentionally disabled/);
});
