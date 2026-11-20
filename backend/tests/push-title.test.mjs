import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const module = { exports: {} };
runInNewContext(readFileSync(new URL("../pb_hooks/lib/huawei-push.js", import.meta.url), "utf8"), { module });
const job = { id: "synthetic-event", profileId: "synthetic-profile", token: "synthetic-token", kind: "inbox",
  targetId: "synthetic-receipt", expiresAt: 600000, category: "SUBSCRIPTION", subscribed: true };
const payload = (title) => JSON.parse(JSON.stringify(module.exports.message({ ...job, title }, false, 0)));

test("push title: missing, non-text, empty and malformed titles safely use the brand fallback", () => {
  for (const title of [undefined, null, false, 1, [], {}, "", " \n\t ", "\u0000\u0007\u202e\u2066", "坏\ud800标题", "\udfff"])
    assert.equal(payload(title).payload.notification.title, "赴星之约");
  const untrusted = { toString() { throw new Error("A non-text value must not be coerced"); } };
  assert.equal(payload(untrusted).payload.notification.title, "赴星之约");
});

test("push title: folds whitespace and removes nonprinting and directional controls", () => {
  assert.equal(payload(" \r\n 星港\t 新信 \u0085来了\u0000\u0007\u200b\u202e！\u2066 ").payload.notification.title, "星港 新信 来了！");
  assert.equal(payload("\u0000\u0007星\u007f\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u202a\u202e\u2060\u206f港").payload.notification.title, "星港");
});

test("push title: bounds long Chinese text to 60 Unicode code points", () => {
  const title = payload("星".repeat(61)).payload.notification.title;
  assert.equal(title, "星".repeat(60));
  assert.equal([...title].length, 60);
});

test("push title: preserves emoji, joiners and complete surrogate pairs at the boundary", () => {
  assert.equal(payload("星".repeat(59) + "🙂尾").payload.notification.title, "星".repeat(59) + "🙂");
  const emoji = payload("🙂".repeat(61)).payload.notification.title;
  assert.equal(emoji, "🙂".repeat(60));
  assert.equal([...emoji].length, 60);
  assert.equal(emoji.isWellFormed(), true);
  assert.equal(payload("👩‍🚀 星港").payload.notification.title, "👩‍🚀 星港");
});

test("push title: remains literal text and changes no body, category, click route or delivery options", () => {
  const before = payload(undefined), after = payload("<b>星港来信</b>");
  assert.equal(after.payload.notification.title, "<b>星港来信</b>");
  assert.equal(after.payload.notification.body, "你订阅的旅途动态有新消息，打开应用查看。");
  assert.deepEqual(after.payload.notification.clickAction, before.payload.notification.clickAction);
  after.payload.notification.title = before.payload.notification.title;
  assert.deepEqual(after, before);
});
