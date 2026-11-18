import { pb } from "../pocketbase";

export class GameRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function gameRequest<T>(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const token = pb.authStore.token;
  const response = await fetch(`${pb.baseUrl}/api/questions/v1${path}`, {
    method,
    headers: {
      Authorization: token,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && token === pb.authStore.token)
      pb.authStore.clear();
    throw new GameRequestError(
      data.error?.message || `请求失败（${response.status}）`,
      response.status,
      data.error?.code,
    );
  }
  if (token !== pb.authStore.token)
    throw new Error("登录状态已变化，请重新进入页面");
  return data as T;
}
