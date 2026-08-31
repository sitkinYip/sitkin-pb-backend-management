import {
  Alert,
  Button,
  Image,
  Input,
  Space,
  Tag,
  Typography,
} from "antd";
import { AlistMediaInput } from "../../components/Alist/AlistMediaInput";
import { TextSyntaxHelp } from "../../components/TextSyntaxHelp";
import type {
  AdminQuestionClue,
  GameClue,
  GameClueContent,
} from "../contracts";
import { Field } from "../ui";
import { LinesInput } from "../shared";
import type { FormPath } from "./PresentationFields";

export type EditableClueKind = AdminQuestionClue["kind"];
export type PreviewMoment = "fresh" | "history";

export const questionClueKindOptions: {
  value: EditableClueKind;
  label: string;
}[] = [
  { value: "text", label: "文字" },
  { value: "image", label: "图片" },
  { value: "video", label: "视频" },
  { value: "link", label: "外部链接" },
];

export const clueKindLabels: Record<GameClue["kind"], string> = {
  text: "文字",
  image: "图片",
  video: "视频",
  link: "外部链接",
  letter: "信件",
  bless: "祝福",
};

export function emptyClueContent(): GameClueContent {
  return {
    title: "",
    text: "",
    url: "",
    imageUrls: [],
    buttonText: "",
    description: "",
    tips: "",
  };
}

export function normalizeClueContent(
  value?: Partial<GameClueContent>,
): GameClueContent {
  return {
    title: value?.title || "",
    text: value?.text || "",
    url: value?.url || "",
    imageUrls: (value?.imageUrls || []).map((url) => url.trim()).filter(Boolean),
    buttonText: value?.buttonText || "",
    description: value?.description || "",
    tips: value?.tips || "",
  };
}

function TextAndDescriptionFields({
  prefix,
  requiredText = false,
}: {
  prefix: FormPath;
  requiredText?: boolean;
}) {
  return (
    <>
      <Field
        name={[...prefix, "text"]}
        label="文字内容"
        rules={
          requiredText
            ? [
                {
                  required: true,
                  whitespace: true,
                  message: "请填写文字线索正文",
                },
              ]
            : undefined
        }
        extra={<TextSyntaxHelp />}
      >
        <Input.TextArea rows={4} />
      </Field>
      <Field
        name={[...prefix, "buttonText"]}
        label="线索确认按钮文字"
      >
        <Input />
      </Field>
      <Field name={[...prefix, "description"]} label="底部说明">
        <Input.TextArea rows={2} />
      </Field>
    </>
  );
}

/** Fields are deliberately selected by kind instead of showing every wire field. */
export function ClueContentFields({
  prefix,
  kind,
  requirePrimary = false,
}: {
  prefix: FormPath;
  kind: GameClue["kind"];
  requirePrimary?: boolean;
}) {
  return (
    <>
      <Field name={[...prefix, "title"]} label="线索标题">
        <Input />
      </Field>

      {kind === "text" && (
        <TextAndDescriptionFields
          prefix={prefix}
          requiredText={requirePrimary}
        />
      )}

      {kind === "image" && (
        <>
          <Field
            name={[...prefix, "imageUrls"]}
            label="图片 URL（每行一条）"
            rules={
              requirePrimary
                ? [
                    {
                      validator: (_, value?: string[]) =>
                        value?.some((url) => url.trim())
                          ? Promise.resolve()
                          : Promise.reject(new Error("请至少填写一张线索图片")),
                    },
                  ]
                : undefined
            }
          >
            <LinesInput rows={4} />
          </Field>
          <TextAndDescriptionFields prefix={prefix} />
        </>
      )}

      {kind === "video" && (
        <>
          <Field
            name={[...prefix, "url"]}
            label="视频 URL"
            rules={
              requirePrimary
                ? [
                    {
                      required: true,
                      whitespace: true,
                      message: "请填写视频 URL",
                    },
                  ]
                : undefined
            }
          >
            <AlistMediaInput type="video" />
          </Field>
          <TextAndDescriptionFields prefix={prefix} />
        </>
      )}

      {kind === "link" && (
        <>
          <Field
            name={[...prefix, "url"]}
            label="外部链接 URL"
            rules={
              requirePrimary
                ? [
                    {
                      required: true,
                      whitespace: true,
                      message: "请填写外部链接 URL",
                    },
                  ]
                : undefined
            }
          >
            <Input inputMode="url" />
          </Field>
          <Field
            name={[...prefix, "text"]}
            label="链接说明"
            extra={<TextSyntaxHelp />}
          >
            <Input.TextArea rows={3} />
          </Field>
          <Field name={[...prefix, "buttonText"]} label="链接按钮文字">
            <Input />
          </Field>
        </>
      )}

      <Field name={[...prefix, "tips"]} label="入口提示文字">
        <Input />
      </Field>
    </>
  );
}

export function clueSummary(
  kind: GameClue["kind"],
  content?: Partial<GameClueContent>,
) {
  const normalized = normalizeClueContent(content);
  const candidate =
    normalized.title ||
    normalized.text ||
    normalized.description ||
    normalized.url ||
    normalized.imageUrls[0] ||
    `未填写${clueKindLabels[kind]}内容`;
  return candidate.replace(/\s+/g, " ").trim().slice(0, 56);
}

export function CluePlayerPreview({
  kind,
  content,
  autoPlay,
  moment,
  freshLabel = "刚答完此题",
  freshMessage,
}: {
  kind: GameClue["kind"];
  content?: Partial<GameClueContent>;
  autoPlay?: boolean;
  moment: PreviewMoment;
  freshLabel?: string;
  freshMessage?: string;
}) {
  const value = normalizeClueContent(content);
  const canAutoPlay = autoPlay && ["text", "image", "video"].includes(kind);
  return (
    <section className="admin-clue-preview" aria-label="玩家线索预览">
      <div className="admin-clue-preview-heading">
        <div>
          <Typography.Text strong>玩家态预览</Typography.Text>
          <Typography.Text type="secondary">
            {moment === "fresh" ? freshLabel : "此前已经答过"}
          </Typography.Text>
        </div>
        <Tag>{clueKindLabels[kind]}</Tag>
      </div>
      <Alert
        type={moment === "history" ? "info" : canAutoPlay ? "success" : "info"}
        showIcon
        message={
          moment === "history"
            ? "只静默加入线索列表，不重复弹窗或执行跳转。"
            : freshMessage ||
              (canAutoPlay
                ? "答题成功后会立即展示这条线索。"
                : "答题成功后加入线索列表，由玩家主动打开。")
        }
      />
      <article className="admin-clue-preview-surface">
        <Typography.Title level={4}>
          {value.title || "未填写线索标题"}
        </Typography.Title>
        {kind === "image" && value.imageUrls.length > 0 && (
          <div className="admin-clue-preview-images">
            {value.imageUrls.map((url, index) => (
              <Image
                key={`${url}-${index}`}
                src={url}
                alt={`${value.title || "线索"}图片 ${index + 1}`}
              />
            ))}
          </div>
        )}
        {kind === "video" && value.url && (
          <video
            className="admin-clue-preview-video"
            src={value.url}
            controls
            preload="metadata"
            aria-label={value.title || "线索视频"}
          />
        )}
        {value.text && (
          <Typography.Paragraph className="admin-clue-preview-copy">
            {value.text}
          </Typography.Paragraph>
        )}
        {kind === "link" && value.url && (
          <Button href={value.url} target="_blank" rel="noreferrer">
            {value.buttonText || "打开链接"}
          </Button>
        )}
        {kind !== "link" && value.buttonText && (
          <Button type="primary">{value.buttonText}</Button>
        )}
        {value.description && (
          <Typography.Paragraph type="secondary">
            {value.description}
          </Typography.Paragraph>
        )}
        {value.tips && (
          <Space size={6} className="admin-clue-preview-tip">
            <Typography.Text type="secondary">列表入口：</Typography.Text>
            <Typography.Text>{value.tips}</Typography.Text>
          </Space>
        )}
      </article>
    </section>
  );
}
