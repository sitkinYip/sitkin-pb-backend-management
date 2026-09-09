import type {
  AdminCatalog,
  AdminQuestionClue,
  EditorSessionPreview,
  GameClue,
  GamePresentation,
} from "../contracts";
import { previewDraft } from "./draft";
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
function presentation(value: unknown): GamePresentation {
  const p = obj(value);
  return {
    ...(typeof p.hideTitle === "boolean" ? { hideTitle: p.hideTitle } : {}),
    backgroundMode:
      p.backgroundMode === "none" || p.backgroundMode === "custom"
        ? p.backgroundMode
        : "inherit",
    backgroundUrl: str(p.backgroundUrl),
    bgmMode:
      p.bgmMode === "silent" || p.bgmMode === "custom" ? p.bgmMode : "inherit",
    bgmUrl: str(p.bgmUrl),
    completionStyle: p.completionStyle === "finale" ? "finale" : "normal",
  };
}
/** Resolve references once in the admin. Only display data crosses the iframe boundary. */
export function sessionPreviewDraft(
  values: unknown,
  catalog: AdminCatalog,
  common: Record<string, AdminQuestionClue[]> = {},
): EditorSessionPreview {
  const v = obj(values),
    issues: string[] = [];
  const occurrences = new Map<string, number>();
  const levels = arr(v.levels).map((value, index) => {
    const l = obj(value),
      qid = str(l.question),
      occurrence = occurrences.get(qid) ?? 0;
    occurrences.set(qid, occurrence + 1);
    const q = catalog.questions.find((q) => q.id === qid);
    if (!q)
      issues.push(
        `第 ${index + 1} 关${qid ? "引用的题目不存在" : "尚未选择题目"}。`,
      );
    else if (q.status === "archived")
      issues.push(`第 ${index + 1} 关题目已归档，当前仅供核对展示。`);
    const draft = previewDraft("question", q);
    return {
      id: str(l.id) || `preview-level-${qid}-${occurrence}`,
      position: index,
      xp: num(l.xp),
      autoNext: l.autoNext === true,
      completedAt: "",
      wrongCount: 0,
      cooldownUntil: "",
      locked: false,
      presentationOverride: presentation(l.presentationOverride),
      question:
        q && draft.kind === "question" ? { ...draft.value, id: qid } : null,
      lastAnswer: "",
    };
  });
  const clues: GameClue[] = [];
  function addClue(
    value: unknown,
    index: number,
    source: "session" | "question",
    levelId = "",
    question = "",
  ) {
    const c = obj(value),
      content = obj(c.content);
    const kind = ["text", "image", "video", "link", "letter", "bless"].includes(
      str(c.kind),
    )
      ? (c.kind as GameClue["kind"])
      : "text";
    const trigger =
      source === "question"
        ? "question_completed"
        : ["start", "level_completed", "session_completed", "manual"].includes(
              str(c.trigger),
            )
          ? (c.trigger as GameClue["trigger"])
          : "start";
    const bound =
      levelId ||
      (str(c.sessionLevel)
        ? levels.find((l) => l.id === c.sessionLevel)?.id
        : typeof c.levelIndex === "number"
          ? levels[c.levelIndex]?.id
          : "") ||
      "";
    if (trigger === "level_completed" && !bound) {
      issues.push(`第 ${index + 1} 条场次线索尚未绑定有效关卡。`);
      return;
    }
    const id = `${source}-${levelId}-${str(c.id) || index}`;
    clues.push({
      id,
      definitionId: id,
      source,
      question,
      sessionLevel: bound,
      trigger,
      kind,
      position: index,
      narrative: str(c.narrative),
      autoPlay: c.autoPlay === true,
      unlockedAt: "",
      content: {
        title: str(content.title),
        text: str(content.text),
        url: str(content.url),
        imageUrls: arr(content.imageUrls).filter(
          (x): x is string => typeof x === "string",
        ),
        buttonText: str(content.buttonText),
        description: str(content.description),
        tips: str(content.tips),
      },
    });
  }
  arr(v.clues).forEach((c, i) => addClue(c, i, "session"));
  for (const l of levels)
    for (const [i, c] of (common[l.question?.id || ""] || []).entries())
      if (c.status === "active")
        addClue(c, i, "question", l.id, l.question!.id);
  const t = obj(v.completionTarget);
  const target =
    t.kind === "narrative"
      ? { kind: "narrative" as const, id: str(t.id) }
      : t.kind === "link"
        ? { kind: "link" as const, url: str(t.url) }
        : null;
  const refs = new Set(
    clues
      .filter((c) => c.kind === "letter" || c.kind === "bless")
      .map((c) => c.narrative),
  );
  if (target?.kind === "narrative") refs.add(target.id);
  const narratives: EditorSessionPreview["narratives"] = [];
  for (const id of refs) {
    const n = catalog.narratives.find((n) => n.id === id);
    if (!n) {
      issues.push("存在未选择或已缺失的剧情引用，请检查线索和完成后入口。");
      continue;
    }
    if (n.status === "archived")
      issues.push(`剧情「${n.title}」已移出内容库，当前仅供核对展示。`);
    const d = previewDraft("narrative", n);
    if (d.kind === "narrative") narratives.push({ ...d.value, id: n.id });
  }
  const rank = (id: unknown) => catalog.ranks.find((r) => r.id === id)?.order;
  return {
    assignment: {
      id: "editor-session",
      player: "editor-player",
      session: "editor-session",
      status: "assigned",
      order: 0,
      startsAt: "",
      endsAt: "",
      startedAt: "",
      completedAt: "",
      previousAssignment: "",
      title: str(v.title),
      description: str(v.description),
      minLevel: rank(v.minLevel) ?? 0,
      maxLevel: rank(v.maxLevel) ?? null,
      completedLevels: 0,
      totalLevels: levels.length,
      presentation: presentation(v.presentation),
      completionTarget: target,
      currentIndex: 0,
      clues,
      levels,
      serverTime: "2026-01-01T00:00:00.000Z",
    },
    narratives,
    issues: [...new Set(issues)],
  };
}
