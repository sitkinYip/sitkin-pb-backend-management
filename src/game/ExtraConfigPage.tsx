import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Typography,
} from "antd";
import type {
  AdminAssignmentSummary,
  AdminCatalog,
  ExtraConfig,
  ExtraDefinition,
  ExtraField,
  ExtraPreview,
  ExtraScope,
  GameExtra,
} from "./contracts";
import { AdminTable, EditorDrawer, Field, PageCard } from "./ui";
import { ErrorNotice, fieldRule, useAdminData } from "./shared";
import { useConfigRequest } from "./useConfigRequest";

const scopes: Record<ExtraScope, string> = {
  global: "全局",
  rank: "成长等级",
  question: "题目版本",
  session: "场次版本",
  assignment: "一次场次任务",
  session_level: "场次小关卡",
  assignment_level: "某次任务的小关卡",
};
const contexts = {
  profile: "用户资料",
  assignment: "场次详情",
  level: "答题关卡",
};
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const textFields: ExtraField = {
  type: "object",
  properties: {
    text: {
      type: "string",
      label: "展示文案",
      required: true,
      maxLength: 2000,
    },
  },
};
const stringify = (value: unknown) => JSON.stringify(value, null, 2);

function JsonInput({
  value,
  onChange,
  id,
}: {
  value?: unknown;
  onChange?: (value: unknown) => void;
  id?: string;
}) {
  return (
    <Input.TextArea
      id={id}
      value={typeof value === "string" ? value : stringify(value ?? {})}
      autoSize={{ minRows: 4, maxRows: 14 }}
      onChange={(e) => {
        try {
          onChange?.(JSON.parse(e.target.value));
        } catch {
          onChange?.(e.target.value);
        }
      }}
    />
  );
}
function ValueFields({ spec }: { spec: ExtraField }) {
  return (
    <>
      {Object.entries(spec.properties || {}).map(([key, field]) => {
        const label = field.label || key;
        const rules = [
          { required: field.required === true, message: `请填写${label}` },
        ];
        const name = ["extra", key];
        if (field.type === "boolean")
          return (
            <Field
              key={key}
              name={name}
              label={label}
              valuePropName="checked"
              initialValue={field.default ?? false}
            >
              <Switch />
            </Field>
          );
        if (field.type === "number")
          return (
            <Field
              key={key}
              name={name}
              label={label}
              rules={rules}
              initialValue={field.default}
            >
              <InputNumber min={field.minimum} max={field.maximum} />
            </Field>
          );
        if (field.enum)
          return (
            <Field
              key={key}
              name={name}
              label={label}
              rules={rules}
              initialValue={field.default}
            >
              <Select
                allowClear
                options={field.enum.map((value) => ({ value, label: value }))}
              />
            </Field>
          );
        if (["object", "array"].includes(field.type))
          return (
            <Field
              key={key}
              name={name}
              label={label}
              rules={rules}
              initialValue={field.default ?? (field.type === "array" ? [] : {})}
              extra="使用 JSON 编辑，保存前由服务端按字段定义校验。"
            >
              <JsonInput />
            </Field>
          );
        return (
          <Field
            key={key}
            name={name}
            label={label}
            rules={rules}
            initialValue={field.default}
          >
            <Input.TextArea
              maxLength={field.maxLength ?? 2000}
              autoSize={{ minRows: 2, maxRows: 6 }}
            />
          </Field>
        );
      })}
    </>
  );
}

export function ExtraConfigPage() {
  const catalog = useAdminData<AdminCatalog>("/admin/catalog");
  return (
    <PageCard title="扩展配置">
      <ErrorNotice error={catalog.error} retry={() => void catalog.refresh()} />
      {catalog.loading && !catalog.data ? (
        <Spin />
      ) : catalog.data?.capabilities?.extraConfig ? (
        <ConfigWorkspace catalog={catalog.data} />
      ) : (
        <Alert
          type="info"
          showIcon
          message="当前后端尚未支持扩展配置"
          description="后端完成本次迁移并启用接口后，才能创建字段定义和下发配置。"
        />
      )}
    </PageCard>
  );
}

function ConfigWorkspace({ catalog }: { catalog: AdminCatalog }) {
  const defs = useAdminData<{ items: ExtraDefinition[] }>(
    "/admin/extra-definitions",
  );
  const [tab, setTab] = useState("configs");
  const [editing, setEditing] = useState<ExtraDefinition | "new" | null>(null);
  const [dispatching, setDispatching] = useState<ExtraConfig | "new" | null>(
    null,
  );
  const [records, setRecords] = useState<ExtraConfig[]>([]);
  const [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [filter, setFilter] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const request = useConfigRequest();
  async function load(nextPage = page) {
    const result = await request.run<{
      items: ExtraConfig[];
      hasMore: boolean;
    }>("/admin/extra-configs/query", {
      page: nextPage,
      ...(filter ? { definitionId: filter } : {}),
    });
    if (result) {
      setRecords(result.items);
      setMore(result.hasMore);
      setPage(nextPage);
    }
  }
  useEffect(() => {
    void load(1);
  }, [filter]);
  const definitions = defs.data?.items || [];
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="为已有对象下发展示字段，不改变经验、奖励或参与规则。"
        description="全部当前用户是名单快照；公共默认包含未来用户。普通字段使用“仅传输”，通用文本可直接展示。"
      />
      <ErrorNotice error={defs.error} retry={() => void defs.refresh()} />
      {request.error && (
        <Alert
          type="error"
          showIcon
          message={request.error.message}
          action={<Button onClick={() => void load()}>重新查询</Button>}
        />
      )}
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "configs",
            label: "下发记录",
            children: (
              <>
                <div className="admin-list-toolbar">
                  <Select
                    aria-label="按字段筛选"
                    allowClear
                    placeholder="全部字段"
                    value={filter || undefined}
                    onChange={(id) => setFilter(id || "")}
                    options={definitions.map((d) => ({
                      value: d.id,
                      label: d.label,
                    }))}
                  />
                  <Space wrap>
                    <Button onClick={() => setInspecting(true)}>
                      查看用户生效值
                    </Button>
                    <Button onClick={() => void load()} disabled={request.busy}>
                      刷新
                    </Button>
                    <Button
                      type="primary"
                      disabled={!definitions.some((d) => d.status === "active")}
                      onClick={() => setDispatching("new")}
                    >
                      下发配置
                    </Button>
                  </Space>
                </div>
                {!definitions.length && !defs.loading && (
                  <Alert
                    type="info"
                    message="请先在“字段定义”中创建一个字段，再选择用户和目标下发。"
                  />
                )}
                <AdminTable<ExtraConfig>
                  rowKey="id"
                  loading={request.busy}
                  dataSource={records}
                  pagination={false}
                  columns={[
                    {
                      title: "字段",
                      render: (_, row) =>
                        definitions.find((d) => d.id === row.definition)
                          ?.label || row.definition,
                    },
                    {
                      title: "目标",
                      render: (_, row) => (
                        <>
                          {scopes[row.scopeType]}
                          <br />
                          <Typography.Text type="secondary">
                            {row.scopeId || "全局"}
                          </Typography.Text>
                        </>
                      ),
                    },
                    {
                      title: "接收用户",
                      render: (_, row) =>
                        row.player
                          ? catalog.players.find((p) => p.id === row.player)
                              ?.displayName || row.player
                          : "公共默认（含未来用户）",
                    },
                    {
                      title: "状态",
                      render: (_, row) =>
                        row.status === "revoked"
                          ? "已撤销"
                          : row.mode === "suppress"
                            ? "屏蔽继承"
                            : "已下发",
                    },
                    {
                      title: "操作",
                      render: (_, row) => (
                        <Button
                          disabled={!definitions.length}
                          onClick={() => setDispatching(row)}
                        >
                          查看 / 修改 / 撤销
                        </Button>
                      ),
                    },
                  ]}
                />
                <Space className="admin-extra-form">
                  <Button
                    disabled={page === 1 || request.busy}
                    onClick={() => void load(page - 1)}
                  >
                    上一页
                  </Button>
                  <span>第 {page} 页</span>
                  <Button
                    disabled={!more || request.busy}
                    onClick={() => void load(page + 1)}
                  >
                    下一页
                  </Button>
                </Space>
              </>
            ),
          },
          {
            key: "definitions",
            label: "字段定义",
            children: (
              <>
                <div className="admin-list-toolbar">
                  <Typography.Text type="secondary">
                    最多 100 个命名空间；新字段不需要新增数据库列。
                  </Typography.Text>
                  <Button type="primary" onClick={() => setEditing("new")}>
                    创建字段定义
                  </Button>
                </div>
                <AdminTable<ExtraDefinition>
                  rowKey="id"
                  loading={defs.loading}
                  dataSource={definitions}
                  columns={[
                    { title: "名称", dataIndex: "label" },
                    { title: "字段标识", dataIndex: "key" },
                    {
                      title: "展示方式",
                      render: (_, d) =>
                        d.schema.visibility === "admin"
                          ? "仅管理员可见"
                          : d.schema.renderer === "text"
                            ? "通用文本（已接入）"
                            : "仅传输（前端按需接入）",
                    },
                    {
                      title: "状态",
                      render: (_, d) =>
                        d.status === "active" ? "启用" : "停用",
                    },
                    {
                      title: "操作",
                      render: (_, d) => (
                        <Button onClick={() => setEditing(d)}>编辑定义</Button>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
      {editing && (
        <DefinitionEditor
          initial={editing === "new" ? undefined : editing}
          close={() => setEditing(null)}
          refresh={defs.refresh}
        />
      )}
      {dispatching && (
        <DispatchEditor
          initial={dispatching === "new" ? undefined : dispatching}
          definitions={definitions}
          catalog={catalog}
          close={() => setDispatching(null)}
          refresh={() => load(1)}
        />
      )}
      {inspecting && (
        <InspectEditor catalog={catalog} close={() => setInspecting(false)} />
      )}
    </>
  );
}

function useClose(dirty: boolean, busy: boolean, close: () => void) {
  const { modal } = App.useApp();
  return () => {
    if (busy) return;
    if (dirty) modal.confirm({ title: "放弃未保存的修改？", onOk: close });
    else close();
  };
}
function DefinitionEditor({
  initial,
  close,
  refresh,
}: {
  initial?: ExtraDefinition;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(initial?.revision || 0);
  const request = useConfigRequest();
  const onClose = useClose(dirty, request.busy, close);
  const { message, modal } = App.useApp();
  async function reloadDefinition() {
    const result = await request.run<{ items: ExtraDefinition[] }>(
      "/admin/extra-definitions",
    );
    const latest = result?.items.find((item) => item.id === initial?.id);
    if (!latest) return;
    setRevision(latest.revision);
    form.setFieldsValue({
      key: latest.key,
      label: latest.label,
      status: latest.status,
      scopes: latest.schema.scopes,
      contexts: latest.schema.contexts,
      visibility: latest.schema.visibility,
      renderer: latest.schema.renderer,
      fieldsText: stringify(latest.schema.fields),
      reason: "",
    });
    setDirty(false);
    await refresh();
  }
  async function save() {
    try {
      const data = await form.validateFields();
      let fields;
      try {
        fields = JSON.parse(data.fieldsText);
      } catch {
        request.setError(new Error("字段结构不是有效的 JSON"));
        return;
      }
      const result = await request.run(
        "/admin/extra-definitions",
        {
          ...(initial ? { id: initial.id } : {}),
          key: data.key,
          label: data.label,
          status: data.status,
          expectedRevision: revision,
          reason: data.reason,
          schema: {
            scopes: data.scopes,
            contexts: data.contexts,
            visibility: data.visibility,
            renderer: data.renderer,
            fields,
          },
        },
        true,
      );
      if (result) {
        message.success("字段定义已保存");
        await refresh();
        close();
      }
    } catch {
      /* Visible form errors. */
    }
  }
  return (
    <EditorDrawer
      open
      title={initial ? "编辑字段定义" : "创建字段定义"}
      width={760}
      onClose={onClose}
      closable={!request.busy}
      maskClosable={!request.busy}
      keyboard={!request.busy}
      extra={
        <Space>
          <Button disabled={request.busy} onClick={onClose}>
            关闭
          </Button>
          <Button
            type="primary"
            loading={request.busy}
            onClick={() => void save()}
          >
            保存定义
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        message="已有下发记录后只允许增加可选属性；改变类型、可见性或作用范围请使用新字段标识。"
      />
      {request.error && (
        <Alert
          type="error"
          showIcon
          message={request.error.message}
          description="草稿已保留，可先复制需要的内容；刷新最新定义会替换当前草稿。"
          action={
            initial ? (
              <Button
                disabled={request.busy}
                onClick={() =>
                  modal.confirm({
                    title: "刷新最新定义并替换当前草稿？",
                    onOk: reloadDefinition,
                  })
                }
              >
                刷新最新定义
              </Button>
            ) : undefined
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={request.busy}
        onValuesChange={() => setDirty(true)}
        className="admin-extra-form"
        initialValues={{
          key: initial?.key,
          label: initial?.label,
          status: initial?.status || "active",
          scopes: initial?.schema.scopes || ["global"],
          contexts: initial?.schema.contexts || ["profile"],
          visibility: initial?.schema.visibility || "player",
          renderer: initial?.schema.renderer || "text",
          fieldsText: stringify(initial?.schema.fields || textFields),
        }}
      >
        <div className="admin-field-grid">
          <Field
            name="key"
            label="字段标识"
            rules={fieldRule}
            extra="字母开头，支持字母、数字和下划线；例如 profileGreeting。"
          >
            <Input disabled={!!initial || request.busy} maxLength={60} />
          </Field>
          <Field name="label" label="显示名称" rules={fieldRule}>
            <Input maxLength={100} />
          </Field>
        </div>
        <Field name="scopes" label="允许下发的对象" rules={fieldRule}>
          <Select mode="multiple" options={options(scopes)} />
        </Field>
        <Field name="contexts" label="输出位置" rules={fieldRule}>
          <Select mode="multiple" options={options(contexts)} />
        </Field>
        <div className="admin-field-grid">
          <Field name="visibility" label="可见性">
            <Select
              options={options({ player: "玩家可见", admin: "仅管理员可见" })}
            />
          </Field>
          <Field name="renderer" label="展示方式">
            <Select
              options={options({
                text: "通用文本（直接展示 text 属性）",
                none: "仅传输（前端自行接入）",
              })}
            />
          </Field>
        </div>
        <Field
          name="fieldsText"
          label="字段结构（JSON）"
          rules={fieldRule}
          extra="支持 object、array、string、url、number、boolean；通用文本必须包含必填的 text 字符串属性。"
        >
          <Input.TextArea autoSize={{ minRows: 8, maxRows: 20 }} />
        </Field>
        <Collapse
          items={[
            {
              key: "help",
              label: "字段结构示例与约束",
              children: (
                <Typography.Paragraph>
                  属性放在 properties 中。每项支持
                  label、required、default；文本支持 maxLength 和 enum，数值支持
                  minimum / maximum，数组使用 items。最多嵌套 4 层，每层 50
                  个键，配置最多 16
                  KiB。经验、答案、奖励和权限不能由扩展字段改变。
                </Typography.Paragraph>
              ),
            },
          ]}
        />
        <Field name="status" label="定义状态">
          <Select
            options={options({
              active: "启用",
              disabled: "停用（所有绑定暂不生效）",
            })}
          />
        </Field>
        <Field name="reason" label="操作原因" rules={fieldRule}>
          <Input.TextArea maxLength={1000} />
        </Field>
      </Form>
    </EditorDrawer>
  );
}

function DispatchEditor({
  initial,
  definitions,
  catalog,
  close,
  refresh,
}: {
  initial?: ExtraConfig;
  definitions: ExtraDefinition[];
  catalog: AdminCatalog;
  close: () => void;
  refresh: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const request = useConfigRequest();
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<ExtraPreview | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<{
    requestId: string;
    results: { id?: string; revision?: number; status: string }[];
  } | null>(null);
  const { message } = App.useApp();
  const onClose = useClose(dirty, request.busy, close);
  const definitionId =
    Form.useWatch("definitionId", form) || initial?.definition;
  const definition = definitions.find((d) => d.id === definitionId);
  const scopeType = (Form.useWatch("scopeType", form) ||
    initial?.scopeType ||
    "global") as ExtraScope;
  const audience =
    Form.useWatch("audience", form) ||
    (initial?.player ? "selected" : "public");
  const action = Form.useWatch("action", form) || "value";
  const tasks = useAdminData<{ items: AdminAssignmentSummary[] }>(
    ["assignment", "assignment_level"].includes(scopeType)
      ? "/admin/assignments"
      : "",
  );
  const targetOptions =
    scopeType === "rank"
      ? catalog.ranks.map((r) => ({
          value: r.id,
          label: `${r.order} 级 · ${r.name}`,
        }))
      : scopeType === "question"
        ? catalog.questions.map((q) => ({
            value: q.id,
            label: `${q.title} · v${q.revision}`,
          }))
        : scopeType === "session"
          ? catalog.sessions.map((s) => ({
              value: s.id,
              label: `${s.title} · v${s.revision}`,
            }))
          : scopeType === "assignment"
            ? (tasks.data?.items || []).map((a) => ({
                value: a.id,
                label: `${a.title} · ${catalog.players.find((p) => p.id === a.player)?.displayName || a.player} · ${a.id}`,
              }))
            : catalog.sessions.flatMap((s) =>
                s.levels
                  .filter((l) => l.id)
                  .map((l, i) => ({
                    value: l.id!,
                    label: `${s.title} v${s.revision} · 第 ${i + 1} 关`,
                  })),
              );
  async function prepare() {
    try {
      const data = await form.validateFields();
      const next = {
        definitionId: data.definitionId,
        scopeType: data.scopeType,
        scopeId: data.scopeType === "global" ? "" : data.scopeId,
        assignmentId:
          data.scopeType === "assignment_level" ? data.assignmentId : "",
        audience: data.audience,
        ...(data.audience === "selected" ? { playerIds: data.playerIds } : {}),
        action: data.action,
        ...(data.action === "value" ? { extra: data.extra || {} } : {}),
        reason: data.reason,
      };
      const p = await request.run<ExtraPreview>(
        "/admin/extra-configs/preview",
        next,
      );
      if (p) {
        setPreview(p);
        setPayload(next);
      }
    } catch {
      /* Field validation. */
    }
  }
  async function submit() {
    if (!preview || !payload) return;
    const saved = await request.run<{
      requestId: string;
      results: { id?: string; revision?: number; status: string }[];
    }>(
      "/admin/extra-configs/dispatch",
      { ...payload, expectedVersion: preview.version },
      true,
    );
    if (saved) {
      setResult(saved);
      setDirty(false);
      setPreview(null);
      message.success("配置操作已完成");
      await refresh();
    }
  }
  async function undo() {
    if (!result) return;
    const records = result.results
      .filter((item) => item.id && item.status === "active")
      .map((item) => ({ id: item.id, revision: item.revision }));
    const saved = await request.run(
      "/admin/extra-configs/revoke-batch",
      {
        batchId: result.requestId,
        records,
        reason: `撤销刚才的下发批次 ${result.requestId}`,
      },
      true,
    );
    if (saved) {
      setResult(null);
      message.success("该批次已撤销，恢复继承配置");
      await refresh();
    }
  }
  return (
    <EditorDrawer
      open
      title="下发扩展配置"
      width={780}
      onClose={onClose}
      closable={!request.busy}
      maskClosable={!request.busy}
      keyboard={!request.busy}
      extra={
        <Space wrap>
          <Button onClick={onClose} disabled={request.busy}>
            关闭
          </Button>
          <Button disabled={request.busy} onClick={() => void prepare()}>
            预览影响
          </Button>
          <Button
            type="primary"
            disabled={!preview}
            loading={request.busy}
            onClick={() => void submit()}
          >
            确认{action === "revoke" ? "撤销" : "下发"}
          </Button>
        </Space>
      }
    >
      {request.error && (
        <Alert
          type="error"
          showIcon
          message={request.error.message}
          description="草稿已保留。若发生版本冲突，请重新预览影响；网络中断时可重试原确认操作。"
        />
      )}
      <ErrorNotice error={tasks.error} retry={() => void tasks.refresh()} />
      {result && (
        <Alert
          type="success"
          showIcon
          message="操作已完成"
          description={`批次：${result.requestId}`}
          action={
            result.results.some((r) => r.status === "active") ? (
              <Button disabled={request.busy} onClick={() => void undo()}>
                撤销本批次
              </Button>
            ) : undefined
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={request.busy}
        className="admin-extra-form"
        initialValues={{
          definitionId: initial?.definition,
          scopeType: initial?.scopeType || "global",
          scopeId: initial?.scopeId,
          assignmentId: initial?.assignment,
          audience: initial?.player ? "selected" : "public",
          playerIds: initial?.player ? [initial.player] : [],
          action: initial?.mode || "value",
          extra: initial?.extra || {},
        }}
        onValuesChange={() => {
          setDirty(true);
          setPreview(null);
        }}
      >
        <Field name="definitionId" label="字段定义" rules={fieldRule}>
          <Select
            options={definitions.map((d) => ({
              value: d.id,
              label: `${d.label} · ${d.key}${d.status === "disabled" ? "（已停用，只能撤销）" : ""}`,
            }))}
            onChange={(id) => {
              const firstScope =
                definitions.find((d) => d.id === id)?.schema.scopes[0] ||
                "global";
              form.setFieldsValue({
                extra: {},
                scopeType: firstScope,
                audience: ["assignment", "assignment_level"].includes(
                  firstScope,
                )
                  ? "selected"
                  : "public",
                scopeId: "",
                assignmentId: "",
              });
            }}
          />
        </Field>
        <Field name="scopeType" label="目标范围" rules={fieldRule}>
          <Select
            options={options(scopes).filter(
              (o) =>
                !definition ||
                definition.schema.scopes.includes(o.value as ExtraScope),
            )}
            onChange={(scope) =>
              form.setFieldsValue({
                scopeId: "",
                assignmentId: "",
                ...(["assignment", "assignment_level"].includes(scope)
                  ? { audience: "selected" }
                  : {}),
              })
            }
          />
        </Field>
        {scopeType !== "global" && (
          <Field name="scopeId" label="目标对象" rules={fieldRule}>
            <Select
              showSearch
              optionFilterProp="label"
              options={targetOptions}
            />
          </Field>
        )}
        {scopeType === "assignment_level" && (
          <Field name="assignmentId" label="所属任务" rules={fieldRule}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(tasks.data?.items || []).map((a) => ({
                value: a.id,
                label: `${a.title} · ${catalog.players.find((p) => p.id === a.player)?.displayName || a.player} · ${a.id}`,
              }))}
            />
          </Field>
        )}
        <Field name="audience" label="接收范围" rules={fieldRule}>
          <Select
            options={options({
              selected: "指定用户",
              all: "全部当前有效用户（名单快照）",
              public: "公共默认（包含未来用户）",
            }).map((o) => ({
              ...o,
              disabled:
                ["assignment", "assignment_level"].includes(scopeType) &&
                o.value !== "selected",
            }))}
          />
        </Field>
        {audience === "selected" && (
          <Field name="playerIds" label="接收用户" rules={fieldRule}>
            <Select
              mode="multiple"
              options={catalog.players.map((p) => ({
                value: p.id,
                label: `${p.displayName} · ${p.account}${p.status !== "active" ? "（已停用，将跳过）" : ""}`,
              }))}
            />
          </Field>
        )}
        <Field name="action" label="操作">
          <Select
            options={options({
              value: "设置此范围的完整配置",
              suppress: "屏蔽继承值",
              revoke: "撤销此范围配置，恢复继承",
            })}
          />
        </Field>
        {action === "value" && definition && (
          <ValueFields key={definition.id} spec={definition.schema.fields} />
        )}
        <Field name="reason" label="操作原因" rules={fieldRule}>
          <Input.TextArea maxLength={1000} />
        </Field>
      </Form>
      <Alert
        type="info"
        message="具体对象优先于全局，同一对象下指定用户优先于公共默认。配置整体替换，不按属性拼接。单次最多 100 位用户。"
      />
      {preview && (
        <div className="admin-extra-preview" role="status">
          <Typography.Title level={4}>本次影响</Typography.Title>
          <p>
            {preview.recipientIds.includes("")
              ? "公共默认，包含未来有权访问目标的用户"
              : `${preview.recipientIds.length} 位用户`}
            ；跳过 {preview.skippedIds.length} 位停用用户。
          </p>
          <pre>{stringify(preview.normalizedExtra)}</pre>
          <AdminTable
            rowKey="playerId"
            dataSource={preview.items}
            expandable={{
              rowExpandable: (item) => !!item.before,
              expandedRowRender: (item) => (
                <pre>{stringify(item.before?.extra)}</pre>
              ),
            }}
            columns={[
              {
                title: "用户",
                render: (_, i) =>
                  i.playerId
                    ? catalog.players.find((p) => p.id === i.playerId)
                        ?.displayName || i.playerId
                    : "公共默认",
              },
              {
                title: "现有配置",
                render: (_, i) =>
                  i.before
                    ? `${i.before.status === "revoked" ? "已撤销" : i.before.mode === "suppress" ? "屏蔽" : "有配置"} · 版本 ${i.before.revision}`
                    : "未配置",
              },
            ]}
          />
        </div>
      )}
    </EditorDrawer>
  );
}

function InspectEditor({
  catalog,
  close,
}: {
  catalog: AdminCatalog;
  close: () => void;
}) {
  const [form] = Form.useForm();
  const request = useConfigRequest();
  const [result, setResult] = useState<
    (GameExtra & { sources: unknown }) | null
  >(null);
  const context = Form.useWatch("context", form) || "profile";
  const tasks = useAdminData<{ items: AdminAssignmentSummary[] }>(
    context !== "profile" ? "/admin/assignments" : "",
  );
  const player = Form.useWatch("playerId", form);
  const assignment = Form.useWatch("assignmentId", form);
  const session = catalog.sessions.find(
    (s) => s.id === tasks.data?.items.find((a) => a.id === assignment)?.session,
  );
  async function inspect() {
    try {
      const data = await form.validateFields();
      const response = await request.run<GameExtra & { sources: unknown }>(
        "/admin/extra-configs/inspect",
        {
          playerId: data.playerId,
          context: data.context,
          ...(context !== "profile" ? { assignmentId: data.assignmentId } : {}),
          ...(context === "level"
            ? { sessionLevelId: data.sessionLevelId }
            : {}),
        },
      );
      if (response) setResult(response);
    } catch {
      /* Visible form errors. */
    }
  }
  return (
    <EditorDrawer
      open
      title="用户生效值与来源"
      width={720}
      onClose={close}
      extra={
        <Button
          type="primary"
          loading={request.busy}
          onClick={() => void inspect()}
        >
          查看生效值
        </Button>
      }
    >
      <Alert
        type="info"
        message="展示字段的当前解析结果；此预览不会授予玩家入场或解锁权限。未解锁关卡的值只供管理员核对。"
      />
      {request.error && <Alert type="error" message={request.error.message} />}
      <ErrorNotice error={tasks.error} retry={() => void tasks.refresh()} />
      <Form
        form={form}
        layout="vertical"
        className="admin-extra-form"
        disabled={request.busy}
        initialValues={{ context: "profile" }}
        onValuesChange={() => setResult(null)}
      >
        <Field name="playerId" label="用户" rules={fieldRule}>
          <Select
            options={catalog.players.map((p) => ({
              value: p.id,
              label: `${p.displayName} · ${p.account}`,
            }))}
            onChange={() =>
              form.setFieldsValue({ assignmentId: "", sessionLevelId: "" })
            }
          />
        </Field>
        <Field name="context" label="输出位置">
          <Select options={options(contexts)} />
        </Field>
        {context !== "profile" && (
          <Field name="assignmentId" label="任务" rules={fieldRule}>
            <Select
              options={(tasks.data?.items || [])
                .filter((a) => a.player === player)
                .map((a) => ({ value: a.id, label: `${a.title} · ${a.id}` }))}
              onChange={() => form.setFieldValue("sessionLevelId", "")}
            />
          </Field>
        )}
        {context === "level" && (
          <Field name="sessionLevelId" label="关卡" rules={fieldRule}>
            <Select
              options={(session?.levels || []).map((l, i) => ({
                value: l.id,
                label: `第 ${i + 1} 关`,
              }))}
            />
          </Field>
        )}
      </Form>
      {result && (
        <div className="admin-extra-preview">
          <Typography.Title level={4}>玩家可见结果</Typography.Title>
          {result.extraDisplay?.map((item) => (
            <Typography.Paragraph key={item.key}>
              <strong>{item.label}</strong>
              <br />
              {item.text}
            </Typography.Paragraph>
          ))}
          <pre>{stringify(result)}</pre>
        </div>
      )}
    </EditorDrawer>
  );
}
