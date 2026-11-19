import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createTestServer } from "./server.mjs";

const root = "/api/questions/v1";
const migration = "1795075200_push_subscriptions.js";
const privateTables = ["game_push_subscriptions", "game_push_notice_contexts", "game_push_notice_deliveries"];
function ok(response) {
  assert.equal(response.status, 200, `isolated API: ${response.data.error?.code || "unexpected status"}`);
  return response.data;
}
function fixture(server) {
  const call = (route, token, body, method = body ? "POST" : "GET") =>
    server.request(root + route, { token, body, method });
  const records = async (name) => ok(await server.request(`/api/collections/${name}/records`, { token: server.superToken })).items;
  const player = async (account) => {
    const password = "S-" + randomUUID();
    const row = ok(await server.request("/api/collections/game_players/records", {
      token: server.superToken, method: "POST",
      body: { account, displayName: "订阅验收玩家", status: "active", mustChangePassword: false, password, passwordConfirm: password },
    }));
    const auth = ok(await server.request("/api/collections/game_players/auth-with-password", {
      method: "POST", body: { identity: account, password },
    }));
    return { id: row.id, token: auth.token };
  };
  return { call, records, player };
}

test("real PocketBase: additive subscription migration preserves existing business and starts empty", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((name) => name !== migration) });
  t.after(() => server.stop());
  const f = fixture(server), p = await f.player("subscription_migration");
  const snapshot = () => JSON.parse(execFileSync("python3", ["-c", `
import json, sqlite3, sys
db=sqlite3.connect('file:' + sys.argv[1] + '/data.db?mode=ro', uri=True)
db.row_factory=sqlite3.Row
print(json.dumps({row['name']: dict(row) for row in db.execute('SELECT * FROM _collections') if row['name'] not in ${JSON.stringify(privateTables)}}))
`, server.dataDirectory()], { encoding: "utf8" }));
  const before = snapshot();
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names });
  assert.deepEqual(snapshot(), before);
  const actualObjects = JSON.parse(execFileSync("python3", ["-c", `
import json, sqlite3, sys
db=sqlite3.connect('file:' + sys.argv[1] + '/data.db?mode=ro', uri=True)
db.row_factory=sqlite3.Row
print(json.dumps([dict(row) for row in db.execute('SELECT type,name,tbl_name AS "table" FROM sqlite_master WHERE tbl_name IN (?,?,?) ORDER BY type,name', ${JSON.stringify(privateTables)})]))
`, server.dataDirectory()], { encoding: "utf8" }));
  const delta = JSON.parse(readFileSync(new URL("../deploy/1panel/allowed-delta.push-subscriptions.json", import.meta.url), "utf8"));
  assert.deepEqual(actualObjects, delta.newSchemaObjects);
  for (const name of privateTables) assert.deepEqual(await f.records(name), []);
  assert.equal((await f.call("/me/push/subscriptions", p.token)).data.error.code, "PUSH_SUBSCRIPTION_SCOPE_CHANGED");
  await server.restart();
  for (const name of privateTables) assert.deepEqual(await f.records(name), []);
});
