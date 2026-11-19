import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";
const migration = "1795075320_push_personal_journey_notices.js";
const runner = path.resolve(import.meta.dirname, "../deploy/1panel/release-runner.py");
const load = `import importlib.util,sys,json,sqlite3,copy,os\ns=importlib.util.spec_from_file_location('runner',sys.argv[1]);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)\n`;
const run = (source, args = [], runnerPath = runner) => execFileSync("python3", ["-c", load + source, runnerPath, ...args], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
const summary = (server) => JSON.parse(run("print(json.dumps(r._sqlite_summary(sys.argv[2])))", [path.join(server.dataDirectory(), "data.db")]));
const delta = { schemaVersion: 1, verifier: "personal-journey-context-v1", newMigrationFiles: [migration], newCollections: [], newSchemaObjects: [], emptyTables: [], contextEvolution: { collection: "game_push_notice_contexts", sessionRequired: false, kindValues: ["session", "account"], legacyKind: "session" } };
const ok = (response) => { assert.equal(response.status, 200, JSON.stringify(response.data)); return response.data; };

test("real PocketBase: narrow release verifier preserves populated legacy context and rejects every unrelated drift", { timeout: 120000 }, async (t) => {
  const names = readdirSync(new URL("../pb_migrations", import.meta.url)).filter((name) => name.endsWith(".js"));
  const server = await createTestServer({ migrationNames: names.filter((name) => name !== migration) }); t.after(() => server.stop());
  const call = async (route, body) => ok(await server.request("/api/questions/v1" + route, { token: server.adminToken, method: "POST", body: { requestId: randomUUID(), ...body } }));
  const raw = async (table, body) => ok(await server.request(`/api/collections/${table}/records`, { token: server.superToken, method: "POST", body }));
  const question = await call("/admin/questions", { title: "合成发布题目", kind: "text", content: [{ text: "合成题面" }], acceptedAnswers: ["星"] });
  await call(`/admin/questions/${question.id}/publish`, {});
  const session = await call("/admin/sessions", { title: "合成发布旅途", levels: [{ question: question.id, xp: 0 }] });
  const admins = ok(await server.request("/api/collections/game_admins/records", { token: server.superToken })).items;
  const note = await raw("game_notifications", { title: "合成旧来信", content: "发布回填检查", status: "sent", createdBy: admins[0].id, sentAt: new Date().toISOString() });
  await raw("game_push_notice_contexts", { notification: note.id, session: session.id });
  const before = summary(server);
  await server.upgradeMigrations({ restoreCopy: true, targetMigrationNames: names });
  const after = summary(server);
  const evidence = path.join(server.directory, "release-verifier-evidence.json");
  writeFileSync(evidence, JSON.stringify({ before, after, delta }));
  const validation = String.raw`
v=json.load(open(sys.argv[2]));before,after,delta=v['before'],v['after'],v['delta']
result=r._validate_migration_delta(before,after,delta,delta['newMigrationFiles'])
assert result['preservedContextRowCount']==1 and result['addedMigrationCount']==1
r._equivalent_rehearsed_outcome(after,after,delta)
# Rehearsal and production legitimately save the collection at different times.
rehearsed=copy.deepcopy(after);rehearsed['collections'][r.CONTEXT_TABLE]['rowDigest']='a'*64
rehearsed['contextEvolution']['updated']='2026-11-19 00:00:00.000Z'
r._equivalent_rehearsed_outcome(rehearsed,after,delta)
def reject(value,label):
    try:r._validate_migration_delta(before,value,delta,delta['newMigrationFiles'])
    except r.ReleaseError as e:assert e.code=='delta_mismatch',(label,e.code)
    else:raise AssertionError('unexpected acceptance: '+label)
# Each corruption is applied to a SQLite backup, never to the live fixture DB.
source=sqlite3.connect('file:'+sys.argv[3]+'?mode=ro',uri=True)
mutations=[
 ('old-row',"UPDATE game_push_notice_contexts SET notification='changed'",()),
 ('missing-session',"UPDATE game_push_notice_contexts SET session=''",()),
 ('wrong-backfill',"UPDATE game_push_notice_contexts SET kind='account'",()),
 ('empty-backfill',"UPDATE game_push_notice_contexts SET kind=''",()),
 ('old-ledger',"UPDATE _migrations SET applied=applied+1 WHERE file=(SELECT file FROM _migrations ORDER BY file LIMIT 1)",()),
 ('other-row',"UPDATE game_admins SET displayName='changed'",()),
 ('other-schema',"ALTER TABLE game_admins ADD COLUMN unexpected TEXT",()),
 ('context-extra-column',"ALTER TABLE game_push_notice_contexts ADD COLUMN unexpected TEXT",()),
 ('context-rule',"UPDATE _collections SET viewRule='' WHERE name='game_push_notice_contexts'",()),
]
for label,sql,args in mutations:
    filename=os.path.join(sys.argv[4],label+'.db');db=sqlite3.connect(filename);source.backup(db);db.execute(sql,args);db.commit();db.close()
    reject(r._sqlite_summary(filename),label)
# Altering field help or session.required is outside the reviewed metadata diff.
for label,change in [('context-field-help',lambda fs:fs[0].update(help='changed')),('context-session-required',lambda fs:next(f for f in fs if f['name']=='session').update(required=True))]:
    filename=os.path.join(sys.argv[4],label+'.db');db=sqlite3.connect(filename);source.backup(db)
    fields=json.loads(db.execute("SELECT fields FROM _collections WHERE name='game_push_notice_contexts'").fetchone()[0]);change(fields)
    db.execute("UPDATE _collections SET fields=? WHERE name='game_push_notice_contexts'",(json.dumps(fields),));db.commit();db.close()
    reject(r._sqlite_summary(filename),label)
source.close()
# Live post-switch business rows may advance; schema/collection/ledger may not.
r._validate_post_switch_structure(after,after,delta)
print(json.dumps({'preservedLegacyRows':1,'rejectedSqliteDrifts':11,'rehearsalEquivalent':True}))
`;
  assert.deepEqual(JSON.parse(run(validation, [evidence, path.join(server.dataDirectory(), "data.db"), server.directory])), { preservedLegacyRows: 1, rejectedSqliteDrifts: 11, rehearsalEquivalent: true });
  // Actual independent-source mutation: dropping the projected old-row equality must be caught.
  const sourceText = readdirSync(path.dirname(runner)).includes("release-runner.py")
    ? (await import("node:fs")).readFileSync(runner, "utf8") : "";
  const gate = 'and new["legacyRows"] == old["legacyRows"]';
  assert.equal(sourceText.split(gate).length, 2);
  const mutant = path.join(server.directory, "mutated-release-runner.py");
  writeFileSync(mutant, sourceText.replace(gate, "and True"));
  const mutation = spawnSync("python3", ["-c", load + validation, mutant, evidence, path.join(server.dataDirectory(), "data.db"), server.directory], {
    encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  assert.notEqual(mutation.status, 0);
  assert.match(mutation.stderr, /unexpected acceptance: old-row/);
  // After traffic resumes, a new account-context message is valid business data.
  const later = await raw("game_notifications", { title: "合成新来信", content: "恢复服务后的正常业务", status: "sent", createdBy: admins[0].id, sentAt: new Date().toISOString() });
  await raw("game_push_notice_contexts", { notification: later.id, kind: "account" });
  const live = summary(server);
  assert.equal(live.tables.game_push_notice_contexts.rowCount, 2);
  writeFileSync(evidence, JSON.stringify({ before, after, live, delta }));
  run(String.raw`v=json.load(open(sys.argv[2]));r._validate_post_switch_structure(v['after'],v['live'],v['delta'])
try:r._validate_migration_delta(v['before'],v['live'],v['delta'],v['delta']['newMigrationFiles'])
except r.ReleaseError as e:assert e.code=='delta_mismatch'
else:raise AssertionError('stopped migration allowed live row additions')`, [evidence]);
});
