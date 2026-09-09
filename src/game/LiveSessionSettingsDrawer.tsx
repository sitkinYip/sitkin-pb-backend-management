import { SessionPreview } from "./preview/SessionPreview";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Collapse,
  Form,
  Input,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from "antd";
import type {
  AdminClue,
  AdminCatalog,
  AdminQuestion,
  AdminSession,
  AdminSessionLiveSettingsInput,
  AdminSessionLiveSettingsResult,
  GameLivePresentation,
  GamePresentation,
} from "./contracts";
import {
  ClueContentFields,
  CluePlayerPreview,
  clueKindLabels,
  clueSummary,
  normalizeClueContent,
} from "./components/ClueFields";
import { PresentationFields } from "./components/PresentationFields";
import { EditorDrawer, Field } from "./ui";
import { useAdminCommand } from "./shared";

const triggerLabels: Record<AdminClue["trigger"], string> = {
  start: "开始场次",
  level_completed: "完成指定关卡",
  session_completed: "完成整个场次",
  manual: "管理员手动解锁",
};

type LiveLevelDraft = {
  id: string;
  question: string;
  presentationOverride: GamePresentation;
};
type LiveClueDraft = AdminClue & { id: string; position: number };
type LiveSettingsFormValue = {
  reason: string;
  title: string;
  description: string;
  presentation: GamePresentation;
  levels: LiveLevelDraft[];
  clues: LiveClueDraft[];
};

export function livePresentationPayload(
  value?: GamePresentation,
): GameLivePresentation {
  return {
    ...(value?.backgroundMode ? { backgroundMode: value.backgroundMode } : {}),
    ...(typeof value?.hideTitle === "boolean"
      ? { hideTitle: value.hideTitle }
      : {}),
    ...(value?.bgmMode ? { bgmMode: value.bgmMode } : {}),
    ...(typeof value?.bgmUrl === "string" ? { bgmUrl: value.bgmUrl } : {}),
    ...(typeof value?.backgroundUrl === "string"
      ? { backgroundUrl: value.backgroundUrl }
      : {}),
  };
}

export function liveSettingsPayload(
  values: LiveSettingsFormValue,
  expectedVersion: string,
): Omit<AdminSessionLiveSettingsInput, "requestId"> {
  return {
    reason: values.reason.trim(),
    expectedVersion,
    title: values.title,
    description: values.description || "",
    presentation: livePresentationPayload(values.presentation),
    levels: (values.levels || [])
      .filter((level) => Boolean(level.id))
      .map((level) => ({
        id: level.id,
        presentationOverride: livePresentationPayload(
          level.presentationOverride,
        ),
      })),
    clues: (values.clues || [])
      .filter((clue) => Boolean(clue.id))
      .map((clue, index) => ({
        id: clue.id,
        position: index,
        content: normalizeClueContent(clue.content),
        autoPlay: clue.autoPlay === true,
      })),
  };
}

function toFormValue(session: AdminSession): LiveSettingsFormValue {
  return {
    reason: "",
    title: session.title,
    description: session.description || "",
    presentation: session.presentation || {},
    levels: session.levels.map((level) => ({
      id: level.id || "",
      question: level.question,
      presentationOverride: level.presentationOverride || {},
    })),
    clues: session.clues.map((clue, index) => ({
      ...clue,
      id: clue.id || "",
      position: clue.position ?? index,
      content: normalizeClueContent(clue.content),
    })),
  };
}

function questionTitle(questions: AdminQuestion[], id: string) {
  return (
    questions.find((question) => question.id === id)?.title || "题目不存在"
  );
}

export function LiveSessionSettingsDrawer({
  session,
  questions,
  catalog,
  open,
  onClose,
  refresh,
}: {
  session: AdminSession | null;
  questions: AdminQuestion[];
  catalog: AdminCatalog;
  open: boolean;
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const [form] = Form.useForm<LiveSettingsFormValue>();
  const [dirty, setDirty] = useState(false);
  const [activeLevel, setActiveLevel] = useState<string>();
  const [activeClue, setActiveClue] = useState<string>();
  const { modal } = App.useApp();
  const { run, busy } = useAdminCommand(refresh);
  const watchedClues = Form.useWatch("clues", form) || [];

  useEffect(() => {
    if (!open || !session) return;
    form.setFieldsValue(toFormValue(session));
    setDirty(false);
    setActiveLevel(session.levels.length ? "0" : undefined);
    setActiveClue(session.clues.length ? "0" : undefined);
  }, [form, open, session?.id, session?.liveSettingsVersion]);

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: "放弃未保存的线上配置？",
      content: "关闭后，本次展示内容和排序修改都会丢失。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: onClose,
    });
  };

  return (
    <EditorDrawer
      title={session ? `编辑已发布配置 · ${session.title}` : "编辑已发布配置"}
      width={1280}
      open={open}
      forceRender
      onClose={close}
      extra={
        <Space wrap>
          <Button onClick={close}>关闭</Button>
          <Button
            type="primary"
            loading={busy}
            disabled={!session || session.status !== "published"}
            onClick={() => form.submit()}
          >
            保存线上展示
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="线上场次只开放展示层修改，保存后玩家下次读取会看到新内容。"
        description="题目与关卡结构、经验、惩罚、自动下一题、奖励、参与等级、线索类型与触发关系、信件关联和通关入口仍然锁定。完整配置可在原查看抽屉中核对。"
      />
      <SessionPreview
        form={form}
        catalog={catalog}
        active={open}
        base={session}
      >
        <Form<LiveSettingsFormValue>
          form={form}
          layout="vertical"
          onValuesChange={() => setDirty(true)}
          onFinish={async (values) => {
            if (!session || session.status !== "published") return;
            const result = await run<AdminSessionLiveSettingsResult>(
              `/admin/sessions/${encodeURIComponent(session.id)}/live-settings`,
              liveSettingsPayload(values, session.liveSettingsVersion),
              "PATCH",
            );
            if (result) setDirty(false);
          }}
        >
          <Field
            name="reason"
            label="修改原因"
            rules={[
              { required: true, whitespace: true, message: "请填写修改原因" },
            ]}
          >
            <Input.TextArea
              rows={2}
              maxLength={1000}
              placeholder="例如：替换背景音乐并修正第 2 条线索说明"
            />
          </Field>
          <Tabs
            items={[
              {
                key: "session-display",
                forceRender: true,
                label: "场次展示",
                children: (
                  <>
                    <Field
                      name="title"
                      label="场次名称"
                      rules={[{ required: true, whitespace: true }]}
                    >
                      <Input />
                    </Field>
                    <Field name="description" label="场次说明">
                      <Input.TextArea rows={3} />
                    </Field>
                    <PresentationFields prefix={["presentation"]} />
                    <Alert
                      type="warning"
                      message="参与等级、通关演出和完成后入口在已发布状态下不可修改。"
                    />
                  </>
                ),
              },
              {
                key: "level-display",
                forceRender: true,
                label: `关卡展示（${session?.levels.length || 0}）`,
                children: (
                  <Form.List name="levels">
                    {(fields) => (
                      <Collapse
                        accordion
                        className="admin-live-section-list"
                        activeKey={activeLevel}
                        onChange={(key) =>
                          setActiveLevel(
                            Array.isArray(key)
                              ? String(key[0] || "")
                              : String(key),
                          )
                        }
                        items={fields.map((field, index) => ({
                          key: String(index),
                          label: (
                            <div className="admin-live-summary">
                              <span>第 {index + 1} 关</span>
                              <Typography.Text type="secondary">
                                {questionTitle(
                                  questions,
                                  session?.levels[index]?.question || "",
                                )}
                              </Typography.Text>
                            </div>
                          ),
                          children: (
                            <div key={field.key}>
                              <Field name={[field.name, "id"]} hidden>
                                <Input />
                              </Field>
                              <Field name={[field.name, "question"]} hidden>
                                <Input />
                              </Field>
                              <PresentationFields
                                prefix={[field.name, "presentationOverride"]}
                              />
                              <Typography.Text type="secondary">
                                本关的题目、经验、惩罚和自动下一题保持锁定。
                              </Typography.Text>
                            </div>
                          ),
                        }))}
                      />
                    )}
                  </Form.List>
                ),
              },
              {
                key: "clue-display",
                forceRender: true,
                label: `场次线索（${session?.clues.length || 0}）`,
                children: (
                  <Form.List name="clues">
                    {(fields, { move }) => (
                      <Collapse
                        accordion
                        className="admin-live-section-list"
                        activeKey={activeClue}
                        onChange={(key) =>
                          setActiveClue(
                            Array.isArray(key)
                              ? String(key[0] || "")
                              : String(key),
                          )
                        }
                        items={fields.map((field, index) => {
                          const clue = watchedClues[field.name];
                          const kind = clue?.kind || "text";
                          return {
                            key: String(index),
                            label: (
                              <div className="admin-clue-summary">
                                <span className="admin-clue-order">
                                  {index + 1}
                                </span>
                                <div>
                                  <Space size={6} wrap>
                                    <Tag>{clueKindLabels[kind]}</Tag>
                                    <Tag>
                                      {triggerLabels[clue?.trigger || "manual"]}
                                    </Tag>
                                    {clue?.autoPlay &&
                                      ["text", "image", "video"].includes(
                                        kind,
                                      ) && <Tag color="green">立即展示</Tag>}
                                  </Space>
                                  <Typography.Text>
                                    {clueSummary(kind, clue?.content)}
                                  </Typography.Text>
                                </div>
                              </div>
                            ),
                            extra: (
                              <Space size={4} wrap>
                                <Button
                                  size="small"
                                  disabled={index === 0}
                                  aria-label={`上移第 ${index + 1} 条场次线索`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    move(index, index - 1);
                                    setActiveClue(String(index - 1));
                                  }}
                                >
                                  上移
                                </Button>
                                <Button
                                  size="small"
                                  disabled={index === fields.length - 1}
                                  aria-label={`下移第 ${index + 1} 条场次线索`}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    move(index, index + 1);
                                    setActiveClue(String(index + 1));
                                  }}
                                >
                                  下移
                                </Button>
                              </Space>
                            ),
                            children: (
                              <div key={field.key}>
                                <Field name={[field.name, "id"]} hidden>
                                  <Input />
                                </Field>
                                <div className="admin-clue-editor-grid">
                                  <div className="admin-clue-editor-fields">
                                    <ClueContentFields
                                      prefix={[field.name, "content"]}
                                      kind={kind}
                                      requirePrimary={[
                                        "text",
                                        "image",
                                        "video",
                                        "link",
                                      ].includes(kind)}
                                    />
                                    <Field
                                      name={[field.name, "autoPlay"]}
                                      label="解锁后立即展示"
                                      valuePropName="checked"
                                      extra="只影响之后真正触发的解锁；已经解锁过的用户不会补弹。"
                                    >
                                      <Switch
                                        disabled={
                                          !["text", "image", "video"].includes(
                                            kind,
                                          )
                                        }
                                      />
                                    </Field>
                                    <Alert
                                      type="warning"
                                      message="线索类型、触发时机、关联关卡与信件 / 祝福关系保持锁定；已发布线索不能在这里新增或删除。"
                                    />
                                  </div>
                                  {["text", "image", "video", "link"].includes(
                                    kind,
                                  ) ? (
                                    <CluePlayerPreview
                                      kind={kind}
                                      content={clue?.content}
                                      autoPlay={clue?.autoPlay}
                                      moment="fresh"
                                      freshLabel="下一次真正触发"
                                      freshMessage={
                                        clue?.autoPlay &&
                                        ["text", "image", "video"].includes(
                                          kind,
                                        )
                                          ? "下一次触发时会立即展示；已经解锁过的玩家不会补弹。"
                                          : "下一次触发后加入线索列表，由玩家主动打开。"
                                      }
                                    />
                                  ) : (
                                    <Alert
                                      type="info"
                                      showIcon
                                      message="叙事入口预览受限"
                                      description="信件与祝福由玩家端叙事页面承载；此处只允许核对并修改入口标题、提示等展示文字，关联关系仍保持锁定。"
                                    />
                                  )}
                                </div>
                              </div>
                            ),
                          };
                        })}
                      />
                    )}
                  </Form.List>
                ),
              },
            ]}
          />
        </Form>
      </SessionPreview>
    </EditorDrawer>
  );
}
