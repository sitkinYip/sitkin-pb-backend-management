import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";

const auditTable = "game_admin_audit_logs";
const capacity = 2_000_000;
const byteSize = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");

test(
  "real PocketBase: audit capacity upgrade preserves existing data",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer({
      migrationNames: ["1787788800_game_schema.js"],
    });
    t.after(() => server.stop());
    const ok = (response) => {
      assert.equal(
        response.status,
        200,
        JSON.stringify(response.data).slice(0, 2000),
      );
      return response.data;
    };
    const call = (
      route,
      body,
      token = server.adminToken,
      method = body ? "POST" : "GET",
    ) => server.request("/api/questions/v1" + route, { token, method, body });
    const command = async (route, body = {}, token, method) =>
      ok(
        await call(route, { requestId: randomUUID(), ...body }, token, method),
      );
    const raw = (route, body, method = body ? "POST" : "GET") =>
      server.request("/api/collections/" + route, {
        token: server.superToken,
        body,
        method,
      });
    const schema = async () =>
      ok(
        await server.request("/api/collections?perPage=500&sort=name", {
          token: server.superToken,
        }),
      ).items.filter((row) => row.name.startsWith("game_"));
    const records = async (name) =>
      ok(await raw(name + "/records?perPage=500&sort=id")).items;
    const snapshot = async () => {
      const data = {};
      for (const collection of await schema())
        data[collection.name] = await records(collection.name);
      return data;
    };
    const catalogQuestion = async (id) =>
      ok(await call("/admin/catalog")).questions.find((row) => row.id === id);

    // Each JSON column fits its unchanged 200KB limit, while complete before/after
    // configuration is around 1MB. Include Chinese to exercise byte, not char, size.
    const original = {
      title: "大题面迁移前",
      kind: "text",
      content: Array.from({ length: 6 }, () => ({ text: "题".repeat(10000) })),
      options: Array.from({ length: 15 }, (_, i) => ({
        key: String(i),
        text: "选".repeat(3500),
      })),
      acceptedAnswers: [
        "旧答案",
        ...Array.from({ length: 15 }, (_, i) => `备选${i}` + "答".repeat(3500)),
      ],
    };
    const q = (await command("/admin/questions", original)).id;
    await command(`/admin/questions/${q}/publish`);
    const reward = (
      await command("/admin/rewards", {
        name: "迁移保留奖品",
        claimMethod: "staff",
      })
    ).id;
    const session = (
      await command("/admin/sessions", {
        title: "迁移前已完成场次",
        levels: [{ question: q, xp: 10 }],
        rewardRules: [{ trigger: "session_completed", reward }],
      })
    ).id;
    await command(`/admin/sessions/${session}/publish`);
    const password = `Test-${randomUUID()}`;
    const player = (
      await command("/admin/players", {
        account: "audit_migration_player",
        displayName: "迁移测试玩家",
        password,
      })
    ).id;
    ok(
      await raw(
        `game_players/records/${player}`,
        { mustChangePassword: false },
        "PATCH",
      ),
    );
    const playerToken = ok(
      await server.request("/api/collections/game_players/auth-with-password", {
        method: "POST",
        body: { identity: "audit_migration_player", password },
      }),
    ).token;
    const assignment = (
      await command("/admin/assignments", {
        sessionId: session,
        target: "selected",
        playerIds: [player],
      })
    ).results[0].assignmentId;
    const started = await command(
      `/assignments/${assignment}/start`,
      {},
      playerToken,
    );
    await command(
      `/assignments/${assignment}/answers`,
      {
        sessionLevelId: started.levels[0].id,
        answer: "旧答案",
      },
      playerToken,
    );
    await command(`/admin/sessions/${session}/archive`, {
      reason: "迁移前保留历史结算",
    });

    const beforeQuestion = await catalogQuestion(q);
    const updateBody = {
      ...original,
      requestId: randomUUID(),
      title: "大题面迁移后",
      content: original.content.map(() => ({ text: "新".repeat(10000) })),
      acceptedAnswers: ["新答案", ...original.acceptedAnswers.slice(1)],
      reason: "完整保留大题目的修改前后配置",
    };

    await t.test(
      "upgrade expands audit capacity, adds private empty collections and preserves seeded records",
      async () => {
        const beforeSchema = await schema();
        const oldAudit = beforeSchema.find((row) => row.name === auditTable);
        assert.equal(
          oldAudit.fields.find((field) => field.name === "safeDiff").maxSize,
          200000,
        );
        const before = await snapshot();
        assert.ok(before.game_admin_audit_logs.length > 0);
        assert.equal(before.game_player_stats[0].totalXp, 10);
        assert.equal(before.game_player_rewards.length, 1);
        assert.equal(before.game_assignments[0].status, "completed");

        // Demonstrate the old failure and the transaction rollback before upgrading.
        const failed = await call(
          `/admin/questions/${q}`,
          updateBody,
          undefined,
          "PATCH",
        );
        assert.equal(failed.status, 500);
        assert.equal(failed.data.error.code, "INTERNAL_ERROR");
        assert.deepEqual(await snapshot(), before);

        await server.upgradeMigrations();
        const afterSchema = await schema();
        const newAudit = afterSchema.find((row) => row.name === auditTable);
        assert.equal(
          newAudit.fields.find((field) => field.name === "safeDiff").maxSize,
          capacity,
        );
        const expected = structuredClone(beforeSchema);
        const expectedAudit = expected.find((row) => row.name === auditTable);
        expectedAudit.fields.find(
          (field) => field.name === "safeDiff",
        ).maxSize = capacity;
        expectedAudit.updated = newAudit.updated;
        const newQuestionClues = afterSchema.find(
          (row) => row.name === "game_question_clues",
        );
        const newQuestionSettings = afterSchema.find(
          (row) => row.name === "game_question_settings",
        );
        assert(newQuestionClues);
        assert(newQuestionSettings);
        assert.equal(newQuestionClues.listRule, null);
        assert.equal(newQuestionClues.createRule, null);
        assert.equal(newQuestionSettings.listRule, null);
        assert.equal(newQuestionSettings.createRule, null);
        assert.deepEqual(
          afterSchema.filter(
            (row) =>
              ![
                "game_question_clues",
                "game_question_settings",
                "game_player_level_titles",
                "game_extra_definitions",
                "game_extra_configs",
                "game_push_bindings",
                "game_push_deliveries",
                "game_push_settings",
                "game_push_subscriptions",
                "game_push_notice_contexts",
                "game_push_notice_deliveries",
                "game_push_journey_subscriptions",
                "game_push_journey_deliveries",
              ].includes(row.name),
          ),
          expected,
        );
        const after = await snapshot();
        assert.deepEqual(after.game_question_clues, []);
        assert.deepEqual(after.game_question_settings, []);
        delete after.game_question_clues;
        delete after.game_question_settings;
        for (const name of [
          "game_player_level_titles",
          "game_extra_definitions",
          "game_extra_configs",
          "game_push_bindings",
          "game_push_deliveries",
          "game_push_settings",
          "game_push_subscriptions",
          "game_push_notice_contexts",
          "game_push_notice_deliveries",
          "game_push_journey_subscriptions",
          "game_push_journey_deliveries",
        ]) {
          const collection = afterSchema.find((row) => row.name === name);
          assert(collection);
          for (const rule of [
            "listRule",
            "viewRule",
            "createRule",
            "updateRule",
            "deleteRule",
          ])
            assert.equal(collection[rule], null);
          assert.deepEqual(after[name], []);
          delete after[name];
        }
        assert.deepEqual(after, before);
      },
    );

    await t.test(
      "large edits retain full before/after configuration and original IDs without touching settlement",
      async () => {
        const before = await snapshot();
        const result = ok(
          await call(`/admin/questions/${q}`, updateBody, undefined, "PATCH"),
        );
        assert.equal(result.id, q);
        const afterQuestion = await catalogQuestion(q);
        const after = await snapshot();
        assert.equal(
          after.game_answer_keys[0].id,
          before.game_answer_keys[0].id,
        );
        assert.equal(afterQuestion.revision, beforeQuestion.revision);
        assert.equal(afterQuestion.title, updateBody.title);
        assert.deepEqual(
          afterQuestion.acceptedAnswers,
          updateBody.acceptedAnswers,
        );
        assert.deepEqual(
          afterQuestion.content.map((block) => block.text),
          updateBody.content.map((block) => block.text),
        );
        for (const [table, rows] of Object.entries(before)) {
          if (
            ![
              "game_questions",
              "game_answer_keys",
              "game_question_settings",
              auditTable,
              "game_command_receipts",
            ].includes(table)
          ) {
            assert.deepEqual(after[table], rows, table);
          }
        }
        assert.deepEqual(before.game_question_settings, []);
        assert.equal(after.game_question_settings.length, 1);
        assert.equal(after.game_question_settings[0].question, q);
        assert.equal(after.game_question_settings[0].answerMatchMode, "exact");
        assert.equal(after.game_question_settings[0].groupName, "其他");
        const audit = after[auditTable].find(
          (row) => row.requestId === updateBody.requestId,
        );
        const { usage: beforeUsage, ...expectedBefore } = beforeQuestion;
        const { usage: afterUsage, ...expectedAfter } = afterQuestion;
        assert.deepEqual(audit.safeDiff, {
          before: expectedBefore,
          after: expectedAfter,
        });
        assert.ok(byteSize(audit.safeDiff) > 900000);
        assert.ok(byteSize(audit.safeDiff) < capacity);
        const adminAudit = ok(await call("/admin/audit")).items.find(
          (row) => row.id === audit.id,
        );
        assert.deepEqual(adminAudit.safeDiff, audit.safeDiff);
        assert.equal(
          (await call("/admin/audit", undefined, playerToken)).status,
          401,
        );
        assert.notEqual(
          (
            await server.request(
              `/api/collections/${auditTable}/records/${audit.id}`,
              { token: playerToken },
            )
          ).status,
          200,
        );
        ok(await call(`/admin/questions/${q}`, updateBody, undefined, "PATCH"));
        assert.deepEqual(
          await snapshot(),
          after,
          "retry must not duplicate audit or settlement",
        );
      },
    );

    await t.test(
      "2MB is enforced in UTF-8 bytes without truncating oversized audit JSON",
      async () => {
        const existing = (await records(auditTable))[0];
        const valueAt = (size) => {
          const safeDiff = {
            text: "题".repeat(Math.floor((size - 20) / 3)),
            padding: "",
          };
          // Account for the JSON object's own punctuation and keys exactly.
          while (byteSize(safeDiff) > size)
            safeDiff.text = safeDiff.text.slice(0, -1);
          safeDiff.padding = "x".repeat(size - byteSize(safeDiff));
          assert.equal(byteSize(safeDiff), size);
          return safeDiff;
        };
        const fields = {
          actor: existing.actor,
          action: "audit_capacity_test",
          entityType: "game_questions",
          entityId: q,
          reason: "仅隔离测试容量边界",
          requestId: randomUUID(),
        };
        const safeDiff = valueAt(capacity);
        const created = ok(
          await raw(`${auditTable}/records`, { ...fields, safeDiff }),
        );
        assert.deepEqual(created.safeDiff, safeDiff);
        const rejected = await raw(`${auditTable}/records`, {
          ...fields,
          requestId: randomUUID(),
          safeDiff: valueAt(capacity + 1),
        });
        assert.equal(rejected.status, 400);
        assert.ok(rejected.data.data.safeDiff);
        assert.equal(
          (await records(auditTable)).filter(
            (row) => row.action === fields.action,
          ).length,
          1,
        );
      },
    );

    await t.test(
      "rerunning migrations preserves the expanded schema and all data",
      async () => {
        const beforeSchema = await schema();
        const before = await snapshot();
        await server.upgradeMigrations();
        assert.deepEqual(await schema(), beforeSchema);
        assert.deepEqual(await snapshot(), before);
      },
    );
  },
);
