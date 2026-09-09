import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, Button, Form, type FormInstance } from "antd";
import type {
  AdminCatalog,
  AdminQuestionClue,
  AdminQuestionClueSet,
  AdminSession,
} from "../contracts";
import { gameRequest } from "../api";
import { LivePreview } from "./LivePreview";
import { sessionPreviewDraft } from "./session-draft";

export function SessionPreview({
  form,
  catalog,
  active,
  base,
  children,
}: {
  form: FormInstance;
  catalog: AdminCatalog;
  active: boolean;
  base?: AdminSession | null;
  children: ReactNode;
}) {
  const values = Form.useWatch([], { form, preserve: true });
  const merged = useMemo(
    () =>
      base
        ? {
            ...base,
            ...values,
            presentation: { ...base.presentation, ...values?.presentation },
            levels: (values?.levels ?? base.levels).map(
              (l: AdminSession["levels"][number]) => ({
                ...base.levels.find((old) => old.id === l.id),
                ...l,
              }),
            ),
          }
        : values,
    [base, values],
  );
  const ids = JSON.stringify(
    [
      ...new Set(
        (merged?.levels ?? [])
          .map((l: { question?: string }) => l?.question)
          .filter(Boolean),
      ),
    ].sort(),
  );
  const [common, setCommon] = useState<Record<string, AdminQuestionClue[]>>({});
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setCommon({});
    setNotice("正在读取题目通用线索…");
    const questions = JSON.parse(ids) as string[];
    void Promise.allSettled(
      questions.map((id) =>
        gameRequest<AdminQuestionClueSet>(
          `/admin/questions/${encodeURIComponent(id)}/clues`,
        ),
      ),
    ).then((results) => {
      if (cancelled) return;
      const entries: Record<string, AdminQuestionClue[]> = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled") entries[questions[i]] = r.value.items;
      });
      setCommon(entries);
      setNotice(
        results.some((r) => r.status === "rejected")
          ? "部分题目通用线索读取失败，预览可能不完整。请重试。"
          : "",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [active, ids, refresh, catalog.questions]);
  const draft = useMemo(
    () => ({
      kind: "session" as const,
      value: (() => {
        const value = sessionPreviewDraft(merged, catalog, common);
        return {
          ...value,
          issues: notice ? [notice, ...value.issues] : value.issues,
        };
      })(),
    }),
    [merged, catalog, common, notice],
  );
  return (
    <LivePreview
      form={form}
      kind="session"
      active={active}
      draftOverride={draft}
    >
      {notice && (
        <Alert
          type="info"
          message={notice}
          action={
            <Button onClick={() => setRefresh((n) => n + 1)}>重试</Button>
          }
        />
      )}
      {children}
    </LivePreview>
  );
}
