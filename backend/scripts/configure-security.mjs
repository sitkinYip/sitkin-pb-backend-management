import { pathToFileURL } from "node:url";

export const gameRateRules = [
  {
    label: "POST /api/collections/game_players/auth-with-password",
    audience: "",
    duration: 60,
    maxRequests: 30,
  },
  {
    label: "POST /api/collections/game_admins/auth-with-password",
    audience: "",
    duration: 60,
    maxRequests: 20,
  },
  {
    label: "POST /api/questions/v1/me/change-password",
    audience: "",
    duration: 60,
    maxRequests: 5,
  },
];
export function withGameRateLimits(existing) {
  return {
    enabled: true,
    rules: [
      ...gameRateRules,
      ...(existing?.rules || []).filter(
        (rule) => !gameRateRules.some((ours) => ours.label === rule.label),
      ),
    ],
  };
}
async function main() {
  const base = (process.env.PB_URL || "http://127.0.0.1:8090").replace(
    /\/$/,
    "",
  );
  const url = new URL(base);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) &&
    (url.protocol !== "https:" || !process.argv.includes("--allow-remote"))
  )
    throw new Error(
      "Remote settings changes require HTTPS and --allow-remote.",
    );
  if (!process.env.PB_SUPERUSER_EMAIL || !process.env.PB_SUPERUSER_PASSWORD)
    throw new Error(
      "Provide PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD via environment.",
    );
  async function request(route, method, body, token) {
    const response = await fetch(base + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(`Security configuration failed: HTTP ${response.status}`);
    return response.json();
  }
  const { token } = await request(
    "/api/collections/_superusers/auth-with-password",
    "POST",
    {
      identity: process.env.PB_SUPERUSER_EMAIL,
      password: process.env.PB_SUPERUSER_PASSWORD,
    },
  );
  const current = await request("/api/settings", "GET", undefined, token);
  const rateLimits = withGameRateLimits(current.rateLimits);
  console.log(
    JSON.stringify({
      currentlyEnabled: current.rateLimits.enabled,
      proposed: rateLimits,
      applied: process.argv.includes("--apply"),
      warning:
        "Enabling the limiter also activates retained existing rules. Review effects on other applications before --apply; trusted proxy headers are not changed.",
    }),
  );
  if (process.argv.includes("--apply"))
    await request("/api/settings", "PATCH", { rateLimits }, token);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
