import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { FormInstance } from "antd";
import type {
  AdminQuestion,
  AdminQuestionClue,
  AdminQuestionClueInput,
  AdminQuestionClueSaveInput,
  AdminQuestionClueSet,
} from "./contracts";
import {
  ClueContentFields,
  CluePlayerPreview,
  clueKindLabels,
  clueSummary,
  emptyClueContent,
  normalizeClueContent,
  questionClueKindOptions,
  type EditableClueKind,
  type PreviewMoment,
} from "./components/ClueFields";
import { EditorDrawer, Field } from "./ui";
import {
  ErrorNotice,
  fieldRule,
  useAdminCommand,
  useAdminData,
} from "./shared";

type QuestionClueDraft = AdminQuestionClueInput & { id?: string };
type QuestionClueFormValue = {
  reason: string;
  clues: QuestionClueDraft[];
};

export function questionClueSavePayload(
  values: QuestionClueFormValue,
  expectedVersion: string,
): Omit<AdminQuestionClueSaveInput, "requestId"> {
  return {
    reason: values.reason.trim(),
    expectedVersion,
    clues: (values.clues || []).map((clue) => ({
      ...(clue.id ? { id: clue.id } : {}),
      kind: clue.kind,
      content: normalizeClueContent(clue.content),
      autoPlay: clue.kind === "link" ? false : clue.autoPlay === true,
    })),
  };
}

function toDraft(item: AdminQuestionClue): QuestionClueDraft {
  return {
    id: item.id,
    kind: item.kind,
    content: normalizeClueContent(item.content),
    autoPlay: item.autoPlay,
  };
}

function QuestionClueFields({
  form,
  name,
  readOnly,
}: {
  form: FormInstance<QuestionClueFormValue>;
  name: number;
  readOnly: boolean;
}) {
  const [moment, setMoment] = useState<PreviewMoment>("fresh");
  const kind =
    (Form.useWatch(["clues", name, "kind"], form) as EditableClueKind) ||
    "text";
  const content = Form.useWatch(["clues", name, "content"], form);
  const autoPlay = Form.useWatch(["clues", name, "autoPlay"], form);
  return (
    <div className="admin-clue-editor-grid">
      <div className="admin-clue-editor-fields">
        <Field name={[name, "id"]} hidden>
          <Input />
        </Field>
        <Field name={[name, "kind"]} label="线索类型" rules={fieldRule}>
          <Select disabled={readOnly} options={questionClueKindOptions} />
        </Field>
        <ClueContentFields
          prefix={[name, "content"]}
          kind={kind}
          requirePrimary
        />
        <Field
          name={[name, "autoPlay"]}
          label="答题后立即展示"
          valuePropName="checked"
          extra={
            kind === "link"
              ? "外部链接不会自动打开，只会加入线索列表。"
              : "仅玩家刚完成这道题时执行；此前已答过的玩家只会静默看到更新。"
          }
        >
          <Switch disabled={readOnly || kind === "link"} />
        </Field>
      </div>
      <div>
        <Radio.Group
          className="admin-preview-mode"
          value={moment}
          onChange={(event) => setMoment(event.target.value)}
          optionType="button"
          buttonStyle="solid"
          aria-label="选择线索预览场景"
          options={[
            { value: "fresh", label: "刚答完" },
            { value: "history", label: "历史已答" },
          ]}
        />
        <CluePlayerPreview
          kind={kind}
          content={content}
          autoPlay={autoPlay}
          moment={moment}
        />
      </div>
    </div>
  );
}

export function QuestionClueManager({
  question,
  open,
  onClose,
  refreshCatalog,
}: {
  question: AdminQuestion | null;
  open: boolean;
  onClose: () => void;
  refreshCatalog: () => Promise<void>;
}) {
  const [form] = Form.useForm<QuestionClueFormValue>();
  const [activeKey, setActiveKey] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const { modal } = App.useApp();
  const readOnly = question?.status === "archived";
  const path =
    open && question
      ? `/admin/questions/${encodeURIComponent(question.id)}/clues`
      : "";
  const query = useAdminData<AdminQuestionClueSet>(path);
  const refreshAll = useCallback(async () => {
    await Promise.all([query.refresh(), refreshCatalog()]);
  }, [query.refresh, refreshCatalog]);
  const { run, busy } = useAdminCommand(refreshAll);

  useEffect(() => {
    if (!open || !query.data) return;
    form.setFieldsValue({
      reason: "",
      clues: query.data.items.map(toDraft),
    });
    setDirty(false);
    setActiveKey(query.data.items.length ? "0" : undefined);
  }, [form, open, query.data, question?.id]);

  const close = () => {
    if (!dirty) {
      onClose();
      return;
    }
    modal.confirm({
      title: "放弃未保存的线索修改？",
      content: "关闭后，本次新增、排序和内容修改都会丢失。",
      okText: "放弃修改",
      okButtonProps: { danger: true },
      cancelText: "继续编辑",
      onOk: onClose,
    });
  };

  const watched = Form.useWatch("clues", form) || [];
  return (
    <EditorDrawer
      title={
        question
          ? `${readOnly ? "查看" : "管理"}通用线索 · ${question.title}`
          : "通用线索"
      }
      width={980}
      open={open}
      forceRender
      onClose={close}
      extra={
        <Space wrap>
          <Button onClick={close}>关闭</Button>
          {!readOnly && (
            <Button
              type="primary"
              loading={busy}
              disabled={!query.data || query.loading}
              onClick={() => form.submit()}
            >
              保存全部更改
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type={readOnly ? "warning" : "info"}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          readOnly
            ? "题目已移出题库，通用线索仅供查看。"
            : "通用线索只与这道题关联，可独立增删，不需要下线引用它的场次。"
        }
        description="支持文字、图片、视频和外部链接；不支持信件或祝福。场次专属线索始终排在通用线索前面。"
      />
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      {query.loading && !query.data ? (
        <div className="admin-centered-loading">
          <Spin />
        </div>
      ) : (
        <Form<QuestionClueFormValue>
          form={form}
          layout="vertical"
          disabled={readOnly}
          scrollToFirstError={{ behavior: "smooth", block: "center" }}
          onValuesChange={() => setDirty(true)}
          onFinishFailed={({ errorFields }) => {
            const first = errorFields[0]?.name;
            const clueIndex = first?.[0] === "clues" ? first[1] : undefined;
            if (typeof clueIndex === "number") {
              setActiveKey(String(clueIndex));
              window.requestAnimationFrame(() => form.scrollToField(first));
            }
          }}
          onFinish={async (values) => {
            if (!question || !query.data || readOnly) return;
            const result = await run<AdminQuestionClueSet>(
              `/admin/questions/${encodeURIComponent(question.id)}/clues`,
              questionClueSavePayload(values, query.data.version),
              "PATCH",
            );
            if (result) {
              form.setFieldsValue({
                reason: "",
                clues: result.items.map(toDraft),
              });
              setDirty(false);
              setActiveKey(result.items.length ? "0" : undefined);
            }
          }}
        >
          {!readOnly && (
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
                placeholder="例如：补充第 3 题的图片线索"
              />
            </Field>
          )}
          <Form.List name="clues">
            {(fields, { add, remove, move }) => (
              <>
                <div className="admin-section-heading">
                  <div>
                    <Typography.Title level={4}>线索列表</Typography.Title>
                    <Typography.Text type="secondary">
                      共 {fields.length} 条；数组顺序即玩家看到的通用线索顺序。
                    </Typography.Text>
                  </div>
                  {!readOnly && (
                    <Button
                      type="primary"
                      ghost
                      onClick={() => {
                        add({
                          kind: "text",
                          content: emptyClueContent(),
                          autoPlay: false,
                        });
                        setActiveKey(String(fields.length));
                      }}
                    >
                      添加通用线索
                    </Button>
                  )}
                </div>
                {!fields.length ? (
                  <Card className="admin-inline-empty" size="small">
                    <Typography.Text type="secondary">
                      尚未配置通用线索。保存后，引用此题的场次会自动读取这里的内容。
                    </Typography.Text>
                  </Card>
                ) : (
                  <Collapse
                    accordion
                    className="admin-clue-list"
                    activeKey={activeKey}
                    onChange={(key) =>
                      setActiveKey(
                        Array.isArray(key) ? String(key[0] || "") : String(key),
                      )
                    }
                    items={fields.map((field, index) => {
                      const item = watched[field.name] || {};
                      const kind = (item.kind || "text") as EditableClueKind;
                      return {
                        key: String(index),
                        label: (
                          <div className="admin-clue-summary">
                            <span className="admin-clue-order">{index + 1}</span>
                            <div>
                              <Space size={6} wrap>
                                <Tag>{clueKindLabels[kind]}</Tag>
                                {item.autoPlay && kind !== "link" && (
                                  <Tag color="green">立即展示</Tag>
                                )}
                              </Space>
                              <Typography.Text>
                                {clueSummary(kind, item.content)}
                              </Typography.Text>
                            </div>
                          </div>
                        ),
                        extra: readOnly ? null : (
                          <Space size={4} wrap>
                            <Button
                              size="small"
                              disabled={index === 0}
                              aria-label={`上移第 ${index + 1} 条通用线索`}
                              onClick={(event) => {
                                event.stopPropagation();
                                move(index, index - 1);
                                setActiveKey(String(index - 1));
                              }}
                            >
                              上移
                            </Button>
                            <Button
                              size="small"
                              disabled={index === fields.length - 1}
                              aria-label={`下移第 ${index + 1} 条通用线索`}
                              onClick={(event) => {
                                event.stopPropagation();
                                move(index, index + 1);
                                setActiveKey(String(index + 1));
                              }}
                            >
                              下移
                            </Button>
                            <Button
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                add(
                                  {
                                    kind,
                                    content: normalizeClueContent(item.content),
                                    autoPlay: item.autoPlay === true,
                                  },
                                  index + 1,
                                );
                                setActiveKey(String(index + 1));
                              }}
                            >
                              复制
                            </Button>
                            <Button
                              danger
                              size="small"
                              onClick={(event) => {
                                event.stopPropagation();
                                modal.confirm({
                                  title: `移除第 ${index + 1} 条通用线索？`,
                                  content:
                                    "保存全部更改后，服务端会将这条线索归档；玩家列表不再展示。",
                                  okText: "移除",
                                  okButtonProps: { danger: true },
                                  cancelText: "取消",
                                  onOk: () => {
                                    remove(field.name);
                                    setActiveKey(
                                      fields.length > 1
                                        ? String(Math.max(0, index - 1))
                                        : undefined,
                                    );
                                  },
                                });
                              }}
                            >
                              删除
                            </Button>
                          </Space>
                        ),
                        children: (
                          <QuestionClueFields
                            key={field.key}
                            form={form}
                            name={field.name}
                            readOnly={readOnly}
                          />
                        ),
                      };
                    })}
                  />
                )}
              </>
            )}
          </Form.List>
        </Form>
      )}
    </EditorDrawer>
  );
}
