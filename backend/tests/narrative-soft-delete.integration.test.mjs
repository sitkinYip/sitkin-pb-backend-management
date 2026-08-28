import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";

test(
  "real PocketBase: narrative soft deletion and reference integrity",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    const call = (
      path,
      body,
      method = body ? "POST" : "GET",
      token = server.adminToken,
    ) => server.request("/api/questions/v1" + path, { body, method, token });
    const command = (path, body = {}, method, token) =>
      call(path, { requestId: randomUUID(), ...body }, method, token);
    const ok = (response) => {
      assert.equal(
        response.status,
        200,
        JSON.stringify(response.data) + "\n" + server.logs(),
      );
      return response.data;
    };
    const denied = (response, code) => {
      assert.equal(response.status, 409, JSON.stringify(response.data));
      assert.equal(response.data.error.code, code);
      return response.data.error.message;
    };
    const records = async (table) =>
      ok(
        await server.request(
          `/api/collections/${table}/records?perPage=500&sort=id`,
          { token: server.superToken },
        ),
      ).items;
    const rawPatch = async (table, id, body) =>
      ok(
        await server.request(`/api/collections/${table}/records/${id}`, {
          token: server.superToken,
          method: "PATCH",
          body,
        }),
      );
    const catalog = async () => ok(await call("/admin/catalog"));
    const publish = (type, id) => command(`/admin/${type}/${id}/publish`);
    const close = (id) =>
      command(`/admin/sessions/${id}/archive`, { reason: "测试下线" });
    const remove = (id, body = {}) =>
      command(`/admin/narratives/${id}/archive`, {
        reason: "旧内容移出",
        ...body,
      });
    const narrative = async (kind = "letter", published = true) => {
      const id = ok(
        await command("/admin/narratives", {
          kind,
          title: `${kind} 保留正文`,
          payload:
            kind === "letter"
              ? {
                  variant: "modern",
                  paragraphs: [{ content: "不可丢失的正文" }],
                  backgroundImages: ["https://cdn.example.com/original.png"],
                }
              : {
                  phrases: [{ text: "保留祝福" }],
                  closingLines: [{ text: "保留谢幕" }],
                },
        }),
      ).id;
      if (published) ok(await publish("narratives", id));
      return id;
    };
    const question = ok(
      await command("/admin/questions", {
        title: "测试题",
        kind: "text",
        content: [{ text: "题面" }],
        acceptedAnswers: ["答案"],
        options: [],
      }),
    ).id;
    ok(await publish("questions", question));
    const reference = (id, source) =>
      source === "target"
        ? { completionTarget: { kind: "narrative", id } }
        : { clues: [{ kind: "letter", trigger: "start", narrative: id }] };
    const scene = async (extra = {}, published = false) => {
      const id = ok(
        await command("/admin/sessions", {
          title: "引用场次",
          levels: [{ question, xp: 10 }],
          ...extra,
        }),
      ).id;
      if (published) ok(await publish("sessions", id));
      return id;
    };
    const snapshot = async (tables) =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async (table) => [table, await records(table)]),
        ),
      );
    const structural = [
      "game_sessions",
      "game_session_levels",
      "game_clues",
      "game_reward_rules",
    ];

    for (const kind of ["letter", "bless"])
      for (const published of [false, true]) {
        await t.test(
          `${kind} ${published ? "published" : "draft"}: unreferenced delete preserves payload and audits once`,
          async () => {
            const id = await narrative(kind, published);
            const before = (await catalog()).narratives.find(
              (n) => n.id === id,
            );
            const requestId = randomUUID();
            assert.equal((await remove(id, { reason: "  " })).status, 400);
            assert.deepEqual(
              (await catalog()).narratives.find((n) => n.id === id),
              before,
            );
            assert(
              !(await records("game_admin_audit_logs")).some(
                (a) => a.action === "delete_narrative" && a.entityId === id,
              ),
            );
            ok(await remove(id, { requestId }));
            ok(await remove(id, { requestId }));
            ok(await remove(id));
            denied(
              await remove(id, { requestId, reason: "不同原因" }),
              "IDEMPOTENCY_CONFLICT",
            );
            assert.deepEqual(
              (await catalog()).narratives.find((n) => n.id === id),
              { ...before, status: "archived" },
            );
            const logs = (await records("game_admin_audit_logs")).filter(
              (a) => a.action === "delete_narrative" && a.entityId === id,
            );
            assert.equal(logs.length, 1);
            assert(logs[0].actor);
            assert.equal(logs[0].reason, "旧内容移出");
            assert.deepEqual(logs[0].safeDiff, {
              from: before.status,
              to: "archived",
              historyCount: 0,
            });
            denied(await publish("narratives", id), "INVALID_STATE");
            denied(
              await command(
                `/admin/narratives/${id}`,
                { ...before, title: "不能改" },
                "PATCH",
              ),
              "PUBLISHED_IMMUTABLE",
            );
          },
        );
      }

    await t.test(
      "audit persistence failure rolls back status and receipt, and the same request can retry",
      async () => {
        const id = await narrative();
        const requestId = randomUUID();
        const tables = [
          "game_narratives",
          "game_admin_audit_logs",
          "game_command_receipts",
        ];
        const before = await snapshot(tables);
        const schema = ok(
          await server.request("/api/collections/game_admin_audit_logs", {
            token: server.superToken,
          }),
        );
        const fields = schema.fields.map((field) =>
          field.name === "reason" ? { ...field, max: 1 } : field,
        );
        try {
          // Fault injection only in this disposable test database: row.save succeeds,
          // then audit.save fails, so the encompassing command must roll back both.
          ok(
            await server.request("/api/collections/game_admin_audit_logs", {
              token: server.superToken,
              method: "PATCH",
              body: { fields },
            }),
          );
          assert.notEqual((await remove(id, { requestId })).status, 200);
          assert.deepEqual(await snapshot(tables), before);
        } finally {
          ok(
            await server.request("/api/collections/game_admin_audit_logs", {
              token: server.superToken,
              method: "PATCH",
              body: { fields: schema.fields },
            }),
          );
        }
        ok(await remove(id, { requestId }));
        assert.equal(
          (await catalog()).narratives.find((n) => n.id === id).status,
          "archived",
        );
      },
    );

    for (const source of ["clue", "target"])
      for (const published of [false, true]) {
        await t.test(
          `${source}: ${published ? "online" : "draft"} blocks deletion, archived permits it`,
          async () => {
            const id = await narrative();
            const session = await scene(reference(id, source), published);
            const tables = [
              ...structural,
              "game_narratives",
              "game_admin_audit_logs",
              "game_command_receipts",
            ];
            const before = await snapshot(tables);
            const message = denied(await remove(id), "NARRATIVE_IN_USE");
            assert.match(message, /引用场次/);
            assert(message.includes(published ? "线上" : "草稿"));
            assert.deepEqual(await snapshot(tables), before);
            ok(await close(session));
            const history = await snapshot(structural);
            ok(await remove(id));
            assert.deepEqual(await snapshot(structural), history);
          },
        );
      }

    await t.test(
      "all sessions count, duplicate locations deduplicate, and IDs—not series—control deletion",
      async () => {
        const id = await narrative();
        const first = await scene(
          {
            ...reference(id, "target"),
            clues: [
              { kind: "letter", trigger: "start", narrative: id },
              { kind: "text", trigger: "manual", narrative: id },
            ],
          },
          true,
        );
        const second = await scene({
          title: "另一草稿",
          ...reference(id, "target"),
        });
        const message = denied(await remove(id), "NARRATIVE_IN_USE");
        assert.equal(message.split("引用场次").length - 1, 1);
        assert.match(message, /另一草稿/);
        const copy = ok(
          await command(`/admin/narratives/${id}`, { clone: true }),
        ).id;
        ok(await remove(copy)); // Same series, different ID, no references.
        ok(await close(first));
        denied(await remove(id), "NARRATIVE_IN_USE");
        ok(await close(second));
        ok(await remove(id));
        const audit = (await records("game_admin_audit_logs")).find(
          (a) => a.action === "delete_narrative" && a.entityId === id,
        );
        assert.equal(audit.safeDiff.historyCount, 2);
      },
    );

    for (const source of ["clue", "target"]) {
      await t.test(
        `${source}: new/edit/publish reject removed content; clone preserves references for repair`,
        async () => {
          const id = await narrative();
          const old = await scene(reference(id, source), true);
          ok(await close(old));
          ok(await remove(id));
          const before = await snapshot(structural);
          denied(
            await command("/admin/sessions", {
              title: "无效新建",
              levels: [{ question, xp: 0 }],
              ...reference(id, source),
            }),
            "NARRATIVE_DELETED",
          );
          // clone:true without an actual source must not bypass new-session validation.
          denied(
            await command("/admin/sessions", {
              clone: true,
              title: "无效复制",
              levels: [{ question, xp: 0 }],
              ...reference(id, source),
            }),
            "NARRATIVE_DELETED",
          );
          assert.deepEqual(await snapshot(structural), before);
          const copy = ok(
            await command(`/admin/sessions/${old}`, { clone: true }),
          ).id;
          const draft = (await catalog()).sessions.find((s) => s.id === copy);
          if (source === "target") assert.equal(draft.completionTarget.id, id);
          else assert.equal(draft.clues[0].narrative, id);
          const state = await snapshot([
            ...structural,
            "game_command_receipts",
            "game_admin_audit_logs",
          ]);
          denied(
            await command(
              `/admin/sessions/${copy}`,
              { ...draft, title: "必须先修复" },
              "PATCH",
            ),
            "NARRATIVE_DELETED",
          );
          assert.match(
            denied(await publish("sessions", copy), "NARRATIVE_DELETED"),
            /替换或移除引用/,
          );
          assert.deepEqual(
            await snapshot([
              ...structural,
              "game_command_receipts",
              "game_admin_audit_logs",
            ]),
            state,
          );
          const replacement = ok(
            await command(`/admin/narratives/${id}`, { clone: true }),
          ).id;
          ok(await publish("narratives", replacement));
          ok(
            await command(
              `/admin/sessions/${copy}`,
              { ...draft, ...reference(replacement, source) },
              "PATCH",
            ),
          );
          ok(await publish("sessions", copy));
          assert.equal(
            (await catalog()).sessions.find((s) => s.id === old).status,
            "archived",
          );
          assert.equal(
            (await catalog()).narratives.find((n) => n.id === id).status,
            "archived",
          );
        },
      );
    }

    await t.test(
      "repair can remove references instead of replacing, while unpublished content still blocks publish",
      async () => {
        const id = await narrative("bless");
        const old = await scene({
          ...reference(id, "target"),
          ...reference(id, "clue"),
        });
        ok(await close(old));
        ok(await remove(id));
        const copy = ok(
          await command(`/admin/sessions/${old}`, { clone: true }),
        ).id;
        const draft = (await catalog()).sessions.find((s) => s.id === copy);
        ok(
          await command(
            `/admin/sessions/${copy}`,
            { ...draft, clues: [], completionTarget: null },
            "PATCH",
          ),
        );
        ok(await publish("sessions", copy));
        const pending = await narrative("letter", false);
        const pendingScene = await scene(reference(pending, "target"));
        assert.equal((await publish("sessions", pendingScene)).status, 400);
        ok(await publish("narratives", pending));
        ok(await publish("sessions", pendingScene));
      },
    );

    await t.test(
      "concurrent save/publish and delete never introduce live removed references",
      async () => {
        for (const source of ["clue", "target"])
          for (let attempt = 0; attempt < 3; attempt++) {
            const id = await narrative();
            const draft = await scene();
            const row = (await catalog()).sessions.find((s) => s.id === draft);
            const [saved, deleted] = await Promise.all([
              command(
                `/admin/sessions/${draft}`,
                { ...row, ...reference(id, source) },
                "PATCH",
              ),
              remove(id),
            ]);
            if (saved.status === 200) {
              denied(deleted, "NARRATIVE_IN_USE");
              const [published, retried] = await Promise.all([
                publish("sessions", draft),
                remove(id),
              ]);
              ok(published);
              denied(retried, "NARRATIVE_IN_USE");
            } else {
              denied(saved, "NARRATIVE_DELETED");
              ok(deleted);
            }
            const state = await catalog();
            const content = state.narratives.find((n) => n.id === id);
            const session = state.sessions.find((s) => s.id === draft);
            if (content.status === "archived") {
              assert(!session.clues.some((c) => c.narrative === id));
              assert.notEqual(session.completionTarget?.id, id);
            }
          }
      },
    );

    await t.test(
      "legacy archives remain readable; offline deletion preserves XP, grants, claim and redemption data",
      async () => {
        const id = await narrative();
        const reward = ok(
          await command("/admin/rewards", {
            name: "保留奖品",
            claimMethod: "staff",
          }),
        ).id;
        const session = await scene(
          {
            ...reference(id, "clue"),
            ...reference(id, "target"),
            rewardRules: [{ trigger: "session_completed", reward }],
          },
          true,
        );
        const account = "p" + randomUUID().replaceAll("-", "").slice(0, 16);
        const password = "T-" + randomUUID();
        const playerId = ok(
          await command("/admin/players", {
            account,
            password,
            displayName: "隔离玩家",
          }),
        ).id;
        await rawPatch("game_players", playerId, { mustChangePassword: false });
        const token = ok(
          await server.request(
            "/api/collections/game_players/auth-with-password",
            { method: "POST", body: { identity: account, password } },
          ),
        ).token;
        const assignment = ok(
          await command("/admin/assignments", {
            sessionId: session,
            target: "selected",
            playerIds: [playerId],
          }),
        ).results[0].assignmentId;
        const entered = ok(
          await command(`/assignments/${assignment}/start`, {}, "POST", token),
        );
        await rawPatch("game_narratives", id, { status: "archived" }); // Pre-upgrade fixture only.
        const reader = `/assignments/${assignment}/narratives/${id}`;
        ok(await call(reader, undefined, "GET", token));
        const legacyBefore = await snapshot([
          "game_narratives",
          "game_admin_audit_logs",
        ]);
        ok(await remove(id)); // Retry must not break the legacy scene or audit a new deletion.
        assert.deepEqual(
          await snapshot(["game_narratives", "game_admin_audit_logs"]),
          legacyBefore,
        );
        const result = ok(
          await command(
            `/assignments/${assignment}/answers`,
            { sessionLevelId: entered.levels[0].id, answer: "答案" },
            "POST",
            token,
          ),
        );
        ok(await call(reader, undefined, "GET", token)); // Completion target as well as clue.
        const grant = result.rewardIds[0];
        ok(
          await command(`/admin/grants/${grant}/actions`, {
            action: "claim_details",
            claimDetails: "KEEP-CODE",
            reason: "登记",
          }),
        );
        ok(
          await command(`/admin/grants/${grant}/actions`, {
            action: "redeem",
            reason: "已领取",
          }),
        );
        // Recreate a normally published narrative so this tests a real new soft deletion.
        await rawPatch("game_narratives", id, { status: "published" });
        ok(await close(session));
        const tables = [
          ...structural,
          "game_assignments",
          "game_level_progress",
          "game_answer_submissions",
          "game_xp_ledger",
          "game_player_stats",
          "game_player_rewards",
          "game_clue_unlocks",
        ];
        const before = await snapshot(tables);
        ok(await remove(id));
        assert.deepEqual(await snapshot(tables), before);
        denied(await call(reader, undefined, "GET", token), "SESSION_OFFLINE");
        assert.equal(
          ok(await call("/me", undefined, "GET", token)).totalXp,
          10,
        );
        ok(
          await command(`/admin/grants/${grant}/actions`, {
            action: "undo_redeem",
            reason: "测试撤销核销",
          }),
        );
        const available = ok(
          await call("/rewards", undefined, "GET", token),
        ).items.find((r) => r.id === grant);
        assert.equal(available.status, "available");
        assert.equal(available.claimDetails, "KEEP-CODE");
        ok(
          await command(`/admin/grants/${grant}/actions`, {
            action: "redeem",
            reason: "删除后仍可领取",
          }),
        );
      },
    );
  },
);
