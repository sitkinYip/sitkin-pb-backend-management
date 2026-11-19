import { useWarnAboutChange } from "@refinedev/core";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { GameRequestError } from "./api";
import type { AdminCatalog } from "./contracts";
import type {
  AdminPushAudience,
  AdminPushSettings,
  AdminPushSettingsInput,
} from "./pushSettingsContracts";
import { ErrorNotice, useAdminData } from "./shared";
import { Field, PageCard } from "./ui";
import { useConfigRequest } from "./useConfigRequest";

const settingsPath = "/admin/push-settings";
const maxPlayers = 1000;
const noPlayerIds: string[] = [];
type Draft = Pick<AdminPushSettingsInput, "audience" | "playerIds" | "reason"> & {
  baseRevision: number;
};

const scopeName: Record<AdminPushAudience, string> = {
  allowlist: "仅白名单",
  all: "全部开放",
};

function loadError(error: Error | null) {
  if (error instanceof GameRequestError && error.status === 404)
    return new Error("当前服务端尚未提供鸿蒙推送配置，更新服务端后可重试。");
  if (error instanceof GameRequestError && error.status === 403)
    return new Error("当前账号没有管理鸿蒙推送的权限。");
  return error;
}

export function PushSettingsPage() {
  const settings = useAdminData<AdminPushSettings>(settingsPath);
  const catalog = useAdminData<AdminCatalog>(settings.data ? "/admin/catalog" : "");
  const { run, busy, error, setError } = useConfigRequest();
  const { message } = App.useApp();
  const { setWarnWhen } = useWarnAboutChange();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const saved = settings.data;
  const audience = draft?.audience ?? saved?.audience ?? "allowlist";
  const playerIds = draft?.playerIds ?? saved?.playerIds ?? noPlayerIds;
  const reason = draft?.reason ?? "";
  const changed =
    saved !== null && Boolean(draft) &&
    (audience !== saved.audience ||
      playerIds.length !== saved.playerIds.length ||
      saved.playerIds.some((id) => !playerIds.includes(id)));
  const dirty = changed || Boolean(reason);
  const blockingConflict = saved !== null && conflict === saved.revision;
  const staleDraft = Boolean(draft && saved && draft.baseRevision !== saved.revision);
  const canSave =
    changed && reason.trim().length > 0 && playerIds.length <= maxPlayers &&
    !busy && !settings.error && !settings.loading && !blockingConflict && !staleDraft;

  useEffect(() => {
    setWarnWhen(dirty);
    return () => setWarnWhen(false);
  }, [dirty, setWarnWhen]);

  const { options, labels } = useMemo(() => {
    const selected = new Set(playerIds);
    const all = catalog.data?.players ?? [];
    const known = all.map((player) => ({
      value: player.id,
      label: `${player.displayName || player.account}（${player.account}）${player.status === "disabled" ? " · 已停用" : ""}`,
      disabled: player.status === "disabled" && !selected.has(player.id),
    }));
    const labels = new Map(known.map(({ value, label }) => [value, label]));
    const missing = playerIds.filter((id) => !labels.has(id)).map((id) => ({
      value: id,
      label: catalog.data ? `未找到的玩家（${id}）` : id,
      disabled: false,
    }));
    return { options: [...known, ...missing], labels };
  }, [catalog.data, playerIds]);

  function change(values: Partial<Omit<Draft, "baseRevision">>) {
    if (!saved) return;
    setDraft({
      audience,
      playerIds,
      reason,
      baseRevision: draft?.baseRevision ?? saved.revision,
      ...values,
    });
    if (error) setError(null);
  }

  function discard() {
    setDraft(null);
    setError(null);
    if (!blockingConflict) setConflict(null);
  }

  function useLatestVersion() {
    if (!draft || !saved) return;
    setDraft({ ...draft, baseRevision: saved.revision });
    setError(null);
    setConflict(null);
  }

  async function save() {
    if (!canSave || !draft) return;
    const values: Omit<AdminPushSettingsInput, "requestId"> = {
      audience,
      playerIds: [...playerIds].sort(),
      expectedRevision: draft.baseRevision,
      reason: reason.trim(),
    };
    const result = await run<AdminPushSettings>(settingsPath, values, true, {
      method: "PATCH",
      onError: (error) => {
        if (
          error instanceof GameRequestError &&
          error.code === "PUSH_SETTINGS_CONFLICT"
        )
          setConflict(draft.baseRevision);
      },
    });
    if (!result) return;
    settings.setData(result);
    setDraft(null);
    setConflict(null);
    message.success("推送范围已保存");
    // An idempotent retry can return an earlier revision; show the latest policy.
    await settings.refresh();
  }

  return (
    <PageCard
      title="鸿蒙推送"
      extra={
        saved && (
          <Button
            disabled={busy}
            loading={settings.loading}
            onClick={() => void settings.refresh()}
          >
            刷新配置
          </Button>
        )
      }
    >
      <div className="admin-push-settings">
        <ErrorNotice
          error={loadError(settings.error)}
          retry={() => void settings.refresh()}
        />
        {!saved && settings.loading && (
          <div role="status" aria-label="正在加载推送配置">
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          </div>
        )}
        {saved && (
          <>
            <div className="admin-push-settings-status" role="status">
              <Space size="small" wrap>
                <Typography.Text strong>已保存的范围</Typography.Text>
                <Tag>{scopeName[saved.audience]}</Tag>
                {saved.audience === "allowlist" && (
                  <Typography.Text type="secondary">
                    {saved.playerIds.length} 位玩家
                  </Typography.Text>
                )}
                {settings.loading && (
                  <Typography.Text type="secondary">正在刷新…</Typography.Text>
                )}
              </Space>
            </div>
            {!saved.serverEnabled ? (
              <Alert type="info" showIcon message="服务端总开关已关闭"
                description="可以先保存范围，当前不会注册设备或发送推送。总开关由服务端配置控制。" />
            ) : saved.testMode ? (
              <Alert type="info" showIcon message="当前发送华为开发测试消息"
                description="只有服务端指定的测试玩家能接收；此处保存的范围在正式发送时生效。" />
            ) : (
              <Alert type="success" showIcon message="正式发送已开启"
                description="保存后立即应用新范围，无需重启后端或重新发包。" />
            )}

            <Alert
              type={saved.subscriptionApproved ? "success" : "info"}
              showIcon
              message={saved.subscriptionApproved ? "旅途订阅分类已启用" : "旅途订阅分类尚未启用"}
              description={saved.subscriptionApproved
                ? "玩家一次订阅并单独确认通知后，分配给他的新场次、剧情来信与关卡动态使用 SUBSCRIPTION。平台公告和运营推广继续使用 MARKETING。"
                : "账号级旅途订阅默认关闭。订阅选择可以保存；获华为对应权益并在服务端启用前，不发送新场次和剧情来信提醒，也不降级消耗营销额度。公告和推广仍使用 MARKETING。"}
            />

            {blockingConflict ? (
              <Alert
                type="warning"
                showIcon
                message="配置已被其他操作更新"
                description={
                  <>
                    <div>草稿已保留。请刷新已保存的范围，核对后再保存。</div>
                    <Button
                      className="admin-push-settings-resolve"
                      size="small"
                      loading={settings.loading}
                      onClick={() => void settings.refresh()}
                    >
                      加载最新配置
                    </Button>
                  </>
                }
              />
            ) : staleDraft && (
              <Alert
                type="warning"
                showIcon
                message="已加载最新配置，草稿仍保留"
                description={
                  <>
                    <div>请对照页首已保存的范围。继续使用草稿，会用当前草稿替换最新配置。</div>
                    {saved.playerIds.length > 0 && (
                      <details>
                        <summary>查看已保存的白名单</summary>
                        <ul>
                          {saved.playerIds.map((id) => (
                            <li key={id}>{labels.get(id) ?? id}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    <Button
                      className="admin-push-settings-resolve"
                      size="small"
                      disabled={settings.loading || Boolean(settings.error)}
                      onClick={useLatestVersion}
                    >
                      保留草稿并继续
                    </Button>
                  </>
                }
              />
            )}
            {error && !(error instanceof GameRequestError && error.code === "PUSH_SETTINGS_CONFLICT") && (
              <Alert type="error" showIcon message="未能确认保存成功"
                description={`${error.message}。草稿已保留，可再次保存。`} />
            )}

            <Form layout="vertical" disabled={busy || settings.loading} onFinish={() => {
              if (!canSave) return;
              if (audience === "all" && saved.audience !== "all") setConfirmAll(true);
              else void save();
            }}>
              <Field htmlFor="push-audience" label="推送范围">
                <Radio.Group id="push-audience" name="push-audience" aria-label="推送范围"
                  value={audience} onChange={(event) => change({ audience: event.target.value })}>
                  <Space direction="vertical">
                    <Radio value="allowlist">仅白名单</Radio>
                    <Radio value="all">全部开放</Radio>
                  </Space>
                </Radio.Group>
              </Field>
              {audience === "allowlist" ? (
                <>
                  <ErrorNotice error={catalog.error} retry={() => void catalog.refresh()} />
                  <Field label="白名单玩家" htmlFor="push-players" extra={playerIds.length
                    ? `已选 ${playerIds.length} 位。只有已授权且已绑定设备的名单内玩家会收到推送。`
                    : "名单留空时，不向任何玩家发送正式推送。"}>
                    <Select mode="multiple" id="push-players" showSearch placeholder="按昵称或登录账号搜索"
                      style={{ width: "100%" }} options={options} maxCount={maxPlayers} value={playerIds}
                      loading={catalog.loading} optionFilterProp="label" maxTagCount={3}
                      onChange={(ids: string[]) => change({ playerIds: ids })}
                      notFoundContent={catalog.loading ? "正在加载玩家…" : "没有符合条件的玩家"} />
                  </Field>
                </>
              ) : (
                <Alert className="admin-push-settings-scope-note" type="warning" showIcon
                  message="符合条件的玩家都可以收到推送"
                  description={`仍需玩家授权并绑定设备。新场次和剧情来信还需一次旅途订阅及独立通知确认；公告使用营销分类。白名单保留 ${playerIds.length} 位，切回后可继续使用。`} />
              )}
              <Field label="变更原因" htmlFor="push-reason" required extra="最多 200 字。原因会记入操作记录，不会展示给玩家。">
                <Input.TextArea id="push-reason" aria-required="true" rows={2} maxLength={200}
                  placeholder="例如：首轮邀请测试，仅开放给验收账号" value={reason}
                  onChange={(event) => change({ reason: event.target.value })} />
              </Field>
              <Space wrap>
                <Button type="primary" htmlType="submit" loading={busy} disabled={!canSave}>保存推送范围</Button>
                <Button disabled={!dirty || busy} onClick={discard}>放弃修改</Button>
                <Typography.Text type="secondary" role="status">{busy ? "正在保存…" : dirty ? "有未保存修改" : ""}</Typography.Text>
              </Space>
            </Form>
            <Modal title="确认切换到全部开放？" open={confirmAll} onCancel={() => setConfirmAll(false)}
              okText="确认开放" cancelText="返回检查"
              okButtonProps={{ disabled: !canSave, danger: true }}
              onOk={() => { setConfirmAll(false); void save(); }}>
              <Typography.Paragraph>
                正式发送开启时，只要玩家授权并绑定了鸿蒙设备，就可以收到属于自己的新通知。保存不会补发历史消息。
              </Typography.Paragraph>
            </Modal>
          </>
        )}
      </div>
    </PageCard>
  );
}
