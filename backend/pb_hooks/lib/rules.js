function fail(code, message, status = 400) {
  const error = new Error(message);
  error.businessCode = code;
  error.status = status;
  throw error;
}
function text(value, name, max = 200, required = true) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    fail("INVALID_INPUT", `${name}格式不正确`);
  return value.trim();
}
function password(value, name = "密码") {
  // PocketBase 0.40 rejects 72-character passwords even when bcrypt's
  // independent 72-byte UTF-8 limit has not been exceeded.
  text(value, name, 71);
  let bytes = 0;
  for (const character of value) {
    const cp = character.codePointAt(0);
    bytes += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  if (value.length < 10 || bytes > 72)
    fail("INVALID_INPUT", `${name}须为 10～71 位，UTF-8 编码最多 72 字节`);
  return value;
}
function integer(value, name, min = 0, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail("INVALID_INPUT", `${name}须为 ${min}～${max} 的整数`);
  return value;
}
function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_INPUT", `${name}须为对象`);
  return value;
}
function list(value, name, max = 100) {
  if (!Array.isArray(value) || value.length > max)
    fail("INVALID_INPUT", `${name}列表不正确`);
  return value;
}
function date(value, name) {
  if (value === "" || value === undefined || value === null) return "";
  if (
    typeof value !== "string" ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("INVALID_INPUT", `${name}须包含时区`);
  return new Date(value).toISOString();
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function normalizeAnswer(value) {
  const ranges = require("./answer-ranges.js");
  let result = "";
  for (const character of value.normalize("NFKC")) {
    const cp = character.codePointAt(0);
    let lo = 0,
      hi = ranges.length - 1,
      ignored = false;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1,
        range = ranges[mid];
      if (cp < range[0]) hi = mid - 1;
      else if (cp > range[1]) lo = mid + 1;
      else {
        ignored = true;
        break;
      }
    }
    if (!ignored) result += character;
  }
  return result.toLowerCase();
}
function correct(kind, answer, accepted) {
  return kind === "choice"
    ? accepted.includes(answer.trim())
    : accepted.some(
        (candidate) => normalizeAnswer(candidate) === normalizeAnswer(answer),
      );
}
function penaltyPolicy(value) {
  return list(value || [], "惩罚", 20).map((item) => {
    object(item, "惩罚");
    if (item.type === "lock") return { type: "lock" };
    if (item.type !== "cooldown") fail("INVALID_INPUT", "未知惩罚类型");
    return {
      type: "cooldown",
      seconds: integer(item.seconds, "冷却秒数", 0, 86400 * 30),
    };
  });
}
function safeUrl(value, allowInternal = false) {
  if (typeof value !== "string" || value.length > 4000)
    fail("INVALID_INPUT", "链接格式错误");
  if (!value) return "";
  if (/^https?:\/\/[^/\s@\\?#]+(?:[/?#][^\s\\]*)?$/i.test(value)) return value;
  if (allowInternal && /^\/(?!\/)/.test(value) && !value.includes("\\"))
    return value;
  fail("INVALID_INPUT", "仅允许 HTTP(S) 或受控站内链接");
}
module.exports = {
  fail,
  text,
  password,
  integer,
  object,
  list,
  date,
  canonical,
  normalizeAnswer,
  correct,
  penaltyPolicy,
  safeUrl,
};
