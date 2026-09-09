import { SessionPreview } from "./preview/SessionPreview";
import { LivePreview } from "./preview/LivePreview";
import { AdminTable, EditorDrawer, Field, PageCard } from "./ui";
import { createRequestId } from "./request-id";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { AlistMediaInput } from "../components/Alist/AlistMediaInput";
import { TextSyntaxHelp } from "../components/TextSyntaxHelp";
import { PresentationFields } from "./components/PresentationFields";
import { LiveSessionSettingsDrawer } from "./LiveSessionSettingsDrawer";
import { QuestionClueManager } from "./QuestionClueManager";
import type {
  AdminCatalog,
  AdminQuestion,
  AdminSession,
  AdminSessionLevel,
  AdminNarrative,
  AdminRewardDefinition,
  AdminSessionReference,
} from "./contracts";
import {
  filterSessions,
  filterQuestions,
  filterNarratives,
  narrativeDeletionHint,
  narrativeOptions,
  narrativeUsage,
  unavailableNarrativeReferences,
  questionOptions,
  questionGroups,
  QUESTION_DEFAULT_GROUP,
  questionUsage,
  sessionCounts,
  sessionStatusLabels,
  type SessionFilter,
  type QuestionScope,
  type NarrativeFilter,
} from "./content-policy";
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
function SessionReferences({
  references,
}: {
  references: AdminSessionReference[];
}) {
  return (
    <Space direction="vertical" size={0}>
      {references.map((s) => (
        <Link key={s.id} to={`/sessions?sessionId=${encodeURIComponent(s.id)}`}>
          {s.title} · v{s.revision}（{sessionStatusLabels[s.status]}）
        </Link>
      ))}
    </Space>
  );
}
function QuestionEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm();
  const [deleteForm] = Form.useForm();
  const [groupForm] = Form.useForm();
  const [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const [scope, setScope] = useState<QuestionScope>("available");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [grouping, setGrouping] = useState<AdminQuestion | null>(null);
  const [deleting, setDeleting] = useState<AdminQuestion | null>(null);
  const [clueQuestionId, setClueQuestionId] = useState("");
  const selected = catalog.questions.find((row) => row.id === id);
  const clueQuestion = catalog.questions.find(
    (row) => row.id === clueQuestionId,
  );
  const usage = selected ? questionUsage(selected, catalog.sessions) : null;
  const readOnly = Boolean(id && (!selected || !usage?.canEdit));
  const { run, busy } = useAdminCommand(refresh);
  const kind = Form.useWatch("kind", form);
  const fuzzyMatch = Form.useWatch("fuzzyMatch", form);
  const groups = questionGroups(catalog.questions);
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
        fuzzyMatch: false,
        groupName: QUESTION_DEFAULT_GROUP,
      },
    );
    setOpen(true);
  };
  return (
    <PageCard
      title="题库"
      extra={
        <Space>
          <Button onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" onClick={() => edit()}>
            新建题目
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message="线上场次引用时，题面与答案不可修改或删除；通用线索仍可独立增删，不需要下线场次。历史已答用户只会静默看到线索更新。"
        style={{ marginBottom: 20 }}
      />
      <div className="admin-list-toolbar">
        <Input.Search
          aria-label="搜索题目标题"
          placeholder="搜索题目标题"
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          aria-label="题库范围"
          value={scope}
          style={{ width: 190 }}
          onChange={setScope}
          options={[
            { value: "available", label: "正常题库" },
            { value: "archived", label: "已移出题库" },
            { value: "all", label: "全部题目" },
          ]}
        />
        <Select
          aria-label="题目分组"
          value={groupFilter}
          style={{ width: 190 }}
          onChange={setGroupFilter}
          options={[
            { value: "all", label: "全部分组" },
            ...groups.map((groupName) => ({
              value: groupName,
              label: groupName,
            })),
          ]}
        />
      </div>
      <AdminTable
        rowKey="id"
        dataSource={filterQuestions(
          catalog.questions,
          scope,
          search,
          groupFilter,
        )}
        columns={[
          {
            title: "题目",
            dataIndex: "title",
            render: (value: string, row: AdminQuestion) => (
              <Tooltip title={`题目 ID：${row.id}`}>
                <span className="admin-question-title-with-id">{value}</span>
              </Tooltip>
            ),
          },
          {
            title: "类型",
            dataIndex: "kind",
            render: (value) => (value === "choice" ? "单选" : "填空"),
          },
          {
            title: "分组",
            dataIndex: "groupName",
            render: (value: string) => (
              <Tag>{value || QUESTION_DEFAULT_GROUP}</Tag>
            ),
          },
          {
            title: "判题",
            render: (_, row: AdminQuestion) =>
              row.kind === "text" && row.fuzzyMatch
                ? "包含全部关键词"
                : "精确匹配",
          },
          { title: "版本", dataIndex: "revision" },
          {
            title: "通用线索",
            dataIndex: "commonClueCount",
            render: (value: number) => (
              <Tag color={value ? "blue" : "default"}>{value || 0} 条</Tag>
            ),
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => (
              <Tag>
                {value === "archived" ? "已移出题库" : statusLabels[value]}
              </Tag>
            ),
          },
          {
            title: "引用 / 编辑限制",
            render: (_, row: AdminQuestion) => {
              const info = questionUsage(row, catalog.sessions);
              return (
                <Space direction="vertical" size={4}>
                  <Tag color={info.online.length ? "orange" : "default"}>
                    {row.status === "archived"
                      ? "只读"
                      : info.canEdit
                        ? "可编辑"
                        : "线上引用，已锁定"}
                  </Tag>
                  <SessionReferences
                    references={[...info.online, ...info.drafts]}
                  />
                  {!!info.historyCount && (
                    <Typography.Text type="secondary">
                      另有 {info.historyCount} 个已下线场次引用
                    </Typography.Text>
                  )}
                </Space>
              );
            },
          },
          {
            title: "操作",
            render: (_, row: AdminQuestion) => (
              <Space wrap>
                <Button onClick={() => edit(row)}>
                  {questionUsage(row, catalog.sessions).canEdit
                    ? "编辑"
                    : "查看"}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    groupForm.setFieldsValue({ groupName: row.groupName });
                    setGrouping(row);
                  }}
                >
                  归类
                </Button>
                <Button onClick={() => setClueQuestionId(row.id)}>
                  通用线索
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
                <Button
                  danger
                  disabled={
                    busy || !questionUsage(row, catalog.sessions).canDelete
                  }
                  onClick={() => {
                    deleteForm.resetFields();
                    setDeleting(row);
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <EditorDrawer
        title={readOnly ? "查看题目" : id ? "编辑题目" : "新建题目"}
        width={1280}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Space wrap>
              {selected && (
                <Button onClick={() => setClueQuestionId(selected.id)}>
                  {selected.status === "archived" ? "查看" : "管理"}通用线索
                </Button>
              )}
              <Button onClick={() => setOpen(false)}>关闭</Button>
            </Space>
          ) : (
            <Space wrap>
              {selected && (
                <Button onClick={() => setClueQuestionId(selected.id)}>
                  管理通用线索
                </Button>
              )}
              <FormFooter
                busy={busy}
                form={form}
                cancel={() => setOpen(false)}
              />
            </Space>
          )
        }
      >
        {usage && (
          <Alert
            style={{ marginBottom: 16 }}
            type={readOnly ? "warning" : "info"}
            message={
              selected?.status === "archived"
                ? "题目已移出题库，仅可查看或复制。"
                : usage.online.length
                  ? "请先下线所有引用场次，再修改此题。"
                  : usage.drafts.length
                    ? "保存后，引用此题的草稿将同步使用新配置。"
                    : "保存更新原题，题目 ID 不变。"
            }
            description={
              <>
                <SessionReferences
                  references={[...usage.online, ...usage.drafts]}
                />
                {!!usage.historyCount && (
                  <p>
                    后台旧场次会显示当前题面；历史提交与结算不重算。请填写修改原因。
                  </p>
                )}
              </>
            }
          />
        )}
        <LivePreview form={form} kind="question" active={open}>
        <Form
          name="question-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (readOnly) return;
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
          {id && !readOnly && (
            <Field
              name="reason"
              label="修改原因"
              rules={usage?.historyCount ? fieldRule : undefined}
            >
              <Input.TextArea
                maxLength={1000}
                rows={2}
                placeholder="例如：修正错别字或答案配置"
              />
            </Field>
          )}
          <Field name="title" label="题目标题" rules={fieldRule}>
            <Input />
          </Field>
          <Field name="groupName" label="题目分组">
            <AutoComplete
              allowClear
              options={groups.map((groupName) => ({ value: groupName }))}
              placeholder="留空自动归为其他"
            />
          </Field>
          <Field name="kind" label="题型" rules={fieldRule}>
            <Select
              options={[
                { value: "text", label: "填空" },
                { value: "choice", label: "单选" },
              ]}
            />
          </Field>
          {kind === "text" && (
            <Field
              name="fuzzyMatch"
              label="模糊答案匹配"
              valuePropName="checked"
              preserve={false}
            >
              <Switch checkedChildren="关键词" unCheckedChildren="精确" />
            </Field>
          )}
          <Field name="placeholder" label="输入占位提示">
            <Input />
          </Field>
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
                    <Field
                      name={[name, "text"]}
                      label="正文"
                      extra={<TextSyntaxHelp />}
                    >
                      <Input.TextArea rows={4} />
                    </Field>
                    <Field
                      name={[name, "hint"]}
                      label="可展开提示"
                      extra={<TextSyntaxHelp />}
                    >
                      <Input.TextArea />
                    </Field>
                    <Field name={[name, "imageUrl"]} label="图片 / 视频封面">
                      <AlistMediaInput type="img" />
                    </Field>
                    <Field
                      name={[name, "imageUrls"]}
                      label="更多图片（每行一条 URL）"
                    >
                      <LinesInput />
                    </Field>
                    <Field name={[name, "videoUrl"]} label="视频">
                      <AlistMediaInput type="video" />
                    </Field>
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
                      <Field
                        name={[name, "key"]}
                        label="选项标识（如 A）"
                        rules={fieldRule}
                      >
                        <Input />
                      </Field>
                      <Field name={[name, "text"]} label="选项文字">
                        <Input.TextArea />
                      </Field>
                      <Field name={[name, "imageUrl"]} label="选项图片">
                        <AlistMediaInput type="img" />
                      </Field>
                      <Field name={[name, "videoUrl"]} label="选项视频">
                        <AlistMediaInput type="video" />
                      </Field>
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
          <Field
            name="acceptedAnswers"
            label={
              kind === "choice"
                ? "正确选项标识（每行一个）"
                : fuzzyMatch
                  ? "必须包含的关键词（每行一个）"
                  : "可接受答案（每行一个）"
            }
            rules={fieldRule}
            style={{ marginTop: 24 }}
          >
            <LinesInput rows={4} />
          </Field>
        </Form>
        </LivePreview>
      </EditorDrawer>
      <Modal
        title={`调整题目分组 · ${grouping?.title || ""}`}
        open={!!grouping}
        forceRender
        confirmLoading={busy}
        onCancel={() => setGrouping(null)}
        onOk={() => groupForm.submit()}
        okText="保存分组"
      >
        <Alert
          type="info"
          showIcon
          message="分组仅用于后台整理，不影响玩家答题；线上引用中的题目也可调整。"
          style={{ marginBottom: 16 }}
        />
        <Form
          form={groupForm}
          layout="vertical"
          onFinish={async (values) => {
            if (
              grouping &&
              (await run(
                `/admin/questions/${grouping.id}/group`,
                values,
                "PATCH",
              ))
            )
              setGrouping(null);
          }}
        >
          <Field name="groupName" label="题目分组">
            <AutoComplete
              allowClear
              options={groups.map((groupName) => ({ value: groupName }))}
              placeholder="留空自动归为其他"
            />
          </Field>
        </Form>
      </Modal>
      <Modal
        title="删除题目（保留历史）"
        open={!!deleting}
        forceRender
        confirmLoading={busy}
        onCancel={() => setDeleting(null)}
        onOk={() => deleteForm.submit()}
        okText="确认删除"
        okButtonProps={{ danger: true }}
      >
        <Alert
          type="warning"
          showIcon
          message={`将“${deleting?.title || ""}”移出题库，历史关联保留；不能直接恢复，可复制成新题。`}
        />
        <Form
          form={deleteForm}
          layout="vertical"
          onFinish={async (values) => {
            if (
              deleting &&
              (await run(`/admin/questions/${deleting.id}/archive`, values))
            )
              setDeleting(null);
          }}
        >
          <Field name="reason" label="删除原因" rules={fieldRule}>
            <Input.TextArea maxLength={1000} />
          </Field>
        </Form>
      </Modal>
      <QuestionClueManager
        question={clueQuestion || null}
        open={Boolean(clueQuestion)}
        onClose={() => setClueQuestionId("")}
        refreshCatalog={refresh}
      />
    </PageCard>
  );
}
function SessionEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm();
  const [closeForm] = Form.useForm();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<SessionFilter>("published");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [closingId, setClosingId] = useState("");
  const [liveEditingId, setLiveEditingId] = useState("");
  const closing = catalog.sessions.find((s) => s.id === closingId);
  const liveEditing = catalog.sessions.find((s) => s.id === liveEditingId);
  const counts = sessionCounts(catalog.sessions);
  const [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const readOnly = Boolean(
    id && catalog.sessions.find((row) => row.id === id)?.status !== "draft",
  );
  const { run, busy } = useAdminCommand(refresh);
  const steps: AdminSessionLevel[] = Form.useWatch("levels", form) || [];
  const targetKind = Form.useWatch(["completionTarget", "kind"], form);
  const targetId = Form.useWatch(["completionTarget", "id"], form);
  const clues: AdminSession["clues"] = Form.useWatch("clues", form) || [];
  const unavailableNarratives = unavailableNarrativeReferences(
    catalog.narratives,
    {
      clues,
      completionTarget:
        targetKind === "narrative" ? { kind: "narrative", id: targetId } : null,
    },
  );
  const narrativeRule = {
    validator: (_: unknown, value?: string) => {
      const row = catalog.narratives.find((n) => n.id === value);
      return value && (!row || row.status === "archived")
        ? Promise.reject(
            new Error("内容已移出或不存在，请替换或移除引用后再保存。"),
          )
        : Promise.resolve();
    },
  };
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
  useEffect(() => {
    const target = params.get("sessionId");
    const row = target ? catalog.sessions.find((s) => s.id === target) : null;
    if (!row) return;
    setId(row.id);
    form.resetFields();
    form.setFieldsValue(row);
    setOpen(true);
    setFilter(row.status);
    setSearch("");
    setPage(1);
    const next = new URLSearchParams(params);
    next.delete("sessionId");
    setParams(next, { replace: true });
  }, [params, catalog.sessions, form, setParams]);
  const unavailable = steps.filter((step) => {
    const q = catalog.questions.find((q) => q.id === step.question);
    return step.question && (!q || q.status === "archived");
  });
  return (
    <PageCard
      title="场次编排"
      extra={
        <Space>
          <Button onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" onClick={() => edit()}>
            新建场次
          </Button>
        </Space>
      }
    >
      <Tabs
        activeKey={filter}
        onChange={(value) => {
          setFilter(value as SessionFilter);
          setPage(1);
        }}
        items={(["published", "draft", "archived", "all"] as const).map(
          (key) => ({
            key,
            label: `${key === "all" ? "全部" : sessionStatusLabels[key]}（${counts[key]}）`,
          }),
        )}
      />
      <Input.Search
        aria-label="搜索场次标题"
        placeholder="搜索场次标题"
        allowClear
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
        style={{ maxWidth: 360, marginBottom: 16 }}
      />
      <AdminTable
        rowKey="id"
        dataSource={filterSessions(catalog.sessions, filter, search)}
        pagination={{
          current: page,
          pageSize: 10,
          showSizeChanger: false,
          onChange: setPage,
        }}
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
            render: (value: AdminSession["status"]) => (
              <Tag color={value === "published" ? "green" : "default"}>
                {sessionStatusLabels[value]}
              </Tag>
            ),
          },
          {
            title: "操作",
            render: (_, row: AdminSession) => (
              <Space wrap>
                <Button onClick={() => edit(row)}>
                  {row.status === "draft" ? "编辑" : "查看"}
                </Button>
                {row.status === "published" && (
                  <Button onClick={() => setLiveEditingId(row.id)}>
                    编辑已发布配置
                  </Button>
                )}
                <Button
                  disabled={busy || row.status !== "draft"}
                  onClick={async () => {
                    if (await run(`/admin/sessions/${row.id}/publish`)) {
                      setFilter("published");
                      setSearch("");
                      setPage(1);
                    }
                  }}
                >
                  发布
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    const result = await run<{ id: string }>(
                      `/admin/sessions/${row.id}`,
                      { clone: true },
                    );
                    if (result) setParams({ sessionId: result.id });
                  }}
                >
                  复制为新草稿
                </Button>
                <Button
                  danger
                  disabled={busy || row.status === "archived"}
                  onClick={() => {
                    closeForm.resetFields();
                    setClosingId(row.id);
                  }}
                >
                  {row.status === "draft" ? "作废" : "下线"}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <EditorDrawer
        title={readOnly ? "查看场次版本" : id ? "编辑场次草稿" : "新建场次"}
        width={1280}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Space wrap>
              {catalog.sessions.find((row) => row.id === id)?.status ===
                "published" && (
                <Button onClick={() => setLiveEditingId(id)}>
                  编辑已发布配置
                </Button>
              )}
              <Button onClick={() => setOpen(false)}>关闭</Button>
            </Space>
          ) : (
            <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
          )
        }
      >
        {readOnly && (
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={
              catalog.sessions.find((row) => row.id === id)?.status ===
              "published"
                ? "完整编排保持只读；可使用“编辑已发布配置”单独修正标题、说明、BGM、背景和已有线索展示。"
                : "此场次只读；下线后不能恢复上线，需要复制为新草稿。题面为题库当前配置，历史判定未重算。"
            }
          />
        )}
        {!!unavailable.length && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`有 ${unavailable.length} 个关卡引用了已移出题库的题目，发布前必须替换；旧记录仍保留。`}
          />
        )}
        {!!unavailableNarratives.length && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              readOnly
                ? "此场次保留了已移出的剧情内容引用。"
                : "有已移出的剧情内容，替换或移除后才能保存、发布。"
            }
            description={
              <>
                {unavailableNarratives.map((ref) => (
                  <p key={ref.id}>
                    {ref.label}：{ref.locations.join("、")}
                  </p>
                ))}
                <span>
                  复制旧场次会保留原引用；如需沿用正文，可到
                  <Link to="/narratives">信件与祝福</Link>
                  的“已移出”列表复制新版本，发布后再替换。旧场次和历史记录不变。
                </span>
              </>
            }
          />
        )}
        <SessionPreview form={form} catalog={catalog} active={open}>
        <Form
          name="session-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (readOnly || unavailableNarratives.length) return;
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
            if (result) {
              setOpen(false);
              setFilter("draft");
              setSearch("");
              setPage(1);
            }
          }}
        >
          <Tabs
            items={[
              {
                key: "basic",
                forceRender: true,
                label: "基础与演出",
                children: (
                  <>
                    <Field name="title" label="场次名称" rules={fieldRule}>
                      <Input />
                    </Field>
                    <Field name="description" label="场次说明">
                      <Input.TextArea />
                    </Field>
                    <div className="admin-field-grid">
                      <Field name="minLevel" label="最低参与等级">
                        <Select allowClear options={rankOptions} />
                      </Field>
                      <Field name="maxLevel" label="最高参与等级">
                        <Select allowClear options={rankOptions} />
                      </Field>
                    </div>
                    <Alert
                      type="info"
                      message="等级在首次入场时检查，入场后升级不会被中途踢出。"
                      style={{ marginBottom: 20 }}
                    />
                    <PresentationFields prefix={["presentation"]} />
                    <Field
                      name={["presentation", "completionStyle"]}
                      label="通关演出"
                    >
                      <Select
                        options={[
                          { value: "normal", label: "普通场次完成" },
                          { value: "finale", label: "终章演出" },
                        ]}
                      />
                    </Field>
                    <Field
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
                    </Field>
                    {targetKind === "narrative" && (
                      <Field
                        name={["completionTarget", "id"]}
                        label="叙事内容"
                        rules={[...fieldRule, narrativeRule]}
                      >
                        <Select
                          showSearch
                          optionFilterProp="label"
                          options={narrativeOptions(
                            catalog.narratives,
                            targetId,
                          )}
                        />
                      </Field>
                    )}
                    {targetKind === "link" && (
                      <Field
                        name={["completionTarget", "url"]}
                        label="HTTP(S) 链接"
                        rules={fieldRule}
                      >
                        <Input />
                      </Field>
                    )}
                  </>
                ),
              },
              {
                key: "levels",
                forceRender: true,
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
                              <Space size={4} wrap>
                                <Button
                                  size="small"
                                  disabled={readOnly || name === 0}
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
                            <Field name={[name, "id"]} hidden>
                              <Input />
                            </Field>
                            <Field
                              name={[name, "question"]}
                              label="题目版本"
                              rules={fieldRule}
                            >
                              <Select
                                showSearch
                                optionFilterProp="searchText"
                                optionRender={(option) => (
                                  <div className="admin-question-option">
                                    <div className="admin-question-option-label">
                                      {option.label}
                                    </div>
                                    <div className="admin-question-option-id">
                                      题目 ID：{String(option.value)}
                                    </div>
                                  </div>
                                )}
                                options={questionOptions(
                                  catalog.questions,
                                  steps[name]?.question,
                                )}
                              />
                            </Field>
                            <div className="admin-field-grid">
                              <Field
                                name={[name, "xp"]}
                                label="通关经验"
                                rules={fieldRule}
                              >
                                <InputNumber min={0} max={1000000} />
                              </Field>
                              <Field
                                name={[name, "autoNext"]}
                                label="自动进入下一题"
                                valuePropName="checked"
                              >
                                <Switch />
                              </Field>
                            </div>
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
                                    <div
                                      className="admin-penalty-row"
                                      key={p.key}
                                    >
                                      <Field
                                        name={[p.name, "type"]}
                                        label="惩罚方式"
                                      >
                                        <Select
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
                                      </Field>
                                      <Field
                                        name={[p.name, "seconds"]}
                                        label="冷却时长"
                                      >
                                        <InputNumber
                                          min={0}
                                          max={2592000}
                                          addonAfter="秒"
                                        />
                                      </Field>
                                      <Button
                                        danger
                                        onClick={() => removePenalty(p.name)}
                                      >
                                        移除
                                      </Button>
                                    </div>
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
                forceRender: true,
                label: "解锁线索",
                children: (
                  <Form.List name="clues">
                    {(fields, { add, remove, move }) => (
                      <>
                        {fields.map(({ key, name }) => (
                          <Card
                            key={key}
                            size="small"
                            style={{ marginBottom: 16 }}
                            title={`线索 ${name + 1}`}
                            extra={
                              <Space>
                                <Button
                                  disabled={readOnly || name === 0}
                                  aria-label={`上移第 ${name + 1} 条场次线索`}
                                  onClick={() => move(name, name - 1)}
                                >
                                  上移
                                </Button>
                                <Button
                                  size="small"
                                  disabled={
                                    readOnly || name === fields.length - 1
                                  }
                                  aria-label={`下移第 ${name + 1} 条场次线索`}
                                  onClick={() => move(name, name + 1)}
                                >
                                  下移
                                </Button>
                                <Button
                                  danger
                                  size="small"
                                  onClick={() => remove(name)}
                                >
                                  移除
                                </Button>
                              </Space>
                            }
                          >
                            <Field
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
                            </Field>
                            <Field
                              name={[name, "sessionLevel"]}
                              label="关联小关卡（指定关卡时必选）"
                            >
                              <Select allowClear options={stepOptions} />
                            </Field>
                            <Field
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
                            </Field>
                            <Field
                              name={[name, "content", "title"]}
                              label="标题"
                            >
                              <Input />
                            </Field>
                            <Field
                              name={[name, "content", "text"]}
                              label="文字内容"
                              extra={<TextSyntaxHelp />}
                            >
                              <Input.TextArea rows={4} />
                            </Field>
                            <Field
                              name={[name, "content", "buttonText"]}
                              label="组合线索确认按钮文字"
                            >
                              <Input />
                            </Field>
                            <Field
                              name={[name, "content", "description"]}
                              label="组合线索底部说明"
                            >
                              <Input.TextArea rows={2} />
                            </Field>
                            <Field
                              name={[name, "content", "url"]}
                              label="视频 / 外部链接 URL"
                            >
                              <Input />
                            </Field>
                            <Field
                              name={[name, "content", "imageUrls"]}
                              label="图片 URL（每行一条）"
                            >
                              <LinesInput />
                            </Field>
                            <Field
                              name={[name, "narrative"]}
                              label="信件 / 祝福内容"
                              rules={[narrativeRule]}
                            >
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp="label"
                                options={narrativeOptions(
                                  catalog.narratives,
                                  clues[name]?.narrative,
                                )}
                              />
                            </Field>
                            <Field
                              name={[name, "autoPlay"]}
                              label="解锁后自动展示（文字、图片、视频）"
                              valuePropName="checked"
                            >
                              <Switch />
                            </Field>
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
                forceRender: true,
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
                            title={`发奖规则 ${name + 1}`}
                            extra={
                              <Button danger onClick={() => remove(name)}>
                                移除
                              </Button>
                            }
                          >
                            <Field
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
                            </Field>
                            <Field
                              name={[name, "sessionLevel"]}
                              label="关联小关卡（整场完成时留空）"
                            >
                              <Select allowClear options={stepOptions} />
                            </Field>
                            <Field
                              name={[name, "reward"]}
                              label="奖品"
                              rules={fieldRule}
                            >
                              <Select
                                options={catalog.rewards
                                  .filter((r) => r.active)
                                  .map((r) => ({ value: r.id, label: r.name }))}
                              />
                            </Field>
                            <Field
                              name={[name, "quantity"]}
                              label="数量"
                              rules={fieldRule}
                            >
                              <InputNumber min={1} max={100} />
                            </Field>
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
        </SessionPreview>
      </EditorDrawer>
      <Modal
        title={closing?.status === "draft" ? "作废场次草稿" : "永久下线场次"}
        open={!!closing}
        forceRender
        confirmLoading={busy}
        onCancel={() => setClosingId("")}
        onOk={() => closeForm.submit()}
        okText={closing?.status === "draft" ? "确认作废" : "确认下线"}
        okButtonProps={{ danger: true, disabled: !closing?.assignmentCounts }}
      >
        <Typography.Paragraph>
          {closing?.title} · v{closing?.revision}
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          message="此操作不可恢复；只能复制为新草稿再发布。"
          description="玩家待答和历史列表将不再显示，旧链接不可访问。未完成下发结束；已获经验、奖品、领取信息与核销记录全部保留。"
        />
        <Typography.Paragraph style={{ marginTop: 16 }}>
          {closing?.assignmentCounts
            ? `当前共 ${closing.assignmentCounts.total} 条下发；将结束 ${closing.assignmentCounts.assigned + closing.assignmentCounts.active} 条未完成下发；${closing.assignmentCounts.completed} 条已完成记录保留原状态。`
            : "暂时无法读取下发统计，请刷新或检查后端版本。"}
          实际处理数量以服务端执行结果为准。
        </Typography.Paragraph>
        <Form
          form={closeForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!closing) return;
            const result = await run<{ id: string; cancelledCount: number }>(
              `/admin/sessions/${closing.id}/archive`,
              values,
            );
            if (result) {
              setClosingId("");
              if (id === closing.id) setOpen(false);
              setPage(1);
            }
          }}
        >
          <Field
            name="reason"
            label={closing?.status === "draft" ? "作废原因" : "下线原因"}
            rules={fieldRule}
          >
            <Input.TextArea maxLength={1000} rows={3} />
          </Field>
        </Form>
      </Modal>
      <LiveSessionSettingsDrawer
        session={liveEditing || null}
        questions={catalog.questions}
        catalog={catalog}
        open={Boolean(liveEditing)}
        onClose={() => setLiveEditingId("")}
        refresh={refresh}
      />
    </PageCard>
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
    <PageCard
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
      <AdminTable
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
      <EditorDrawer
        width={1280}
        open={open}
        forceRender
        title="奖品配置"
        onClose={() => setOpen(false)}
        extra={
          <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
        }
      >
        <LivePreview form={form} kind="reward" active={open}>
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
            <Field name="name" label="名称" rules={fieldRule}>
              <Input />
            </Field>
            <Field name="image" label="图片">
              <AlistMediaInput type="img" />
            </Field>
            <Field name="description" label="奖品说明">
              <Input.TextArea />
            </Field>
            <Field name="claimMethod" label="领取方式" rules={fieldRule}>
              <Select
                options={[
                  { value: "staff", label: "找工作人员领取" },
                  { value: "location", label: "去指定地点领取" },
                  { value: "locker", label: "柜子领取" },
                ]}
              />
            </Field>
            <Field
              name="publicInstructions"
              label="可复用的领取说明"
              extra={<TextSyntaxHelp />}
            >
              <Input.TextArea rows={4} />
            </Field>
            <Field name="active" label="启用" valuePropName="checked">
              <Switch />
            </Field>
          </Form>
        </LivePreview>
      </EditorDrawer>
    </PageCard>
  );
}
function NarrativeEditor({ catalog, refresh }: EditorProps) {
  const [form] = Form.useForm(),
    [open, setOpen] = useState(false),
    [id, setId] = useState("");
  const [deleteForm] = Form.useForm();
  const [scope, setScope] = useState<NarrativeFilter>("available");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const selected = catalog.narratives.find((row) => row.id === id);
  const deleting = catalog.narratives.find((row) => row.id === deletingId);
  const readOnly = Boolean(id && selected?.status !== "draft");
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
  useEffect(() => {
    const row = copiedId
      ? catalog.narratives.find((n) => n.id === copiedId)
      : null;
    if (!row) return;
    setId(row.id);
    form.resetFields();
    form.setFieldsValue(row);
    setOpen(true);
    setCopiedId("");
  }, [copiedId, catalog.narratives, form]);
  const clone = async (row: AdminNarrative) => {
    const result = await run<{ id: string }>(`/admin/narratives/${row.id}`, {
      clone: true,
    });
    if (result) {
      setScope("available");
      setSearch("");
      setPage(1);
      setCopiedId(result.id);
    }
  };
  return (
    <PageCard
      title="信件与祝福"
      extra={
        <Space>
          <Button onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" onClick={() => edit()}>
            新建内容
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="无引用或仅被已下线场次引用时可删除；线上和草稿引用会阻止删除。"
        description="删除只移出内容库，保留正文、历史关联和玩家权益，不删除媒体文件。已移出内容不可恢复发布，需要再用时请复制新版本。"
        style={{ marginBottom: 20 }}
      />
      <div className="admin-list-toolbar">
        <Input.Search
          aria-label="搜索信件或祝福标题"
          placeholder="搜索信件或祝福标题"
          allowClear
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="剧情内容范围"
          value={scope}
          style={{ width: 250 }}
          onChange={(value: NarrativeFilter) => {
            setScope(value);
            setPage(1);
          }}
          options={[
            { value: "available", label: "正常内容" },
            { value: "archived", label: "已移出（含历史归档）" },
            { value: "all", label: "全部" },
          ]}
        />
      </div>
      <AdminTable
        rowKey="id"
        dataSource={filterNarratives(catalog.narratives, scope, search)}
        pagination={{
          current: page,
          pageSize: 10,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          { title: "标题", dataIndex: "title" },
          {
            title: "类型",
            dataIndex: "kind",
            render: (value) => (value === "letter" ? "信件" : "祝福"),
          },
          { title: "版本", dataIndex: "revision" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => (
              <Tag>{value === "archived" ? "已移出" : statusLabels[value]}</Tag>
            ),
          },
          {
            title: "引用 / 删除限制",
            width: 320,
            render: (_, row: AdminNarrative) => {
              const info = narrativeUsage(row, catalog.sessions);
              return (
                <Space direction="vertical" size={4}>
                  <Typography.Text
                    type={
                      info.online.length || info.drafts.length
                        ? "warning"
                        : "secondary"
                    }
                  >
                    {narrativeDeletionHint(row, catalog.sessions)}
                  </Typography.Text>
                  <SessionReferences
                    references={[...info.online, ...info.drafts]}
                  />
                  {!!info.history.length && (
                    <details>
                      <summary>{info.history.length} 个已下线场次引用</summary>
                      <SessionReferences references={info.history} />
                    </details>
                  )}
                </Space>
              );
            },
          },
          {
            title: "操作",
            render: (_, row: AdminNarrative) => (
              <Space wrap>
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
                <Button disabled={busy} onClick={() => void clone(row)}>
                  复制新版本
                </Button>
                <Button
                  danger
                  disabled={
                    busy || !narrativeUsage(row, catalog.sessions).canDelete
                  }
                  onClick={() => {
                    deleteForm.resetFields();
                    setDeletingId(row.id);
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <EditorDrawer
        title={readOnly ? "查看剧情内容" : id ? "编辑剧情草稿" : "新建剧情内容"}
        width={1280}
        open={open}
        forceRender
        onClose={() => setOpen(false)}
        extra={
          readOnly ? (
            <Space>
              <Button
                disabled={busy || !selected}
                onClick={() => selected && void clone(selected)}
              >
                复制新版本
              </Button>
              <Button onClick={() => setOpen(false)}>关闭</Button>
            </Space>
          ) : (
            <FormFooter busy={busy} form={form} cancel={() => setOpen(false)} />
          )
        }
      >
        {readOnly && selected && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              selected.status === "archived"
                ? "已移出内容库，只读且不可恢复发布。"
                : "已发布内容只读，修改请复制新版本。"
            }
            description={`${narrativeDeletionHint(selected, catalog.sessions)}复制的新版本不会自动替换旧场次引用。`}
          />
        )}
        <LivePreview form={form} kind="narrative" active={open}>
        <Form
          name="narrative-editor"
          disabled={readOnly}
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (readOnly) return;
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
          <Field name="title" label="标题" rules={fieldRule}>
            <Input />
          </Field>
          <Field name="kind" label="类型" rules={fieldRule}>
            <Select
              options={[
                { value: "letter", label: "信件" },
                { value: "bless", label: "祝福" },
              ]}
            />
          </Field>
          <Field name={["payload", "mainAudioUrl"]} label="背景音乐">
            <AlistMediaInput type="audio" />
          </Field>
          {kind === "letter" && (
            <>
              <Field name={["payload", "variant"]} label="信件样式">
                <Select
                  options={[
                    { value: "modern", label: "现代" },
                    { value: "classical", label: "古典" },
                    { value: "magic", label: "魔法" },
                  ]}
                />
              </Field>
              <Field name={["payload", "description"]} label="说明">
                <Input />
              </Field>
              <Field name={["payload", "hintText"]} label="开启提示">
                <Input />
              </Field>
              <Field
                name={["payload", "typingSpeedMs"]}
                label="打字间隔（毫秒）"
              >
                <InputNumber min={1} />
              </Field>
              <Field
                name={["payload", "backgroundImages"]}
                label="信纸背景图（每行一条）"
              >
                <LinesInput />
              </Field>
              <Field name={["payload", "pageBackgroundUrl"]} label="页面背景">
                <AlistMediaInput type="img" />
              </Field>
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
                      <Field
                        name={[name, kind === "letter" ? "content" : "text"]}
                        label="文字"
                        rules={fieldRule}
                      >
                        <Input.TextArea rows={4} />
                      </Field>
                      <Field name={[name, "audioUrl"]} label="段落配音">
                        <AlistMediaInput type="audio" />
                      </Field>
                      <Field
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
                      </Field>
                      {kind === "letter" && (
                        <Field name={[name, "align"]} label="对齐">
                          <Select
                            options={[
                              "left",
                              "center",
                              "right",
                              "top",
                              "bottom",
                            ].map((value) => ({
                              value,
                              label: (
                                {
                                  left: "左对齐",
                                  center: "居中",
                                  right: "右对齐",
                                  top: "靠上",
                                  bottom: "靠下",
                                } as Record<string, string>
                              )[value],
                            }))}
                          />
                        </Field>
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
        </LivePreview>
      </EditorDrawer>
      <Modal
        title="删除剧情内容（保留历史）"
        open={!!deleting}
        forceRender
        confirmLoading={busy}
        onCancel={() => setDeletingId("")}
        onOk={() => deleteForm.submit()}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          disabled:
            !deleting || !narrativeUsage(deleting, catalog.sessions).canDelete,
        }}
      >
        <Typography.Paragraph>
          {deleting?.title} · v{deleting?.revision}
        </Typography.Paragraph>
        <Alert
          type="warning"
          showIcon
          message="移出后不可直接恢复，只能复制新版本再使用。"
          description="原 ID、正文和历史关联保留，不影响经验、奖品、领取信息或核销记录，也不删除 CDN 文件。"
        />
        {deleting && (
          <Typography.Paragraph style={{ marginTop: 16 }}>
            {narrativeDeletionHint(deleting, catalog.sessions)}
            实际能否删除以服务端最新引用检查为准。
          </Typography.Paragraph>
        )}
        <Form
          name="narrative-delete"
          form={deleteForm}
          layout="vertical"
          onFinish={async (values) => {
            if (
              !deleting ||
              !narrativeUsage(deleting, catalog.sessions).canDelete
            )
              return;
            if (await run(`/admin/narratives/${deleting.id}/archive`, values)) {
              setDeletingId("");
              if (id === deleting.id) setOpen(false);
              setPage(1);
            }
          }}
        >
          <Field
            name="reason"
            label="删除原因"
            rules={[
              {
                required: true,
                whitespace: true,
                message: "请填写删除原因，便于追溯此次操作",
              },
            ]}
          >
            <Input.TextArea
              maxLength={1000}
              showCount
              rows={3}
              placeholder="例如：旧活动已下线，保留历史记录后移出内容库"
            />
          </Field>
        </Form>
      </Modal>
    </PageCard>
  );
}
