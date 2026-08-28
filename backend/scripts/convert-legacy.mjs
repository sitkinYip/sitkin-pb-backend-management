import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory)
  throw new Error(
    "Usage: node scripts/convert-legacy.mjs /absolute/private-backup-directory",
  );
const read = async (name) =>
  JSON.parse(await readFile(path.join(directory, `${name}.json`), "utf8"))
    .records;
const [levels, letters, phrases, combinations] = await Promise.all(
  ["levels", "letter", "phrase", "multi_quest_clues"].map(read),
);
const safeUrl = (value) => {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {}
  return "";
};
const warnings = [];
const narratives = [
  ...letters.map((row) => ({
    legacyKey: `letter:${row.id}`,
    kind: "letter",
    title: row.title || `旧信件 ${row.from}`,
    payload: {
      from: row.from || "",
      variant: row.type || "modern",
      description: row.desc || "",
      hintText: row.hintText || "点击开启信件",
      paragraphs: (row.paragraphConfigList || []).map((p) => ({
        content: p.content,
        align: p.align || "left",
        delayMs: p.delay || 0,
        audioUrl: safeUrl(p.audio),
      })),
      backgroundImages: (row.bgImages || []).map(safeUrl).filter(Boolean),
      pageBackgroundUrl: safeUrl(row.bgImg),
      mainAudioUrl: safeUrl(row.mainAudio),
      typingSpeedMs: row.speed || 80,
    },
  })),
  ...phrases.map((row) => ({
    legacyKey: `bless:${row.id}`,
    kind: "bless",
    title: row.title || `旧祝福 ${row.from}`,
    payload: {
      from: row.from || "",
      phrases: (row.phraseList || []).map((p) => ({
        text: p.text,
        audioUrl: safeUrl(p.audio),
        durationMs: p.duration ?? 5000,
      })),
      closingLines: (row.takeABowList || []).map((p) => ({
        text: p.text,
        audioUrl: safeUrl(p.audio),
        durationMs: p.duration ?? 2500,
      })),
      mainAudioUrl: safeUrl(row.mainAudio),
    },
  })),
];
const narrativeTarget = (route, query = {}) => {
  const kind = route?.includes("bless")
    ? "bless"
    : route?.includes("letter")
      ? "letter"
      : null;
  const row = (kind === "bless" ? phrases : letters).find(
    (item) => item.from === query.from,
  );
  return kind && row ? `${kind}:${row.id}` : null;
};
const questions = levels.map((row) => ({
  legacyKey: `question:${row.id}`,
  kind: row.type === "MultipleChoice" ? "choice" : "text",
  title: row.title || `第 ${row.step} 题`,
  placeholder: row.placeholder || "",
  content: (row.question || []).map((p) => ({
    text: p.text || "",
    hint: p.tips || "",
    imageUrl: safeUrl(p.img),
    imageUrls: (p.imgList || []).map(safeUrl).filter(Boolean),
    videoUrl: safeUrl(p.video),
  })),
  options: (row.options || []).map((p) => ({
    key: p.key,
    text: p.text || "",
    imageUrl: safeUrl(p.img),
    videoUrl: safeUrl(p.video),
  })),
  acceptedAnswers: [
    ...new Set(
      [row.answer, ...(row.answerList || [])].filter(
        (v) => typeof v === "string" && v.trim(),
      ),
    ),
  ],
}));
function sessionFor(rows, legacyKey, title, combined) {
  const clues = [];
  for (const [index, row] of rows.entries()) {
    for (const thread of row.thread || []) {
      const key = narrativeTarget(thread.path, thread.query);
      const kind =
        thread.type === "img"
          ? "image"
          : key
            ? key.split(":")[0]
            : thread.type === "url"
              ? "link"
              : thread.type;
      if (kind === "letter" && !key) {
        warnings.push({
          legacyKey,
          kind: "unresolved_narrative",
          step: row.step,
        });
        continue;
      }
      const url = safeUrl(thread.url);
      if (kind === "link" && !url && !key) {
        warnings.push({ legacyKey, kind: "unresolved_link", step: row.step });
        continue;
      }
      if (!["text", "image", "video", "link", "letter", "bless"].includes(kind))
        continue;
      clues.push({
        trigger: "level_completed",
        levelIndex: index,
        kind,
        narrativeKey: key || undefined,
        autoPlay:
          ["text", "image", "video"].includes(kind) &&
          thread.state === "AutoPlay",
        content: {
          title: thread.title || "",
          text: thread.content || "",
          tips: thread.tips || "",
          url,
          imageUrls: [
            ...new Set(
              [thread.url, ...(thread.imgList || [])]
                .map(safeUrl)
                .filter(Boolean),
            ),
          ],
        },
      });
    }
  }
  if (combined)
    clues.push({
      trigger: "session_completed",
      kind: "text",
      content: {
        title: combined.title || "组合线索",
        text: combined.content || "",
        buttonText: combined.buttonText || "",
        description: combined.desc || "",
      },
      autoPlay: true,
    });
  const last = rows.at(-1),
    target = last?.FinalLevelConfig;
  const narrativeKey = target
    ? narrativeTarget(target.path || target.link, target.query)
    : null;
  const url = safeUrl(target?.link || target?.path);
  if (target && Object.keys(target).length && !narrativeKey && !url)
    warnings.push({ legacyKey, kind: "unresolved_completion_target" });
  return {
    legacyKey,
    title,
    description: "由旧题目备份复配；经验暂设每题 50，请在发布前检查。",
    presentation: {
      bgmMode: rows[0].mainAudio ? "custom" : "silent",
      bgmUrl: safeUrl(rows[0].mainAudio),
      backgroundUrl: safeUrl(rows[0].mainBgImg),
      completionStyle: last?.isFinalLevel ? "finale" : "normal",
    },
    completionTarget: narrativeKey
      ? { kind: "narrative", narrativeKey }
      : url
        ? { kind: "link", url }
        : null,
    levels: rows.map((row) => ({
      questionKey: `question:${row.id}`,
      xp: 50,
      autoNext: Boolean(row.autoNext),
      penaltyPolicy: (row.type === "MultipleChoice"
        ? row.penaltyConfig?.length
          ? row.penaltyConfig
          : [180000, -1]
        : []
      ).map((ms) =>
        ms < 0
          ? { type: "lock" }
          : { type: "cooldown", seconds: Math.ceil(ms / 1000) },
      ),
      presentationOverride: {
        hideTitle: !row.title,
        backgroundMode: row.mainBgImg ? "custom" : "none",
        // Original multi-question sessions keep the first question's BGM.
        bgmMode: "inherit",
        backgroundUrl: safeUrl(row.mainBgImg),
      },
    })),
    clues,
    rewardRules: [],
  };
}
const sessions = levels.map((row) =>
  sessionFor([row], `single:${row.id}`, `复配 · ${row.title || row.step}`),
);
for (const combined of combinations) {
  const steps = String(combined.qas)
    .split(",")
    .map((s) => Number(s.trim()));
  const rows = steps.map((step) => levels.find((row) => row.step === step));
  if (rows.some((row) => !row)) {
    warnings.push({ legacyKey: combined.id, kind: "missing_question" });
    continue;
  }
  sessions.push(
    sessionFor(
      rows,
      `combined:${combined.id}`,
      combined.title || "复配组合场次",
      combined,
    ),
  );
}
const output = path.join(directory, "converted-game-v1.json");
await writeFile(
  output,
  JSON.stringify(
    { schemaVersion: 1, questions, narratives, sessions, warnings },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    output,
    questions: questions.length,
    narratives: narratives.length,
    sessions: sessions.length,
    warningCount: warnings.length,
    omittedFields: [
      "userName",
      "avatar",
      "rank",
      "rankName",
      "startTime",
      "endTime",
    ],
  }),
);
