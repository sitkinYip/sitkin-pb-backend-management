import { createRequestId } from "./request-id";
import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import { AlistMediaInput } from "../components/Alist/AlistMediaInput";
import { TextSyntaxHelp } from "../components/TextSyntaxHelp";
import type {
  AdminCatalog,
  AdminQuestion,
  AdminSession,
  AdminSessionLevel,
  AdminNarrative,
  AdminRewardDefinition,
} from "./contracts";
import {
  ErrorNotice,
  FormFooter,
  LinesInput,
  fieldRule,
  statusLabels,
  useAdminCommand,
  useAdminData,
} from "./shared";

type EditorProps = { catalog: AdminCatalog; refresh: () => Promise<void> };
export function ContentPage({
  section,
}: {
  section: "questions" | "sessions" | "rewards" | "narratives";
}) {
  const query = useAdminData<AdminCatalog>("/admin/catalog");
  return (
    <>
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      {query.data ? (
        section === "questions" ? (
          <QuestionEditor catalog={query.data} refresh={query.refresh} />
        ) : section === "sessions" ? (
          <SessionEditor catalog={query.data} refresh={query.refresh} />
        ) : section === "rewards" ? (
          <RewardEditor catalog={query.data} refresh={query.refresh} />
        ) : (
          <NarrativeEditor catalog={query.data} refresh={query.refresh} />
        )
      ) : (
        <Card loading={query.loading} />
      )}
    </>
  );
}
function PresentationFields({ prefix }: { prefix: (string | number)[] }) {
  return (
    <>
      <Form.Item name={[...prefix, "bgmMode"]} label="背景音乐模式">
        <Select
          options={[
            { value: "inherit", label: "继承场次 / 不指定" },
            { value: "custom", label: "指定音乐" },
            { value: "silent", label: "静音" },
          ]}
        />
      </Form.Item>
      <Form.Item name={[...prefix, "bgmUrl"]} label="背景音乐">
        <AlistMediaInput type="audio" />
      </Form.Item>
      <Form.Item name={[...prefix, "backgroundMode"]} label="背景图片模式">
        <Select
          options={[
            { value: "inherit", label: "继承场次 / 不指定" },
            { value: "custom", label: "指定背景" },
            { value: "none", label: "不显示背景图" },
          ]}
        />
      </Form.Item>
      <Form.Item
        name={[...prefix, "hideTitle"]}
        label="不显示题目标题"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      <Form.Item name={[...prefix, "backgroundUrl"]} label="背景图片">
        <AlistMediaInput type="img" />
      </Form.Item>
    </>
  );
}
function QuestionEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const readOnly = Boolean(
    id && catalog.questions.find((row) => row.id === id)?.status !== "draft",
  );
  const { run, busy } = useAdminCommand(refresh);
  const kind = Form.useWatch("kind", form);
  const edit = (row?: AdminQuestion) => {
    setId(row?.id || "");
    form.resetFields();
    form.setFieldsValue(
      row || {
        kind: "text",
        title: "",
        content: [{ text: "", hint: "", imageUrls: [] }],
        options: [],
        acceptedAnswers: [],
      },
    );
    setOpen(true);
  };
  return (
    <Card
      title="题库"
      extra={
        <Button type="primary" onClick={() => edit()}>
          新建题目
        </Button>
      }
    >
      <Alert
        type="info"
        message="答案仅供管理员查看。发布后不可原地修改，可创建新版本；题目不再配置用户、经验或最终关。"
        style={{ marginBottom: 20 }}
      />
      <Table
        rowKey="id"
        dataSource={catalog.questions}
        columns={[
          { title: "题目", dataIndex: "title" },
          {
            title: "类型",
            dataIndex: "kind",
            render: (value) => (value === "choice" ? "单选" : "填空"),
          },
          { title: "版本", dataIndex: "revision" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => <Tag>{statusLabels[value]}</Tag>,
          },
          {
            title: "操作",
            render: (_, row: AdminQuestion) => (
              <Space>
                <Button onClick={() => edit(row)}>
                  {row.status === "draft" ? "编辑" : "查看"}
                </Button>
                <Button
                  disabled={row.status !== "draft" || busy}
                  onClick={() => void run(`/admin/questions/${row.id}/publish`)}
                >
                  发布
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(`/admin/questions/${row.id}`, { clone: true })
                  }
                >
                  新版本
                </Button>
                <Popconfirm
                  title="归档后不能再用于新配置，已有场次仍可回顾。确认归档？"
                  onConfirm={() =>
                    run(`/admin/questions/${row.id}/archive`, {
                      reason: "管理员归档内容",
                    })
                  }
                >
                  <Button disabled={busy || row.status === "archived"}>
                    归档
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={readOnly ? "查看题目版本" : id ? "编辑题目草稿" : "新建题目"}
        width={760}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Button onClick={() => setOpen(false)}>关闭</Button>
          ) : (
            <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
          )
        }
      >
        <Form
          name="question-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            const result = await run(
              id ? `/admin/questions/${id}` : "/admin/questions",
              {
                ...values,
                acceptedAnswers: (values.acceptedAnswers || [])
                  .map((v: string) => v.trim())
                  .filter(Boolean),
              },
              id ? "PATCH" : "POST",
            );
            if (result) setOpen(false);
          }}
        >
          <Form.Item name="title" label="题目标题" rules={fieldRule}>
            <Input />
          </Form.Item>
          <Form.Item name="kind" label="题型" rules={fieldRule}>
            <Select
              options={[
                { value: "text", label: "填空" },
                { value: "choice", label: "单选" },
              ]}
            />
          </Form.Item>
          <Form.Item name="placeholder" label="输入占位提示">
            <Input />
          </Form.Item>
          <Form.List name="content">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name }) => (
                  <Card
                    key={key}
                    size="small"
                    title={`题面段落 ${name + 1}`}
                    extra={
                      <Button danger onClick={() => remove(name)}>
                        移除
                      </Button>
                    }
                    style={{ marginBottom: 16 }}
                  >
                    <Form.Item
                      name={[name, "text"]}
                      label="正文"
                      extra={<TextSyntaxHelp />}
                    >
                      <Input.TextArea rows={4} />
                    </Form.Item>
                    <Form.Item
                      name={[name, "hint"]}
                      label="可展开提示"
                      extra={<TextSyntaxHelp />}
                    >
                      <Input.TextArea />
                    </Form.Item>
                    <Form.Item
                      name={[name, "imageUrl"]}
                      label="图片 / 视频封面"
                    >
                      <AlistMediaInput type="img" />
                    </Form.Item>
                    <Form.Item
                      name={[name, "imageUrls"]}
                      label="更多图片（每行一条 URL）"
                    >
                      <LinesInput />
                    </Form.Item>
                    <Form.Item name={[name, "videoUrl"]} label="视频">
                      <AlistMediaInput type="video" />
                    </Form.Item>
                  </Card>
                ))}
                <Button
                  onClick={() => add({ text: "", hint: "", imageUrls: [] })}
                >
                  添加题面段落
                </Button>
              </>
            )}
          </Form.List>
          {kind === "choice" && (
            <Form.List name="options">
              {(fields, { add, remove }) => (
                <>
                  <Typography.Title level={5}>选项</Typography.Title>
                  {fields.map(({ key, name }) => (
                    <Card
                      key={key}
                      size="small"
                      extra={
                        <Button danger onClick={() => remove(name)}>
                          移除选项
                        </Button>
                      }
                      style={{ marginBottom: 12 }}
                    >
                      <Form.Item
                        name={[name, "key"]}
                        label="选项标识（如 A）"
                        rules={fieldRule}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item name={[name, "text"]} label="选项文字">
                        <Input.TextArea />
                      </Form.Item>
                      <Form.Item name={[name, "imageUrl"]} label="选项图片">
                        <AlistMediaInput type="img" />
                      </Form.Item>
                      <Form.Item name={[name, "videoUrl"]} label="选项视频">
                        <AlistMediaInput type="video" />
                      </Form.Item>
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      add({
                        key: String.fromCharCode(65 + fields.length),
                        text: "",
                      })
                    }
                  >
                    添加选项
                  </Button>
                </>
              )}
            </Form.List>
          )}
          <Form.Item
            name="acceptedAnswers"
            label={
              kind === "choice"
                ? "正确选项标识（每行一个）"
                : "可接受答案（每行一个）"
            }
            rules={fieldRule}
            style={{ marginTop: 24 }}
          >
            <LinesInput rows={4} />
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
}
function SessionEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const readOnly = Boolean(
    id && catalog.sessions.find((row) => row.id === id)?.status !== "draft",
  );
  const { run, busy } = useAdminCommand(refresh);
  const steps: AdminSessionLevel[] = Form.useWatch("levels", form) || [];
  const targetKind = Form.useWatch(["completionTarget", "kind"], form);
  const stepOptions = steps.map((step, index) => ({
    value: step.id,
    label: `第 ${index + 1} 关：${catalog.questions.find((q) => q.id === step.question)?.title || "未选题"}`,
  }));
  const rankOptions = catalog.ranks.map((rank) => ({
    value: rank.id,
    label: `${rank.order} 级 · ${rank.name}`,
  }));
  const edit = (row?: AdminSession) => {
    setId(row?.id || "");
    form.resetFields();
    form.setFieldsValue(
      row || {
        title: "",
        levels: [],
        clues: [],
        rewardRules: [],
        presentation: { bgmMode: "custom", completionStyle: "normal" },
      },
    );
    setOpen(true);
  };
  return (
    <Card
      title="场次编排"
      extra={
        <Button type="primary" onClick={() => edit()}>
          新建场次
        </Button>
      }
    >
      <Table
        rowKey="id"
        dataSource={catalog.sessions}
        columns={[
          { title: "场次", dataIndex: "title" },
          {
            title: "关卡数",
            render: (_, row: AdminSession) => row.levels.length,
          },
          { title: "版本", dataIndex: "revision" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => <Tag>{statusLabels[value]}</Tag>,
          },
          {
            title: "操作",
            render: (_, row: AdminSession) => (
              <Space>
                <Button onClick={() => edit(row)}>
                  {row.status === "draft" ? "编辑" : "查看"}
                </Button>
                <Button
                  disabled={busy || row.status !== "draft"}
                  onClick={() => void run(`/admin/sessions/${row.id}/publish`)}
                >
                  发布
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(`/admin/sessions/${row.id}`, { clone: true })
                  }
                >
                  新版本
                </Button>
                <Popconfirm
                  title="归档后不能再用于新配置，已有场次仍可回顾。确认归档？"
                  onConfirm={() =>
                    run(`/admin/sessions/${row.id}/archive`, {
                      reason: "管理员归档内容",
                    })
                  }
                >
                  <Button disabled={busy || row.status === "archived"}>
                    归档
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title={readOnly ? "查看场次版本" : id ? "编辑场次草稿" : "新建场次"}
        width={900}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Button onClick={() => setOpen(false)}>关闭</Button>
          ) : (
            <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
          )
        }
      >
        <Form
          name="session-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            const result = await run(
              id ? `/admin/sessions/${id}` : "/admin/sessions",
              {
                ...values,
                completionTarget: values.completionTarget?.kind
                  ? values.completionTarget
                  : null,
              },
              id ? "PATCH" : "POST",
            );
            if (result) setOpen(false);
          }}
        >
          <Tabs
            items={[
              {
                key: "basic",
                label: "基础与演出",
                children: (
                  <>
                    <Form.Item name="title" label="场次名称" rules={fieldRule}>
                      <Input />
                    </Form.Item>
                    <Form.Item name="description" label="场次说明">
                      <Input.TextArea />
                    </Form.Item>
                    <Space align="start">
                      <Form.Item name="minLevel" label="最低参与等级">
                        <Select
                          allowClear
                          options={rankOptions}
                          style={{ width: 220 }}
                        />
                      </Form.Item>
                      <Form.Item name="maxLevel" label="最高参与等级">
                        <Select
                          allowClear
                          options={rankOptions}
                          style={{ width: 220 }}
                        />
                      </Form.Item>
                    </Space>
                    <Alert
                      type="info"
                      message="等级在首次入场时检查，入场后升级不会被中途踢出。"
                      style={{ marginBottom: 20 }}
                    />
                    <PresentationFields prefix={["presentation"]} />
                    <Form.Item
                      name={["presentation", "completionStyle"]}
                      label="通关演出"
                    >
                      <Select
                        options={[
                          { value: "normal", label: "普通场次完成" },
                          { value: "finale", label: "终章演出" },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item
                      name={["completionTarget", "kind"]}
                      label="完成后继续入口"
                    >
                      <Select
                        allowClear
                        options={[
                          { value: "narrative", label: "信件 / 祝福" },
                          { value: "link", label: "外部网页" },
                        ]}
                      />
                    </Form.Item>
                    {targetKind === "narrative" && (
                      <Form.Item
                        name={["completionTarget", "id"]}
                        label="叙事内容"
                        rules={fieldRule}
                      >
                        <Select
                          options={catalog.narratives
                            .filter((n) => n.status === "published")
                            .map((n) => ({ value: n.id, label: n.title }))}
                        />
                      </Form.Item>
                    )}
                    {targetKind === "link" && (
                      <Form.Item
                        name={["completionTarget", "url"]}
                        label="HTTP(S) 链接"
                        rules={fieldRule}
                      >
                        <Input />
                      </Form.Item>
                    )}
                  </>
                ),
              },
              {
                key: "levels",
                label: "小关卡",
                children: (
                  <Form.List name="levels">
                    {(fields, { add, remove, move }) => (
                      <>
                        {fields.map(({ key, name }) => (
                          <Card
                            key={key}
                            title={`第 ${name + 1} 关`}
                            size="small"
                            extra={
                              <Space>
                                <Button
                                  disabled={name === 0}
                                  onClick={() => move(name, name - 1)}
                                >
                                  上移
                                </Button>
                                <Button danger onClick={() => remove(name)}>
                                  移除
                                </Button>
                              </Space>
                            }
                            style={{ marginBottom: 20 }}
                          >
                            <Form.Item name={[name, "id"]} hidden>
                              <Input />
                            </Form.Item>
                            <Form.Item
                              name={[name, "question"]}
                              label="题目版本"
                              rules={fieldRule}
                            >
                              <Select
                                showSearch
                                optionFilterProp="label"
                                options={catalog.questions.map((q) => ({
                                  value: q.id,
                                  label: `${q.title} · v${q.revision} · ${statusLabels[q.status]}`,
                                }))}
                              />
                            </Form.Item>
                            <Space>
                              <Form.Item
                                name={[name, "xp"]}
                                label="通关经验"
                                rules={fieldRule}
                              >
                                <InputNumber min={0} max={1000000} />
                              </Form.Item>
                              <Form.Item
                                name={[name, "autoNext"]}
                                label="自动进入下一题"
                                valuePropName="checked"
                              >
                                <Switch />
                              </Form.Item>
                            </Space>
                            <Form.List name={[name, "penaltyPolicy"]}>
                              {(
                                penalties,
                                { add: addPenalty, remove: removePenalty },
                              ) => (
                                <>
                                  <Typography.Text>
                                    单选答错后的递进惩罚；用完后沿用最后一项。
                                  </Typography.Text>
                                  {penalties.map((p) => (
                                    <Space key={p.key} align="start">
                                      <Form.Item name={[p.name, "type"]}>
                                        <Select
                                          style={{ width: 160 }}
                                          options={[
                                            {
                                              value: "cooldown",
                                              label: "冷却",
                                            },
                                            {
                                              value: "lock",
                                              label: "工作人员解锁",
                                            },
                                          ]}
                                        />
                                      </Form.Item>
                                      <Form.Item name={[p.name, "seconds"]}>
                                        <InputNumber
                                          min={0}
                                          max={2592000}
                                          addonAfter="秒"
                                        />
                                      </Form.Item>
                                      <Button
                                        danger
                                        onClick={() => removePenalty(p.name)}
                                      >
                                        移除
                                      </Button>
                                    </Space>
                                  ))}
                                  <Button
                                    onClick={() =>
                                      addPenalty({
                                        type: "cooldown",
                                        seconds: 180,
                                      })
                                    }
                                  >
                                    添加惩罚
                                  </Button>
                                </>
                              )}
                            </Form.List>
                            <details style={{ marginTop: 20 }}>
                              <summary>本关背景 / 音乐覆盖</summary>
                              <PresentationFields
                                prefix={[
                                  "levels",
                                  name,
                                  "presentationOverride",
                                ]}
                              />
                            </details>
                          </Card>
                        ))}
                        <Button
                          block
                          onClick={() =>
                            add({
                              id: createRequestId(),
                              xp: 20,
                              autoNext: false,
                              penaltyPolicy: [],
                              presentationOverride: { bgmMode: "inherit" },
                            })
                          }
                        >
                          添加小关卡
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
              {
                key: "clues",
                label: "解锁线索",
                children: (
                  <Form.List name="clues">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 16 }}
                            extra={
                              <Button danger onClick={() => remove(name)}>
                                移除
                              </Button>
                            }
                          >
                            <Form.Item
                              name={[name, "trigger"]}
                              label="解锁时机"
                              rules={fieldRule}
                            >
                              <Select
                                options={[
                                  { value: "start", label: "开始场次" },
                                  {
                                    value: "level_completed",
                                    label: "完成指定小关卡",
                                  },
                                  {
                                    value: "session_completed",
                                    label: "完成整个场次",
                                  },
                                  { value: "manual", label: "管理员手动解锁" },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[name, "sessionLevel"]}
                              label="关联小关卡（指定关卡时必选）"
                            >
                              <Select allowClear options={stepOptions} />
                            </Form.Item>
                            <Form.Item
                              name={[name, "kind"]}
                              label="线索类型"
                              rules={fieldRule}
                            >
                              <Select
                                options={[
                                  { value: "text", label: "文字" },
                                  { value: "image", label: "图片" },
                                  { value: "video", label: "视频" },
                                  { value: "link", label: "外部链接" },
                                  { value: "letter", label: "信件" },
                                  { value: "bless", label: "祝福" },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "title"]}
                              label="标题"
                            >
                              <Input />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "text"]}
                              label="文字内容"
                              extra={<TextSyntaxHelp />}
                            >
                              <Input.TextArea rows={4} />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "buttonText"]}
                              label="组合线索确认按钮文字"
                            >
                              <Input />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "description"]}
                              label="组合线索底部说明"
                            >
                              <Input.TextArea rows={2} />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "url"]}
                              label="视频 / 外部链接 URL"
                            >
                              <Input />
                            </Form.Item>
                            <Form.Item
                              name={[name, "content", "imageUrls"]}
                              label="图片 URL（每行一条）"
                            >
                              <LinesInput />
                            </Form.Item>
                            <Form.Item
                              name={[name, "narrative"]}
                              label="信件 / 祝福内容"
                            >
                              <Select
                                allowClear
                                options={catalog.narratives.map((n) => ({
                                  value: n.id,
                                  label: n.title,
                                }))}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[name, "autoPlay"]}
                              label="解锁后自动展示（文字、图片、视频）"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Form.Item>
                          </Card>
                        ))}
                        <Button
                          block
                          onClick={() =>
                            add({
                              trigger: "session_completed",
                              kind: "text",
                              content: {
                                title: "",
                                text: "",
                                url: "",
                                imageUrls: [],
                                buttonText: "",
                              },
                            })
                          }
                        >
                          添加线索
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
              {
                key: "rewards",
                label: "发奖规则",
                children: (
                  <Form.List name="rewardRules">
                    {(fields, { add, remove }) => (
                      <>
                        {fields.map(({ key, name }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 16 }}
                            extra={
                              <Button danger onClick={() => remove(name)}>
                                移除
                              </Button>
                            }
                          >
                            <Form.Item
                              name={[name, "trigger"]}
                              label="发奖时机"
                              rules={fieldRule}
                            >
                              <Select
                                options={[
                                  {
                                    value: "level_completed",
                                    label: "完成指定小关卡",
                                  },
                                  {
                                    value: "session_completed",
                                    label: "完成整个场次",
                                  },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[name, "sessionLevel"]}
                              label="关联小关卡（整场完成时留空）"
                            >
                              <Select allowClear options={stepOptions} />
                            </Form.Item>
                            <Form.Item
                              name={[name, "reward"]}
                              label="奖品"
                              rules={fieldRule}
                            >
                              <Select
                                options={catalog.rewards
                                  .filter((r) => r.active)
                                  .map((r) => ({ value: r.id, label: r.name }))}
                              />
                            </Form.Item>
                            <Form.Item
                              name={[name, "quantity"]}
                              label="数量"
                              rules={fieldRule}
                            >
                              <InputNumber min={1} max={100} />
                            </Form.Item>
                          </Card>
                        ))}
                        <Button
                          block
                          onClick={() =>
                            add({ trigger: "session_completed", quantity: 1 })
                          }
                        >
                          添加发奖规则
                        </Button>
                      </>
                    )}
                  </Form.List>
                ),
              },
            ]}
          />
        </Form>
      </Drawer>
    </Card>
  );
}
function RewardEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm(),
    [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const { run, busy } = useAdminCommand(refresh);
  const edit = (row?: AdminRewardDefinition) => {
    setId(row?.id || "");
    form.resetFields();
    form.setFieldsValue(row || { claimMethod: "staff", active: true });
    setOpen(true);
  };
  return (
    <Card
      title="奖品定义"
      extra={
        <Button type="primary" onClick={() => edit()}>
          新建奖品
        </Button>
      }
    >
      <Alert
        type="warning"
        message="这里只填写可复用的领取说明。取件码等一次性信息请在“奖品核销”中为某一次发放单独配置。"
        style={{ marginBottom: 20 }}
      />
      <Table
        rowKey="id"
        dataSource={catalog.rewards}
        columns={[
          { title: "奖品", dataIndex: "name" },
          {
            title: "领取方式",
            dataIndex: "claimMethod",
            render: (value) =>
              ({ staff: "工作人员", location: "指定地点", locker: "柜子领取" })[
                value as "staff"
              ],
          },
          {
            title: "启用",
            dataIndex: "active",
            render: (value) => (value ? "是" : "否"),
          },
          {
            title: "操作",
            render: (_, row) => <Button onClick={() => edit(row)}>编辑</Button>,
          },
        ]}
      />
      <Drawer
        width={640}
        open={open}
        forceRender
        title="奖品配置"
        onClose={() => setOpen(false)}
        extra={
          <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
        }
      >
        <Form
          name="reward-editor"
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (
              await run(
                id ? `/admin/rewards/${id}` : "/admin/rewards",
                values,
                id ? "PATCH" : "POST",
              )
            )
              setOpen(false);
          }}
        >
          <Form.Item name="name" label="名称" rules={fieldRule}>
            <Input />
          </Form.Item>
          <Form.Item name="image" label="图片">
            <AlistMediaInput type="img" />
          </Form.Item>
          <Form.Item name="description" label="奖品说明">
            <Input.TextArea />
          </Form.Item>
          <Form.Item name="claimMethod" label="领取方式" rules={fieldRule}>
            <Select
              options={[
                { value: "staff", label: "找工作人员领取" },
                { value: "location", label: "去指定地点领取" },
                { value: "locker", label: "柜子领取" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="publicInstructions"
            label="可复用的领取说明"
            extra={<TextSyntaxHelp />}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>
    </Card>
  );
}
function NarrativeEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm(),
    [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const readOnly = Boolean(
    id && catalog.narratives.find((row) => row.id === id)?.status !== "draft",
  );
  const { run, busy } = useAdminCommand(refresh);
  const kind = Form.useWatch("kind", form);
  const edit = (row?: AdminNarrative) => {
    setId(row?.id || "");
    form.resetFields();
    form.setFieldsValue(
      row || {
        kind: "letter",
        payload: {
          variant: "modern",
          typingSpeedMs: 60,
          hintText: "点击开启信件",
          paragraphs: [],
          phrases: [],
          closingLines: [],
          backgroundImages: [],
        },
      },
    );
    setOpen(true);
  };
  return (
    <Card
      title="信件与祝福"
      extra={
        <Button type="primary" onClick={() => edit()}>
          新建内容
        </Button>
      }
    >
      <Table
        rowKey="id"
        dataSource={catalog.narratives}
        columns={[
          { title: "标题", dataIndex: "title" },
          { title: "类型", dataIndex: "kind" },
          { title: "版本", dataIndex: "revision" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => statusLabels[value],
          },
          {
            title: "操作",
            render: (_, row: AdminNarrative) => (
              <Space>
                <Button onClick={() => edit(row)}>
                  {row.status === "draft" ? "编辑" : "查看"}
                </Button>
                <Button
                  disabled={row.status !== "draft" || busy}
                  onClick={() =>
                    void run(`/admin/narratives/${row.id}/publish`)
                  }
                >
                  发布
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(`/admin/narratives/${row.id}`, { clone: true })
                  }
                >
                  新版本
                </Button>
                <Popconfirm
                  title="归档后不能再用于新配置，已有场次仍可回顾。确认归档？"
                  onConfirm={() =>
                    run(`/admin/narratives/${row.id}/archive`, {
                      reason: "管理员归档内容",
                    })
                  }
                >
                  <Button disabled={busy || row.status === "archived"}>
                    归档
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title="编辑叙事内容"
        width={760}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Button onClick={() => setOpen(false)}>关闭</Button>
          ) : (
            <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
          )
        }
      >
        <Form
          name="narrative-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (
              await run(
                id ? `/admin/narratives/${id}` : "/admin/narratives",
                values,
                id ? "PATCH" : "POST",
              )
            )
              setOpen(false);
          }}
        >
          <Form.Item name="title" label="标题" rules={fieldRule}>
            <Input />
          </Form.Item>
          <Form.Item name="kind" label="类型" rules={fieldRule}>
            <Select
              options={[
                { value: "letter", label: "信件" },
                { value: "bless", label: "祝福" },
              ]}
            />
          </Form.Item>
          <Form.Item name={["payload", "mainAudioUrl"]} label="背景音乐">
            <AlistMediaInput type="audio" />
          </Form.Item>
          {kind === "letter" && (
            <>
              <Form.Item name={["payload", "variant"]} label="信件样式">
                <Select
                  options={[
                    { value: "modern", label: "现代" },
                    { value: "classical", label: "古典" },
                    { value: "magic", label: "魔法" },
                  ]}
                />
              </Form.Item>
              <Form.Item name={["payload", "description"]} label="说明">
                <Input />
              </Form.Item>
              <Form.Item name={["payload", "hintText"]} label="开启提示">
                <Input />
              </Form.Item>
              <Form.Item
                name={["payload", "typingSpeedMs"]}
                label="打字间隔（毫秒）"
              >
                <InputNumber min={1} />
              </Form.Item>
              <Form.Item
                name={["payload", "backgroundImages"]}
                label="信纸背景图（每行一条）"
              >
                <LinesInput />
              </Form.Item>
              <Form.Item
                name={["payload", "pageBackgroundUrl"]}
                label="页面背景"
              >
                <AlistMediaInput type="img" />
              </Form.Item>
            </>
          )}
          {(kind === "letter"
            ? ["paragraphs"]
            : ["phrases", "closingLines"]
          ).map((list) => (
            <Form.List key={list} name={["payload", list]}>
              {(fields, { add, remove }) => (
                <>
                  <Typography.Title level={5}>
                    {list === "closingLines" ? "谢幕内容" : "正文段落"}
                  </Typography.Title>
                  {fields.map(({ key, name }) => (
                    <Card
                      key={key}
                      size="small"
                      extra={
                        <Button danger onClick={() => remove(name)}>
                          移除
                        </Button>
                      }
                      style={{ marginBottom: 16 }}
                    >
                      <Form.Item
                        name={[name, kind === "letter" ? "content" : "text"]}
                        label="文字"
                        rules={fieldRule}
                      >
                        <Input.TextArea rows={4} />
                      </Form.Item>
                      <Form.Item name={[name, "audioUrl"]} label="段落配音">
                        <AlistMediaInput type="audio" />
                      </Form.Item>
                      <Form.Item
                        name={[
                          name,
                          kind === "letter" ? "delayMs" : "durationMs",
                        ]}
                        label={
                          kind === "letter"
                            ? "开始前延迟（毫秒）"
                            : "持续时间（毫秒）"
                        }
                      >
                        <InputNumber min={0} />
                      </Form.Item>
                      {kind === "letter" && (
                        <Form.Item name={[name, "align"]} label="对齐">
                          <Select
                            options={[
                              "left",
                              "center",
                              "right",
                              "top",
                              "bottom",
                            ].map((value) => ({ value, label: value }))}
                          />
                        </Form.Item>
                      )}
                    </Card>
                  ))}
                  <Button
                    onClick={() =>
                      add(
                        kind === "letter"
                          ? { content: "", delayMs: 0, align: "left" }
                          : { text: "", durationMs: 3000 },
                      )
                    }
                  >
                    添加段落
                  </Button>
                </>
              )}
            </Form.List>
          ))}
        </Form>
      </Drawer>
    </Card>
  );
}
