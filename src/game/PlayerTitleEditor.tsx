import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Typography,
} from "antd";
import type { GamePlayer, GameRank, PlayerLevelTitle } from "./contracts";
import { EditorDrawer, Field } from "./ui";
import { fieldRule } from "./shared";
import { useConfigRequest } from "./useConfigRequest";

export function PlayerTitleEditor({
  player,
  ranks,
  onClose,
  refresh,
}: {
  player: GamePlayer;
  ranks: GameRank[];
  onClose: () => void;
  refresh: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [items, setItems] = useState<PlayerLevelTitle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedLevel, setSelectedLevel] = useState(player.level.id);
  const request = useConfigRequest();
  const { modal, message } = App.useApp();
  const levelId = Form.useWatch("levelId", form) || player.level.id;
  function select(id: string, rows = items) {
    setSelectedLevel(id);
    const row = rows.find((item) => item.level === id);
    form.setFieldsValue({
      levelId: id,
      name: row?.status === "active" ? row.name : "",
      reason: "",
    });
    setRevision(row?.revision || 0);
    setDirty(false);
  }
  async function load() {
    const result = await request.run<{ items: PlayerLevelTitle[] }>(
      `/admin/players/${player.id}/titles`,
    );
    if (result) {
      setItems(result.items);
      select(levelId, result.items);
      setLoaded(true);
    }
  }
  useEffect(() => {
    void load();
  }, [player.id]);
  const close = () => {
    if (request.busy) return;
    if (dirty)
      modal.confirm({ title: "放弃未保存的头衔修改？", onOk: onClose });
    else onClose();
  };
  async function save(action: "save" | "revoke") {
    try {
      const values = await form.validateFields(
        action === "revoke" ? ["levelId", "reason"] : undefined,
      );
      const result = await request.run(
        `/admin/players/${player.id}/titles`,
        {
          levelId,
          ...(action === "save" ? { name: values.name } : {}),
          reason: values.reason,
          expectedRevision: revision,
          action,
        },
        true,
      );
      if (result) {
        setDirty(false);
        message.success(
          action === "save" ? "专属头衔已保存" : "已恢复默认头衔",
        );
        await load();
        await refresh();
      }
    } catch {
      /* AntD shows field errors. */
    }
  }
  const current = items.find((item) => item.level === levelId);
  return (
    <EditorDrawer
      open
      title={`专属头衔 · ${player.displayName}`}
      width={620}
      onClose={close}
      closable={!request.busy}
      maskClosable={!request.busy}
      keyboard={!request.busy}
      extra={
        <Space wrap>
          <Button disabled={request.busy} onClick={close}>
            关闭
          </Button>
          <Button
            disabled={!loaded || request.busy || current?.status !== "active"}
            onClick={() => void save("revoke")}
          >
            撤销并恢复默认
          </Button>
          <Button
            type="primary"
            disabled={!loaded}
            loading={request.busy}
            onClick={() => void save("save")}
          >
            保存专属名称
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        message="只定制名称，等级、经验和参与资格保持现有规则。可提前配置未来等级。"
      />
      {request.error && (
        <Alert
          type="error"
          showIcon
          message={request.error.message}
          description="修改草稿仍保留。刷新最新数据会重新加载该等级的配置。"
          action={
            <Button
              onClick={() =>
                modal.confirm({ title: "重新加载并放弃当前草稿？", onOk: load })
              }
            >
              刷新最新数据
            </Button>
          }
        />
      )}
      {!loaded && request.busy ? (
        <Spin />
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={request.busy}
          onValuesChange={() => setDirty(true)}
          className="admin-extra-form"
        >
          <Field name="levelId" label="对应等级" rules={fieldRule}>
            <Select
              options={ranks.map((rank) => ({
                value: rank.id,
                label: `${rank.order} 级 · ${rank.name}`,
              }))}
              onChange={(id) => {
                if (!dirty) {
                  select(id);
                  return;
                }
                form.setFieldValue("levelId", selectedLevel);
                modal.confirm({
                  title: "切换等级并放弃未保存的修改？",
                  onOk: () => select(id),
                });
              }}
            />
          </Field>
          <Typography.Paragraph type="secondary">
            默认名称：{ranks.find((rank) => rank.id === levelId)?.name} ·
            当前配置：
            {current?.status === "active" ? current.name : "使用默认名称"}
          </Typography.Paragraph>
          <Field name="name" label="专属名称" rules={fieldRule}>
            <Input maxLength={60} />
          </Field>
          <Field name="reason" label="操作原因" rules={fieldRule}>
            <Input.TextArea
              maxLength={1000}
              autoSize={{ minRows: 2, maxRows: 5 }}
            />
          </Field>
        </Form>
      )}
    </EditorDrawer>
  );
}
