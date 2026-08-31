const db = require(`${__hooks}/lib/db.js`);
const r = require(`${__hooks}/lib/rules.js`);

const CONTENT_FIELDS = [
  "title",
  "text",
  "url",
  "imageUrls",
  "buttonText",
  "description",
  "tips",
];
const QUESTION_KINDS = ["text", "image", "video", "link"];

function collectionAvailable(app) {
  try {
    app.findCollectionByNameOrId("game_question_clues");
    return true;
  } catch (_) {
    return false;
  }
}

function onlyFields(value, allowed, name) {
  r.object(value, name);
  const permitted = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !permitted.has(key));
  if (extra.length)
    r.fail("INVALID_INPUT", `${name}包含不允许的字段：${extra.join("、")}`);
  return value;
}

function cleanContent(value) {
  const content = onlyFields(value || {}, CONTENT_FIELDS, "线索内容");
  return {
    title: r.text(content.title || "", "线索标题", 200, false),
    text: r.text(content.text || "", "线索文字", 16000, false),
    url: r.safeUrl(content.url || ""),
    imageUrls: r
      .list(content.imageUrls || [], "线索图片", 30)
      .map((url) => r.safeUrl(url)),
    buttonText: r.text(content.buttonText || "", "按钮文字", 100, false),
    description: r.text(
      content.description || "",
      "线索说明",
      1000,
      false,
    ),
    tips: r.text(content.tips || "", "线索入口提示", 500, false),
  };
}

function questionClueDto(row) {
  return db.pick(
    row,
    ["question", "position", "kind", "autoPlay", "status", "updated"],
    ["content"],
  );
}

function questionClues(app, questionId, includeArchived = false) {
  if (!collectionAvailable(app)) return [];
  return db.all(
    app,
    "game_question_clues",
    `question={:id}${includeArchived ? "" : " && status='active'"}`,
    { id: questionId },
    "position,id",
  );
}

function questionCluesByQuestion(app, questionIds) {
  const ids = [...new Set(questionIds.filter(Boolean))];
  const result = {};
  if (!ids.length || !collectionAvailable(app)) return result;
  const params = {};
  const owners = ids.map((id, index) => {
    params[`q${index}`] = id;
    return `question={:q${index}}`;
  });
  for (const row of db.all(
    app,
    "game_question_clues",
    `status='active' && (${owners.join(" || ")})`,
    params,
    "question,position,id",
  )) {
    const question = row.getString("question");
    if (!result[question]) result[question] = [];
    result[question].push(row);
  }
  return result;
}

function version(value) {
  return $security.sha256(r.canonical(value));
}

function questionClueSet(app, questionId) {
  const items = questionClues(app, questionId).map(questionClueDto);
  return { items, version: version(items) };
}

function questionClueCounts(app) {
  const result = {};
  if (!collectionAvailable(app)) return result;
  for (const row of db.all(app, "game_question_clues", "status='active'")) {
    const question = row.getString("question");
    result[question] = (result[question] || 0) + 1;
  }
  return result;
}

function validateQuestionKind(value) {
  if (!QUESTION_KINDS.includes(value))
    r.fail(
      "INVALID_INPUT",
      "题目通用线索仅支持文字、图片、视频或外部链接，不支持信件或祝福",
    );
  return value;
}

function cleanQuestionContent(kind, value) {
  const content = cleanContent(value);
  if (kind === "text" && !content.text)
    r.fail("INVALID_INPUT", "文字线索至少需要填写正文");
  if (kind === "image" && !content.imageUrls.length)
    r.fail("INVALID_INPUT", "图片线索至少需要配置一张图片");
  if (["video", "link"].includes(kind) && !content.url)
    r.fail("INVALID_INPUT", `${kind === "video" ? "视频" : "外部链接"}线索需要配置 URL`);
  return content;
}

module.exports = {
  CONTENT_FIELDS,
  QUESTION_KINDS,
  collectionAvailable,
  onlyFields,
  cleanContent,
  questionClueDto,
  questionClues,
  questionCluesByQuestion,
  questionClueSet,
  questionClueCounts,
  version,
  validateQuestionKind,
  cleanQuestionContent,
};
