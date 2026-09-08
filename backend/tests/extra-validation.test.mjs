import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
globalThis.__hooks = fileURLToPath(new URL("../pb_hooks", import.meta.url));
const require = createRequire(import.meta.url);
const v = require("../pb_hooks/lib/extra-validation.js");
const { reader } = require("../pb_hooks/lib/extra-config.js");
const spec = (fields) => ({
  scopes: ["global"],
  contexts: ["profile"],
  visibility: "player",
  renderer: "none",
  fields,
});
test("extra field validation preserves falsy/default values and rejects incompatible schemas", () => {
  const definition = v.schema(
    spec({
      type: "object",
      properties: {
        count: { type: "number", minimum: 0, maximum: 3, default: 1 },
        enabled: { type: "boolean", default: true },
        labels: { type: "array", items: { type: "string", enum: ["a", "b"] } },
      },
    }),
  );
  assert.deepEqual(
    v.value(definition.fields, { count: 0, enabled: false, labels: [] }),
    { count: 0, enabled: false, labels: [] },
  );
  assert.deepEqual(v.value(definition.fields, {}), { count: 1, enabled: true });
  for (const data of [
    { count: -1 },
    { count: "0" },
    { labels: ["c"] },
    { unknown: true },
    { count: null },
  ])
    assert.throws(() => v.value(definition.fields, data));
  assert.throws(() =>
    v.schema(
      spec({
        type: "object",
        properties: { n: { type: "number", maxLength: 10 } },
      }),
    ),
  );
  assert.throws(() =>
    v.schema(
      spec({
        type: "object",
        properties: { url: { type: "url", default: "javascript:alert(1)" } },
      }),
    ),
  );
  assert.throws(() =>
    v.schema(
      spec({
        type: "object",
        properties: JSON.parse('{"constructor":{"type":"string"}}'),
      }),
    ),
  );
  assert.throws(
    () => v.bounded({ text: "星".repeat(5500) }),
    "16KiB counts UTF-8 bytes",
  );
  let nested = { type: "string" };
  for (let i = 0; i < 6; i++)
    nested = { type: "object", properties: { item: nested } };
  assert.throws(() => v.schema(spec(nested)));
});
test("request-local resolver uses two data reads regardless of level count and caps aggregate payload", () => {
  const row = (data) => ({
    id: data.id,
    get: (k) => data[k],
    getInt: (k) => data[k],
    getString: (k) =>
      typeof data[k] === "object" ? JSON.stringify(data[k]) : data[k] || "",
  });
  const definitions = Array.from({ length: 30 }, (_, i) =>
    row({
      id: "def" + i,
      key: "field" + i,
      label: "提示",
      status: "active",
      revision: 1,
      schema: {
        ...spec({
          type: "object",
          properties: {
            text: { type: "string", maxLength: 4000, required: true },
          },
        }),
        contexts: ["level"],
        renderer: "text",
      },
    }),
  );
  const configs = definitions.map((d, i) =>
    row({
      id: "cfg" + i,
      definition: d.id,
      targetKey: "global",
      recipientKey: "public",
      mode: "value",
      status: "active",
      revision: 1,
      extra: { text: "x".repeat(4000) },
    }),
  );
  let queries = 0;
  const app = {
    findCollectionByNameOrId: () => ({}),
    findRecordsByFilter: (name) => {
      queries++;
      return name === "game_extra_definitions" ? definitions : configs;
    },
  };
  const resolve = reader(
    app,
    "player",
    Array.from({ length: 100 }, (_, i) => "session_level:" + i),
  );
  let aggregate = 0,
    delivered = 0;
  for (let i = 0; i < 100; i++) {
    const result = resolve("level", ["session_level:" + i]);
    for (const [key, value] of Object.entries(result.extra))
      aggregate += v.bytes({ [key]: value });
    for (const view of result.extraDisplay) aggregate += v.bytes(view);
    delivered += Object.keys(result.extra).length;
  }
  assert.equal(queries, 2);
  assert(delivered > 0);
  assert(aggregate <= 262144);
});
