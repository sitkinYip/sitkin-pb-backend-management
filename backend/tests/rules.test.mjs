import { test } from "node:test";
import assert from "node:assert/strict";
import rules from "../pb_hooks/lib/rules.js";

test("answer normalization preserves legacy text behavior and choice keys", () => {
  assert.equal(rules.normalizeAnswer(" Ａ，北极星！\n"), "a北极星");
  assert.equal(rules.correct("text", "POLARIS。", ["北极星", "Polaris"]), true);
  assert.equal(rules.correct("choice", "a", ["A"]), false);
});
test("idempotency hashes ignore object key ordering but retain array order", () => {
  assert.equal(
    rules.canonical({ b: 2, a: [1, 3] }),
    rules.canonical({ a: [1, 3], b: 2 }),
  );
  assert.notEqual(rules.canonical([1, 3]), rules.canonical([3, 1]));
});
test("strict configuration boundaries reject ambiguous times and unsafe URLs", () => {
  assert.equal(rules.password("a".repeat(71)), "a".repeat(71));
  assert.throws(() => rules.password("a".repeat(72)), /格式/);
  assert.equal(rules.password("星".repeat(24)), "星".repeat(24));
  assert.throws(() => rules.password("星".repeat(25)), /72/);
  assert.throws(
    () => rules.safeUrl("https://user:secret@example.test"),
    /HTTP/,
  );
  assert.throws(
    () => rules.safeUrl("https://example.test\nHeader: bad"),
    /HTTP/,
  );
  assert.throws(() => rules.date("2026-08-27 10:00", "时间"), /时区/);
  assert.throws(() => rules.safeUrl("javascript:alert(1)"), /HTTP/);
  assert.throws(() => rules.safeUrl("//example.com", true), /HTTP/);
  assert.throws(
    () => rules.penaltyPolicy([{ type: "cooldown", seconds: -1 }]),
    /整数/,
  );
  assert.deepEqual(rules.penaltyPolicy([{ type: "lock" }]), [{ type: "lock" }]);
});
