import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";

test(
  "real PocketBase: question groups and deterministic keyword matching",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    const root = "/api/questions/v1";
    const call = (path, token = server.adminToken, method = "GET", body) =>
      server.request(root + path, { token, method, body });
    const command = (path, body = {}, token = server.adminToken, method = "POST") =>
      call(path, token, method, { requestId: randomUUID(), ...body });
    const ok = (response) => {
      assert.equal(
        response.status,
        200,
        `${JSON.stringify(response.data)}\n${server.logs()}`,
      );
      return response.data;
    };
    const catalog = async () => ok(await call("/admin/catalog"));
    const records = async (table, filter = "") =>
      ok(
        await server.request(
          `/api/collections/${table}/records?perPage=500&filter=${encodeURIComponent(filter)}`,
          { token: server.superToken },
        ),
      ).items;

    const fuzzy = ok(
      await command("/admin/questions", {
        kind: "text",
        title: "城市地标",
        groupName: "地理",
        fuzzyMatch: true,
        content: [{ text: "请描述目的地" }],
        options: [],
        acceptedAnswers: ["北京", "故宫"],
      }),
    );
    let row = (await catalog()).questions.find((q) => q.id === fuzzy.id);
    assert.equal(row.groupName, "地理");
    assert.equal(row.fuzzyMatch, true);
    assert.equal(
      (await records("game_question_settings", `question="${fuzzy.id}"`))[0]
        .answerMatchMode,
      "contains_all",
    );

    for (const body of [
      {
        kind: "text",
        title: "空关键词",
        fuzzyMatch: true,
        content: [],
        options: [],
        acceptedAnswers: ["！"],
      },
      {
        kind: "text",
        title: "重复关键词",
        fuzzyMatch: true,
        content: [],
        options: [],
        acceptedAnswers: ["北京", "北 京"],
      },
      {
        kind: "choice",
        title: "错误选择题配置",
        fuzzyMatch: true,
        content: [],
        options: [
          { key: "A", text: "甲" },
          { key: "B", text: "乙" },
        ],
        acceptedAnswers: ["A"],
      },
    ]) {
      const rejected = await command("/admin/questions", body);
      assert.equal(rejected.status, 400, JSON.stringify(rejected.data));
      assert.equal(rejected.data.error.code, "INVALID_INPUT");
    }

    ok(await command(`/admin/questions/${fuzzy.id}/publish`));
    const session = ok(
      await command("/admin/sessions", {
        title: "关键词判题场次",
        levels: [{ question: fuzzy.id, xp: 10 }],
      }),
    );
    ok(await command(`/admin/sessions/${session.id}/publish`));

    const grouped = ok(
      await command(
        `/admin/questions/${fuzzy.id}/group`,
        { groupName: "文化" },
        server.adminToken,
        "PATCH",
      ),
    );
    assert.equal(grouped.groupName, "文化");
    row = (await catalog()).questions.find((q) => q.id === fuzzy.id);
    assert.equal(row.groupName, "文化");
    assert.equal(row.fuzzyMatch, true);
    const locked = await command(
      `/admin/questions/${fuzzy.id}`,
      { ...row, fuzzyMatch: false, reason: "不应成功" },
      server.adminToken,
      "PATCH",
    );
    assert.equal(locked.status, 409);
    assert.equal(locked.data.error.code, "QUESTION_IN_USE");

    const clone = ok(
      await command(`/admin/questions/${fuzzy.id}`, { clone: true }),
    );
    const cloned = (await catalog()).questions.find((q) => q.id === clone.id);
    assert.equal(cloned.groupName, "文化");
    assert.equal(cloned.fuzzyMatch, true);

    const account = `keyword_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const password = `Test-${randomUUID()}`;
    const player = ok(
      await command("/admin/players", {
        account,
        password,
        displayName: "关键词测试玩家",
      }),
    );
    ok(
      await server.request(`/api/collections/game_players/records/${player.id}`, {
        token: server.superToken,
        method: "PATCH",
        body: { mustChangePassword: false },
      }),
    );
    const playerToken = ok(
      await server.request(
        "/api/collections/game_players/auth-with-password",
        {
          method: "POST",
          body: { identity: account, password },
        },
      ),
    ).token;
    const assignment = ok(
      await command("/admin/assignments", {
        sessionId: session.id,
        target: "selected",
        playerIds: [player.id],
      }),
    ).results[0].assignmentId;
    const entered = ok(
      await command(`/assignments/${assignment}/start`, {}, playerToken),
    );
    assert.equal(JSON.stringify(entered).includes("groupName"), false);
    assert.equal(JSON.stringify(entered).includes("fuzzyMatch"), false);
    assert.equal(JSON.stringify(entered).includes("acceptedAnswers"), false);
    const sessionLevelId = entered.levels[0].id;
    const wrong = ok(
      await command(
        `/assignments/${assignment}/answers`,
        { sessionLevelId, answer: "北京天安门" },
        playerToken,
      ),
    );
    assert.equal(wrong.result, "incorrect");
    const correct = ok(
      await command(
        `/assignments/${assignment}/answers`,
        { sessionLevelId, answer: "先参观故宫，最后到北京。" },
        playerToken,
      ),
    );
    assert.equal(correct.result, "correct");
    const submissions = await records(
      "game_answer_submissions",
      `assignment="${assignment}"`,
    );
    assert.match(
      submissions.find((item) => item.result === "correct").rulesRevision,
      /contains-all-v1$/,
    );

    const legacy = ok(
      await command("/admin/questions", {
        kind: "text",
        title: "模拟旧题",
        content: [],
        options: [],
        acceptedAnswers: ["旧答案"],
      }),
    );
    const legacySetting = (
      await records("game_question_settings", `question="${legacy.id}"`)
    )[0];
    const removed = await fetch(
      `${server.base}/api/collections/game_question_settings/records/${legacySetting.id}`,
      {
        method: "DELETE",
        headers: { Authorization: server.superToken },
      },
    );
    assert.equal(removed.status, 204);
    row = (await catalog()).questions.find((q) => q.id === legacy.id);
    assert.equal(row.groupName, "其他");
    assert.equal(row.fuzzyMatch, false);
    ok(
      await command(
        `/admin/questions/${legacy.id}`,
        {
          ...row,
          groupName: "旧题回填",
          fuzzyMatch: true,
          acceptedAnswers: ["旧", "答案"],
          reason: "逐题回填配置",
        },
        server.adminToken,
        "PATCH",
      ),
    );
    row = (await catalog()).questions.find((q) => q.id === legacy.id);
    assert.equal(row.groupName, "旧题回填");
    assert.equal(row.fuzzyMatch, true);
  },
);
