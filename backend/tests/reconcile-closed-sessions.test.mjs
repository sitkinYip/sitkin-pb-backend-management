import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcile,
  reconciliationPlan,
} from "../scripts/reconcile-closed-sessions.mjs";

const archived = {
  id: "archived0000001",
  status: "archived",
  title: "待补齐",
  revision: 1,
  assignmentCounts: {
    total: 4,
    assigned: 1,
    active: 1,
    completed: 1,
    cancelled: 1,
  },
};
const online = { ...archived, id: "published000001", status: "published" };
const settings = {
  base: "http://127.0.0.1:8090",
  account: "test",
  password: "test-password",
};
function fixture() {
  const calls = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, ...options });
      const data = url.endsWith("auth-with-password")
        ? { token: "local-test-token" }
        : url.endsWith("catalog")
          ? { sessions: [archived, online] }
          : { id: archived.id, cancelledCount: 2 };
      return { ok: true, status: 200, json: async () => data };
    },
  };
}
test("preview only reports archived sessions and never writes business data", async () => {
  const { calls, request } = fixture();
  const result = await reconcile(settings, request);
  assert.equal(result.mode, "preview");
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].pending, 2);
  assert.equal(calls.length, 2);
  assert(!JSON.stringify(result).includes("local-test-token"));
});
test("apply requires exact archived IDs and protected remote access", async () => {
  const { calls, request } = fixture();
  await assert.rejects(
    reconcile({ ...settings, apply: true }, request),
    /explicit/,
  );
  await assert.rejects(
    reconcile(
      { ...settings, base: "http://example.test", allowRemote: true },
      request,
    ),
    /HTTPS/,
  );
  await assert.rejects(
    reconcile({ ...settings, base: "https://example.test" }, request),
    /explicit/,
  );
  assert.equal(calls.length, 0);
  assert.throws(
    () => reconciliationPlan({ sessions: [online] }, [online.id]),
    /already archived/,
  );
  const result = await reconcile(
    { ...settings, apply: true, selectedIds: [archived.id] },
    request,
  );
  assert.equal(result.sessions[0].cancelledCount, 2);
  assert(calls[2].url.endsWith("/" + archived.id + "/archive"));
  assert.equal(JSON.parse(calls[2].body).requestId.length, 64);
});

test("old-backend preview derives counts without changing archival behavior", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, ...options });
    const data = url.endsWith("auth-with-password")
      ? { token: "test-token" }
      : url.endsWith("catalog")
        ? { sessions: [{ ...archived, assignmentCounts: undefined }] }
        : {
            items: [
              { session: archived.id, status: "active" },
              { session: archived.id, status: "completed" },
            ],
          };
    return { ok: true, status: 200, json: async () => data };
  };
  const preview = await reconcile(settings, request);
  assert.equal(preview.sessions[0].pending, 1);
  assert.equal(preview.sessions[0].completed, 1);
  assert.equal(calls.length, 3);
  await assert.rejects(
    reconcile(
      { ...settings, apply: true, selectedIds: [archived.id] },
      request,
    ),
    /Upgrade/,
  );
  assert(!calls.some((call) => call.url.endsWith("/archive")));
});
