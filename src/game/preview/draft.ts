import type { EditorPreviewDraft } from "../contracts";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown, fallback: number, minimum = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= minimum
    ? value
    : fallback;
const items = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
/** Explicit allowlist: never send answer keys, reasons, recipients or credentials. */
export function previewDraft(
  kind: Exclude<EditorPreviewDraft["kind"], "session">,
  values: unknown,
): EditorPreviewDraft {
  const v = record(values);
  if (kind === "narrative") {
    const p = record(v.payload);
    const narrativeKind = v.kind === "bless" ? "bless" : "letter";
    const line = (value: unknown) => {
      const l = record(value);
      return {
        text: text(l.text),
        audioUrl: text(l.audioUrl),
        durationMs: number(l.durationMs, 3000),
      };
    };
    return {
      kind,
      value: {
        id: "editor-narrative",
        kind: narrativeKind,
        title: text(v.title),
        payload: {
          from: text(p.from),
          mainAudioUrl: text(p.mainAudioUrl),
          ...(narrativeKind === "letter"
            ? {
                variant:
                  p.variant === "classical" || p.variant === "magic"
                    ? p.variant
                    : "modern",
                description: text(p.description),
                hintText:
                  typeof p.hintText === "string" ? p.hintText : "点击开启信件",
                typingSpeedMs: number(p.typingSpeedMs, 60, 1),
                pageBackgroundUrl: text(p.pageBackgroundUrl),
                backgroundImages: items(p.backgroundImages).filter(
                  (url): url is string => typeof url === "string",
                ),
                paragraphs: items(p.paragraphs).map((value) => {
                  const paragraph = record(value);
                  return {
                    content: text(paragraph.content),
                    audioUrl: text(paragraph.audioUrl),
                    delayMs: number(paragraph.delayMs, 0),
                    align: ["center", "right", "top", "bottom"].includes(
                      text(paragraph.align),
                    )
                      ? text(paragraph.align)
                      : "left",
                  };
                }),
              }
            : {
                phrases: items(p.phrases).map(line),
                closingLines: items(p.closingLines).map(line),
              }),
        },
      },
    };
  }
  if (kind === "notification")
    return {
      kind,
      value: {
        title: text(v.title),
        content: text(v.content),
        popupTitle: text(v.popupTitle),
        buttonText: text(v.buttonText),
      },
    };
  return {
    kind,
    value: {
      id: "editor-question",
      kind: v.kind === "choice" ? "choice" : "text",
      title: text(v.title),
      placeholder: text(v.placeholder),
      content: items(v.content).map((item) => {
        const b = record(item);
        return {
          text: text(b.text),
          hint: text(b.hint),
          imageUrl: text(b.imageUrl),
          videoUrl: text(b.videoUrl),
          imageUrls: items(b.imageUrls).filter(
            (url): url is string => typeof url === "string",
          ),
        };
      }),
      options: items(v.options).map((item) => {
        const o = record(item);
        return {
          key: text(o.key),
          text: text(o.text),
          imageUrl: text(o.imageUrl),
          videoUrl: text(o.videoUrl),
        };
      }),
    },
  };
}
