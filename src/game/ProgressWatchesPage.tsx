import { useWarnAboutChange } from "@refinedev/core";
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Space, Tag, Typography } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useEffect, useMemo, useState } from "react";
import type { AdminProgressWatch, AdminProgressWatchList } from "../../backend/contracts/progress-watch";
import type { AdminAssignmentSummary, AdminCatalog } from "./contracts";
import { GameRequestError } from "./api";
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

type RevokeForm = Pick<GrantForm, "reason">;

type EditGrant =
  | { record: AdminProgressWatch | null; revoke: false }
  | { record: AdminProgressWatch; revoke: true };

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
  const [revokeForm] = Form.useForm<RevokeForm>();
  const [dirty, setDirty] = useState(false);
  const { busy, error, run, setError } = useConfigRequest();
  const { message, modal } = App.useApp();
  const { setWarnWhen } = useWarnAboutChange();
  const selectedWatcher = Form.useWatch("watcher", form);
  const selectedAssignment = Form.useWatch("assignment", form);
  const watcher = editor?.record?.watcher ?? selectedWatcher;
  const assignment = editor?.record?.assignment ?? selectedAssignment;
  const serverConflict = error instanceof GameRequestError && error.code === "PROGRESS_WATCH_CONFLICT";
  const players = useMemo(() => new Map(catalog.data?.players.map((player) => [player.id, player])), [catalog.data]);
  const availableAssignments = (assignments.data?.items ?? []).filter((row) =>
    row.status !== "cancelled" && row.sessionStatus === "published" && row.player !== watcher);
  const baseLoading = watches.loading || catalog.loading;
  const baseReady = !baseLoading && !!watches.data && !!catalog.data && !watches.error && !catalog.error;
  const creating = !!editor && !editor.record;
  const assignmentsReady = !assignments.loading && !!assignments.data && !assignments.error;
  const editorReady = baseReady && (!creating || assignmentsReady);
  const editorLoading = baseLoading || (creating && (assignments.loading || (!assignments.data && !assignments.error)));
  const currentRecord = watches.data?.items.find((row) => row.watcher === watcher && row.assignment === assignment);
  const missingRecord = baseReady && !!editor?.record && !currentRecord;
  const alreadyRevoked = baseReady && editor?.revoke && currentRecord?.revoked;
  const versionChanged = baseReady && !!currentRecord &&
    (currentRecord.id !== editor?.record?.id || currentRecord.revision !== editor?.record?.revision);
  const invalidWatcher = editorReady && !editor?.revoke && !!watcher && players.get(watcher)?.status !== "active";
  const invalidAssignment = editorReady && creating && !!assignment &&
    !availableAssignments.some((row) => row.id === assignment);
  const conflict = serverConflict || versionChanged;
  const canSubmit = !!editor && editorReady && !busy && !conflict && !missingRecord && !alreadyRevoked &&
    !invalidWatcher && !invalidAssignment;

  useEffect(() => {
    setWarnWhen(dirty);
    return () => setWarnWhen(false);
  }, [dirty, setWarnWhen]);

  function name(id: string) {
    const player = players.get(id);
    return player ? `${player.displayName || player.account}（${player.account}）` : id;
  }

  function start(next: EditGrant) {
    if (!baseReady || busy) return;
    if (next.revoke) {
      revokeForm.resetFields();
    } else {
      form.resetFields();
      if (next.record) form.setFieldValue("expiresAt", dayjs(next.record.expiresAt));
    }
    setError(null);
    setDirty(false);
    setEditor(next);
  }

  function finish() {
    setEditor(null);
    setDirty(false);
    setError(null);
  }

  function close() {
    if (busy) return;
    if (!dirty) { finish(); return; }
    modal.confirm({ title: "放弃本次修改？", okText: "放弃修改", cancelText: "继续编辑", onOk: finish });
  }

  function refreshData() {
    if (busy) return;
    void watches.refresh();
    if (watches.data) void catalog.refresh();
    if (creating) void assignments.refresh();
  }

  function reloadVersion() {
    if (!editor || !editorReady || busy) return;
    void watches.refresh((latest) => {
      const record = latest.items.find((row) => row.watcher === watcher && row.assignment === assignment);
      setEditor((active) => {
        if (active !== editor || !record) return active;
        return { ...active, record };
      });
      setError(null);
    });
  }

  async function submit(reason: string, grant?: GrantForm) {
    if (!canSubmit || !editor) return;
    const target = editor.revoke ? {
      watcher: editor.record.watcher,
      assignment: editor.record.assignment,
      expiresAt: editor.record.expiresAt,
    } : grant && {
      watcher: editor.record?.watcher ?? grant.watcher,
      assignment: editor.record?.assignment ?? grant.assignment,
      expiresAt: grant.expiresAt.toISOString(),
    };
    if (!target) return;
    const result = await run<AdminProgressWatch>(watchesPath, {
      ...target,
      revoked: editor.revoke,
      expectedRevision: editor.record?.revision ?? 0,
      reason: reason.trim(),
    }, true, { method: "PUT" });
    if (!result) return;
    finish();
    message.success(editor.revoke ? "授权已撤销" : "授权已保存");
    await watches.refresh();
  }

  const listError = watches.error instanceof GameRequestError && watches.error.status === 404 ?
    new Error("当前服务端尚未提供场次进度订阅。") : watches.error;
  const refreshError = listError ?? catalog.error ?? (creating ? assignments.error : null);
  const editorFeedback = <>
    {editorLoading ? <Typography.Paragraph role="status" type="secondary">
      正在刷新授权和账号数据…
    </Typography.Paragraph> : refreshError && <ErrorNotice error={refreshError} retry={refreshData} />}
    {missingRecord && <Alert type="warning" showIcon message="这条授权已不存在，请关闭后重新选择。" />}
    {alreadyRevoked && <Alert type="info" showIcon message="这条授权已撤销。" />}
    {error && !conflict && <Alert type="error" showIcon message={error.message} />}
    {conflict && !missingRecord && !alreadyRevoked && <Alert type="warning" showIcon
      message={serverConflict ? error.message : "授权版本已更新。"}
      description="载入最新版本后会保留本次填写的内容，请核对后提交。"
      action={<Button disabled={!editorReady || busy} onClick={reloadVersion}>载入最新版本</Button>} />}
    {invalidWatcher && <Alert type="warning" showIcon
      message={creating ? "接收账号已不可用，请重新选择。" : "接收账号已不可用。"} />}
    {invalidAssignment && <Alert type="warning" showIcon message="当前选择的场次已不可用，请重新选择。" />}
  </>;
  const editorSummary = editor?.record && <Typography.Paragraph>
    {name(editor.record.watcher)} · {name(editor.record.player)} · {editor.record.title}
  </Typography.Paragraph>;
  const reasonField = <Field name="reason" label="变更原因"
    rules={[{ required: true, whitespace: true, message: "请填写原因" }]}>
    <Input.TextArea maxLength={200} rows={3} />
  </Field>;

  return (
    <PageCard title="进度订阅授权" extra={<Space wrap>
      <Button onClick={refreshData} loading={baseLoading} disabled={busy}>刷新</Button>
      <Button type="primary" disabled={!baseReady || busy}
        onClick={() => start({ record: null, revoke: false })}>新增授权</Button>
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
            <Button disabled={!baseReady || busy} onClick={() => start({ record: row, revoke: false })}>
              {authorizationLabel(row) === "有效" ? "调整期限" : "重新授权"}
            </Button>
            {!row.revoked && <Button danger disabled={!baseReady || busy}
              onClick={() => start({ record: row, revoke: true })}>撤销</Button>}
          </Space> },
        ]} />
      <EditorDrawer open={!!editor && !editor.revoke} forceRender title={editor?.record ? "调整进度授权" : "新增进度授权"}
        width={520} onClose={close} closable={!busy} maskClosable={!busy} keyboard={!busy}
        extra={<Space>
          <Button onClick={close} disabled={busy}>关闭</Button>
          <Button type="primary" loading={busy} disabled={!canSubmit} onClick={() => form.submit()}>保存授权</Button>
        </Space>}>
        {editor && !editor.revoke && editorFeedback}
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values.reason, values)}
          onValuesChange={(changes) => {
            if (changes.watcher) form.setFieldValue("assignment", undefined);
            setDirty(true);
          }} disabled={busy} scrollToFirstError>
          {editor?.record ? editorSummary : <>
            <Field name="watcher" label="接收提醒的账号" rules={[{ required: true, message: "请选择接收账号" }]}>
              <Select showSearch optionFilterProp="label" disabled={busy || !baseReady} options={Array.from(players.values())
                .filter((player) => player.status === "active").map((player) => ({ value: player.id, label: name(player.id) }))} />
            </Field>
            <Field name="assignment" label="玩家与场次" rules={[{ required: true, message: "请选择玩家的场次" }]}>
              <Select showSearch optionFilterProp="label" loading={assignments.loading} disabled={busy || !editorReady}
                options={availableAssignments.map((row) => ({ value: row.id, label: `${name(row.player)} · ${row.title}` }))} />
            </Field>
          </>}
          <Field name="expiresAt" label="授权截止时间" extra={editor?.record ? "修改期限后，接收账号需重新订阅。" : undefined}
            rules={[{ required: true, message: "请选择截止时间" }, { validator: (_, value?: Dayjs) =>
              !value || value.isAfter(dayjs()) ? Promise.resolve() : Promise.reject(new Error("截止时间须在未来")) }]}>
            <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" />
          </Field>
          {reasonField}
        </Form>
      </EditorDrawer>
      <Modal open={!!editor?.revoke} forceRender title="撤销进度授权" onCancel={close}
        closable={!busy} maskClosable={!busy} keyboard={!busy} confirmLoading={busy}
        cancelText="取消" cancelButtonProps={{ disabled: busy }}
        okText="确认撤销" okButtonProps={{ danger: true, disabled: !canSubmit }}
        onOk={() => revokeForm.submit()}>
        {editor?.revoke && editorFeedback}
        {editor?.revoke && editorSummary}
        <Typography.Paragraph>撤销后，该账号将失去此场次的进度访问权限。</Typography.Paragraph>
        <Form form={revokeForm} name="revoke-progress-watch" layout="vertical" disabled={busy}
          onValuesChange={() => setDirty(true)} onFinish={(values) => void submit(values.reason)} scrollToFirstError>
          {reasonField}
        </Form>
      </Modal>
    </PageCard>
  );
}
