import { useRef, useState } from "react";
import { gameRequest } from "./api";
import { createRequestId } from "./request-id";

/** Keep uncertain writes retryable and errors visible inside the editor. */
export function useConfigRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const pending = useRef(new Map<string, string>());
  const running = useRef(false);
  async function run<T>(
    path: string,
    input?: Record<string, unknown>,
    command = false,
    options?: { method?: string; onError?: (error: Error) => void },
  ): Promise<T | null> {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setError(null);
    const signature = JSON.stringify([path, options?.method, input]);
    let body = input;
    if (command) {
      const requestId = pending.current.get(signature) || createRequestId();
      pending.current.set(signature, requestId);
      body = { ...input, requestId };
    }
    try {
      const result = await gameRequest<T>(path, body, options?.method);
      pending.current.delete(signature);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("操作失败");
      setError(error);
      options?.onError?.(error);
      return null;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return { run, busy, error, setError };
}
