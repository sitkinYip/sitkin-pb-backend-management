import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";
import { reconcile } from "../scripts/reconcile-closed-sessions.mjs";

test(
  "real PocketBase: permanent session closure and question reference locks",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    const call = (
      path,
      body,
      token = server.adminToken,
      method = body ? "POST" : "GET",
    ) => server.request("/api/questions/v1" + path, { token, method, body });
    const command = (path, body = {}, token) =>
      call(path, { requestId: randomUUID(), ...body }, token);
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
    };
    const records = async (table, filter = "") =>
      ok(
        await server.request(
          "/api/collections/" +
            table +
            "/records?perPage=500&filter=" +
            encodeURIComponent(filter),
          { token: server.superToken },
        ),
      ).items;
    const rawPatch = (table, id, body) =>
      server.request("/api/collections/" + table + "/records/" + id, {
        token: server.superToken,
        method: "PATCH",
        body,
      });
    const catalog = async () => ok(await call("/admin/catalog"));
    const question = async () => {
      const result = ok(
        await command("/admin/questions", {
          title: "原题面",
          kind: "text",
          content: [{ text: "原正文" }],
          acceptedAnswers: ["原答案"],
          options: [],
        }),
      );
      ok(await command("/admin/questions/" + result.id + "/publish"));
      return result.id;
    };
    const scene = async (q, extra = {}, publish = true) => {
      const result = ok(
        await command("/admin/sessions", {
          title: "测试场次",
          levels: [{ question: q, xp: 10 }],
          ...extra,
        }),
      );
      if (publish)
        ok(await command("/admin/sessions/" + result.id + "/publish"));
      return result.id;
    };
    const close = (id, extra = {}) =>
      command("/admin/sessions/" + id + "/archive", {
        reason: "测试永久下线",
        ...extra,
      });
    const edit = async (id, extra = {}) => {
      const row = (await catalog()).questions.find((q) => q.id === id);
      return call(
        "/admin/questions/" + id,
        {
          ...row,
          title: "修正题面",
          acceptedAnswers: ["新答案"],
          reason: "修正配置",
          requestId: randomUUID(),
          ...extra,
        },
        server.adminToken,
        "PATCH",
      );
    };
    async function player() {
      const account = "p" + randomUUID().replaceAll("-", "").slice(0, 16);
      const password = "Test-" + randomUUID();
      const created = ok(
        await command("/admin/players", {
          account,
          password,
          displayName: "隔离测试玩家",
        }),
      );
      ok(
        await rawPatch("game_players", created.id, {
          mustChangePassword: false,
        }),
      );
      const auth = ok(
        await server.request(
          "/api/collections/game_players/auth-with-password",
          {
            method: "POST",
            body: { identity: account, password },
          },
        ),
      );
      return { id: created.id, token: auth.token };
    }
    const assign = async (sessionId, subject, extra = {}) =>
      ok(
        await command("/admin/assignments", {
          sessionId,
          target: "selected",
          playerIds: [subject.id],
          ...extra,
        }),
      ).results[0];
    const start = (id, subject, requestId = randomUUID()) =>
      command("/assignments/" + id + "/start", { requestId }, subject.token);
    const answer = (id, level, subject, extra = {}) =>
      command(
        "/assignments/" + id + "/answers",
        {
          sessionLevelId: level,
          answer: "原答案",
          ...extra,
        },
        subject.token,
      );

    await t.test(
      "closure preserves partial/completed rewards and records, hides all old entry points, and releases reissue",
      async () => {
        const q = await question();
        const narrative = ok(
          await command("/admin/narratives", {
            kind: "letter",
            title: "测试信件",
            payload: {
              variant: "modern",
              paragraphs: [{ content: "保密题目内容" }],
            },
          }),
        ).id;
        ok(await command("/admin/narratives/" + narrative + "/publish"));
        const reward = ok(
          await command("/admin/rewards", {
            name: "测试奖品",
            claimMethod: "staff",
          }),
        ).id;
        const session = await scene(q, {
          levels: [
            { question: q, xp: 10 },
            { question: q, xp: 20 },
          ],
          rewardRules: [
            { trigger: "level_completed", levelIndex: 0, reward },
            { trigger: "session_completed", reward },
          ],
          clues: [
            {
              trigger: "start",
              kind: "letter",
              narrative,
              content: { text: "线索" },
            },
          ],
          completionTarget: { kind: "narrative", id: narrative },
        });
        const subjects = [
          await player(),
          await player(),
          await player(),
          await player(),
        ];
        const ids = [];
        for (const subject of subjects)
          ids.push((await assign(session, subject)).assignmentId);
        const startId = randomUUID(),
          answerId = randomUUID();
        const partial = ok(await start(ids[1], subjects[1], startId));
        const first = ok(
          await answer(ids[1], partial.levels[0].id, subjects[1], {
            requestId: answerId,
          }),
        );
        const full = ok(await start(ids[2], subjects[2]));
        ok(await answer(ids[2], full.levels[0].id, subjects[2]));
        ok(await answer(ids[2], full.levels[1].id, subjects[2]));
        ok(
          await command("/admin/assignments/" + ids[3] + "/actions", {
            action: "cancel",
            reason: "预先撤回",
          }),
        );
        const claimId = first.rewardIds[0];
        ok(
          await command("/admin/grants/" + claimId + "/actions", {
            action: "claim_details",
            claimDetails: "TEST-CLAIM",
            reason: "登记领取信息",
          }),
        );
        const completedGrants = ok(
          await call("/rewards", undefined, subjects[2].token),
        ).items;
        ok(
          await command("/admin/grants/" + completedGrants[0].id + "/actions", {
            action: "redeem",
            reason: "测试核销",
          }),
        );
        const protectedTables = [
          "game_level_progress",
          "game_answer_submissions",
          "game_xp_ledger",
          "game_player_stats",
          "game_player_rewards",
          "game_clue_unlocks",
          "game_session_levels",
          "game_reward_rules",
        ];
        const before = {};
        for (const table of protectedTables)
          before[table] = await records(table);
        const summary = (await catalog()).sessions.find(
          (s) => s.id === session,
        );
        assert.deepEqual(summary.assignmentCounts, {
          total: 4,
          assigned: 1,
          active: 1,
          completed: 1,
          cancelled: 1,
        });
        const closeBody = { requestId: randomUUID() };
        const closed = ok(await close(session, closeBody));
        assert.equal(closed.cancelledCount, 2);
        assert.deepEqual(ok(await close(session, closeBody)), closed);
        assert.equal(ok(await close(session)).cancelledCount, 0);
        for (const table of protectedTables)
          assert.deepEqual(await records(table), before[table], table);
        for (const [index, subject] of subjects.entries()) {
          assert(
            !ok(
              await call("/assignments", undefined, subject.token),
            ).items.some((a) => a.session === session),
          );
          denied(
            await call("/assignments/" + ids[index], undefined, subject.token),
            "SESSION_OFFLINE",
          );
          denied(
            await call(
              "/assignments/" + ids[index] + "/narratives/" + narrative,
              undefined,
              subject.token,
            ),
            "SESSION_OFFLINE",
          );
          denied(await start(ids[index], subject), "SESSION_OFFLINE");
          const detail = ok(await call("/admin/assignments/" + ids[index]));
          assert.equal(detail.status, index === 2 ? "completed" : "cancelled");
          assert.equal(detail.levels[0].question.id, q);
        }
        denied(await start(ids[1], subjects[1], startId), "SESSION_OFFLINE");
        denied(
          await answer(ids[1], partial.levels[0].id, subjects[1], {
            requestId: answerId,
          }),
          "SESSION_OFFLINE",
        );
        denied(
          await answer(ids[1], partial.levels[1].id, subjects[1]),
          "SESSION_OFFLINE",
        );
        assert.equal(
          (await call("/assignments/" + ids[1], undefined, subjects[0].token))
            .status,
          404,
        );
        const savedPartial = ok(await call("/admin/assignments/" + ids[1]));
        assert.equal(savedPartial.levels[0].lastAnswer, "原答案");
        assert(savedPartial.levels[0].completedAt);
        assert.equal(savedPartial.clues.length, 1);
        for (const action of [
          "unlock_clue",
          "complete_level",
          "clear_penalty",
          "extend",
        ]) {
          denied(
            await command("/admin/assignments/" + ids[2] + "/actions", {
              action,
              reason: "不允许继续推进",
              sessionLevelId: full.levels[0].id,
            }),
            "SESSION_OFFLINE",
          );
        }
        assert.equal(
          ok(await call("/me", undefined, subjects[1].token)).totalXp,
          10,
        );
        assert.equal(
          ok(await call("/me", undefined, subjects[2].token)).totalXp,
          30,
        );
        assert.equal(
          ok(await call("/rewards", undefined, subjects[1].token)).items[0]
            .claimDetails,
          "TEST-CLAIM",
        );
        ok(
          await command("/admin/grants/" + claimId + "/actions", {
            action: "claim_details",
            claimDetails: "TEST-CLAIM-UPDATED",
            reason: "下线后维护领取信息",
          }),
        );
        ok(
          await command("/admin/grants/" + claimId + "/actions", {
            action: "redeem",
            reason: "下线后仍可领取",
          }),
        );
        ok(
          await command("/admin/grants/" + claimId + "/actions", {
            action: "undo_redeem",
            reason: "下线后仍可撤销核销",
          }),
        );
        denied(
          await command("/admin/sessions/" + session + "/publish"),
          "INVALID_STATE",
        );
        assert.equal(
          (
            await command("/admin/assignments", {
              sessionId: session,
              target: "selected",
              playerIds: [subjects[0].id],
            })
          ).status,
          400,
        );
        const clone = ok(
          await command("/admin/sessions/" + session, { clone: true }),
        ).id;
        assert.notEqual(clone, session);
        ok(await command("/admin/sessions/" + clone + "/publish"));
        const replacement = await assign(clone, subjects[1]);
        assert.equal(replacement.status, "assigned");
        assert.notEqual(replacement.assignmentId, ids[1]);
        assert.equal(
          ok(await start(replacement.assignmentId, subjects[1]))
            .completedLevels,
          0,
        );
        const audit = ok(await call("/admin/audit")).items;
        assert(
          audit.some(
            (a) =>
              a.entityId === session &&
              a.action === "close_session" &&
              a.safeDiff.cancelledCount === 2,
          ),
        );
      },
    );

    await t.test(
      "all online references lock edits/deletion; draft references permit edits but not deletion",
      async () => {
        const q = await question();
        const onlineA = await scene(q),
          onlineB = await scene(q);
        const draft = await scene(q, {}, false);
        let item = (await catalog()).questions.find((r) => r.id === q);
        assert.equal(item.usage.online.length, 2);
        assert.equal(item.usage.drafts.length, 1);
        assert.equal(item.usage.canEdit, false);
        denied(await edit(q), "QUESTION_IN_USE");
        denied(
          await command("/admin/questions/" + q + "/archive", {
            reason: "测试删除",
          }),
          "QUESTION_IN_USE",
        );
        ok(await close(onlineA));
        denied(await edit(q), "QUESTION_IN_USE");
        ok(await close(onlineB));
        const levelsBefore = await records(
          "game_session_levels",
          'question="' + q + '"',
        );
        const keyBefore = (
          await records("game_answer_keys", 'question="' + q + '"')
        )[0];
        assert.equal(ok(await edit(q)).id, q);
        assert.deepEqual(
          await records("game_session_levels", 'question="' + q + '"'),
          levelsBefore,
        );
        const keyAfter = (
          await records("game_answer_keys", 'question="' + q + '"')
        )[0];
        assert.equal(keyAfter.id, keyBefore.id);
        assert.deepEqual(keyAfter.acceptedAnswers, ["新答案"]);
        item = (await catalog()).questions.find((r) => r.id === q);
        assert.equal(item.status, "published");
        assert.equal(item.usage.canEdit, true);
        assert.equal(item.usage.canDelete, false);
        denied(
          await command("/admin/questions/" + q + "/archive", {
            reason: "草稿引用时不能删",
          }),
          "QUESTION_IN_USE",
        );
        // A previously opened editor cannot save after the draft has been published.
        ok(await command("/admin/sessions/" + draft + "/publish"));
        denied(await edit(q), "QUESTION_IN_USE");
        ok(await close(draft));
        ok(
          await command("/admin/questions/" + q + "/archive", {
            reason: "从题库移除",
          }),
        );
        assert.equal(
          (await records("game_questions", 'id="' + q + '"')).length,
          1,
        );
        assert.deepEqual(
          await records("game_session_levels", 'question="' + q + '"'),
          levelsBefore,
        );
        denied(await edit(q), "QUESTION_DELETED");
        denied(
          await command("/admin/questions/" + q + "/publish"),
          "INVALID_STATE",
        );
        const clone = ok(
          await command("/admin/sessions/" + onlineA, { clone: true }),
        ).id;
        assert.equal(
          (await command("/admin/sessions/" + clone + "/publish")).status,
          400,
        );
        const newQuestion = ok(
          await command("/admin/questions/" + q, { clone: true }),
        ).id;
        assert.notEqual(newQuestion, q);
        const audits = ok(await call("/admin/audit")).items.filter(
          (a) => a.entityId === q && a.action === "save_question",
        );
        assert(
          audits.some(
            (a) =>
              a.safeDiff.before?.acceptedAnswers?.[0] === "原答案" &&
              a.safeDiff.after?.acceptedAnswers?.[0] === "新答案",
          ),
        );
      },
    );

    await t.test(
      "unused published questions remain editable, input validation rolls back, and deleted questions stay unavailable",
      async () => {
        const q = await question();
        ok(await edit(q));
        const before = await records("game_questions", 'id="' + q + '"');
        assert.equal(
          (
            await edit(q, {
              kind: "choice",
              options: [{ key: "A", text: "选项" }],
              acceptedAnswers: ["missing"],
            })
          ).status,
          400,
        );
        assert.deepEqual(
          await records("game_questions", 'id="' + q + '"'),
          before,
        );
        ok(
          await edit(q, {
            kind: "choice",
            options: [
              { key: "A", text: "甲" },
              { key: "B", text: "乙" },
            ],
            acceptedAnswers: ["B"],
          }),
        );
        ok(
          await command("/admin/questions/" + q + "/archive", {
            reason: "删除未使用题目",
          }),
        );
        const item = (await catalog()).questions.find((r) => r.id === q);
        assert.equal(item.usage.canEdit, false);
        assert.equal(item.usage.canDelete, false);
      },
    );

    await t.test(
      "legacy archived assignments can be reconciled idempotently without touching completed settlements",
      async () => {
        const q = await question(),
          session = await scene(q),
          subject = await player();
        const id = (await assign(session, subject)).assignmentId;
        ok(await rawPatch("game_sessions", session, { status: "archived" }));
        assert.equal(
          ok(await call("/assignments", undefined, subject.token)).items.length,
          0,
        );
        const settings = {
          base: server.base,
          account: server.adminAccount,
          password: server.adminPassword,
          selectedIds: [session],
        };
        const preview = await reconcile(settings);
        assert.equal(preview.sessions[0].pending, 1);
        assert.equal(
          ok(await call("/admin/assignments/" + id)).status,
          "assigned",
        );
        assert.equal(
          (await reconcile({ ...settings, apply: true })).sessions[0]
            .cancelledCount,
          1,
        );
        assert.equal(
          (await reconcile({ ...settings, apply: true })).sessions[0]
            .cancelledCount,
          0,
        );
        assert.equal(ok(await close(session)).cancelledCount, 0);
        assert.equal(
          ok(await call("/admin/assignments/" + id)).status,
          "cancelled",
        );
      },
    );

    await t.test(
      "only the closed session is hidden; individual withdrawal and legacy narrative archival keep their own semantics",
      async () => {
        const q = await question(),
          session = await scene(q),
          subject = await player();
        const id = (await assign(session, subject)).assignmentId;
        ok(
          await command("/admin/assignments/" + id + "/actions", {
            action: "cancel",
            reason: "单独撤回",
          }),
        );
        assert(
          ok(await call("/assignments", undefined, subject.token)).items.some(
            (r) => r.id === id,
          ),
        );
        const narrative = ok(
          await command("/admin/narratives", {
            kind: "letter",
            title: "保留叙事",
            payload: {
              variant: "modern",
              paragraphs: [{ content: "仍可查看" }],
            },
          }),
        ).id;
        ok(await command("/admin/narratives/" + narrative + "/publish"));
        const second = await scene(q, {
          clues: [{ trigger: "start", kind: "letter", narrative }],
        });
        const active = (await assign(second, subject)).assignmentId;
        ok(await start(active, subject));
        denied(
          await command("/admin/narratives/" + narrative + "/archive", {
            reason: "不再新配置",
          }),
          "NARRATIVE_IN_USE",
        );
        // Simulate an archive made before reference protection was introduced.
        // New commands cannot create this state, but legacy readers must work.
        ok(
          await rawPatch("game_narratives", narrative, { status: "archived" }),
        );
        ok(
          await call(
            "/assignments/" + active + "/narratives/" + narrative,
            undefined,
            subject.token,
          ),
        );
      },
    );

    await t.test(
      "publishing and editing serialize, while failed closure leaves every assignment intact",
      async () => {
        const q = await question();
        const draft = await scene(q, {}, false);
        const publishRequestId = randomUUID();
        const results = await Promise.all([
          edit(q),
          command("/admin/sessions/" + draft + "/publish", {
            requestId: publishRequestId,
          }),
        ]);
        ok(results[1]);
        if (results[0].status !== 200) denied(results[0], "QUESTION_IN_USE");
        denied(await edit(q), "QUESTION_IN_USE");
        denied(
          await command("/admin/questions/" + q + "/archive", {
            reason: "线上引用不能删除",
          }),
          "QUESTION_IN_USE",
        );
        const subject = await player();
        const id = (await assign(draft, subject)).assignmentId;
        const before = await records("game_assignments", 'id="' + id + '"');
        assert.equal((await close(draft, { reason: "" })).status, 400);
        assert.deepEqual(
          await records("game_assignments", 'id="' + id + '"'),
          before,
        );
        assert.equal(
          (await catalog()).sessions.find((s) => s.id === draft).status,
          "published",
        );
        ok(await close(draft));
        ok(await edit(q));
        // Reissuing the original publish request must never resurrect a closed row.
        ok(
          await command("/admin/sessions/" + draft + "/publish", {
            requestId: publishRequestId,
          }),
        );
        assert.equal(
          (await catalog()).sessions.find((s) => s.id === draft).status,
          "archived",
        );
        denied(
          await command("/admin/sessions/" + draft + "/publish"),
          "INVALID_STATE",
        );
      },
    );

    await t.test(
      "concurrent answers and closure settle at most once and never leave an active closed assignment",
      async () => {
        for (let round = 0; round < 3; round++) {
          const q = await question(),
            session = await scene(q),
            subject = await player();
          const id = (await assign(session, subject)).assignmentId;
          const entered = ok(await start(id, subject));
          const requestId = randomUUID();
          const results = await Promise.all([
            answer(id, entered.levels[0].id, subject, { requestId }),
            close(session),
            answer(id, entered.levels[0].id, subject, { requestId }),
          ]);
          ok(results[1]);
          for (const response of [results[0], results[2]]) {
            if (response.status !== 200) denied(response, "SESSION_OFFLINE");
          }
          const ledger = await records(
            "game_xp_ledger",
            'assignment="' + id + '"',
          );
          assert(ledger.length <= 1);
          const detail = ok(await call("/admin/assignments/" + id));
          assert.equal(
            detail.status,
            ledger.length ? "completed" : "cancelled",
          );
          assert.equal(
            ok(await call("/me", undefined, subject.token)).totalXp,
            ledger.length * 10,
          );
          denied(
            await call("/assignments/" + id, undefined, subject.token),
            "SESSION_OFFLINE",
          );
        }
      },
    );
  },
);
