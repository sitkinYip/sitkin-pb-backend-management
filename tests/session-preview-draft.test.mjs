import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
test("session preview resolves references without answer keys, preserves IDs and merges clue sources", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  });
  try {
    const { sessionPreviewDraft } = await vite.ssrLoadModule(
      "/src/game/preview/session-draft.ts",
    );
    const catalog = {
      questions: [
        {
          id: "q",
          kind: "text",
          title: "题目",
          content: [],
          options: [],
          acceptedAnswers: ["secret"],
          status: "published",
        },
      ],
      ranks: [{ id: "rank", order: 3 }],
      narratives: [
        {
          id: "story",
          kind: "letter",
          title: "剧情",
          payload: { variant: "modern", paragraphs: [], private: "secret" },
          status: "published",
        },
      ],
    };
    const values = {
      title: "场次",
      minLevel: "rank",
      reason: "private",
      levels: [
        { id: "l1", question: "q" },
        { id: "l2", question: "q" },
        { id: "l3", question: "missing" },
      ],
      clues: [
        {
          id: "c",
          kind: "letter",
          narrative: "story",
          trigger: "level_completed",
          levelIndex: 1,
          content: { title: "信件" },
        },
        { trigger: "level_completed", sessionLevel: "deleted" },
      ],
      completionTarget: { kind: "narrative", id: "story" },
      rewardRules: [{ secret: true }],
    };
    const common = {
      q: [
        {
          id: "shared",
          kind: "text",
          status: "active",
          content: { text: "通用线索" },
          autoPlay: true,
        },
        { id: "archived", status: "archived" },
      ],
    };
    const result = sessionPreviewDraft(values, catalog, common);
    assert.equal(result.assignment.minLevel, 3);
    assert.equal(result.assignment.levels[2].question, null);
    assert.equal(result.assignment.clues[0].sessionLevel, "l2");
    assert.deepEqual(
      result.assignment.clues
        .filter((c) => c.source === "question")
        .map((c) => c.sessionLevel),
      ["l1", "l2"],
    );
    assert.equal(new Set(result.assignment.clues.map((c) => c.id)).size, 3);
    assert.equal(result.narratives[0].id, "story");
    assert.equal(result.issues.length, 2);
    assert.equal(
      /secret|private|acceptedAnswers|rewardRules/.test(JSON.stringify(result)),
      false,
    );
    const reordered = sessionPreviewDraft(
      { ...values, levels: [values.levels[1], values.levels[0]] },
      catalog,
    );
    assert.deepEqual(
      reordered.assignment.levels.map((l) => l.id),
      ["l2", "l1"],
    );
    const empty = sessionPreviewDraft(undefined, catalog);
    assert.equal(empty.assignment.totalLevels, 0);
    assert.deepEqual(empty.narratives, []);
  } finally {
    await vite.close();
  }
});
