import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createTestServer } from "./server.mjs";

const migration = "1788825600_player_titles_extra.js";
const newTables = [
  "game_player_level_titles",
  "game_extra_definitions",
  "game_extra_configs",
];
function snapshot(folder, immutable = false) {
  // The test's own SQLite database only. Reads include committed WAL data.
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `
import sqlite3,json,hashlib,sys
c=sqlite3.connect('file:'+sys.argv[1]+'/data.db?mode=ro'+('&immutable=1' if sys.argv[2]=='true' else ''),uri=True)
tables=[r[0] for r in c.execute("select name from sqlite_master where type='table' and name like 'game_%' order by name")]
out={}
for name in tables:
 rows=list(c.execute('select * from "'+name+'" order by id'))
 sql=list(c.execute("select type,name,sql from sqlite_master where tbl_name=? order by type,name",(name,)))
 out[name]={'digest':hashlib.sha256(json.dumps(rows,sort_keys=True,default=str).encode()).hexdigest(),'rows':len(rows),'schema':sql}
print(json.dumps(out))
`,
        folder,
        String(immutable),
      ],
      { encoding: "utf8" },
    ),
  );
}
test(
  "Docker PocketBase: additive migration on an offline restored old database",
  { timeout: 180000 },
  async (t) => {
    const targetMigrationNames = (
      await readdir(new URL("../pb_migrations", import.meta.url))
    ).filter((name) => /^\d+_.*\.js$/.test(name) && name <= migration);
    const migrationNames = targetMigrationNames.filter((name) => name !== migration);
    const server = await createTestServer({ migrationNames });
    t.after(() => server.stop());
    const root = "/api/questions/v1";
    const beforeCatalog = await server.request(root + "/admin/catalog", {
      token: server.adminToken,
    });
    assert.equal(beforeCatalog.status, 200);
    assert.deepEqual(beforeCatalog.data.capabilities, {
      playerTitles: false,
      extraConfig: false,
    });
    const before = snapshot(server.dataDirectory());
    assert.equal(Object.keys(before).length, 24);
    const collectionState = async () => {
      const response = await server.request("/api/collections?perPage=500", {
        token: server.superToken,
      });
      assert.equal(response.status, 200);
      return response.data.items;
    };
    const previousCollections = await collectionState();
    const oldDir = server.dataDirectory();
    await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames });
    assert.notEqual(server.dataDirectory(), oldDir);
    const after = snapshot(server.dataDirectory());
    for (const [table, data] of Object.entries(before))
      assert.deepEqual(after[table], data, `${table} changed`);
    assert.deepEqual(
      snapshot(oldDir, true),
      before,
      "the original stopped database remains untouched",
    );
    for (const table of newTables) assert.equal(after[table].rows, 0);
    const nextCollections = await collectionState();
    for (const original of previousCollections)
      assert.deepEqual(
        nextCollections.find((c) => c.id === original.id),
        original,
        `old collection ${original.name} changed`,
      );
    for (const name of newTables) {
      const schema = nextCollections.find((c) => c.name === name);
      for (const rule of [
        "listRule",
        "viewRule",
        "createRule",
        "updateRule",
        "deleteRule",
      ])
        assert.equal(schema[rule], null);
    }
    assert.equal(
      (
        await server.request(root + "/admin/catalog", {
          token: server.adminToken,
        })
      ).data.capabilities.extraConfig,
      true,
    );
    await server.restart();
    assert.deepEqual(snapshot(server.dataDirectory()), after);
    await server.restart();
    assert.deepEqual(snapshot(server.dataDirectory()), after);
  },
);
