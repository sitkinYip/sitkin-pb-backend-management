import { LivePreview } from "./preview/LivePreview";
import { AdminTable, EditorDrawer, Field, PageCard } from "./ui";
import { PlayerTitleEditor } from "./PlayerTitleEditor";
import { auditActionLabels, entityLabels } from "./display-labels";
import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { TextSyntaxHelp } from "../components/TextSyntaxHelp";
import type {
  AdminCatalog,
  AssignmentBatchResult,
  AdminAssignment,
  AdminAssignmentSummary,
  GamePlayer,
  GameReward,
  GameRank,
} from "./contracts";
import {
  ErrorNotice,
  fieldRule,
  playerName,
  statusLabels,
  useAdminCommand,
  useAdminData,
} from "./shared";

type Props = { catalog: AdminCatalog; refresh: () => Promise<void> };
export function OperationPage({
  section,
}: {
  section:
    | "players"
    | "dispatch"
    | "progress"
    | "grants"
    | "notifications"
    | "ranks"
    | "audit";
}) {
  const query = useAdminData<AdminCatalog>("/admin/catalog");
  return (
    <>
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      {query.data ? (
        section === "players" ? (
          <Players {...{ catalog: query.data, refresh: query.refresh }} />
        ) : section === "dispatch" ? (
          <Dispatch {...{ catalog: query.data, refresh: query.refresh }} />
        ) : section === "progress" ? (
          <Progress catalog={query.data} />
        ) : section === "grants" ? (
          <Grants catalog={query.data} />
        ) : section === "notifications" ? (
          <Notifications catalog={query.data} />
        ) : section === "ranks" ? (
          <Ranks {...{ catalog: query.data, refresh: query.refresh }} />
        ) : (
          <Audit />
        )
      ) : (
        <Card loading={query.loading} />
      )}
    </>
  );
}
function Players({ catalog, refresh }: Props) {
  const [titlePlayer, setTitlePlayer] = useState<GamePlayer | null>(null);
  const [search, setSearch] = useState("");
  const [form] = Form.useForm(),
    [actionForm] = Form.useForm();
  const [createOpen, setCreateOpen] = useState(false),
    [action, setAction] = useState<{ id: string; type: string } | null>(null);
  const { run, busy } = useAdminCommand(refresh);
  const prepare = (row: GamePlayer, type: string) => {
    actionForm.resetFields();
    setAction({ id: row.id, type });
  };
  return (
    <PageCard
      title="玩家管理"
      extra={
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setCreateOpen(true);
          }}
        >
          创建玩家
        </Button>
      }
    >
      <div className="admin-list-toolbar">
        <Input.Search
          aria-label="搜索玩家"
          placeholder="搜索昵称或登录账号"
          allowClear
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <AdminTable<GamePlayer & { status: string }>
        rowKey="id"
        dataSource={catalog.players.filter((player) =>
          `${player.displayName} ${player.account}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )}
        scroll={{ x: 850 }}
        columns={[
          { title: "登录账号", dataIndex: "account" },
          { title: "昵称", dataIndex: "displayName" },
          {
            title: "等级 / 经验",
            render: (_, row: GamePlayer) =>
              `${row.level.order} 级 · ${row.totalXp} EXP`,
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => (
              <Tag color={value === "active" ? "green" : "default"}>
                {value === "active" ? "有效" : "停用"}
              </Tag>
            ),
          },
          {
            title: "操作",
            render: (_, row: GamePlayer & { status: string }) => (
              <Space wrap>
                <Button
                  disabled={!catalog.capabilities?.playerTitles}
                  title={
                    !catalog.capabilities?.playerTitles
                      ? "后端尚未支持专属头衔"
                      : undefined
                  }
                  onClick={() => setTitlePlayer(row)}
                >
                  专属头衔
                </Button>
                <Button onClick={() => prepare(row, "reset_password")}>
                  重置密码
                </Button>
                <Button onClick={() => prepare(row, "adjust_xp")}>
                  调整经验
                </Button>
                <Button
                  danger={row.status === "active"}
                  onClick={() =>
                    prepare(row, row.status === "active" ? "disable" : "enable")
                  }
                >
                  {row.status === "active" ? "停用" : "启用"}
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="创建玩家"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={busy}
        forceRender
      >
        <Form
          name="player-create"
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (await run("/admin/players", values)) setCreateOpen(false);
          }}
        >
          <Field
            name="account"
            label="唯一登录账号"
            rules={[
              {
                required: true,
                pattern: /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}$/,
                message: "3～32 位字母、数字、点、下划线或短横线",
              },
            ]}
          >
            <Input autoComplete="off" />
          </Field>
          <Field
            name="displayName"
            label="显示昵称（可重名）"
            rules={fieldRule}
          >
            <Input maxLength={40} />
          </Field>
          <Field
            name="password"
            label="临时密码"
            rules={[{ required: true, min: 10, max: 71 }]}
          >
            <Input.Password autoComplete="new-password" />
          </Field>
          <Alert
            type="info"
            message="请将临时密码交给玩家；玩家首次登录必须改密，系统不会保存可查看的明文密码。"
          />
        </Form>
      </Modal>
      {titlePlayer && (
        <PlayerTitleEditor
          key={titlePlayer.id}
          player={titlePlayer}
          ranks={catalog.ranks}
          refresh={refresh}
          onClose={() => setTitlePlayer(null)}
        />
      )}
      <Modal
        title={
          action
            ? (
                {
                  reset_password: "重置玩家密码",
                  adjust_xp: "调整玩家经验",
                  disable: "停用玩家账号",
                  enable: "启用玩家账号",
                } as Record<string, string>
              )[action.type]
            : "管理操作"
        }
        open={!!action}
        onCancel={() => setAction(null)}
        onOk={() => actionForm.submit()}
        confirmLoading={busy}
        forceRender
      >
        <Form
          name="player-action"
          form={actionForm}
          layout="vertical"
          onFinish={async (values) => {
            if (
              action &&
              (await run(`/admin/players/${action.id}/actions`, {
                ...values,
                action: action.type,
              }))
            )
              setAction(null);
          }}
        >
          {action?.type === "reset_password" && (
            <Field
              name="password"
              label="新的临时密码"
              rules={[{ required: true, min: 10, max: 71 }]}
            >
              <Input.Password autoComplete="new-password" />
            </Field>
          )}
          {action?.type === "adjust_xp" && (
            <Field
              name="delta"
              label="经验变化（正数增加，负数扣回）"
              rules={fieldRule}
            >
              <InputNumber min={-1000000} max={1000000} />
            </Field>
          )}
          <Field name="reason" label="操作原因" rules={fieldRule}>
            <Input.TextArea />
          </Field>
        </Form>
      </Modal>
    </PageCard>
  );
}
function Dispatch({ catalog, refresh }: Props) {
  const [form] = Form.useForm();
  const { run, busy } = useAdminCommand(refresh),
    { modal } = App.useApp();
  const target = Form.useWatch("target", form),
    ids: string[] = Form.useWatch("playerIds", form) || [];
  const [result, setResult] = useState<AssignmentBatchResult | null>(null);
  const count =
    target === "all"
      ? catalog.players.filter((p) => p.status === "active").length
      : ids.length;
  return (
    <PageCard title="场次下发">
      <Alert
        type="info"
        showIcon
        message="支持指定用户或当前所有有效用户。已进行中的同场任务会跳过，已完成用户默认不再下发；以后新建的用户不会自动补发。"
        style={{ marginBottom: 24 }}
      />
      <Form
        name="dispatch"
        form={form}
        layout="vertical"
        initialValues={{
          target: "selected",
          reissueCompleted: false,
          order: 0,
        }}
        onFinish={(values) => {
          modal.confirm({
            title: `确认向 ${count} 位玩家下发？`,
            content: values.reissueCompleted
              ? "你已选择对完成过该场次的用户重新下发，新的一次游玩会照常发经验和奖品。"
              : "已完成或已有未结束任务的玩家将跳过，提交后显示详细结果。",
            onOk: async () => {
              const outcome = await run<AssignmentBatchResult>(
                "/admin/assignments",
                values,
              );
              if (outcome) setResult(outcome);
            },
          });
        }}
      >
        <Field name="sessionId" label="已发布场次" rules={fieldRule}>
          <Select
            showSearch
            optionFilterProp="label"
            options={catalog.sessions
              .filter((s) => s.status === "published")
              .map((s) => ({
                value: s.id,
                label: `${s.title} · v${s.revision}`,
              }))}
          />
        </Field>
        <Field name="target" label="下发范围" rules={fieldRule}>
          <Select
            options={[
              { value: "selected", label: "指定用户" },
              {
                value: "all",
                label: `所有有效用户（当前 ${catalog.players.filter((p) => p.status === "active").length} 人）`,
              },
            ]}
          />
        </Field>
        {target === "selected" && (
          <Field name="playerIds" label="选择玩家" rules={fieldRule}>
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={catalog.players
                .filter((p) => p.status === "active")
                .map((p) => ({
                  value: p.id,
                  label: `${p.displayName}（${p.account}）· ${p.level.order} 级`,
                }))}
            />
          </Field>
        )}
        <div className="admin-field-grid">
          <Field
            name="startsAt"
            label="开始时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Field>
          <Field
            name="endsAt"
            label="截止时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Field>
          <Field name="order" label="展示顺序">
            <InputNumber min={0} />
          </Field>
        </div>
        <Typography.Paragraph type="secondary">
          时间按当前设备时区显示：
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
          。不符合等级的用户也可提前安排，首次入场时再检查资格。
        </Typography.Paragraph>
        <Field
          name="reissueCompleted"
          label="对已完成用户重新下发"
          valuePropName="checked"
        >
          <Switch />
        </Field>
        <Button
          type="primary"
          htmlType="submit"
          loading={busy}
          disabled={!count}
        >
          确认下发
        </Button>
      </Form>
      {result && (
        <>
          <Typography.Title level={4}>本次下发结果</Typography.Title>
          <AdminTable
            rowKey="playerId"
            dataSource={result.results}
            pagination={false}
            columns={[
              {
                title: "玩家",
                dataIndex: "playerId",
                render: (id) => playerName(catalog, id),
              },
              {
                title: "结果",
                dataIndex: "status",
                render: (value) =>
                  value === "assigned" ? "已下发" : statusLabels[value],
              },
              { title: "任务 ID", dataIndex: "assignmentId" },
            ]}
          />
        </>
      )}
    </PageCard>
  );
}
function Progress({ catalog }: { catalog: AdminCatalog }) {
  const query = useAdminData<{ items: AdminAssignmentSummary[] }>(
    "/admin/assignments",
  );
  const [selected, setSelected] = useState("");
  const detail = useAdminData<AdminAssignment>(
    selected ? `/admin/assignments/${selected}` : "",
  );
  const submissions = useAdminData<{
    items: {
      id: string;
      sessionLevel: string;
      answer: string;
      result: string;
      submittedAt: string;
    }[];
  }>(selected ? `/admin/assignments/${selected}/submissions` : "");
  const refresh = async () => {
    await Promise.all([
      query.refresh(),
      detail.refresh(),
      submissions.refresh(),
    ]);
  };
  const { run, busy } = useAdminCommand(refresh);
  const [form] = Form.useForm();
  const [action, setAction] = useState<{
    id: string;
    type: string;
    level?: string;
    clue?: string;
  } | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [query.refresh, detail.refresh, submissions.refresh]);
  const prepare = (id: string, type: string, level?: string, clue?: string) => {
    form.resetFields();
    setAction({ id, type, level, clue });
  };
  const selectedSession = catalog.sessions.find(
    (s) => s.id === detail.data?.session,
  );
  return (
    <PageCard
      title="现场进度"
      extra={<Button onClick={() => void refresh()}>刷新</Button>}
    >
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <AdminTable
        rowKey="id"
        loading={query.loading && !query.data}
        dataSource={query.data?.items || []}
        scroll={{ x: 850 }}
        columns={[
          {
            title: "玩家",
            dataIndex: "player",
            render: (id) => playerName(catalog, id),
          },
          { title: "场次", dataIndex: "title" },
          {
            title: "状态",
            dataIndex: "status",
            render: (value, row: AdminAssignmentSummary) => (
              <Space>
                <Tag>{statusLabels[value]}</Tag>
                {row.sessionStatus === "archived" && <Tag>所属场次已下线</Tag>}
              </Space>
            ),
          },
          {
            title: "进度",
            render: (_, row: AdminAssignmentSummary) =>
              `${row.completedLevels}/${row.totalLevels}`,
          },
          {
            title: "操作",
            render: (_, row: AdminAssignmentSummary) => (
              <Space>
                <Button onClick={() => setSelected(row.id)}>查看 / 协助</Button>
                <Button
                  disabled={
                    row.sessionStatus !== "published" ||
                    !["assigned", "active"].includes(row.status)
                  }
                  onClick={() => prepare(row.id, "extend")}
                >
                  延时
                </Button>
                <Button
                  danger
                  disabled={
                    row.sessionStatus !== "published" ||
                    !["assigned", "active"].includes(row.status)
                  }
                  onClick={() => prepare(row.id, "cancel")}
                >
                  撤回
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <EditorDrawer
        title="游玩详情与现场协助"
        width={900}
        open={!!selected}
        onClose={() => setSelected("")}
      >
        <ErrorNotice error={detail.error} retry={() => void detail.refresh()} />
        {detail.data && (
          <>
            <Alert
              type="info"
              style={{ marginBottom: 16 }}
              message={
                detail.data.sessionStatus === "archived"
                  ? "场次已下线：旧进度和结算保留，不再允许推进。奖品领取与核销仍可正常处理。"
                  : "后台题面为题库当前配置，历史提交与判定不重算。"
              }
              description={
                detail.data.sessionStatus === "archived"
                  ? "题面显示当前配置；题目修正后可能与当时不同，请结合原始答题记录和修改审计查看。"
                  : undefined
              }
            />
            <Descriptions
              items={[
                {
                  key: "player",
                  label: "玩家",
                  children: playerName(catalog, detail.data.player),
                },
                { key: "title", label: "场次", children: detail.data.title },
                {
                  key: "status",
                  label: "状态",
                  children: statusLabels[detail.data.status],
                },
              ]}
            />
            <AdminTable
              rowKey="id"
              dataSource={detail.data.levels}
              pagination={false}
              columns={[
                { title: "关卡", dataIndex: "position" },
                {
                  title: "当前题目",
                  render: (_, row) => row.question?.title || "—",
                },
                { title: "最近原始回答", dataIndex: "lastAnswer" },
                {
                  title: "状态",
                  render: (_, row) =>
                    row.completedAt
                      ? "已完成"
                      : row.locked
                        ? "锁定"
                        : row.cooldownUntil
                          ? "可能冷却中"
                          : "待答",
                },
                { title: "错误次数", dataIndex: "wrongCount" },
                {
                  title: "操作",
                  render: (_, row) => (
                    <Space>
                      <Button
                        disabled={
                          !!row.completedAt ||
                          detail.data?.status !== "active" ||
                          detail.data?.sessionStatus !== "published"
                        }
                        onClick={() =>
                          prepare(selected, "clear_penalty", row.id)
                        }
                      >
                        解除惩罚
                      </Button>
                      <Button
                        disabled={
                          !!row.completedAt ||
                          detail.data?.status !== "active" ||
                          detail.data?.sessionStatus !== "published"
                        }
                        onClick={() =>
                          prepare(selected, "complete_level", row.id)
                        }
                      >
                        人工通过
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
            <Typography.Title level={5}>手动解锁线索</Typography.Title>
            <Space wrap>
              {selectedSession?.clues.map((clue, index) => (
                <Button
                  key={clue.id}
                  disabled={
                    detail.data?.sessionStatus !== "published" ||
                    detail.data?.status === "cancelled" ||
                    detail.data?.clues.some((c) => c.id === clue.id) ||
                    !detail.data?.startedAt
                  }
                  onClick={() =>
                    prepare(selected, "unlock_clue", undefined, clue.id)
                  }
                >
                  {clue.content.title || `线索 ${index + 1}`}
                </Button>
              ))}
            </Space>
            <Typography.Title level={5}>答题记录</Typography.Title>
            <ErrorNotice
              error={submissions.error}
              retry={() => void submissions.refresh()}
            />
            <AdminTable
              rowKey="id"
              dataSource={submissions.data?.items || []}
              columns={[
                { title: "回答", dataIndex: "answer" },
                {
                  title: "结果",
                  dataIndex: "result",
                  render: (value) => statusLabels[value] || value,
                },
                { title: "服务端时间", dataIndex: "submittedAt" },
              ]}
            />
          </>
        )}
      </EditorDrawer>
      <Modal
        title="确认现场操作"
        open={!!action}
        forceRender
        confirmLoading={busy}
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
      >
        <Form
          name="assignment-action"
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (
              action &&
              (await run(`/admin/assignments/${action.id}/actions`, {
                ...values,
                action: action.type,
                sessionLevelId: action.level,
                clueId: action.clue,
              }))
            )
              setAction(null);
          }}
        >
          {action?.type === "extend" && (
            <Field
              name="endsAt"
              label="新的截止时间（留空取消截止）"
              getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
              normalize={(v) => v?.toISOString() || ""}
            >
              <DatePicker showTime />
            </Field>
          )}
          {action?.type === "complete_level" && (
            <Alert
              type="warning"
              message="人工通过会正常结算经验和奖品，请确认现场情况。"
            />
          )}
          <Field name="reason" label="操作原因" rules={fieldRule}>
            <Input.TextArea />
          </Field>
        </Form>
      </Modal>
    </PageCard>
  );
}
function Grants({ catalog }: { catalog: AdminCatalog }) {
  const query = useAdminData<{ items: GameReward[] }>("/admin/grants"),
    { run, busy } = useAdminCommand(query.refresh);
  const [form] = Form.useForm(),
    [manualForm] = Form.useForm(),
    [manualOpen, setManualOpen] = useState(false);
  const [action, setAction] = useState<{
    row: GameReward;
    type: string;
  } | null>(null);
  const prepare = (row: GameReward, type: string) => {
    form.resetFields();
    form.setFieldsValue({ claimDetails: row.claimDetails });
    setAction({ row, type });
  };
  return (
    <PageCard
      title="奖品核销"
      extra={
        <Space>
          <Button onClick={() => void query.refresh()}>刷新</Button>
          <Button
            onClick={() => {
              manualForm.resetFields();
              manualForm.setFieldValue("quantity", 1);
              setManualOpen(true);
            }}
          >
            人工发奖
          </Button>
        </Space>
      }
    >
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <AdminTable
        rowKey="id"
        dataSource={query.data?.items || []}
        scroll={{ x: 850 }}
        columns={[
          {
            title: "玩家",
            dataIndex: "player",
            render: (id) => playerName(catalog, id),
          },
          {
            title: "奖品",
            render: (_, row: GameReward) =>
              `${row.snapshot.name} × ${row.quantity}`,
          },
          {
            title: "状态",
            dataIndex: "status",
            render: (value) => <Tag>{statusLabels[value]}</Tag>,
          },
          { title: "核销时间", dataIndex: "redeemedAt" },
          {
            title: "操作",
            render: (_, row: GameReward) => (
              <Space wrap>
                <Button
                  type="primary"
                  disabled={row.status !== "available"}
                  onClick={() => prepare(row, "redeem")}
                >
                  核销
                </Button>
                <Button
                  disabled={row.status !== "available"}
                  onClick={() => prepare(row, "claim_details")}
                >
                  专属领取信息
                </Button>
                <Button
                  disabled={row.status !== "redeemed"}
                  onClick={() => prepare(row, "undo_redeem")}
                >
                  撤销误核销
                </Button>
                <Button
                  danger
                  disabled={row.status !== "available"}
                  onClick={() => prepare(row, "void")}
                >
                  作废
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        open={!!action}
        title={
          action?.type === "claim_details" ? "本次领取信息" : "奖品操作确认"
        }
        forceRender
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
        confirmLoading={busy}
      >
        <Form
          name="grant-action"
          form={form}
          layout="vertical"
          onFinish={async (values) => {
            if (
              action &&
              (await run(`/admin/grants/${action.row.id}/actions`, {
                action: action.type,
                reason: values.reason,
                ...(action.type === "claim_details"
                  ? { claimDetails: values.claimDetails }
                  : {}),
              }))
            )
              setAction(null);
          }}
        >
          <Typography.Paragraph>
            {action &&
              `${playerName(catalog, action.row.player)} · ${action.row.snapshot.name}`}
          </Typography.Paragraph>
          {action?.type === "claim_details" && (
            <Field
              name="claimDetails"
              label="仅此用户可见的取件码 / 领取说明"
              extra={<TextSyntaxHelp />}
            >
              <Input.TextArea rows={4} />
            </Field>
          )}
          <Field name="reason" label="核销备注 / 操作原因" rules={fieldRule}>
            <Input.TextArea />
          </Field>
        </Form>
      </Modal>
      <Modal
        open={manualOpen}
        title="人工发奖"
        forceRender
        onCancel={() => setManualOpen(false)}
        onOk={() => manualForm.submit()}
        confirmLoading={busy}
      >
        <Form
          name="manual-grant"
          form={manualForm}
          layout="vertical"
          onFinish={async (values) => {
            if (await run("/admin/grants", values)) setManualOpen(false);
          }}
        >
          <Field name="playerId" label="玩家" rules={fieldRule}>
            <Select
              options={catalog.players.map((p) => ({
                value: p.id,
                label: `${p.displayName}（${p.account}）`,
              }))}
            />
          </Field>
          <Field name="rewardId" label="奖品" rules={fieldRule}>
            <Select
              options={catalog.rewards
                .filter((r) => r.active)
                .map((r) => ({ value: r.id, label: r.name }))}
            />
          </Field>
          <Field name="quantity" label="数量" rules={fieldRule}>
            <InputNumber min={1} max={100} />
          </Field>
          <Field name="reason" label="发奖原因" rules={fieldRule}>
            <Input.TextArea />
          </Field>
        </Form>
      </Modal>
    </PageCard>
  );
}
function Notifications({ catalog }: { catalog: AdminCatalog }) {
  const query = useAdminData<{
      items: {
        id: string;
        title: string;
        content: string;
        status: string;
        sentAt: string;
      }[];
    }>("/admin/notifications"),
    { run, busy } = useAdminCommand(query.refresh);
  const [form] = Form.useForm(),
    [withdrawForm] = Form.useForm();
  const target = Form.useWatch("target", form);
  const messagePurpose = Form.useWatch("messagePurpose", form);
  const [withdraw, setWithdraw] = useState("");
  return (
    <PageCard title="通知管理">
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <LivePreview form={form} kind="notification">
      <Form
        name="notification-create"
        form={form}
        layout="vertical"
        initialValues={{ target: "selected", messagePurpose: "announcement" }}
        onFinish={async (values) => {
          if (await run("/admin/notifications", values)) form.resetFields();
        }}
      >
        <Field name="messagePurpose" label="通知用途" rules={fieldRule}>
          <Select
            onChange={(purpose) => {
              if (purpose === "journey") form.setFieldValue("target", "session");
            }}
            options={[
              { value: "journey", label: "场次动态 · 剧情来信／关卡消息" },
              { value: "announcement", label: "平台公告／运营推广" },
            ]}
          />
        </Field>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message={messagePurpose === "journey" ? "关联具体场次的动态" : "平台公告与运营推广"}
          description={messagePurpose === "journey"
            ? "应用内发给该场次的参与者；系统推送只发给主动订阅且允许通知的玩家。获批后使用订阅分类，取消订阅不影响应用内收信。"
            : "使用 MARKETING 分类，受华为营销通知额度限制。请勿把推广内容作为场次动态发送。"}
        />
        <Field name="target" label="接收范围" rules={fieldRule}>
          <Select
            options={messagePurpose === "journey" ? [
              { value: "session", label: "某场次的参与者" },
            ] : [
              { value: "selected", label: "指定用户" },
              { value: "all", label: "当前所有有效用户" },
              { value: "session", label: "某场次的参与者" },
            ]}
          />
        </Field>
        {target === "selected" && (
          <Field name="playerIds" label="玩家" rules={fieldRule}>
            <Select
              mode="multiple"
              options={catalog.players.map((p) => ({
                value: p.id,
                label: `${p.displayName}（${p.account}）`,
              }))}
            />
          </Field>
        )}
        {target === "session" && (
          <Field name="sessionId" label="场次版本" rules={fieldRule}>
            <Select
              options={catalog.sessions.map((s) => ({
                value: s.id,
                label: `${s.title} v${s.revision}`,
              }))}
            />
          </Field>
        )}
        <Field name="title" label="通知标题" rules={fieldRule}>
          <Input />
        </Field>
        <Field
          name="content"
          label="正文（支持原有富文本标记）"
          rules={fieldRule}
          extra={<TextSyntaxHelp />}
        >
          <Input.TextArea rows={4} />
        </Field>
        <div className="admin-field-grid">
          <Field name="popupTitle" label="弹窗标题">
            <Input />
          </Field>
          <Field name="buttonText" label="确认按钮文字">
            <Input />
          </Field>
          <Field
            name="expiresAt"
            label="过期时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Field>
        </div>
        <Button type="primary" htmlType="submit" loading={busy}>
          发送通知
        </Button>
      </Form>
      </LivePreview>
      <AdminTable
        style={{ marginTop: 32 }}
        rowKey="id"
        dataSource={query.data?.items || []}
        columns={[
          { title: "标题", dataIndex: "title" },
          { title: "时间", dataIndex: "sentAt" },
          {
            title: "状态",
            dataIndex: "status",
            render: (v) => statusLabels[v],
          },
          {
            title: "操作",
            render: (_, row) => (
              <Button
                disabled={row.status !== "sent"}
                onClick={() => {
                  withdrawForm.resetFields();
                  setWithdraw(row.id);
                }}
              >
                撤回
              </Button>
            ),
          },
        ]}
      />
      <Modal
        title="撤回通知"
        open={!!withdraw}
        forceRender
        onCancel={() => setWithdraw("")}
        onOk={() => withdrawForm.submit()}
        confirmLoading={busy}
      >
        <Form
          name="notification-withdraw"
          form={withdrawForm}
          onFinish={async (values) => {
            if (await run(`/admin/notifications/${withdraw}/withdraw`, values))
              setWithdraw("");
          }}
        >
          <Field name="reason" label="原因" rules={fieldRule}>
            <Input.TextArea />
          </Field>
        </Form>
      </Modal>
    </PageCard>
  );
}
function Ranks({ catalog, refresh }: Props) {
  const [form] = Form.useForm(),
    { run, busy } = useAdminCommand(refresh),
    { modal } = App.useApp();
  useEffect(() => {
    form.setFieldsValue({ levels: catalog.ranks });
  }, [catalog.ranks, form]);
  return (
    <PageCard title="等级与经验阈值">
      <Alert
        type="info"
        message="阈值使用累计经验，第一级从 0 开始且严格递增。修改影响尚未入场的资格，不中断已开始场次。"
        style={{ marginBottom: 24 }}
      />
      <Form
        name="rank-editor"
        form={form}
        layout="vertical"
        onFinish={(values) => {
          const changes = catalog.players.filter((p) => {
            const achieved = (values.levels as GameRank[]).filter(
              (level) => level.minTotalXp <= p.totalXp,
            );
            return achieved.length !== p.level.order;
          });
          modal.confirm({
            title: `确认更新等级配置？当前有 ${changes.length} 位玩家等级会改变`,
            content:
              changes
                .map((p) => `${p.displayName}（${p.account}）`)
                .join("、") || "当前没有玩家等级发生变化。",
            onOk: async () => {
              await run("/admin/ranks", values);
            },
          });
        }}
      >
        <Form.List name="levels">
          {(fields, { add }) => (
            <>
              {fields.map(({ key, name }) => (
                <div className="admin-rank-row" key={key}>
                  <Field name={[name, "id"]} hidden>
                    <Input />
                  </Field>
                  <Typography.Text>{name + 1} 级</Typography.Text>
                  <Field
                    name={[name, "name"]}
                    label="等级名称"
                    rules={fieldRule}
                  >
                    <Input />
                  </Field>
                  <Field
                    name={[name, "minTotalXp"]}
                    label="累计经验下限"
                    rules={fieldRule}
                  >
                    <InputNumber min={0} max={1000000} />
                  </Field>
                </div>
              ))}
              <Button
                onClick={() =>
                  add({ name: `旅行者 ${fields.length + 1}`, minTotalXp: 0 })
                }
              >
                增加更高等级
              </Button>
            </>
          )}
        </Form.List>
        <Field
          style={{ marginTop: 20 }}
          name="reason"
          label="调整原因"
          rules={fieldRule}
        >
          <Input.TextArea />
        </Field>
        <Button type="primary" htmlType="submit" loading={busy}>
          预览影响并保存
        </Button>
      </Form>
    </PageCard>
  );
}
function Audit() {
  const query = useAdminData<{
    items: {
      id: string;
      action: string;
      actor: string;
      entityType: string;
      entityId: string;
      reason: string;
      created: string;
      safeDiff?: Record<string, unknown>;
    }[];
  }>("/admin/audit");
  return (
    <PageCard
      title="管理操作审计"
      extra={<Button onClick={() => void query.refresh()}>刷新</Button>}
    >
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <AdminTable
        rowKey="id"
        scroll={{ x: 900 }}
        dataSource={query.data?.items || []}
        expandable={{
          columnTitle: "变更",
          rowExpandable: (row) =>
            !!row.safeDiff && Object.keys(row.safeDiff).length > 0,
          expandedRowRender: (row) => (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                maxHeight: 400,
                overflow: "auto",
              }}
            >
              {JSON.stringify(row.safeDiff, null, 2)}
            </pre>
          ),
        }}
        columns={[
          { title: "时间", dataIndex: "created" },
          {
            title: "操作",
            dataIndex: "action",
            width: 180,
            render: (value) => (
              <span title={value}>{auditActionLabels[value] || value}</span>
            ),
          },
          { title: "操作人 ID", dataIndex: "actor" },
          {
            title: "对象类型",
            dataIndex: "entityType",
            render: (value) => (
              <span title={value}>{entityLabels[value] || value}</span>
            ),
          },
          { title: "对象 ID", dataIndex: "entityId" },
          { title: "原因", dataIndex: "reason" },
        ]}
      />
    </PageCard>
  );
}
