const r = require(`${__hooks}/lib/rules.js`);
const SCOPES = [
  "global",
  "rank",
  "question",
  "session",
  "assignment",
  "session_level",
  "assignment_level",
];
const CONTEXTS = ["profile", "assignment", "level"];
function key(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(value) ||
    ["__proto__", "prototype", "constructor"].includes(value)
  )
    r.fail(
      "INVALID_INPUT",
      "字段标识须为字母开头的字母、数字或下划线，最多 60 位",
    );
  return value;
}
function bytes(value) {
  let count = 0;
  for (const ch of JSON.stringify(value)) {
    const cp = ch.codePointAt(0);
    count += cp < 128 ? 1 : cp < 2048 ? 2 : cp < 65536 ? 3 : 4;
  }
  return count;
}
function bounded(value, max = 16384) {
  if (value === undefined) r.fail("INVALID_INPUT", "缺少扩展配置");
  if (bytes(value) > max) r.fail("INVALID_INPUT", "扩展配置超过容量限制");
  return value;
}
function only(value, names, label) {
  r.object(value, label);
  for (const name of Object.keys(value)) {
    key(name);
    if (!names.includes(name))
      r.fail("INVALID_INPUT", `${label}包含未知字段 ${name}`);
  }
}
function node(input, depth = 0) {
  if (depth > 4) r.fail("INVALID_INPUT", "字段定义最多嵌套 4 层");
  only(
    input,
    [
      "type",
      "label",
      "required",
      "default",
      "properties",
      "items",
      "maxLength",
      "minimum",
      "maximum",
      "enum",
    ],
    "字段定义",
  );
  if (
    !["object", "array", "string", "url", "number", "boolean"].includes(
      input.type,
    )
  )
    r.fail("INVALID_INPUT", "不支持的字段类型");
  if (input.label !== undefined) r.text(input.label, "字段名称", 100);
  if (input.required !== undefined && typeof input.required !== "boolean")
    r.fail("INVALID_INPUT", "required 须为布尔值");
  const out = { type: input.type };
  for (const k of ["label", "required"])
    if (input[k] !== undefined) out[k] = input[k];
  if (input.type === "object") {
    r.object(input.properties, "属性");
    if (Object.keys(input.properties).length > 50)
      r.fail("INVALID_INPUT", "每层最多 50 个属性");
    out.properties = {};
    for (const k of Object.keys(input.properties))
      out.properties[key(k)] = node(input.properties[k], depth + 1);
  } else if (input.type === "array") out.items = node(input.items, depth + 1);
  if (["string", "url", "array"].includes(input.type))
    out.maxLength = r.integer(
      input.maxLength === undefined
        ? input.type === "array"
          ? 50
          : 2000
        : input.maxLength,
      "最大长度",
      1,
      input.type === "array" ? 50 : 4000,
    );
  if (input.type === "number") {
    for (const k of ["minimum", "maximum"])
      if (input[k] !== undefined) {
        if (typeof input[k] !== "number" || !Number.isFinite(input[k]))
          r.fail("INVALID_INPUT", "数值范围无效");
        out[k] = input[k];
      }
    if (
      out.minimum !== undefined &&
      out.maximum !== undefined &&
      out.minimum > out.maximum
    )
      r.fail("INVALID_INPUT", "数值下限大于上限");
  }
  if (input.enum !== undefined) {
    if (input.type !== "string" || !r.list(input.enum, "枚举", 50).length)
      r.fail("INVALID_INPUT", "枚举只支持非空文本列表");
    out.enum = [
      ...new Set(input.enum.map((v) => r.text(v, "枚举值", out.maxLength))),
    ];
  }
  // Reject constraints on incompatible types instead of silently ignoring typos.
  for (const [field, types] of Object.entries({
    properties: ["object"],
    items: ["array"],
    maxLength: ["string", "url", "array"],
    minimum: ["number"],
    maximum: ["number"],
  }))
    if (input[field] !== undefined && !types.includes(input.type))
      r.fail("INVALID_INPUT", `${field} 不适用于 ${input.type}`);
  if (input.default !== undefined)
    out.default = value(out, input.default, depth);
  return out;
}
function value(spec, input, depth = 0) {
  if (depth > 4 || input === null)
    r.fail("INVALID_INPUT", "配置不支持 null 或超过 4 层的嵌套");
  if (input === undefined) {
    if (spec.default !== undefined)
      return JSON.parse(JSON.stringify(spec.default));
    if (spec.required)
      r.fail("INVALID_INPUT", `${spec.label || "字段"}为必填项`);
    return undefined;
  }
  if (spec.type === "object") {
    only(input, Object.keys(spec.properties), spec.label || "配置");
    const out = {};
    for (const k of Object.keys(spec.properties)) {
      const v = value(spec.properties[k], input[k], depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (spec.type === "array")
    return r.list(input, spec.label || "数组", spec.maxLength).map((v) => {
      if (v === undefined) r.fail("INVALID_INPUT", "数组不能包含空值");
      return value(spec.items, v, depth + 1);
    });
  if (["string", "url"].includes(spec.type)) {
    const result = r.text(input, spec.label || "文本", spec.maxLength, false);
    if (spec.enum && !spec.enum.includes(result))
      r.fail("INVALID_INPUT", "值不在枚举范围内");
    return spec.type === "url" ? r.safeUrl(result) : result;
  }
  if (
    spec.type === "number" &&
    (typeof input !== "number" ||
      !Number.isFinite(input) ||
      (spec.minimum !== undefined && input < spec.minimum) ||
      (spec.maximum !== undefined && input > spec.maximum))
  )
    r.fail("INVALID_INPUT", "数值或范围无效");
  if (spec.type === "boolean" && typeof input !== "boolean")
    r.fail("INVALID_INPUT", "须填写布尔值");
  return input;
}
function schema(input) {
  bounded(input);
  only(
    input,
    ["scopes", "contexts", "visibility", "renderer", "fields"],
    "扩展定义",
  );
  const subset = (items, allowed, name) => {
    const result = [...new Set(r.list(items, name, allowed.length))];
    if (!result.length || result.some((v) => !allowed.includes(v)))
      r.fail("INVALID_INPUT", `${name}无效`);
    return result;
  };
  if (
    !["player", "admin"].includes(input.visibility) ||
    !["none", "text"].includes(input.renderer)
  )
    r.fail("INVALID_INPUT", "可见性或展示方式无效");
  const fields = node(input.fields);
  if (fields.type !== "object") r.fail("INVALID_INPUT", "配置根节点须为对象");
  if (
    input.renderer === "text" &&
    (fields.properties.text?.type !== "string" ||
      !fields.properties.text.required)
  )
    r.fail("INVALID_INPUT", "文本展示需要必填的 text 文本属性");
  const scopes = subset(input.scopes, SCOPES, "目标范围");
  const contexts = subset(input.contexts, CONTEXTS, "输出位置");
  const usedScopes = new Set(
    contexts.flatMap((c) =>
      c === "profile"
        ? ["global", "rank"]
        : c === "assignment"
          ? ["global", "session", "assignment"]
          : [
              "global",
              "question",
              "session",
              "assignment",
              "session_level",
              "assignment_level",
            ],
    ),
  );
  if (scopes.some((s) => !usedScopes.has(s)))
    r.fail("INVALID_INPUT", "目标范围不适用于所选输出位置");
  return bounded({
    scopes,
    contexts,
    visibility: input.visibility,
    renderer: input.renderer,
    fields,
  });
}
module.exports = { SCOPES, CONTEXTS, key, bounded, bytes, only, schema, value };
