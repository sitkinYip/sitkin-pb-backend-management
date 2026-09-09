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
    const reward = previewDraft("reward", {
      name: "奖品",
      claimMethod: "locker",
      image: "/gift.png",
      publicInstructions: "领取说明",
      claimDetails: "private-code",
      quantity: 10,
      active: false,
      player: "private-player",
    });
    assert.deepEqual(reward, {
      kind: "reward",
      value: {
        name: "奖品",
        claimMethod: "locker",
        image: "/gift.png",
        publicInstructions: "领取说明",
        description: "",
      },
    });
    assert.equal(previewDraft("reward", undefined).value.claimMethod, "staff");
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
    const letter = previewDraft("narrative", {
      id: "private-id",
      title: "来信",
      kind: "letter",
      status: "published",
      payload: {
        variant: "magic",
        typingSpeedMs: null,
        paragraphs: [null, { content: "内容", align: "right", delayMs: 0 }],
        phrases: [{ text: "hidden" }],
        secret: "private",
      },
    });
    assert.equal(letter.value.kind, "letter");
    assert.equal(letter.value.payload.typingSpeedMs, 60);
    assert.equal(letter.value.payload.paragraphs[0].content, "");
    assert.equal(letter.value.payload.paragraphs[1].align, "right");
    assert.equal(letter.value.payload.hintText, "点击开启信件");
    assert.equal("secret" in letter.value.payload, false);
    assert.equal("phrases" in letter.value.payload, false);
    assert.equal("status" in letter.value, false);
    const bless = previewDraft("narrative", {
      kind: "bless",
      payload: {
        phrases: [{ text: "祝福", durationMs: 0 }, null],
        closingLines: [{ text: "结束" }],
        paragraphs: [{ content: "private" }],
      },
    });
    assert.equal(bless.value.payload.phrases[0].durationMs, 0);
    assert.equal(bless.value.payload.phrases[1].durationMs, 3000);
    assert.equal(bless.value.payload.closingLines[0].text, "结束");
    assert.equal("paragraphs" in bless.value.payload, false);
  } finally {
    await vite.close();
  }
});
