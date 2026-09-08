import type { EditorPreviewDraft } from "../contracts";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const items = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
/** Explicit allowlist: never send answer keys, reasons, recipients or credentials. */
export function previewDraft(
  kind: EditorPreviewDraft["kind"],
  values: unknown,
): EditorPreviewDraft {
  const v = record(values);
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
