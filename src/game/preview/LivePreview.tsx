import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Form,
  Segmented,
  Select,
  Space,
  Typography,
  type FormInstance,
} from "antd";
import {
  EDITOR_PREVIEW_VERSION,
  type EditorPreviewDraft,
  type EditorPreviewMessage,
} from "../contracts";
import { previewDraft } from "./draft";

export function LivePreview({
  form,
  kind,
  children,
  active = true,
}: {
  form: FormInstance;
  kind: EditorPreviewDraft["kind"];
  children: ReactNode;
  active?: boolean;
}) {
  const values = Form.useWatch([], { form, preserve: true });
  const draft = useMemo(() => previewDraft(kind, values), [kind, values]);
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = useRef<HTMLElement>(null);
  const revision = useRef(0);
  const [handshake, setHandshake] = useState(0);
  const [channel, setChannel] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [tab, setTab] = useState("编辑");
  const [device, setDevice] = useState("手机");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [state, setState] = useState<EditorPreviewMessage["state"]>(
    kind === "question" ? "unanswered" : "unread",
  );
  const [reset, setReset] = useState(0);
  const url = useMemo(() => {
    try {
      const target = new URL(
        import.meta.env.VITE_PLAYER_PREVIEW_URL ||
          "https://sitkin.top/questions-next/preview/",
      );
      if (!["http:", "https:"].includes(target.protocol)) return null;
      target.searchParams.set("parentOrigin", window.location.origin);
      target.searchParams.set("channel", channel);
      return target;
    } catch {
      return null;
    }
  }, [channel]);
  useEffect(() => {
    if (!active) return;
    setStatus("loading");
    const timeout = window.setTimeout(
      () => setStatus((current) => (current === "ready" ? current : "error")),
      12000,
    );
    function receive(event: MessageEvent) {
      if (
        !url ||
        event.origin !== url.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.channel !== channel
      )
        return;
      if (event.data.type === "sitkin:preview:ready") {
        if (
          event.data.version !== EDITOR_PREVIEW_VERSION ||
          (kind === "narrative" &&
            (!Array.isArray(event.data.kinds) ||
              !event.data.kinds.includes("narrative")))
        )
          setStatus("error");
        else {
          window.clearTimeout(timeout);
          setStatus("ready");
          setHandshake((n) => n + 1);
        }
      }
    }
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [url, channel, active, kind]);
  useEffect(() => {
    if (!active || status !== "ready" || !url) return;
    const timer = window.setTimeout(() => {
      const message: EditorPreviewMessage = {
        type: "sitkin:preview:update",
        version: EDITOR_PREVIEW_VERSION,
        channel,
        revision: ++revision.current,
        reset,
        theme,
        state,
        draft,
      };
      frame.current?.contentWindow?.postMessage(message, url.origin);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [draft, status, url, channel, state, reset, theme, handshake, active]);
  return (
    <div className="admin-live-editor" data-device={device}>
      <div className="admin-live-tabs">
        <Segmented
          aria-label="编辑与预览"
          options={["编辑", "预览"]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="admin-live-columns" data-tab={tab}>
        <div className="admin-live-fields">{children}</div>
        <section
          ref={preview}
          className="admin-live-preview"
          aria-label="玩家端实时预览"
        >
          <Typography.Title level={5}>实时预览</Typography.Title>
          <Typography.Paragraph type="secondary">
            未保存配置 · 模拟状态。预览不会保存或发送内容。
          </Typography.Paragraph>
          <Space wrap className="admin-preview-tools">
            <Segmented
              aria-label="预览设备"
              options={["手机", "桌面"]}
              value={device}
              onChange={(value) => {
                setDevice(value);
                if (kind === "narrative") setReset((n) => n + 1);
                requestAnimationFrame(() =>
                  preview.current?.scrollIntoView({ block: "start" }),
                );
              }}
            />
            <Select
              aria-label="预览主题"
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
              ]}
            />
            {kind !== "narrative" && (
              <Select
                aria-label="模拟展示状态"
                value={state}
                onChange={setState}
                options={
                  kind === "question"
                    ? [
                        { value: "unanswered", label: "未作答" },
                        { value: "incorrect", label: "答错" },
                        { value: "completed", label: "答对" },
                      ]
                    : [
                        { value: "unread", label: "未读详情" },
                        { value: "read", label: "已读详情" },
                        { value: "popup", label: "通知弹窗" },
                      ]
                }
              />
            )}
            <Button onClick={() => setReset((n) => n + 1)}>重置预览</Button>
          </Space>
          {kind === "narrative" && (
            <Typography.Paragraph type="secondary">
              修改配置后，信件会收起、祝福会回到开始画面；正在播放的音频与打字效果会停止。点击预览中的开启按钮重新播放。
            </Typography.Paragraph>
          )}
          {status === "loading" && url && (
            <p role="status">正在连接玩家端预览…</p>
          )}
          {(status === "error" || !url) && (
            <Alert
              type="warning"
              message="预览暂不可用"
              description="请确认玩家端已发布预览入口、地址配置正确且允许后台嵌入。表单可继续编辑。"
              action={
                <Button onClick={() => setChannel(crypto.randomUUID())}>
                  重新连接
                </Button>
              }
            />
          )}
          <Typography.Paragraph type="secondary">
            窗口较窄时，可在预览区域左右滑动查看完整画面。
          </Typography.Paragraph>
          {active && url && (
            <div className="admin-preview-viewport">
              <iframe
                key={channel}
                ref={frame}
                title={`${kind === "question" ? "题目" : kind === "narrative" ? "剧情内容" : "通知"}玩家端预览`}
                src={url.href}
                sandbox="allow-scripts allow-same-origin"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          )}
          {kind === "question" && (
            <Typography.Paragraph type="secondary">
              此处预览题目自身配置；场次的隐藏标题、背景和通用线索等展示设置不在本次预览范围。
            </Typography.Paragraph>
          )}
        </section>
      </div>
    </div>
  );
}
