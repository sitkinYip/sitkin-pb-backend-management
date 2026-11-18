import { createRequestId } from "./request-id";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Input, Space } from "antd";
import type { FormInstance } from "antd";
import { gameRequest } from "./api";
import type { AdminCatalog } from "./contracts";

export function useAdminData<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const value = await gameRequest<T>(path);
      if (current === generation.current) {
        setData(value);
        setError(null);
      }
    } catch (error) {
      if (current === generation.current) setError(error as Error);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}
export function useAdminCommand(refresh: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Map<string, string>());
  const { message } = App.useApp();
  const run = async <T,>(
    path: string,
    values: Record<string, unknown> = {},
    method = "POST",
  ): Promise<T | null> => {
    const signature = JSON.stringify([path, method, values]);
    const requestId = pending.current.get(signature) || createRequestId();
    pending.current.set(signature, requestId);
    setBusy(true);
    try {
      const result = await gameRequest<T>(
        path,
        { ...values, requestId },
        method,
      );
      pending.current.delete(signature);
      await refresh();
      message.success("操作成功");
      return result;
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : "操作失败。连接中断时请重试原操作，不要反复新建。",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}
export function ErrorNotice({
  error,
  retry,
}: {
  error: Error | null;
  retry: () => void;
}) {
  return error ? (
    <Alert
      type="error"
      showIcon
      message={error.message}
      action={<Button onClick={retry}>重试</Button>}
      style={{ marginBottom: 16 }}
    />
  ) : null;
}
export function LinesInput({
  value = [],
  onChange,
  ...props
}: {
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  rows?: number;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <Input.TextArea
      {...props}
      value={value.join("\n")}
      onChange={(e) => onChange?.(e.target.value.split("\n"))}
    />
  );
}
export const statusLabels: Record<string, string> = {
  correct: "答对",
  incorrect: "答错",
  manual: "人工通过",
  draft: "草稿",
  published: "已发布",
  archived: "已归档",
  assigned: "待开始",
  active: "进行中",
  completed: "已完成",
  cancelled: "已撤回",
  available: "待核销",
  redeemed: "已核销",
  voided: "已作废",
  disabled: "已停用",
  sent: "已发送",
  withdrawn: "已撤回",
  skipped_active: "跳过：已有未结束场次",
  skipped_completed: "跳过：已完成",
  skipped_disabled: "跳过：账号停用",
};
export function FormFooter({
  busy,
  form,
  cancel,
}: {
  busy: boolean;
  form: FormInstance;
  cancel: () => void;
}) {
  return (
    <Space>
      <Button onClick={cancel}>取消</Button>
      <Button type="primary" loading={busy} onClick={() => form.submit()}>
        保存
      </Button>
    </Space>
  );
}
export const playerName = (catalog: AdminCatalog | null, id: string) =>
  catalog?.players.find((p) => p.id === id)?.displayName || id;
export const fieldRule = [{ required: true, message: "请填写此项" }];
