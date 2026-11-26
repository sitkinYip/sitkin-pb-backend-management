import { useWarnAboutChange } from "@refinedev/core";
import { Alert, App, Button, DatePicker, Form, Input, Select, Space, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import type { AdminProgressWatch, AdminProgressWatchList } from "../../backend/contracts/progress-watch";
import type { AdminAssignmentSummary, AdminCatalog } from "./contracts";
import { GameRequestError, gameRequest } from "./api";
import { ErrorNotice, useAdminData } from "./shared";
import { AdminTable, displayTime, EditorDrawer, Field, PageCard } from "./ui";
import { useConfigRequest } from "./useConfigRequest";

const watchesPath = "/admin/progress-watches";

interface GrantForm {
  watcher: string;
  assignment: string;
  expiresAt: Dayjs;
  reason: string;
}

interface EditGrant {
  record: AdminProgressWatch | null;
  revoke: boolean;
}

function authorizationLabel(watch: AdminProgressWatch): string {
  if (watch.revoked) return "已撤销";
  return Date.parse(watch.expiresAt) <= Date.now() ? "已到期" : "有效";
}

export function ProgressWatchesPage() {
  const watches = useAdminData<AdminProgressWatchList>(watchesPath);
  const catalog = useAdminData<AdminCatalog>(watches.data ? "/admin/catalog" : "");
  const [editor, setEditor] = useState<EditGrant | null>(null);
  const assignments = useAdminData<{ items: AdminAssignmentSummary[] }>(
    editor && !editor.record ? "/admin/assignments" : "",
  );
  const [form] = Form.useForm<GrantForm>();
  const [dirty, setDirty] = useState(false);
  const [reloading, setReloading] = useState(false);
  const { busy, error, run, setError } = useConfigRequest();
  const { message, modal } = App.useApp();
  const { setWarnWhen } = useWarnAboutChange();
  const watcher = Form.useWatch("watcher", form);
  const conflict = error instanceof GameRequestError && error.code === "PROGRESS_WATCH_CONFLICT";
  const players = useMemo(() => new Map(catalog.data?.players.map((player) => [player.id, player])), [catalog.data]);

  useEffect(() => {
    setWarnWhen(dirty);
    return () => setWarnWhen(false);
  }, [dirty, setWarnWhen]);

  function name(id: string) {
    const player = players.get(id);
    return player ? `${player.displayName || player.account}（${player.account}）` : id;
  }

  function start(record: AdminProgressWatch | null, revoke = false) {
    form.resetFields();
    form.setFieldsValue(record ? { watcher: record.watcher, assignment: record.assignment,
      expiresAt: dayjs(record.expiresAt), reason: "" } : { reason: "" });
    setError(null);
    setDirty(false);
    setEditor({ record, revoke });
  }

  function finish() {
    setEditor(null);
    setDirty(false);
    setError(null);
  }

  function close() {
    if (busy || reloading) return;
    if (!dirty) { finish(); return; }
    modal.confirm({ title: "放弃本次修改？", okText: "放弃修改", cancelText: "继续编辑", onOk: finish });
  }

  async function reloadVersion() {
    if (!editor || reloading || busy) return;
    setReloading(true);
    try {
      const latest = await gameRequest<AdminProgressWatchList>(watchesPath);
      watches.setData(latest);
      const record = latest.items.find((row) =>
        row.watcher === form.getFieldValue("watcher") && row.assignment === form.getFieldValue("assignment"));
      setEditor({ ...editor, record: record ?? null });
      setError(null);
    } catch (cause) {
      message.error(cause instanceof Error ? cause.message : "无法刷新授权版本");
    } finally { setReloading(false); }
  }

  async function submit(values: GrantForm) {
    if (!editor || busy || reloading || conflict) return;
    const result = await run<AdminProgressWatch>(watchesPath, {
      watcher: editor.record?.watcher ?? values.watcher,
      assignment: editor.record?.assignment ?? values.assignment,
      expiresAt: editor.revoke ? editor.record?.expiresAt : values.expiresAt.toISOString(),
      revoked: editor.revoke,
      expectedRevision: editor.record?.revision ?? 0,
      reason: values.reason.trim(),
    }, true, { method: "PUT" });
    if (!result) return;
    finish();
    message.success(editor.revoke ? "授权已撤销" : "授权已保存");
    await watches.refresh();
  }

  const listError = watches.error instanceof GameRequestError && watches.error.status === 404 ?
    new Error("当前服务端尚未提供场次进度订阅。") : watches.error;

  return (
    <PageCard title="进度订阅授权" extra={<Space wrap>
      <Button onClick={() => void watches.refresh()}>刷新</Button>
      <Button type="primary" disabled={!watches.data || catalog.loading || !!catalog.error}
        onClick={() => start(null)}>新增授权</Button>
    </Space>}>
      <Typography.Paragraph type="secondary">
        允许指定账号查看另一位玩家的某个场次。接收账号可在手机设置里选择提醒事件。
      </Typography.Paragraph>
      <ErrorNotice error={listError} retry={() => void watches.refresh()} />
      <ErrorNotice error={catalog.error} retry={() => void catalog.refresh()} />
      <AdminTable<AdminProgressWatch> rowKey="id" scroll={{ x: 1120 }} loading={watches.loading}
        locale={{ emptyText: "还没有授权，可以新增一条场次进度授权。" }} dataSource={watches.data?.items ?? []}
        columns={[
          { title: "接收账号", dataIndex: "watcher", render: (id: string) => name(id) },
          { title: "玩家", dataIndex: "player", render: (id: string) => name(id) },
          { title: "场次", dataIndex: "title" },
          { title: "授权截止", dataIndex: "expiresAt", render: displayTime },
          { title: "状态", render: (_, row) => <Space wrap>
            <Tag color={authorizationLabel(row) === "有效" ? "green" : undefined}>{authorizationLabel(row)}</Tag>
            {authorizationLabel(row) === "有效" && row.subscribed && <Tag>{row.pushEnabled ? "已开启通知" : "已订阅"}</Tag>}
          </Space> },
          { title: "操作", width: 210, render: (_, row) => <Space wrap>
            <Button onClick={() => start(row)}>{authorizationLabel(row) === "有效" ? "调整期限" : "重新授权"}</Button>
            {!row.revoked && <Button danger onClick={() => start(row, true)}>撤销</Button>}
          </Space> },
        ]} />
      <EditorDrawer open={editor !== null} title={editor?.revoke ? "撤销进度授权" : editor?.record ? "调整进度授权" : "新增进度授权"}
        width={520} onClose={close} closable={!busy} maskClosable={!busy} keyboard={!busy}
        extra={<Space>
          <Button onClick={close} disabled={busy || reloading}>关闭</Button>
          <Button type="primary" danger={editor?.revoke} loading={busy} disabled={conflict || reloading ||
            (!editor?.record && (assignments.loading || !!assignments.error))}
            onClick={() => form.submit()}>{editor?.revoke ? "确认撤销" : "保存授权"}</Button>
        </Space>}>
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}
          onValuesChange={(changes) => {
            if (changes.watcher) form.setFieldValue("assignment", undefined);
            setDirty(true);
          }} disabled={busy || reloading} scrollToFirstError>
          {error && <Alert type={conflict ? "warning" : "error"} showIcon message={error.message}
            action={conflict ? <Button onClick={() => void reloadVersion()} loading={reloading}>载入最新版本</Button> : undefined} />}
          {editor?.record ? <Typography.Paragraph>
            {name(editor.record.watcher)} · {name(editor.record.player)} · {editor.record.title}
          </Typography.Paragraph> : <>
            <Field name="watcher" label="接收提醒的账号" rules={[{ required: true, message: "请选择接收账号" }]}>
              <Select showSearch optionFilterProp="label" options={Array.from(players.values())
                .filter((player) => player.status === "active").map((player) => ({ value: player.id, label: name(player.id) }))} />
            </Field>
            <Field name="assignment" label="玩家与场次" rules={[{ required: true, message: "请选择玩家的场次" }]}>
              <Select showSearch optionFilterProp="label" loading={assignments.loading}
                options={(assignments.data?.items ?? []).filter((row) =>
                  row.status !== "cancelled" && row.sessionStatus === "published" && row.player !== watcher)
                  .map((row) => ({ value: row.id, label: `${name(row.player)} · ${row.title}` }))} />
            </Field>
            <ErrorNotice error={assignments.error} retry={() => void assignments.refresh()} />
          </>}
          {editor?.revoke ? <Alert type="warning" message="撤销后，该账号将失去此场次的进度访问权限。" /> :
            <Field name="expiresAt" label="授权截止时间" extra={editor?.record ? "修改期限后，接收账号需重新订阅。" : undefined}
              rules={[{ required: true, message: "请选择截止时间" }, { validator: (_, value?: Dayjs) =>
                !value || value.isAfter(dayjs()) ? Promise.resolve() : Promise.reject(new Error("截止时间须在未来")) }]}>
              <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" />
            </Field>}
          <Field name="reason" label="变更原因" rules={[{ required: true, whitespace: true, message: "请填写原因" }]}>
            <Input.TextArea maxLength={200} rows={3} />
          </Field>
        </Form>
      </EditorDrawer>
    </PageCard>
  );
}
