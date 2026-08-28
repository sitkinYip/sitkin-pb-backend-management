export const ADMIN_HOME = "/players";
export const ADMIN_LOGIN = "/login";

export const adminResources = [
  ["players", "用户管理"],
  ["questions", "题库"],
  ["sessions", "场次配置"],
  ["dispatch", "下发场次"],
  ["progress", "用户进度"],
  ["rewards", "奖品定义"],
  ["grants", "奖品核销"],
  ["narratives", "剧情内容"],
  ["notifications", "通知"],
  ["ranks", "等级设置"],
  ["audit", "操作记录"],
  ["resource_manager", "资源管理"],
].map(([name, label]) => ({ name, list: `/${name}`, meta: { label } }));

const allowedPaths = new Set(adminResources.map((resource) => resource.list));

export function adminReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u0020]/.test(value)
  )
    return ADMIN_HOME;

  const url = new URL(value, "https://admin.invalid");
  const pathname = url.pathname.replace(/\/+$/, "");
  if (url.origin !== "https://admin.invalid" || !allowedPaths.has(pathname))
    return ADMIN_HOME;

  url.searchParams.delete("to");
  return pathname + url.search + url.hash;
}

// Refine gives ?to= priority over authProvider.redirectTo. Normalize it before
// mounting useLogin so old bookmarks cannot send users to removed routes.
export function normalizeAdminLoginSearch(search: string): string {
  const params = new URLSearchParams(search);
  const values = params.getAll("to");
  const target = values.length === 1 ? adminReturnPath(values[0]) : ADMIN_HOME;
  params.delete("to");
  if (target !== ADMIN_HOME) params.set("to", target);
  const normalized = params.toString();
  return normalized ? `?${normalized}` : "";
}
