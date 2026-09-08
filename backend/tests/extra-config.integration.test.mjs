import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";

test(
  "real PocketBase: personal titles and scoped extension delivery",
  { timeout: 180000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    const call = (path, body, token = server.adminToken) =>
      server.request(`/api/questions/v1${path}`, {
        token,
        body,
        method: body ? "POST" : "GET",
      });
    const command = (path, body, token) =>
      call(path, { requestId: randomUUID(), ...body }, token);
    const ok = (res) => {
      assert.equal(
        res.status,
        200,
        JSON.stringify(res.data) + "\n" + server.logs(),
      );
      return res.data;
    };
    const denied = (res, code, status = 400) => {
      assert.equal(res.status, status, JSON.stringify(res.data));
      assert.equal(res.data.error.code, code);
    };
    const raw = (table, id, body) =>
      server.request(`/api/collections/${table}/records${id ? `/${id}` : ""}`, {
        token: server.superToken,
        body,
        method: body ? (id ? "PATCH" : "POST") : "GET",
      });
    async function player() {
      const account = "p" + randomUUID().replaceAll("-", "").slice(0, 15),
        password = "Test-" + randomUUID();
      const p = ok(
        await command("/admin/players", {
          account,
          password,
          displayName: account,
        }),
      );
      ok(await raw("game_players", p.id, { mustChangePassword: false }));
      const auth = ok(
        await server.request(
          "/api/collections/game_players/auth-with-password",
          { method: "POST", body: { identity: account, password } },
        ),
      );
      return { id: p.id, token: auth.token };
    }
    const a = await player(),
      b = await player();
    const me = (p) => call("/me", undefined, p.token).then(ok);
    const initial = await me(a),
      ranks = ok(await call("/admin/catalog")).ranks;
    const titleInput = {
      levelId: ranks[0].id,
      name: "星河守护者",
      action: "save",
      expectedRevision: 0,
      reason: "专属名称测试",
      requestId: randomUUID(),
    };
    await t.test(
      "titles only change display names, including future ranks and revocation",
      async () => {
        const result = ok(
          await call(`/admin/players/${a.id}/titles`, titleInput),
        );
        assert.deepEqual(
          ok(await call(`/admin/players/${a.id}/titles`, titleInput)),
          result,
        );
        let current = await me(a);
        assert.equal(current.level.name, "星河守护者");
        assert.equal(current.level.defaultName, initial.level.name);
        assert.equal(current.totalXp, initial.totalXp);
        assert.equal(current.level.id, initial.level.id);
        assert.equal((await me(b)).level.name, initial.level.name);
        ok(
          await command(`/admin/players/${a.id}/titles`, {
            ...titleInput,
            requestId: randomUUID(),
            levelId: ranks[1].id,
            name: "未来头衔",
          }),
        );
        assert.equal((await me(a)).nextLevel.name, "未来头衔");
        ok(
          await command(`/admin/players/${a.id}/actions`, {
            action: "adjust_xp",
            delta: ranks[1].minTotalXp,
            reason: "验证升级仍按全局经验阈值",
          }),
        );
        assert.equal((await me(a)).level.id, ranks[1].id);
        assert.equal((await me(a)).level.name, "未来头衔");
        ok(
          await command(`/admin/players/${a.id}/actions`, {
            action: "adjust_xp",
            delta: -ranks[1].minTotalXp,
            reason: "验证降级恢复对应名称",
          }),
        );
        assert.equal((await me(a)).level.name, "星河守护者");
        denied(
          await command(`/admin/players/${a.id}/titles`, {
            ...titleInput,
            requestId: randomUUID(),
          }),
          "EDIT_CONFLICT",
          409,
        );
        denied(
          await command(`/admin/players/${a.id}/titles`, {
            ...titleInput,
            requestId: randomUUID(),
            expectedRevision: 1,
            xp: 999,
          }),
          "INVALID_INPUT",
        );
        denied(
          await command(`/admin/players/${a.id}/titles`, titleInput, b.token),
          "AUTH_REQUIRED",
          401,
        );
        ok(
          await command(`/admin/players/${a.id}/titles`, {
            levelId: ranks[0].id,
            action: "revoke",
            expectedRevision: 1,
            reason: "恢复默认",
          }),
        );
        assert.equal((await me(a)).level.name, initial.level.name);
      },
    );
    const fields = {
      type: "object",
      properties: {
        text: { type: "string", required: true, maxLength: 2000 },
        flag: { type: "boolean", default: false },
      },
    };
    async function define(key, overrides = {}) {
      return ok(
        await command("/admin/extra-definitions", {
          key,
          label: key,
          status: "active",
          expectedRevision: 0,
          reason: "创建测试字段",
          schema: {
            scopes: [
              "global",
              "rank",
              "question",
              "session",
              "assignment",
              "session_level",
              "assignment_level",
            ],
            contexts: ["profile", "assignment", "level"],
            visibility: "player",
            renderer: "text",
            fields,
            ...overrides,
          },
        }),
      );
    }
    const def = await define("welcome");
    async function preview(input = {}) {
      const body = {
        definitionId: def.id,
        scopeType: "global",
        audience: "selected",
        playerIds: [a.id],
        action: "value",
        extra: { text: "你好" },
        reason: "测试下发",
        ...input,
      };
      if (body.action !== "value") delete body.extra;
      if (body.audience !== "selected") delete body.playerIds;
      return {
        body,
        preview: ok(await call("/admin/extra-configs/preview", body)),
      };
    }
    async function deliver(input = {}) {
      const p = await preview(input);
      const body = {
        ...p.body,
        expectedVersion: p.preview.version,
        requestId: randomUUID(),
      };
      return {
        body,
        result: ok(await call("/admin/extra-configs/dispatch", body)),
      };
    }
    await t.test(
      "definitions validate types and JSON without changing the core protocol",
      async () => {
        for (const extra of [
          { text: 1 },
          { text: "x", arbitrary: 1 },
          { text: null },
          JSON.parse('{"text":"x","__proto__":{}}'),
        ]) {
          denied(
            await call("/admin/extra-configs/preview", {
              definitionId: def.id,
              scopeType: "global",
              audience: "public",
              action: "value",
              extra,
              reason: "校验",
            }),
            "INVALID_INPUT",
          );
        }
        const u = await define("urlTest", {
          fields: {
            type: "object",
            properties: { url: { type: "url", required: true } },
          },
          renderer: "none",
        });
        denied(
          await call("/admin/extra-configs/preview", {
            definitionId: u.id,
            scopeType: "global",
            audience: "public",
            action: "value",
            extra: { url: "javascript:alert(1)" },
            reason: "非法 URL",
          }),
          "INVALID_INPUT",
        );
        denied(
          await command("/admin/extra-definitions", {
            key: "bad",
            label: "bad",
            status: "active",
            expectedRevision: 0,
            reason: "校验",
          }),
          "INVALID_INPUT",
        );
        denied(
          await command("/admin/extra-definitions", {
            key: "constructor",
            label: "bad",
            status: "active",
            expectedRevision: 0,
            reason: "校验",
            schema: def.schema,
          }),
          "INVALID_INPUT",
        );
        denied(
          await call("/admin/extra-configs/query", {}, a.token),
          "AUTH_REQUIRED",
          401,
        );
      },
    );
    await t.test(
      "public defaults, selected users, suppression and withdrawal resolve deterministically",
      async () => {
        await deliver({ audience: "public", extra: { text: "公共欢迎" } });
        assert.equal((await me(b)).extra.welcome.text, "公共欢迎");
        const individual = await deliver({
          extra: { text: "专属欢迎", flag: false },
        });
        assert.deepEqual(
          ok(await call("/admin/extra-configs/dispatch", individual.body)),
          individual.result,
        );
        assert.equal((await me(a)).extra.welcome.text, "专属欢迎");
        assert.equal((await me(a)).extra.welcome.flag, false);
        assert.equal(
          (await me(a)).extraDisplay.find((i) => i.key === "welcome").text,
          "专属欢迎",
        );
        await deliver({ action: "suppress" });
        assert.equal((await me(a)).extra.welcome, undefined);
        await deliver({ action: "revoke" });
        assert.equal((await me(a)).extra.welcome.text, "公共欢迎");
        await deliver({
          scopeType: "rank",
          scopeId: ranks[0].id,
          audience: "public",
          extra: { text: "等级公共值" },
        });
        await deliver({ extra: { text: "个人全局值" } });
        assert.equal(
          (await me(a)).extra.welcome.text,
          "等级公共值",
          "scope specificity precedes personal audience",
        );
        const internal = await define("staffNote", {
          visibility: "admin",
          renderer: "none",
        });
        await deliver({
          definitionId: internal.id,
          extra: { text: "内部备注" },
        });
        assert.equal((await me(a)).extra.staffNote, undefined);
        const rawSelf = await server.request(
          `/api/collections/game_players/records/${a.id}`,
          { token: a.token },
        );
        assert.equal(JSON.stringify(rawSelf.data).includes("内部备注"), false);
        for (const table of [
          "game_player_level_titles",
          "game_extra_definitions",
          "game_extra_configs",
        ]) {
          const response = await server.request(
            `/api/collections/${table}/records`,
            { token: a.token },
          );
          assert.notEqual(response.status, 200);
        }
      },
    );
    await t.test(
      "snapshot recipients, concurrency and batch withdrawal preserve newer edits",
      async () => {
        const snapshot = await define("snapshot");
        const before = await preview({
          definitionId: snapshot.id,
          audience: "all",
          extra: { text: "当前用户" },
        });
        const c = await player();
        denied(
          await command("/admin/extra-configs/dispatch", {
            ...before.body,
            expectedVersion: before.preview.version,
          }),
          "EDIT_CONFLICT",
          409,
        );
        const all = await deliver({
          definitionId: snapshot.id,
          audience: "all",
          extra: { text: "当前用户" },
        });
        const d = await player();
        assert((await me(c)).extra.snapshot);
        assert.equal((await me(d)).extra.snapshot, undefined);
        assert.deepEqual(
          ok(await call("/admin/extra-configs/dispatch", all.body)),
          all.result,
          "replay cannot add new users",
        );
        await deliver({
          definitionId: snapshot.id,
          extra: { text: "较新的个人值" },
        });
        denied(
          await command("/admin/extra-configs/revoke-batch", {
            batchId: all.result.requestId,
            records: all.result.results.map((i) => ({
              id: i.id,
              revision: i.revision,
            })),
            reason: "撤销旧批次",
          }),
          "EDIT_CONFLICT",
          409,
        );
        assert.equal(
          (await me(c)).extra.snapshot.text,
          "当前用户",
          "batch conflict rolls back all changes",
        );
        const one = await deliver({
          definitionId: snapshot.id,
          extra: { text: "可撤销" },
        });
        ok(
          await command("/admin/extra-configs/revoke-batch", {
            batchId: one.result.requestId,
            records: one.result.results.map((i) => ({
              id: i.id,
              revision: i.revision,
            })),
            reason: "撤销最新批次",
          }),
        );
        assert.equal((await me(a)).extra.snapshot, undefined);
        ok(await raw("game_players", c.id, { status: "disabled" }));
        const skipped = await deliver({
          definitionId: snapshot.id,
          playerIds: [a.id, c.id],
        });
        assert.deepEqual(skipped.result.skippedIds, [c.id]);
        denied(
          await call("/admin/extra-configs/dispatch", {
            ...one.body,
            extra: { text: "换内容" },
          }),
          "IDEMPOTENCY_CONFLICT",
          409,
        );
      },
    );
    const question = ok(
      await command("/admin/questions", {
        title: "扩展题面",
        kind: "text",
        content: [{ text: "输入测试答案" }],
        options: [],
        acceptedAnswers: ["答案"],
      }),
    );
    ok(await command(`/admin/questions/${question.id}/publish`, {}));
    const session = ok(
      await command("/admin/sessions", {
        title: "扩展场次",
        levels: [
          { question: question.id, xp: 10 },
          { question: question.id, xp: 20 },
        ],
        clues: [],
        rewardRules: [],
      }),
    );
    ok(await command(`/admin/sessions/${session.id}/publish`, {}));
    const assignment = ok(
      await command("/admin/assignments", {
        sessionId: session.id,
        target: "selected",
        playerIds: [a.id, b.id],
      }),
    );
    const assignmentId = assignment.results.find(
      (i) => i.playerId === a.id,
    ).assignmentId;
    let view = ok(
      await call(`/assignments/${assignmentId}`, undefined, a.token),
    );
    const [first, second] = view.levels;
    await t.test(
      "object scope and access checks prevent unearned content and cross-user leakage",
      async () => {
        await deliver({
          scopeType: "question",
          scopeId: question.id,
          extra: { text: "题目级别" },
        });
        await deliver({
          scopeType: "session",
          scopeId: session.id,
          extra: { text: "场次级别" },
        });
        await deliver({
          scopeType: "assignment",
          scopeId: assignmentId,
          extra: { text: "单次任务" },
        });
        await deliver({
          scopeType: "session_level",
          scopeId: first.id,
          audience: "public",
          extra: { text: "关卡公共值" },
        });
        const precise = {
          scopeType: "assignment_level",
          scopeId: first.id,
          assignmentId,
          extra: { text: "本次此关专属值" },
        };
        await deliver(precise);
        await deliver({
          scopeType: "session_level",
          scopeId: second.id,
          extra: { text: "未来关卡隐藏" },
        });
        view = ok(
          await call(`/assignments/${assignmentId}`, undefined, a.token),
        );
        assert.equal(view.extra.welcome.text, "单次任务");
        assert.equal(view.levels[0].extra, undefined);
        assert.equal(view.levels[1].extra, undefined);
        denied(
          await call("/admin/extra-configs/preview", {
            definitionId: def.id,
            audience: "selected",
            playerIds: [b.id],
            action: "value",
            reason: "越权",
            ...precise,
          }),
          "INVALID_INPUT",
        );
        denied(
          await call("/admin/extra-configs/preview", {
            definitionId: def.id,
            audience: "public",
            action: "value",
            reason: "越权",
            ...precise,
          }),
          "INVALID_INPUT",
        );
        view = ok(
          await command(`/assignments/${assignmentId}/start`, {}, a.token),
        );
        assert.equal(view.levels[0].extra.welcome.text, "本次此关专属值");
        assert.equal(view.levels[1].extra, undefined);
        const inspection = ok(
          await call("/admin/extra-configs/inspect", {
            playerId: a.id,
            context: "level",
            assignmentId,
            sessionLevelId: first.id,
          }),
        );
        assert.equal(inspection.extra.welcome.text, "本次此关专属值");
        assert.equal(
          inspection.sources.welcome.targetKey,
          `assignment_level:${assignmentId}:${first.id}`,
        );
        const answer = ok(
          await command(
            `/assignments/${assignmentId}/answers`,
            { sessionLevelId: first.id, answer: "答案" },
            a.token,
          ),
        );
        assert.equal(answer.xpDelta, 10);
        assert.equal(answer.player.totalXp, initial.totalXp + 10);
        assert.equal(
          answer.assignment.levels[1].extra.welcome.text,
          "未来关卡隐藏",
        );
        const otherView = ok(
          await call(
            `/assignments/${assignment.results.find((i) => i.playerId === b.id).assignmentId}`,
            undefined,
            b.token,
          ),
        );
        assert.equal(
          JSON.stringify(otherView).includes("本次此关专属值"),
          false,
        );
      },
    );
    await t.test(
      "optional schema additions work; breaking changes and private-to-public changes are blocked",
      async () => {
        const data = {
          id: def.id,
          key: def.key,
          label: def.label,
          status: "active",
          expectedRevision: def.revision,
          reason: "增加可选属性",
        };
        const updated = ok(
          await command("/admin/extra-definitions", {
            ...data,
            schema: {
              ...def.schema,
              fields: {
                ...def.schema.fields,
                properties: {
                  ...def.schema.fields.properties,
                  subtitle: { type: "string", default: "默认附注" },
                },
              },
            },
          }),
        );
        assert.equal((await me(a)).extra.welcome.subtitle, "默认附注");
        denied(
          await command("/admin/extra-definitions", {
            ...data,
            expectedRevision: updated.revision,
            schema: { ...updated.schema, visibility: "admin" },
          }),
          "INVALID_INPUT",
        );
        denied(
          await command("/admin/extra-definitions", {
            ...data,
            expectedRevision: updated.revision,
            schema: {
              ...updated.schema,
              fields: { type: "object", properties: {} },
            },
          }),
          "INVALID_INPUT",
        );
        ok(
          await command("/admin/extra-definitions", {
            ...data,
            expectedRevision: updated.revision,
            schema: updated.schema,
            status: "disabled",
          }),
        );
        assert.equal((await me(a)).extra.welcome, undefined);
      },
    );
    await t.test(
      "malformed optional configuration does not break the player and core stats persist",
      async () => {
        const latest = ok(await call("/admin/extra-definitions")).items.find(
          (item) => item.id === def.id,
        );
        ok(
          await command("/admin/extra-definitions", {
            id: latest.id,
            key: latest.key,
            label: latest.label,
            schema: latest.schema,
            status: "active",
            expectedRevision: latest.revision,
            reason: "验证已激活坏数据隔离",
          }),
        );
        const cfg = ok(
          await call("/admin/extra-configs/query", {
            definitionId: def.id,
            scopeType: "rank",
          }),
        ).items[0];
        ok(await raw("game_extra_configs", cfg.id, { extra: { text: 123 } }));
        assert.equal((await me(a)).totalXp, initial.totalXp + 10);
        assert.equal((await me(a)).extra.welcome, undefined);
        ok(await raw("game_extra_definitions", def.id, { schema: {} }));
        assert.equal((await me(a)).extra.welcome, undefined);
        const catalog = ok(await call("/admin/catalog"));
        assert.equal(catalog.ranks[0].name, ranks[0].name);
        assert.deepEqual(catalog.capabilities, {
          playerTitles: true,
          extraConfig: true,
        });
        const beforeRestart = await me(a);
        await server.restart();
        assert.deepEqual(await me(a), beforeRestart);
      },
    );
  },
);
