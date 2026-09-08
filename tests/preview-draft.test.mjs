import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

test("preview drafts tolerate incomplete fields and omit private configuration", async () => {
  const vite = await createServer({
    configFile: false,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
  });
  try {
    const { previewDraft } = await vite.ssrLoadModule(
      "/src/game/preview/draft.ts",
    );
    const question = previewDraft("question", {
      title: "题目",
      kind: "choice",
      acceptedAnswers: ["secret"],
      reason: "private",
      content: [
        null,
        { text: "正文", imageUrls: ["https://example.com/a.png", null] },
      ],
      options: [{ key: "A" }, null],
    });
    assert.equal(question.value.title, "题目");
    assert.equal(question.value.content[0].text, "");
    assert.deepEqual(question.value.content[1].imageUrls, [
      "https://example.com/a.png",
    ]);
    assert.equal(JSON.stringify(question).includes("secret"), false);
    assert.equal(JSON.stringify(question).includes("private"), false);
    const note = previewDraft("notification", {
      title: "通知",
      content: "内容",
      playerIds: ["private-player"],
      target: "all",
      token: "secret",
    });
    assert.deepEqual(note.value, {
      title: "通知",
      content: "内容",
      popupTitle: "",
      buttonText: "",
    });
    assert.equal(previewDraft("question", undefined).value.kind, "text");
  } finally {
    await vite.close();
  }
});
