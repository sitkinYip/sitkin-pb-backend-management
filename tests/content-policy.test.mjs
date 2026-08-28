import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

let vite, policy;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    envFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  policy = await vite.ssrLoadModule("/src/game/content-policy.ts");
});
after(async () => vite?.close());
const q = { id: "q", title: "题目", revision: 1, status: "published" };
const scene = (id, status, title = id) => ({
  id,
  status,
  title,
  revision: 1,
  levels: [{ question: q.id }, { question: q.id }],
});

test("question locks cover every online reference, but drafts only block deletion", () => {
  const scenes = [
    scene("a", "published"),
    scene("b", "published"),
    scene("c", "draft"),
    scene("d", "archived"),
  ];
  let usage = policy.questionUsage(q, scenes);
  assert.equal(usage.online.length, 2);
  assert.equal(usage.canEdit, false);
  assert.equal(usage.canDelete, false);
  scenes[0].status = "archived";
  assert.equal(policy.questionUsage(q, scenes).canEdit, false);
  scenes[1].status = "archived";
  usage = policy.questionUsage(q, scenes);
  assert.equal(usage.canEdit, true);
  assert.equal(usage.canDelete, false);
  scenes[2].status = "archived";
  assert.equal(policy.questionUsage(q, scenes).canDelete, true);
  assert.equal(
    policy.questionUsage({ ...q, status: "archived" }, scenes).canEdit,
    false,
  );
});

test("server usage is preferred and deleted references are visible only as disabled current selections", () => {
  const usage = {
    online: [],
    drafts: [],
    historyCount: 1,
    canEdit: false,
    canDelete: false,
  };
  assert.equal(policy.questionUsage({ ...q, usage }, []).canEdit, false);
  const deleted = { ...q, id: "deleted", status: "archived" };
  assert.deepEqual(
    policy.questionOptions([q, deleted]).map((o) => o.value),
    [q.id],
  );
  const options = policy.questionOptions([q, deleted], deleted.id);
  assert.equal(options.length, 2);
  assert.equal(options[1].disabled, true);
  assert.match(options[1].label, /发布前须替换/);
});

test("status tabs filter by status and title without treating a future time window as offline", () => {
  const scenes = [
    scene("1", "published", "Star Night"),
    scene("2", "draft", "Star Draft"),
    scene("3", "archived", "旧场"),
  ];
  assert.deepEqual(policy.sessionCounts(scenes), {
    published: 1,
    draft: 1,
    archived: 1,
    all: 3,
  });
  assert.equal(policy.filterSessions(scenes, "published", " STAR ").length, 1);
  assert.equal(policy.filterSessions(scenes, "all", "star").length, 2);
  assert.equal(policy.filterSessions(scenes, "archived", "旧")[0].id, "3");
});

test("all session tabs mount their fields so unopened configuration is included in draft saves", async () => {
  const source = await readFile(
    new URL("../src/game/ContentPages.tsx", import.meta.url),
    "utf8",
  );
  for (const key of ["basic", "levels", "clues", "rewards"])
    assert.match(
      source,
      new RegExp('key: "' + key + '",\\s+forceRender: true'),
      key,
    );
});
