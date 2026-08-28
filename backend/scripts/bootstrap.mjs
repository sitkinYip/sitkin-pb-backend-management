const base = process.env.PB_URL || "http://127.0.0.1:8090";
const required = [
  "PB_SUPERUSER_EMAIL",
  "PB_SUPERUSER_PASSWORD",
  "QUESTIONS_ADMIN_ACCOUNT",
  "QUESTIONS_ADMIN_PASSWORD",
];
for (const name of required)
  if (!process.env[name])
    throw new Error(`Missing environment variable: ${name}`);
if (
  !/^https:\/\//.test(base) &&
  !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)
)
  throw new Error("Remote bootstrap requires HTTPS.");
async function post(path, body, token) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: token } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      `Bootstrap request failed with HTTP ${response.status}; no credentials logged.`,
    );
  return response.json();
}
const auth = await post("/api/collections/_superusers/auth-with-password", {
  identity: process.env.PB_SUPERUSER_EMAIL,
  password: process.env.PB_SUPERUSER_PASSWORD,
});
const admin = await post(
  "/api/collections/game_admins/records",
  {
    account: process.env.QUESTIONS_ADMIN_ACCOUNT.toLowerCase(),
    displayName: "管理员",
    status: "active",
    password: process.env.QUESTIONS_ADMIN_PASSWORD,
    passwordConfirm: process.env.QUESTIONS_ADMIN_PASSWORD,
  },
  auth.token,
);
console.log(
  `Created business administrator ${admin.id}. Credentials were not stored.`,
);
