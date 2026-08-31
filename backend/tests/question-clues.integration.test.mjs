import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";

test(
  "real PocketBase: question clues and published live settings",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    const root = "/api/questions/v1";
    const call = (
      path,
      body,
      token = server.adminToken,
      method = body ? "POST" : "GET",
    ) => server.request(root + path, { token, method, body });
    const command = (path, body = {}, token = server.adminToken) =>
      call(path, { requestId: randomUUID(), ...body }, token);
    const patch = (path, body, token = server.adminToken) =>
      call(path, body, token, "PATCH");
    const ok = (response) => {
      assert.equal(
        response.status,
        200,
        `${JSON.stringify(response.data)}\n${server.logs()}`,
      );
      return response.data;
    };
    const denied = (response, code, status = 400) => {
      assert.equal(response.status, status, JSON.stringify(response.data));
      assert.equal(response.data.error.code, code);
      return response.data.error;
    };
    const records = async (table, filter = "") =>
      ok(
        await server.request(
          `/api/collections/${table}/records?perPage=500&filter=${encodeURIComponent(filter)}`,
          { token: server.superToken },
        ),
      ).items;
    const rawPatch = (table, id, body) =>
      server.request(`/api/collections/${table}/records/${id}`, {
        token: server.superToken,
        method: "PATCH",
        body,
      });
    const catalog = async () => ok(await call("/admin/catalog"));
    const createQuestion = async (title, answer) => {
      const question = ok(
        await command("/admin/questions", {
          title,
          kind: "text",
          content: [{ text: `${title}正文` }],
          options: [],
          acceptedAnswers: [answer],
        }),
      );
      ok(await command(`/admin/questions/${question.id}/publish`));
      return question.id;
    };
    const saveQuestionClues = (questionId, set, clues, extra = {}) =>
      patch(`/admin/questions/${questionId}/clues`, {
        requestId: randomUUID(),
        reason: "维护题目通用线索",
        expectedVersion: set.version,
        clues,
        ...extra,
      });
    async function player() {
      const account = `p${randomUUID().replaceAll("-", "").slice(0, 18)}`;
      const password = `Test-${randomUUID()}`;
      const created = ok(
        await command("/admin/players", {
          account,
          password,
          displayName: "通用线索玩家",
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
          { method: "POST", body: { identity: account, password } },
        ),
      );
      return { id: created.id, token: auth.token };
    }

    const q1 = await createQuestion("第一题", "答案一");
    const q2 = await createQuestion("第二题", "答案二");
    let q1Set = ok(await call(`/admin/questions/${q1}/clues`));
    assert.deepEqual(q1Set.items, []);

    await t.test(
      "question clue batch is strict, validated, versioned, soft-deleted and cloned",
      async () => {
        const invalidLetter = await saveQuestionClues(q1, q1Set, [
          {
            kind: "letter",
            narrative: "forbidden",
            content: { text: "不能保存" },
          },
        ]);
        denied(invalidLetter, "INVALID_INPUT");
        assert.deepEqual(
          ok(await call(`/admin/questions/${q1}/clues`)),
          q1Set,
        );
        for (const clue of [
          { kind: "text", content: {} },
          { kind: "image", content: { imageUrls: [] } },
          { kind: "video", content: {} },
          { kind: "link", content: {} },
        ])
          denied(
            await saveQuestionClues(q1, q1Set, [clue]),
            "INVALID_INPUT",
          );
        for (const clues of [
          [
            { position: 0, kind: "text", content: { text: "第一条" } },
            { position: 0, kind: "text", content: { text: "重复顺序" } },
          ],
          [{ position: 1, kind: "text", content: { text: "错位顺序" } }],
        ])
          denied(
            await saveQuestionClues(q1, q1Set, clues),
            "INVALID_INPUT",
          );

        q1Set = ok(
          await saveQuestionClues(q1, q1Set, [
            {
              kind: "text",
              content: { title: "场次之后", text: "第一条通用线索" },
              autoPlay: true,
            },
            {
              kind: "image",
              content: {
                title: "图像证据",
                imageUrls: ["https://example.test/clue.webp"],
              },
              autoPlay: false,
            },
          ]),
        );
        assert.equal(q1Set.items.length, 2);
        assert.deepEqual(
          q1Set.items.map((item) => item.position),
          [0, 1],
        );
        assert.equal(
          (await catalog()).questions.find((item) => item.id === q1)
            .commonClueCount,
          2,
        );
        denied(
          await saveQuestionClues(q1, { ...q1Set, version: "stale" }, []),
          "EDIT_CONFLICT",
          409,
        );
        const q2Set = ok(await call(`/admin/questions/${q2}/clues`));
        denied(
          await saveQuestionClues(q2, q2Set, [
            {
              id: q1Set.items[0].id,
              kind: q1Set.items[0].kind,
              content: q1Set.items[0].content,
              autoPlay: q1Set.items[0].autoPlay,
            },
          ]),
          "INVALID_INPUT",
        );
        denied(
          await saveQuestionClues(q2, q2Set, [
            { kind: "bless", content: { text: "不允许的祝福" } },
          ]),
          "INVALID_INPUT",
        );
        const archivedQuestion = await createQuestion("待归档题", "答案");
        const archivedSet = ok(
          await call(`/admin/questions/${archivedQuestion}/clues`),
        );
        ok(
          await command(`/admin/questions/${archivedQuestion}/archive`, {
            reason: "测试归档",
          }),
        );
        denied(
          await saveQuestionClues(archivedQuestion, archivedSet, [
            { kind: "text", content: { text: "不应保存" } },
          ]),
          "QUESTION_DELETED",
          409,
        );

        const cloned = ok(
          await command(`/admin/questions/${q1}`, { clone: true }),
        );
        const cloneSet = ok(
          await call(`/admin/questions/${cloned.id}/clues`),
        );
        assert.equal(cloneSet.items.length, 2);
        assert.deepEqual(
          cloneSet.items.map((item) => item.content),
          q1Set.items.map((item) => item.content),
        );
        assert(
          cloneSet.items.every(
            (item) => !q1Set.items.some((source) => source.id === item.id),
          ),
        );

        const kept = q1Set.items[0];
        q1Set = ok(
          await saveQuestionClues(q1, q1Set, [
            {
              id: kept.id,
              position: 0,
              kind: kept.kind,
              content: kept.content,
              autoPlay: kept.autoPlay,
            },
            {
              kind: "link",
              content: {
                title: "外部资料",
                url: "https://example.test/evidence",
              },
              autoPlay: false,
            },
          ]),
        );
        const archived = await records(
          "game_question_clues",
          `question="${q1}" && status="archived"`,
        );
        assert.equal(archived.length, 1);
        assert.equal(archived[0].kind, "image");

        const largeQuestion = await createQuestion("大批量线索题", "容量答案");
        const largeSet = ok(
          await call(`/admin/questions/${largeQuestion}/clues`),
        );
        const largeRequestId = randomUUID();
        const marker = "large-clue-receipt-marker";
        const largeSaved = ok(
          await patch(`/admin/questions/${largeQuestion}/clues`, {
            requestId: largeRequestId,
            reason: "验证十几条大容量线索可原子保存",
            expectedVersion: largeSet.version,
            clues: Array.from({ length: 14 }, (_, index) => ({
              kind: "text",
              content: {
                text: `${marker}-${index}-${"x".repeat(15500)}`,
              },
              autoPlay: index === 0,
            })),
          }),
        );
        assert.equal(largeSaved.items.length, 14);
        assert(
          JSON.stringify(largeSaved.items).length > 200_000,
          "the response fixture must exercise more than the receipt JSON limit",
        );
        const [largeReceipt] = await records(
          "game_command_receipts",
          `operation="save-question-clues:${largeQuestion}" && requestId="${largeRequestId}"`,
        );
        assert(largeReceipt);
        assert(JSON.stringify(largeReceipt.resultRefs).length < 1000);
        assert.equal(
          JSON.stringify(largeReceipt.resultRefs).includes(marker),
          false,
        );
      },
    );

    const session = ok(
      await command("/admin/sessions", {
        title: "可在线维护场次",
        description: "初始说明",
        presentation: {
          bgmMode: "inherit",
          backgroundMode: "inherit",
          completionStyle: "normal",
        },
        levels: [
          { id: "first", question: q1, xp: 10, autoNext: false },
          { id: "second", question: q2, xp: 20, autoNext: false },
          { id: "repeat", question: q1, xp: 30, autoNext: false },
        ],
        clues: [
          {
            sessionLevel: "second",
            trigger: "level_completed",
            kind: "text",
            content: { text: "第二关但全局顺序靠前" },
            autoPlay: false,
          },
          {
            sessionLevel: "first",
            trigger: "level_completed",
            kind: "text",
            content: { text: "场次专属线索" },
            autoPlay: true,
          },
          {
            trigger: "session_completed",
            kind: "text",
            content: { text: "整场组合线索" },
            autoPlay: false,
          },
          {
            trigger: "manual",
            kind: "image",
            content: { imageUrls: ["https://example.test/session.webp"] },
          },
          {
            trigger: "manual",
            kind: "video",
            content: { url: "https://example.test/session.mp4" },
          },
          {
            trigger: "manual",
            kind: "link",
            content: { url: "https://example.test/session" },
          },
          {
            trigger: "start",
            kind: "text",
            content: { text: "进入后自动展示" },
            autoPlay: true,
          },
          {
            trigger: "start",
            kind: "text",
            content: { text: "进入后静默展示" },
            autoPlay: false,
          },
        ],
      }),
    );
    ok(await command(`/admin/sessions/${session.id}/publish`));
    const subject = await player();
    for (const token of [subject.token, server.adminToken]) {
      assert.equal(
        (
          await server.request(
            "/api/collections/game_question_clues/records",
            { token },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await server.request(
            "/api/collections/game_question_clues/records",
            {
              token,
              method: "POST",
              body: {
                question: q1,
                kind: "text",
                content: { text: "绕过接口" },
                status: "active",
              },
            },
          )
        ).status,
        403,
      );
    }
    const assignmentId = ok(
      await command("/admin/assignments", {
        sessionId: session.id,
        target: "selected",
        playerIds: [subject.id],
      }),
    ).results[0].assignmentId;
    const startRequest = { requestId: randomUUID() };
    const entered = ok(
      await call(
        `/assignments/${assignmentId}/start`,
        startRequest,
        subject.token,
      ),
    );
    const autoStartEffect = entered.transitionEffects.find((effect) =>
      entered.clues.some(
        (clue) =>
          clue.id === effect.clueId && clue.content.text === "进入后自动展示",
      ),
    );
    const silentStartEffect = entered.transitionEffects.find((effect) =>
      entered.clues.some(
        (clue) =>
          clue.id === effect.clueId && clue.content.text === "进入后静默展示",
      ),
    );
    assert.equal(autoStartEffect.autoPlay, true);
    assert.equal(silentStartEffect.autoPlay, false);
    const legacyStartRequest = { requestId: randomUUID() };
    ok(
      await server.request(
        "/api/collections/game_command_receipts/records",
        {
          token: server.superToken,
          method: "POST",
          body: {
            actorCollection: "game_players",
            actorId: subject.id,
            operation: `start:${assignmentId}`,
            requestId: legacyStartRequest.requestId,
            requestHash: createHash("sha256")
              .update(JSON.stringify(legacyStartRequest))
              .digest("hex"),
            resultRefs: { assignmentId },
          },
        },
      ),
    );
    const legacyStartReplay = ok(
      await call(
        `/assignments/${assignmentId}/start`,
        legacyStartRequest,
        subject.token,
      ),
    );
    assert.equal("transitionEffects" in legacyStartReplay, false);
    const [firstLevel, secondLevel, repeatedLevel] = entered.levels;
    let firstAnswerRequest;

    await t.test(
      "completed progress exposes common clues after session clues and effects only describe this transition",
      async () => {
        firstAnswerRequest = {
          requestId: randomUUID(),
          sessionLevelId: firstLevel.id,
          answer: "答案一",
        };
        const firstResult = ok(
          await call(
            `/assignments/${assignmentId}/answers`,
            firstAnswerRequest,
            subject.token,
          ),
        );
        const firstCommon = firstResult.assignment.clues.filter(
          (clue) => clue.source === "question",
        );
        assert.equal(firstCommon.length, q1Set.items.length);
        assert(firstCommon.every((clue) => clue.question === q1));
        assert(
          firstCommon.every(
            (clue) => clue.sessionLevel === firstLevel.id,
          ),
        );
        const firstQuestionIndex = firstResult.assignment.clues.findIndex(
          (clue) => clue.source === "question",
        );
        assert(
          firstResult.assignment.clues
            .slice(0, firstQuestionIndex)
            .every((clue) => clue.source === "session"),
        );
        assert.deepEqual(
          new Set(firstResult.effects.map((effect) => effect.clueId)),
          new Set(
            firstResult.assignment.clues
              .filter(
                (clue) =>
                  clue.source === "question" ||
                  clue.sessionLevel === firstLevel.id,
              )
              .map((clue) => clue.id),
          ),
        );

        q1Set = ok(
          await saveQuestionClues(q1, q1Set, [
            ...q1Set.items.map((item) => ({
              id: item.id,
              position: item.position,
              kind: item.kind,
              content: item.content,
              autoPlay: item.autoPlay,
            })),
            {
              kind: "text",
              content: { text: "答过后新增，只静默展示" },
              autoPlay: true,
            },
          ]),
        );
        const refreshed = ok(
          await call(`/assignments/${assignmentId}`, undefined, subject.token),
        );
        assert.equal(
          refreshed.clues.filter((clue) => clue.source === "question").length,
          q1Set.items.length,
        );
        const unlocksBeforeReads = await records(
          "game_clue_unlocks",
          `assignment="${assignmentId}"`,
        );
        ok(await call(`/assignments/${assignmentId}`, undefined, subject.token));
        ok(await call(`/assignments/${assignmentId}`, undefined, subject.token));
        assert.deepEqual(
          await records(
            "game_clue_unlocks",
            `assignment="${assignmentId}"`,
          ),
          unlocksBeforeReads,
        );

        const secondResult = ok(
          await command(
            `/assignments/${assignmentId}/answers`,
            { sessionLevelId: secondLevel.id, answer: "答案二" },
            subject.token,
          ),
        );
        assert.equal(secondResult.effects.length, 1);
        assert(
          secondResult.effects.every((effect) =>
            secondResult.assignment.clues.some(
              (clue) => clue.source === "session" && clue.id === effect.clueId,
            ),
          ),
        );
        const q2Set = ok(await call(`/admin/questions/${q2}/clues`));
        ok(
          await saveQuestionClues(q2, q2Set, [
            {
              kind: "text",
              content: { text: "第二题答过后新增的静默线索" },
              autoPlay: true,
            },
          ]),
        );
        const repeatedResult = ok(
          await command(
            `/assignments/${assignmentId}/answers`,
            { sessionLevelId: repeatedLevel.id, answer: "答案一" },
            subject.token,
          ),
        );
        assert(
          repeatedResult.effects.every((effect) =>
            repeatedResult.assignment.clues.some(
              (clue) => clue.source === "session" && clue.id === effect.clueId,
            ),
          ),
        );
        for (const effect of firstResult.effects)
          assert.equal(
            effect.autoPlay,
            firstResult.assignment.clues.find(
              (clue) => clue.id === effect.clueId,
            ).autoPlay,
          );
        const finalCommon = repeatedResult.assignment.clues.filter(
          (clue) => clue.source === "question" && clue.question === q1,
        );
        assert.equal(finalCommon.length, q1Set.items.length);
        assert(finalCommon.every((clue) => clue.sessionLevel === firstLevel.id));
        const questionClues = repeatedResult.assignment.clues.filter(
          (clue) => clue.source === "question",
        );
        assert.deepEqual(
          questionClues.map((clue) => clue.question),
          [
            ...Array.from({ length: q1Set.items.length }, () => q1),
            q2,
          ],
        );
        const sessionPositions = repeatedResult.assignment.clues
          .filter((clue) => clue.source === "session")
          .map((clue) => clue.position);
        assert.deepEqual(
          sessionPositions,
          sessionPositions.toSorted((a, b) => a - b),
        );

        const already = ok(
          await command(
            `/assignments/${assignmentId}/answers`,
            { sessionLevelId: firstLevel.id, answer: "答案一" },
            subject.token,
          ),
        );
        assert.equal(already.result, "already_completed");
        assert.deepEqual(already.effects, []);
      },
    );

    await t.test(
      "published live settings are narrow, optimistic, id-preserving, idempotent and compactly audited",
      async () => {
        let item = (await catalog()).sessions.find(
          (candidate) => candidate.id === session.id,
        );
        const xpBefore = ok(await call("/me", undefined, subject.token)).totalXp;
        const progressBefore = await records(
          "game_level_progress",
          `assignment="${assignmentId}"`,
        );
        const levelIds = item.levels.map((level) => level.id);
        const clueIds = item.clues.map((clue) => clue.id);
        const targetClueId = item.clues.find(
          (clue) => clue.content.text === "场次专属线索",
        ).id;
        const body = {
          requestId: randomUUID(),
          reason: "活动现场调整展示",
          expectedVersion: item.liveSettingsVersion,
          title: "线上新标题",
          description: "线上新说明",
          presentation: {
            bgmMode: "custom",
            bgmUrl: "https://example.test/live.mp3",
            backgroundMode: "none",
            hideTitle: true,
          },
          levels: [
            {
              id: item.levels[0].id,
              presentationOverride: { bgmMode: "silent" },
            },
          ],
          clues: [
            {
              id: targetClueId,
              position: 9,
              content: { text: "线上修改内容" },
              autoPlay: false,
            },
          ],
        };
        const changed = ok(
          await patch(`/admin/sessions/${session.id}/live-settings`, body),
        );
        assert.notEqual(changed.version, body.expectedVersion);
        assert.deepEqual(
          ok(await patch(`/admin/sessions/${session.id}/live-settings`, body)),
          changed,
        );
        item = (await catalog()).sessions.find(
          (candidate) => candidate.id === session.id,
        );
        assert.equal(item.title, "线上新标题");
        assert.equal(item.description, "线上新说明");
        assert.equal(item.presentation.completionStyle, "normal");
        assert.equal(item.levels[0].presentationOverride.bgmMode, "silent");
        assert.equal(item.levels[0].xp, 10);
        const updatedClue = item.clues.find((clue) => clue.id === targetClueId);
        assert.equal(updatedClue.content.text, "线上修改内容");
        assert.equal(updatedClue.position, 9);
        assert.equal(updatedClue.autoPlay, false);
        const replayedFirstAnswer = ok(
          await call(
            `/assignments/${assignmentId}/answers`,
            firstAnswerRequest,
            subject.token,
          ),
        );
        const replayedSessionEffect = replayedFirstAnswer.effects.find(
          (effect) => effect.clueId === targetClueId,
        );
        assert.equal(replayedSessionEffect.autoPlay, true);
        assert.equal(
          replayedFirstAnswer.assignment.clues.find(
            (clue) => clue.id === targetClueId,
          ).autoPlay,
          false,
        );
        assert.deepEqual(
          item.levels.map((level) => level.id),
          levelIds,
        );
        assert.deepEqual(
          new Set(item.clues.map((clue) => clue.id)),
          new Set(clueIds),
        );
        assert.equal(
          ok(await call("/me", undefined, subject.token)).totalXp,
          xpBefore,
        );
        assert.deepEqual(
          await records(
            "game_level_progress",
            `assignment="${assignmentId}"`,
          ),
          progressBefore,
        );

        const autoPlayOnly = ok(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "仅调整自动展示",
            expectedVersion: item.liveSettingsVersion,
            clues: [
              {
                id: targetClueId,
                position: updatedClue.position,
                content: updatedClue.content,
                autoPlay: true,
              },
            ],
          }),
        );
        assert.notEqual(autoPlayOnly.version, item.liveSettingsVersion);
        item = (await catalog()).sessions.find(
          (candidate) => candidate.id === session.id,
        );
        assert.equal(
          item.clues.find((clue) => clue.id === targetClueId).autoPlay,
          true,
        );
        const startAutoClue = item.clues.find(
          (clue) => clue.content.text === "进入后自动展示",
        );
        const startSilentClue = item.clues.find(
          (clue) => clue.content.text === "进入后静默展示",
        );
        const flippedStart = ok(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "验证进入动作快照",
            expectedVersion: item.liveSettingsVersion,
            clues: [
              {
                id: startAutoClue.id,
                position: startAutoClue.position,
                content: startAutoClue.content,
                autoPlay: false,
              },
              {
                id: startSilentClue.id,
                position: startSilentClue.position,
                content: startSilentClue.content,
                autoPlay: true,
              },
            ],
          }),
        );
        assert.notEqual(flippedStart.version, item.liveSettingsVersion);
        item = (await catalog()).sessions.find(
          (candidate) => candidate.id === session.id,
        );
        const replayedStart = ok(
          await call(
            `/assignments/${assignmentId}/start`,
            startRequest,
            subject.token,
          ),
        );
        assert.equal(
          replayedStart.transitionEffects.find(
            (effect) => effect.clueId === startAutoClue.id,
          ).autoPlay,
          true,
        );
        assert.equal(
          replayedStart.transitionEffects.find(
            (effect) => effect.clueId === startSilentClue.id,
          ).autoPlay,
          false,
        );
        assert.equal(
          replayedStart.clues.find((clue) => clue.id === startAutoClue.id)
            .autoPlay,
          false,
        );
        assert.equal(
          replayedStart.clues.find((clue) => clue.id === startSilentClue.id)
            .autoPlay,
          true,
        );
        assert.deepEqual(
          ok(
            await command(
              `/assignments/${assignmentId}/start`,
              {},
              subject.token,
            ),
          ).transitionEffects,
          [],
        );
        const untouchedClue = item.clues.find(
          (clue) => clue.id !== targetClueId,
        );
        denied(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "尝试制造重复顺序",
            expectedVersion: item.liveSettingsVersion,
            clues: [
              {
                id: targetClueId,
                position: untouchedClue.position,
                content: item.clues.find(
                  (clue) => clue.id === targetClueId,
                ).content,
                autoPlay: true,
              },
            ],
          }),
          "INVALID_INPUT",
        );
        assert.equal(
          (
            (await catalog()).sessions.find(
              (candidate) => candidate.id === session.id,
            )
          ).liveSettingsVersion,
          item.liveSettingsVersion,
        );
        for (const kind of ["text", "image", "video", "link"]) {
          const clue = item.clues.find((candidate) => candidate.kind === kind);
          denied(
            await patch(`/admin/sessions/${session.id}/live-settings`, {
              requestId: randomUUID(),
              reason: `尝试清空 ${kind} 主内容`,
              expectedVersion: item.liveSettingsVersion,
              clues: [
                {
                  id: clue.id,
                  position: clue.position,
                  content: {},
                  autoPlay: clue.autoPlay,
                },
              ],
            }),
            "INVALID_INPUT",
          );
        }

        denied(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            ...body,
            requestId: randomUUID(),
          }),
          "EDIT_CONFLICT",
          409,
        );
        for (const forbidden of [
          { completionTarget: null },
          { presentation: { completionStyle: "finale" } },
          {
            levels: [
              {
                id: item.levels[0].id,
                presentationOverride: {},
                xp: 999,
              },
            ],
          },
          {
            levels: [
              {
                id: item.levels[0].id,
                presentationOverride: {},
                autoNext: true,
              },
            ],
          },
          {
            clues: [
              {
                id: targetClueId,
                position: 0,
                content: { text: "非法" },
                autoPlay: true,
                kind: "video",
              },
            ],
          },
          {
            clues: [
              {
                id: targetClueId,
                position: 0,
                content: { text: "非法" },
                autoPlay: true,
                trigger: "manual",
              },
            ],
          },
        ])
          denied(
            await patch(`/admin/sessions/${session.id}/live-settings`, {
              requestId: randomUUID(),
              reason: "尝试越权字段",
              expectedVersion: item.liveSettingsVersion,
              ...forbidden,
            }),
            "INVALID_INPUT",
          );
        denied(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "伪造新增线索",
            expectedVersion: item.liveSettingsVersion,
            clues: [
              {
                id: "missingclueid",
                position: 0,
                content: { text: "不应新增" },
                autoPlay: true,
              },
            ],
          }),
          "NOT_FOUND",
          404,
        );

        const other = ok(
          await command("/admin/sessions", {
            title: "另一个线上场次",
            levels: [{ id: "other-level", question: q2, xp: 0 }],
            clues: [
              {
                sessionLevel: "other-level",
                trigger: "level_completed",
                kind: "text",
                content: { text: "其他场次线索" },
              },
            ],
          }),
        );
        ok(await command(`/admin/sessions/${other.id}/publish`));
        const otherItem = (await catalog()).sessions.find(
          (candidate) => candidate.id === other.id,
        );
        denied(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "跨场次关卡",
            expectedVersion: item.liveSettingsVersion,
            levels: [
              {
                id: otherItem.levels[0].id,
                presentationOverride: { bgmMode: "silent" },
              },
            ],
          }),
          "INVALID_INPUT",
        );
        denied(
          await patch(`/admin/sessions/${session.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "跨场次线索",
            expectedVersion: item.liveSettingsVersion,
            clues: [
              {
                id: otherItem.clues[0].id,
                position: 0,
                content: { text: "不应修改" },
                autoPlay: false,
              },
            ],
          }),
          "INVALID_INPUT",
        );

        const draft = ok(
          await command("/admin/sessions", {
            title: "草稿场次",
            levels: [{ question: q2, xp: 0 }],
          }),
        );
        const draftItem = (await catalog()).sessions.find(
          (candidate) => candidate.id === draft.id,
        );
        denied(
          await patch(`/admin/sessions/${draft.id}/live-settings`, {
            requestId: randomUUID(),
            reason: "草稿不能走线上接口",
            expectedVersion: draftItem.liveSettingsVersion,
            title: "不应保存",
          }),
          "INVALID_STATE",
          409,
        );

        const audit = ok(await call("/admin/audit")).items;
        const liveAudit = audit.find(
          (entry) =>
            entry.action === "update_session_live_settings" &&
            entry.entityId === session.id &&
            entry.reason === "活动现场调整展示",
        );
        assert(liveAudit);
        assert.equal(liveAudit.reason, "活动现场调整展示");
        assert.equal(
          JSON.stringify(liveAudit.safeDiff).includes("线上修改内容"),
          false,
        );
        assert.equal(
          JSON.stringify(
            audit.find(
              (entry) =>
                entry.action === "save_question_clues" && entry.entityId === q1,
            )?.safeDiff,
          ).includes("第一条通用线索"),
          false,
        );
      },
    );
  },
);
