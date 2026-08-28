import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import type {
  AdminCatalog,
  AssignmentBatchResult,
  GameAssignment,
  GameAssignmentSummary,
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
    <Card
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
      <Table<GamePlayer & { status: string }>
        rowKey="id"
        dataSource={catalog.players}
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
          <Form.Item
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
          </Form.Item>
          <Form.Item
            name="displayName"
            label="显示昵称（可重名）"
            rules={fieldRule}
          >
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item
            name="password"
            label="临时密码"
            rules={[{ required: true, min: 10, max: 71 }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Alert
            type="info"
            message="请将临时密码交给玩家；玩家首次登录必须改密，系统不会保存可查看的明文密码。"
          />
        </Form>
      </Modal>
      <Modal
        title="管理操作"
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
            <Form.Item
              name="password"
              label="新的临时密码"
              rules={[{ required: true, min: 10, max: 71 }]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}
          {action?.type === "adjust_xp" && (
            <Form.Item
              name="delta"
              label="经验变化（正数增加，负数扣回）"
              rules={fieldRule}
            >
              <InputNumber min={-1000000} max={1000000} />
            </Form.Item>
          )}
          <Form.Item name="reason" label="操作原因" rules={fieldRule}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
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
    <Card title="场次下发">
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
        <Form.Item name="sessionId" label="已发布场次" rules={fieldRule}>
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
        </Form.Item>
        <Form.Item name="target" label="下发范围" rules={fieldRule}>
          <Select
            options={[
              { value: "selected", label: "指定用户" },
              {
                value: "all",
                label: `所有有效用户（当前 ${catalog.players.filter((p) => p.status === "active").length} 人）`,
              },
            ]}
          />
        </Form.Item>
        {target === "selected" && (
          <Form.Item name="playerIds" label="选择玩家" rules={fieldRule}>
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
          </Form.Item>
        )}
        <Space wrap>
          <Form.Item
            name="startsAt"
            label="开始时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Form.Item>
          <Form.Item
            name="endsAt"
            label="截止时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Form.Item>
          <Form.Item name="order" label="展示顺序">
            <InputNumber min={0} />
          </Form.Item>
        </Space>
        <Typography.Paragraph type="secondary">
          时间按当前设备时区显示：
          {Intl.DateTimeFormat().resolvedOptions().timeZone}
          。不符合等级的用户也可提前安排，首次入场时再检查资格。
        </Typography.Paragraph>
        <Form.Item
          name="reissueCompleted"
          label="对已完成用户重新下发"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
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
          <Table
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
    </Card>
  );
}
function Progress({ catalog }: { catalog: AdminCatalog }) {
  const query = useAdminData<{ items: GameAssignmentSummary[] }>(
    "/admin/assignments",
  );
  const [selected, setSelected] = useState("");
  const detail = useAdminData<GameAssignment>(
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
    <Card
      title="现场进度"
      extra={<Button onClick={() => void refresh()}>刷新</Button>}
    >
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <Table
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
            render: (value) => <Tag>{statusLabels[value]}</Tag>,
          },
          {
            title: "进度",
            render: (_, row: GameAssignmentSummary) =>
              `${row.completedLevels}/${row.totalLevels}`,
          },
          {
            title: "操作",
            render: (_, row: GameAssignmentSummary) => (
              <Space>
                <Button onClick={() => setSelected(row.id)}>查看 / 协助</Button>
                <Button
                  disabled={!["assigned", "active"].includes(row.status)}
                  onClick={() => prepare(row.id, "extend")}
                >
                  延时
                </Button>
                <Button
                  danger
                  disabled={!["assigned", "active"].includes(row.status)}
                  onClick={() => prepare(row.id, "cancel")}
                >
                  撤回
                </Button>
              </Space>
            ),
          },
        ]}
      />
      <Drawer
        title="游玩详情与现场协助"
        width={900}
        open={!!selected}
        onClose={() => setSelected("")}
      >
        <ErrorNotice error={detail.error} retry={() => void detail.refresh()} />
        {detail.data && (
          <>
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
            <Table
              rowKey="id"
              dataSource={detail.data.levels}
              pagination={false}
              columns={[
                { title: "关卡", dataIndex: "position" },
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
                          !!row.completedAt || detail.data?.status !== "active"
                        }
                        onClick={() =>
                          prepare(selected, "clear_penalty", row.id)
                        }
                      >
                        解除惩罚
                      </Button>
                      <Button
                        disabled={
                          !!row.completedAt || detail.data?.status !== "active"
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
            <Table
              rowKey="id"
              dataSource={submissions.data?.items || []}
              columns={[
                { title: "回答", dataIndex: "answer" },
                { title: "结果", dataIndex: "result" },
                { title: "服务端时间", dataIndex: "submittedAt" },
              ]}
            />
          </>
        )}
      </Drawer>
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
            <Form.Item
              name="endsAt"
              label="新的截止时间（留空取消截止）"
              getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
              normalize={(v) => v?.toISOString() || ""}
            >
              <DatePicker showTime />
            </Form.Item>
          )}
          {action?.type === "complete_level" && (
            <Alert
              type="warning"
              message="人工通过会正常结算经验和奖品，请确认现场情况。"
            />
          )}
          <Form.Item name="reason" label="操作原因" rules={fieldRule}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
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
    <Card
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
      <Table
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
            <Form.Item
              name="claimDetails"
              label="仅此用户可见的取件码 / 领取说明"
            >
              <Input.TextArea rows={4} />
            </Form.Item>
          )}
          <Form.Item
            name="reason"
            label="核销备注 / 操作原因"
            rules={fieldRule}
          >
            <Input.TextArea />
          </Form.Item>
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
          <Form.Item name="playerId" label="玩家" rules={fieldRule}>
            <Select
              options={catalog.players.map((p) => ({
                value: p.id,
                label: `${p.displayName}（${p.account}）`,
              }))}
            />
          </Form.Item>
          <Form.Item name="rewardId" label="奖品" rules={fieldRule}>
            <Select
              options={catalog.rewards
                .filter((r) => r.active)
                .map((r) => ({ value: r.id, label: r.name }))}
            />
          </Form.Item>
          <Form.Item name="quantity" label="数量" rules={fieldRule}>
            <InputNumber min={1} max={100} />
          </Form.Item>
          <Form.Item name="reason" label="发奖原因" rules={fieldRule}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
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
  const [withdraw, setWithdraw] = useState("");
  return (
    <Card title="通知管理">
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <Form
        name="notification-create"
        form={form}
        layout="vertical"
        initialValues={{ target: "selected" }}
        onFinish={async (values) => {
          if (await run("/admin/notifications", values)) form.resetFields();
        }}
      >
        <Form.Item name="target" label="接收范围" rules={fieldRule}>
          <Select
            options={[
              { value: "selected", label: "指定用户" },
              { value: "all", label: "当前所有有效用户" },
              { value: "session", label: "某场次的参与者" },
            ]}
          />
        </Form.Item>
        {target === "selected" && (
          <Form.Item name="playerIds" label="玩家" rules={fieldRule}>
            <Select
              mode="multiple"
              options={catalog.players.map((p) => ({
                value: p.id,
                label: `${p.displayName}（${p.account}）`,
              }))}
            />
          </Form.Item>
        )}
        {target === "session" && (
          <Form.Item name="sessionId" label="场次版本" rules={fieldRule}>
            <Select
              options={catalog.sessions.map((s) => ({
                value: s.id,
                label: `${s.title} v${s.revision}`,
              }))}
            />
          </Form.Item>
        )}
        <Form.Item name="title" label="通知标题" rules={fieldRule}>
          <Input />
        </Form.Item>
        <Form.Item
          name="content"
          label="正文（支持原有富文本标记）"
          rules={fieldRule}
        >
          <Input.TextArea rows={4} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="popupTitle" label="弹窗标题">
            <Input />
          </Form.Item>
          <Form.Item name="buttonText" label="确认按钮文字">
            <Input />
          </Form.Item>
          <Form.Item
            name="expiresAt"
            label="过期时间"
            getValueProps={(v) => ({ value: v ? dayjs(v) : null })}
            normalize={(v) => v?.toISOString() || ""}
          >
            <DatePicker showTime />
          </Form.Item>
        </Space>
        <Button type="primary" htmlType="submit" loading={busy}>
          发送通知
        </Button>
      </Form>
      <Table
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
          <Form.Item name="reason" label="原因" rules={fieldRule}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
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
    <Card title="等级与经验阈值">
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
                <Space key={key} align="start">
                  <Form.Item name={[name, "id"]} hidden>
                    <Input />
                  </Form.Item>
                  <Typography.Text>{name + 1} 级</Typography.Text>
                  <Form.Item
                    name={[name, "name"]}
                    label="等级名称"
                    rules={fieldRule}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name={[name, "minTotalXp"]}
                    label="累计经验下限"
                    rules={fieldRule}
                  >
                    <InputNumber min={0} max={1000000} />
                  </Form.Item>
                </Space>
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
        <Form.Item
          style={{ marginTop: 20 }}
          name="reason"
          label="调整原因"
          rules={fieldRule}
        >
          <Input.TextArea />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          预览影响并保存
        </Button>
      </Form>
    </Card>
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
    }[];
  }>("/admin/audit");
  return (
    <Card
      title="管理操作审计"
      extra={<Button onClick={() => void query.refresh()}>刷新</Button>}
    >
      <ErrorNotice error={query.error} retry={() => void query.refresh()} />
      <Table
        rowKey="id"
        scroll={{ x: 900 }}
        dataSource={query.data?.items || []}
        columns={[
          { title: "时间", dataIndex: "created" },
          { title: "操作", dataIndex: "action" },
          { title: "操作人 ID", dataIndex: "actor" },
          { title: "对象类型", dataIndex: "entityType" },
          { title: "对象 ID", dataIndex: "entityId" },
          { title: "原因", dataIndex: "reason" },
        ]}
      />
    </Card>
  );
}
