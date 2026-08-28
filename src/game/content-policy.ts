import type {
  AdminQuestion,
  AdminQuestionUsage,
  AdminSession,
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
      disabled: q.status === "archived",
    }));
}
