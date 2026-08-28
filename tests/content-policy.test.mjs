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

const story = {
  id: "story",
  title: "信件",
  revision: 2,
  status: "published",
  kind: "letter",
  seriesKey: "series",
};
const storyScene = (id, status, source = "clue") => ({
  ...scene(id, status),
  clues:
    source !== "target"
      ? [{ narrative: story.id }, { narrative: story.id }]
      : [],
  completionTarget:
    source !== "clue" ? { kind: "narrative", id: story.id } : null,
});

test("narrative usage checks both reference locations, deduplicates sessions and protects all live/draft refs", () => {
  const scenes = [
    storyScene("live", "published", "both"),
    storyScene("draft", "draft", "target"),
    storyScene("old", "archived"),
  ];
  let info = policy.narrativeUsage(story, scenes);
  assert.equal(info.online.length, 1);
  assert.equal(info.drafts.length, 1);
  assert.equal(info.history.length, 1);
  assert.equal(info.canDelete, false);
  assert.match(policy.narrativeDeletionHint(story, scenes), /线上.*草稿/);
  scenes[0].status = "archived";
  assert.equal(policy.narrativeUsage(story, scenes).canDelete, false);
  assert.match(policy.narrativeDeletionHint(story, scenes), /作废草稿/);
  scenes[1].status = "archived";
  info = policy.narrativeUsage(story, scenes);
  assert.equal(info.history.length, 3);
  assert.equal(info.canDelete, true);
  assert.match(policy.narrativeDeletionHint(story, scenes), /仅已下线/);
  assert.equal(
    policy.narrativeUsage({ ...story, id: "another-version" }, [
      storyScene("live", "published"),
    ]).canDelete,
    true,
  );
});

test("removed content stays readonly, including legacy archives referenced by live sessions", () => {
  const removed = { ...story, status: "archived" };
  assert.equal(policy.narrativeUsage(removed, []).canDelete, false);
  assert.match(policy.narrativeDeletionHint(removed, []), /仅可查看或复制/);
  assert.match(
    policy.narrativeDeletionHint(removed, [storyScene("live", "published")]),
    /历史归档.*保留原读取行为/,
  );
});

test("narrative scope and search preserve normal/draft contents and expose old archives only deliberately", () => {
  const rows = [
    story,
    { ...story, id: "draft", status: "draft", title: "DRAFT" },
    { ...story, id: "old", status: "archived" },
  ];
  assert.deepEqual(
    policy.filterNarratives(rows, "available", "").map((n) => n.id),
    ["story", "draft"],
  );
  assert.deepEqual(
    policy.filterNarratives(rows, "archived", " 信件 ").map((n) => n.id),
    ["old"],
  );
  assert.equal(policy.filterNarratives(rows, "all", "").length, 3);
  assert.equal(
    policy.filterNarratives(rows, "available", " draft ")[0].id,
    "draft",
  );
});

test("both narrative selectors offer published choices and preserve disabled historical labels", () => {
  const removed = { ...story, id: "old", status: "archived" };
  const draft = { ...story, id: "draft", status: "draft", kind: "bless" };
  const rows = [story, removed, draft];
  assert.deepEqual(
    policy.narrativeOptions(rows).map((o) => o.value),
    [story.id],
  );
  const oldOption = policy
    .narrativeOptions(rows, "old")
    .find((o) => o.value === "old");
  assert.equal(oldOption.disabled, true);
  assert.match(oldOption.label, /信件.*v2.*已移出，需替换/);
  const draftOption = policy
    .narrativeOptions(rows, "draft")
    .find((o) => o.value === "draft");
  assert.equal(draftOption.disabled, true);
  assert.match(draftOption.label, /祝福.*草稿/);
});

test("repair guidance lists every location, clears after replacement, and ignores inactive completion IDs", () => {
  const removed = { ...story, status: "archived" };
  const session = storyScene("repair", "draft", "both");
  const refs = policy.unavailableNarrativeReferences([removed], session);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].label, "信件 · v2");
  assert.deepEqual(refs[0].locations, [
    "基础与演出 → 叙事内容",
    "线索 1",
    "线索 2",
  ]);
  assert.equal(
    policy.unavailableNarrativeReferences([story], session).length,
    0,
  );
  assert.equal(
    policy.unavailableNarrativeReferences([], session)[0].label,
    "内容不存在",
  );
  assert.equal(
    policy.unavailableNarrativeReferences([removed], {
      clues: [{ narrative: "" }],
      completionTarget: {
        kind: "link",
        id: story.id,
        url: "https://example.com",
      },
    }).length,
    0,
  );
});

test("narrative deletion UI wires required reason, reference links, scope and both repaired selectors", async () => {
  const source = await readFile(
    new URL("../src/game/ContentPages.tsx", import.meta.url),
    "utf8",
  );
  const editor = source.slice(source.indexOf("function NarrativeEditor"));
  assert.match(editor, /useState<NarrativeFilter>\("available"\)/);
  assert.match(editor, /filterNarratives\(catalog.narratives, scope, search\)/);
  assert.match(editor, /已移出（含历史归档）/);
  assert.match(editor, /删除剧情内容（保留历史）/);
  assert.match(editor, /whitespace: true/);
  assert.match(editor, /narrativeUsage\(row, catalog.sessions\).canDelete/);
  assert.match(editor, /SessionReferences references=\{info.history\}/);
  assert(!editor.includes("Popconfirm"));
  assert.equal((source.match(/options=\{narrativeOptions\(/g) || []).length, 2);
  assert.match(source, /rules=\{\[\.\.\.fieldRule, narrativeRule\]\}/);
  assert.match(source, /rules=\{\[narrativeRule\]\}/);
});
