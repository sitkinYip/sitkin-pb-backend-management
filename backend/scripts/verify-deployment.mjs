// Read-only deployment probe; no migration flag or credentials are needed.
const url = new URL(
  process.env.VITE_POCKET_BASE_HOST || "https://api.sitkin.top",
);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/"
)
  throw new Error(
    "PocketBase must be an HTTPS origin without credentials, path or query.",
  );
const response = await fetch(`${url.origin}/api/questions/v1/admin/me`, {
  signal: AbortSignal.timeout(15000),
  redirect: "error",
});
if (response.status !== 401)
  throw new Error(`Backend route probe failed: HTTP ${response.status}`);
console.log("Unauthenticated backend route probe passed.");
