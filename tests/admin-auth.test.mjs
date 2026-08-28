import test from "node:test";
import assert from "node:assert/strict";
import { createAdminAuthProvider } from "../src/providers/admin-auth.ts";
import {
  ADMIN_HOME,
  ADMIN_LOGIN,
  adminResources,
  adminReturnPath,
  normalizeAdminLoginSearch,
} from "../src/providers/admin-routing.ts";

function fixture() {
  const calls = [];
  const authStore = {
    isValid: false,
    record: null,
    clear() {
      this.isValid = false;
      this.record = null;
      calls.push("clear");
    },
  };
  const client = {
    authStore,
    collection(name) {
      return {
        async authWithPassword(account) {
          calls.push({ collection: name, account });
          authStore.isValid = true;
          authStore.record = { collectionName: "game_admins" };
        },
      };
    },
    async send(path) {
      calls.push(path);
      return { id: "fixture-admin" };
    },
  };
  return { provider: createAdminAuthProvider(client), client, calls };
}

test("first menu item and successful login share the explicit default page", async () => {
  const { provider, calls } = fixture();
  const result = await provider.login({
    account: "  SITKIN_ADMIN  ",
    password: "not-a-real-secret",
  });
  assert.equal(result.success, true);
  assert.equal(result.redirectTo, ADMIN_HOME);
  assert.equal(adminResources[0].list, ADMIN_HOME);
  assert.deepEqual(calls, [
    { collection: "game_admins", account: "sitkin_admin" },
    "/api/questions/v1/admin/me",
  ]);
});

test("logout clears the account and returns to the account login; relogin works", async () => {
  const { provider, client } = fixture();
  await provider.login({ account: "test_admin", password: "fixture" });
  const logout = await provider.logout({});
  assert.equal(logout.redirectTo, ADMIN_LOGIN);
  assert.equal(client.authStore.isValid, false);
  assert.equal(client.authStore.record, null);
  assert.equal((await provider.check({})).authenticated, false);
  assert.equal(
    (await provider.login({ account: "test_admin", password: "fixture" }))
      .redirectTo,
    ADMIN_HOME,
  );
});

test("login does not fall back to the retired email identity form", async () => {
  const { provider, calls } = fixture();
  assert.equal(
    (await provider.login({ email: "old@example.test", password: "fixture" }))
      .success,
    false,
  );
  assert.deepEqual(calls, ["clear"]);
});

test("failed server role verification clears a partially authenticated account", async () => {
  const { provider, client } = fixture();
  client.send = async () => {
    throw new Error("Account disabled");
  };
  assert.equal(
    (await provider.login({ account: "test_admin", password: "fixture" }))
      .success,
    false,
  );
  assert.equal(client.authStore.isValid, false);
});

test("old users or superuser sessions cannot authenticate the business admin", async () => {
  const { provider, client } = fixture();
  for (const collectionName of ["users", "_superusers", "game_players"]) {
    client.authStore.isValid = true;
    client.authStore.record = { collectionName };
    assert.deepEqual(await provider.check({}), {
      authenticated: false,
      redirectTo: ADMIN_LOGIN,
    });
  }
});

test("missing, retired and unsafe return addresses use the first menu page", () => {
  for (const value of [
    undefined,
    null,
    "",
    "/",
    "/levels",
    "/levels/edit/old",
    "/letter",
    "/login",
    "/register",
    "/forgot-password",
    "https://other.test",
    "//other.test/players",
    "/\\other.test",
    "/players\n",
    "/unknown",
  ]) {
    assert.equal(adminReturnPath(value), ADMIN_HOME, String(value));
  }
});

test("only current menu routes can be preserved as login destinations", () => {
  for (const resource of adminResources)
    assert.equal(adminReturnPath(resource.list), resource.list);
  assert.equal(
    adminReturnPath("/sessions/?page=2#list"),
    "/sessions?page=2#list",
  );
  assert.equal(
    adminReturnPath("/questions?to=%2Flevels&page=2"),
    "/questions?page=2",
  );
});

test("Refine return parameter is sanitized before its login hook mounts", () => {
  assert.equal(normalizeAdminLoginSearch("?to=%2Flevels"), "");
  assert.equal(normalizeAdminLoginSearch("?to=https%3A%2F%2Fother.test"), "");
  assert.equal(
    normalizeAdminLoginSearch("?to=%2Flogin%3Fto%3D%252Flevels"),
    "",
  );
  assert.equal(normalizeAdminLoginSearch("?to=%2Fquestions&to=%2Flevels"), "");
  assert.equal(
    normalizeAdminLoginSearch("?release=fix&to=%2Flevels"),
    "?release=fix",
  );
  const valid = normalizeAdminLoginSearch("?to=%2Fquestions%3Fpage%3D2");
  assert.equal(new URLSearchParams(valid).get("to"), "/questions?page=2");
  assert.equal(normalizeAdminLoginSearch(valid), valid);
});
