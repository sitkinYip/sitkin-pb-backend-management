import type {
  AdminQuestion,
  AdminQuestionUsage,
  AdminSession,
  AdminNarrative,
} from "./contracts";

export type SessionFilter = AdminSession["status"] | "all";
export const sessionStatusLabels = {
  published: "线上",
  draft: "草稿",
  archived: "已下线",
};

export function questionUsage(
  question: AdminQuestion,
  sessions: AdminSession[],
): AdminQuestionUsage {
  if (question.usage) return question.usage;
  // Backwards-compatible display only. The backend always rechecks on save.
  const refs = sessions.filter((s) =>
    s.levels.some((level) => level.question === question.id),
  );
  const online = refs.filter((s) => s.status === "published");
  const drafts = refs.filter((s) => s.status === "draft");
  return {
    online,
    drafts,
    historyCount: refs.filter((s) => s.status === "archived").length,
    canEdit: question.status !== "archived" && online.length === 0,
    canDelete:
      question.status !== "archived" &&
      online.length === 0 &&
      drafts.length === 0,
  };
}

export function filterSessions(
  sessions: AdminSession[],
  status: SessionFilter,
  search: string,
) {
  const term = search.trim().toLocaleLowerCase();
  return sessions.filter(
    (s) =>
      (status === "all" || s.status === status) &&
      s.title.toLocaleLowerCase().includes(term),
  );
}

export function sessionCounts(sessions: AdminSession[]) {
  return {
    published: sessions.filter((s) => s.status === "published").length,
    draft: sessions.filter((s) => s.status === "draft").length,
    archived: sessions.filter((s) => s.status === "archived").length,
    all: sessions.length,
  };
}

export function questionOptions(
  questions: AdminQuestion[],
  selectedId?: string,
) {
  return questions
    .filter((q) => q.status !== "archived" || q.id === selectedId)
    .map((q) => ({
      value: q.id,
      label: `${q.title} · v${q.revision}${q.status === "archived" ? "（已移出，发布前须替换）" : q.status === "draft" ? "（草稿）" : ""}`,
      searchText: `${q.title} ${q.id}`,
      disabled: q.status === "archived",
    }));
}

export type NarrativeFilter = "available" | "archived" | "all";

export function narrativeUsage(
  narrative: AdminNarrative,
  sessions: AdminSession[],
) {
  // Both relation-backed clues and the JSON completion target count, once per session.
  const refs = sessions.filter(
    (s) =>
      s.clues.some((clue) => clue.narrative === narrative.id) ||
      (s.completionTarget?.kind === "narrative" &&
        s.completionTarget.id === narrative.id),
  );
  const online = refs.filter((s) => s.status === "published");
  const drafts = refs.filter((s) => s.status === "draft");
  const history = refs.filter((s) => s.status === "archived");
  return {
    online,
    drafts,
    history,
    canDelete:
      narrative.status !== "archived" &&
      online.length === 0 &&
      drafts.length === 0,
  };
}

export function narrativeDeletionHint(
  narrative: AdminNarrative,
  sessions: AdminSession[],
) {
  const info = narrativeUsage(narrative, sessions);
  if (narrative.status === "archived")
    return info.online.length
      ? "历史归档内容仍被线上场次引用：保留原读取行为，不自动断开关联。"
      : "已移出，仅可查看或复制；历史关联保留。";
  if (info.online.length && info.drafts.length)
    return "先下线所有线上引用，并替换 / 移除草稿引用（或作废草稿），再删除。";
  if (info.online.length) return "先下线所有线上引用，再删除。";
  if (info.drafts.length) return "先替换 / 移除草稿引用，或作废草稿，再删除。";
  return info.history.length
    ? "仅已下线场次引用，可删除并保留历史关联。"
    : "无场次引用，可删除。";
}

export function filterNarratives(
  narratives: AdminNarrative[],
  scope: NarrativeFilter,
  search: string,
) {
  const term = search.trim().toLocaleLowerCase();
  return narratives.filter(
    (n) =>
      n.title.toLocaleLowerCase().includes(term) &&
      (scope === "all" ||
        (scope === "archived"
          ? n.status === "archived"
          : n.status !== "archived")),
  );
}

export function narrativeOptions(
  narratives: AdminNarrative[],
  selectedId?: string,
) {
  return narratives
    .filter((n) => n.status === "published" || n.id === selectedId)
    .map((n) => ({
      value: n.id,
      label: `${n.title} · v${n.revision}（${n.kind === "letter" ? "信件" : "祝福"}${n.status === "archived" ? " · 已移出，需替换" : n.status === "draft" ? " · 草稿，须先发布" : ""}）`,
      disabled: n.status !== "published",
    }));
}

export function unavailableNarrativeReferences(
  narratives: AdminNarrative[],
  session: Pick<AdminSession, "clues" | "completionTarget">,
) {
  const references = new Map<
    string,
    { id: string; label: string; locations: string[] }
  >();
  const add = (id: string | undefined, location: string) => {
    if (!id) return;
    const row = narratives.find((n) => n.id === id);
    if (row && row.status !== "archived") return;
    const ref = references.get(id) || {
      id,
      label: row ? `${row.title} · v${row.revision}` : "内容不存在",
      locations: [],
    };
    ref.locations.push(location);
    references.set(id, ref);
  };
  if (session.completionTarget?.kind === "narrative")
    add(session.completionTarget.id, "基础与演出 → 叙事内容");
  session.clues.forEach((clue, index) =>
    add(clue.narrative, `线索 ${index + 1}`),
  );
  return [...references.values()];
}
