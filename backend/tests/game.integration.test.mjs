import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestServer } from "./server.mjs";
import { withGameRateLimits } from "../scripts/configure-security.mjs";

test(
  "real PocketBase: authentication, publication, all-user dispatch, settlement and redemption",
  { timeout: 120000 },
  async (t) => {
    const server = await createTestServer();
    t.after(() => server.stop());
    for (const [input, expected] of [
      [" ＰＯＬＡＲＩＳ！ ", "polaris"],
      ["Polaris", "polaris"],
      [" 星辰，大海！ ", "星辰大海"],
    ]) {
      const normalized = await server.request("/__test/normalize", {
        token: server.superToken,
        method: "POST",
        body: { value: input },
      });
      assert.equal(
        normalized.data.value,
        expected,
        `JSVM normalization mismatch: ${JSON.stringify(normalized.data)}`,
      );
    }
    const root = "/api/questions/v1";
    const call = (path, token = server.adminToken, method = "GET", body) =>
      server.request(root + path, { token, method, body });
    const command = (path, body = {}, token = server.adminToken) =>
      call(path, token, "POST", { requestId: randomUUID(), ...body });
    const ok = (response) => {
      assert.equal(
        response.status,
        200,
        `${JSON.stringify(response.data)}\n${server.logs()}`,
      );
      return response.data;
    };
    async function player(account, change = true) {
      const password = `P-${randomUUID()}`,
        next = `N-${randomUUID()}`;
      const created = ok(
        await command("/admin/players", {
          account,
          displayName: "同名玩家",
          password,
        }),
      );
      const auth = ok(
        await server.request(
          "/api/collections/game_players/auth-with-password",
          { method: "POST", body: { identity: account, password } },
        ),
      );
      let token = auth.token;
      if (change)
        token = ok(
          await call("/me/change-password", token, "POST", {
            oldPassword: password,
            password: next,
            passwordConfirm: next,
          }),
        ).token;
      return {
        id: created.id,
        token,
        password,
        next,
        originalToken: auth.token,
      };
    }
    const alice = await player("alice"),
      bob = await player("bob");
    await t.test(
      "registration, privilege boundaries, password rotation and field allowlists",
      async () => {
        const tooLong = "a".repeat(72);
        for (const result of [
          await command("/admin/players", {
            account: "invalid_length",
            displayName: "密码边界",
            password: tooLong,
          }),
          await command(`/admin/players/${alice.id}/actions`, {
            action: "reset_password",
            password: tooLong,
            reason: "密码边界测试",
          }),
          await call("/me/change-password", alice.token, "POST", {
            oldPassword: alice.next,
            password: tooLong,
            passwordConfirm: tooLong,
          }),
        ]) {
          assert.equal(result.status, 400);
          assert.equal(result.data.error.code, "INVALID_INPUT");
        }
        const registered = await server.request(
          "/api/collections/game_players/records",
          {
            method: "POST",
            body: {
              account: "intruder",
              password: "Password-12345",
              passwordConfirm: "Password-12345",
              displayName: "侵入者",
              status: "active",
            },
          },
        );
        assert.equal(registered.status, 403);
        assert.equal((await call("/admin/catalog", alice.token)).status, 401);
        assert.equal((await call("/me", alice.originalToken)).status, 401);
        assert.equal(
          (
            await call("/me/profile", alice.token, "PATCH", {
              status: "disabled",
            })
          ).status,
          400,
        );
        assert.equal(
          ok(
            await call("/me/profile", alice.token, "PATCH", {
              displayName: "新称呼",
            }),
          ).displayName,
          "新称呼",
        );
        const newcomer = await player("must_change", false);
        assert.equal(
          (await call("/assignments", newcomer.token)).data.error.code,
          "PASSWORD_CHANGE_REQUIRED",
        );
        ok(
          await command(`/admin/players/${newcomer.id}/actions`, {
            action: "disable",
            reason: "测试禁用",
          }),
        );
        assert.equal((await call("/me", newcomer.token)).status, 401);
      },
    );
    const question = ok(
      await command("/admin/questions", {
        kind: "text",
        title: "指路之星",
        content: [{ text: "哪颗星指示北方？" }],
        options: [],
        acceptedAnswers: ["北极星", "Polaris"],
      }),
    );
    ok(await command(`/admin/questions/${question.id}/publish`));
    const choice = ok(
      await command("/admin/questions", {
        kind: "choice",
        title: "方向",
        content: [{ text: "请选择北方" }],
        options: [
          { key: "N", text: "北" },
          { key: "S", text: "南" },
        ],
        acceptedAnswers: ["N"],
      }),
    );
    ok(await command(`/admin/questions/${choice.id}/publish`));
    const reward = ok(
      await command("/admin/rewards", {
        name: "纪念品",
        claimMethod: "staff",
        publicInstructions: "联系工作人员",
      }),
    );
    const session = ok(
      await command("/admin/sessions", {
        title: "星空探险",
        levels: [
          { question: question.id, xp: 100 },
          {
            question: choice.id,
            xp: 50,
            penaltyPolicy: [{ type: "lock" }],
            presentationOverride: { hideTitle: true, backgroundMode: "none" },
          },
        ],
        rewardRules: [
          { trigger: "session_completed", reward: reward.id, quantity: 1 },
        ],
        clues: [
          {
            trigger: "session_completed",
            kind: "text",
            content: {
              text: "秘密地点：前台",
              buttonText: "收下信标",
              description: "线索会保留",
              tips: "点击查阅",
            },
          },
        ],
      }),
    );
    ok(await command(`/admin/sessions/${session.id}/publish`));
    let aliceAssignment, bobAssignment;
    await t.test(
      "all users are snapshotted; repeats do not include future users or duplicate active tasks",
      async () => {
        const body = {
          requestId: randomUUID(),
          sessionId: session.id,
          target: "all",
        };
        const batch = ok(
          await call("/admin/assignments", server.adminToken, "POST", body),
        );
        assert.deepEqual(
          new Set(batch.recipientIds),
          new Set([alice.id, bob.id]),
        );
        aliceAssignment = batch.results.find(
          (row) => row.playerId === alice.id,
        ).assignmentId;
        bobAssignment = batch.results.find(
          (row) => row.playerId === bob.id,
        ).assignmentId;
        const later = await player("later");
        assert.deepEqual(
          ok(await call("/admin/assignments", server.adminToken, "POST", body)),
          batch,
        );
        assert.equal(
          ok(await call("/assignments", later.token)).items.length,
          0,
        );
        const repeat = ok(
          await command("/admin/assignments", {
            sessionId: session.id,
            target: "selected",
            playerIds: [alice.id],
          }),
        );
        assert.equal(repeat.results[0].status, "skipped_active");
        const conflict = await call(
          "/admin/assignments",
          server.adminToken,
          "POST",
          { ...body, target: "selected", playerIds: [alice.id] },
        );
        assert.equal(conflict.data.error.code, "IDEMPOTENCY_CONFLICT");
      },
    );
    let stepIds;
    await t.test(
      "no question or clue leakage before entry; wrong-player reads and raw collections denied",
      async () => {
        assert.equal(
          (await call(`/assignments/${bobAssignment}`, alice.token)).status,
          404,
        );
        const waiting = ok(
          await call(`/assignments/${aliceAssignment}`, alice.token),
        );
        assert(waiting.levels.every((step) => step.question === null));
        for (const table of [
          "game_questions",
          "game_answer_keys",
          "game_clues",
          "game_assignments",
          "game_xp_ledger",
        ])
          assert.equal(
            (
              await server.request(`/api/collections/${table}/records`, {
                token: alice.token,
              })
            ).status,
            403,
          );
        const entered = ok(
          await command(
            `/assignments/${aliceAssignment}/start`,
            {},
            alice.token,
          ),
        );
        stepIds = entered.levels.map((step) => step.id);
        assert.equal(entered.levels[1].question, null);
        assert(!JSON.stringify(entered).includes("acceptedAnswers"));
        assert(!JSON.stringify(entered).includes("秘密地点"));
        const skip = await command(
          `/assignments/${aliceAssignment}/answers`,
          { sessionLevelId: stepIds[1], answer: "N" },
          alice.token,
        );
        assert.equal(skip.data.error.code, "PREVIOUS_LEVEL_REQUIRED");
      },
    );
    await t.test(
      "concurrent correct answers settle XP once, retries are deterministic",
      async () => {
        const body = {
          sessionLevelId: stepIds[0],
          answer: " ＰＯＬＡＲＩＳ！ ",
        };
        const responses = await Promise.all([
          command(`/assignments/${aliceAssignment}/answers`, body, alice.token),
          command(`/assignments/${aliceAssignment}/answers`, body, alice.token),
        ]);
        assert.deepEqual(
          responses
            .map(ok)
            .map((row) => row.result)
            .sort(),
          ["already_completed", "correct"],
        );
        assert.equal(ok(await call("/me", alice.token)).totalXp, 100);
        assert.equal(ok(await call("/me", bob.token)).totalXp, 0);
      },
    );
    await t.test(
      "incorrect answer retries count once; admin unlock and final reward are audited",
      async () => {
        const body = {
          requestId: randomUUID(),
          sessionLevelId: stepIds[1],
          answer: "S",
        };
        const wrong = ok(
          await call(
            `/assignments/${aliceAssignment}/answers`,
            alice.token,
            "POST",
            body,
          ),
        );
        assert.equal(wrong.assignment.levels[1].wrongCount, 1);
        const retry = ok(
          await call(
            `/assignments/${aliceAssignment}/answers`,
            alice.token,
            "POST",
            body,
          ),
        );
        assert.equal(retry.assignment.levels[1].wrongCount, 1);
        assert.equal(
          (
            await command(
              `/assignments/${aliceAssignment}/answers`,
              { sessionLevelId: stepIds[1], answer: "N" },
              alice.token,
            )
          ).data.error.code,
          "LOCKED",
        );
        ok(
          await command(`/admin/assignments/${aliceAssignment}/actions`, {
            action: "clear_penalty",
            sessionLevelId: stepIds[1],
            reason: "现场协助",
          }),
        );
        const result = ok(
          await command(
            `/assignments/${aliceAssignment}/answers`,
            { sessionLevelId: stepIds[1], answer: "N" },
            alice.token,
          ),
        );
        assert.equal(result.assignment.status, "completed");
        assert.equal(
          result.assignment.levels[1].presentationOverride.hideTitle,
          true,
        );
        assert.equal(
          result.assignment.levels[1].presentationOverride.backgroundMode,
          "none",
        );
        assert.equal(result.player.totalXp, 150);
        assert.equal(result.assignment.clues[0].content.text, "秘密地点：前台");
        assert.equal(result.assignment.clues[0].trigger, "session_completed");
        assert.equal(result.assignment.clues[0].content.buttonText, "收下信标");
        assert.equal(
          result.assignment.clues[0].content.description,
          "线索会保留",
        );
        assert.equal(result.assignment.clues[0].content.tips, "点击查阅");
        assert.equal(ok(await call("/rewards", alice.token)).items.length, 1);
      },
    );
    await t.test(
      "completed players are skipped by default; explicit reissue gives a fresh full reward",
      async () => {
        const skipped = ok(
          await command("/admin/assignments", {
            sessionId: session.id,
            target: "selected",
            playerIds: [alice.id],
          }),
        );
        assert.equal(skipped.results[0].status, "skipped_completed");
        const reissued = ok(
          await command("/admin/assignments", {
            sessionId: session.id,
            target: "selected",
            playerIds: [alice.id],
            reissueCompleted: true,
          }),
        );
        const fresh = reissued.results[0].assignmentId;
        assert.notEqual(fresh, aliceAssignment);
        const entered = ok(
          await command(`/assignments/${fresh}/start`, {}, alice.token),
        );
        for (const [index, step] of entered.levels.entries())
          ok(
            await command(
              `/assignments/${fresh}/answers`,
              { sessionLevelId: step.id, answer: index ? "N" : "北极星" },
              alice.token,
            ),
          );
        assert.equal(ok(await call("/me", alice.token)).totalXp, 300);
        assert.equal(ok(await call("/rewards", alice.token)).items.length, 2);
      },
    );
    await t.test(
      "only one concurrent redemption succeeds, secret claim details remain private",
      async () => {
        const grant = ok(await call("/rewards", alice.token)).items[0];
        ok(
          await command(`/admin/grants/${grant.id}/actions`, {
            action: "claim_details",
            reason: "现场配置",
            claimDetails: "TEST-CLAIM-SECRET",
          }),
        );
        assert.equal(ok(await call("/rewards", bob.token)).items.length, 0);
        assert.equal(
          (
            await command(
              `/admin/grants/${grant.id}/actions`,
              { action: "redeem", reason: "用户尝试核销" },
              alice.token,
            )
          ).status,
          401,
        );
        const results = await Promise.all([
          command(`/admin/grants/${grant.id}/actions`, {
            action: "redeem",
            reason: "已交付",
          }),
          command(`/admin/grants/${grant.id}/actions`, {
            action: "redeem",
            reason: "第二人同时操作",
          }),
        ]);
        assert.deepEqual(results.map((row) => row.status).sort(), [200, 409]);
        const audit = ok(await call("/admin/audit"));
        assert(!JSON.stringify(audit).includes("TEST-CLAIM-SECRET"));
      },
    );
    await t.test(
      "notification receipts and online question reference locks",
      async () => {
        const note = ok(
          await command("/admin/notifications", {
            target: "selected",
            playerIds: [alice.id],
            title: "现场提示",
            content: "请到前台",
          }),
        );
        assert.equal(
          ok(await call("/notifications", bob.token)).items.length,
          0,
        );
        ok(await command(`/notifications/${note.id}/read`, {}, alice.token));
        assert(ok(await call("/notifications", alice.token)).items[0].readAt);
        assert.equal(
          (
            await call(
              `/admin/questions/${question.id}`,
              server.adminToken,
              "PATCH",
              { requestId: randomUUID(), title: "修改" },
            )
          ).data.error.code,
          "QUESTION_IN_USE",
        );
      },
    );
    await t.test(
      "multipart profile updates with and without avatars, and owner-only file access",
      async () => {
        const nicknameOnly = new FormData();
        nicknameOnly.set("displayName", "只改昵称");
        const renamed = ok(
          await server.request(root + "/me/profile", {
            token: alice.token,
            method: "PATCH",
            form: nicknameOnly,
          }),
        );
        assert.equal(renamed.displayName, "只改昵称");
        assert.equal(renamed.avatar, "");
        assert.equal(
          ok(await call("/me", alice.token)).displayName,
          "只改昵称",
        );

        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        );
        const form = new FormData();
        form.set("displayName", "头像玩家");
        form.set(
          "avatar",
          new Blob([png], { type: "image/png" }),
          "avatar.png",
        );
        const profile = ok(
          await server.request(root + "/me/profile", {
            token: alice.token,
            method: "PATCH",
            form,
          }),
        );
        assert(profile.avatar);
        nicknameOnly.set("displayName", "保留原头像");
        const renamedWithAvatar = ok(
          await server.request(root + "/me/profile", {
            token: alice.token,
            method: "PATCH",
            form: nicknameOnly,
          }),
        );
        assert.equal(renamedWithAvatar.displayName, "保留原头像");
        assert.equal(renamedWithAvatar.avatar, profile.avatar);
        const fileToken = ok(
          await server.request("/api/files/token", {
            token: alice.token,
            method: "POST",
            body: {},
          }),
        ).token;
        const otherToken = ok(
          await server.request("/api/files/token", {
            token: bob.token,
            method: "POST",
            body: {},
          }),
        ).token;
        const url = `${server.base}/api/files/game_players/${alice.id}/${profile.avatar}`;
        assert.equal((await fetch(`${url}?token=${fileToken}`)).status, 200);
        assert.equal((await fetch(url)).status, 404);
        assert.equal((await fetch(`${url}?token=${otherToken}`)).status, 404);
        const fake = new FormData();
        fake.set(
          "avatar",
          new Blob(["<svg onload='alert(1)'></svg>"], { type: "image/png" }),
          "fake.png",
        );
        assert.equal(
          (
            await server.request(root + "/me/profile", {
              token: alice.token,
              method: "PATCH",
              form: fake,
            })
          ).status,
          400,
        );
        const large = new FormData();
        large.set(
          "avatar",
          new Blob([png, new Uint8Array(2100000)], { type: "image/png" }),
          "large.png",
        );
        assert.equal(
          (
            await server.request(root + "/me/profile", {
              token: alice.token,
              method: "PATCH",
              form: large,
            })
          ).status,
          400,
        );
        const removeAvatar = new FormData();
        removeAvatar.set("removeAvatar", "true");
        const removed = ok(
          await server.request(root + "/me/profile", {
            token: alice.token,
            method: "PATCH",
            form: removeAvatar,
          }),
        );
        assert.equal(removed.avatar, "");
        assert.equal(removed.displayName, "保留原头像");
        assert.equal(ok(await call("/me", alice.token)).avatar, "");
      },
    );
    await t.test(
      "level boundaries are checked once per entry and again on reissue",
      async () => {
        const catalog = ok(await call("/admin/catalog"));
        const rank2 = catalog.ranks.find((rank) => rank.order === 2).id;
        const gated = ok(
          await command("/admin/sessions", {
            title: "等级边界",
            minLevel: rank2,
            maxLevel: rank2,
            levels: [
              { question: question.id, xp: 250 },
              { question: question.id, xp: 50 },
            ],
          }),
        );
        ok(await command(`/admin/sessions/${gated.id}/publish`));
        const dispatch = ok(
          await command("/admin/assignments", {
            sessionId: gated.id,
            target: "selected",
            playerIds: [alice.id, bob.id],
          }),
        );
        const aid = dispatch.results.find(
            (row) => row.playerId === alice.id,
          ).assignmentId,
          bid = dispatch.results.find(
            (row) => row.playerId === bob.id,
          ).assignmentId;
        assert.equal(
          (await command(`/assignments/${aid}/start`, {}, alice.token)).data
            .error.code,
          "LEVEL_NOT_ELIGIBLE",
        );
        assert.equal(
          (await command(`/assignments/${bid}/start`, {}, bob.token)).data.error
            .code,
          "LEVEL_NOT_ELIGIBLE",
        );
        ok(
          await command(`/admin/players/${bob.id}/actions`, {
            action: "adjust_xp",
            delta: 100,
            reason: "等级边界测试",
          }),
        );
        const entered = ok(
          await command(`/assignments/${bid}/start`, {}, bob.token),
        );
        for (const step of entered.levels)
          ok(
            await command(
              `/assignments/${bid}/answers`,
              { sessionLevelId: step.id, answer: "北极星" },
              bob.token,
            ),
          );
        assert.equal(ok(await call("/me", bob.token)).totalXp, 400);
        const again = ok(
          await command("/admin/assignments", {
            sessionId: gated.id,
            target: "selected",
            playerIds: [bob.id],
            reissueCompleted: true,
          }),
        );
        assert.equal(
          (
            await command(
              `/assignments/${again.results[0].assignmentId}/start`,
              {},
              bob.token,
            )
          ).data.error.code,
          "LEVEL_NOT_ELIGIBLE",
        );
      },
    );
    await t.test(
      "time windows use server time and invalid config rolls back",
      async () => {
        const count = ok(await call("/admin/catalog")).sessions.length;
        assert.equal(
          (
            await command("/admin/sessions", {
              title: "失败草稿",
              levels: [{ question: question.id, xp: -1 }],
            })
          ).status,
          400,
        );
        assert.equal(ok(await call("/admin/catalog")).sessions.length, count);
        const timed = ok(
          await command("/admin/sessions", {
            title: "时间窗口",
            levels: [{ question: question.id, xp: 0 }],
          }),
        );
        ok(await command(`/admin/sessions/${timed.id}/publish`));
        const dispatch = ok(
          await command("/admin/assignments", {
            sessionId: timed.id,
            target: "selected",
            playerIds: [alice.id],
            startsAt: new Date(Date.now() + 60000).toISOString(),
          }),
        );
        const id = dispatch.results[0].assignmentId;
        assert.equal(
          (
            await command(
              `/assignments/${id}/start`,
              { clientTime: new Date(Date.now() + 120000).toISOString() },
              alice.token,
            )
          ).data.error.code,
          "NOT_STARTED",
        );
        ok(
          await command(`/admin/assignments/${id}/actions`, {
            action: "cancel",
            reason: "调整窗口",
          }),
        );
        const expired = ok(
          await command("/admin/assignments", {
            sessionId: timed.id,
            target: "selected",
            playerIds: [alice.id],
            endsAt: new Date(Date.now() - 1000).toISOString(),
          }),
        );
        assert.equal(
          (
            await command(
              `/assignments/${expired.results[0].assignmentId}/start`,
              {},
              alice.token,
            )
          ).data.error.code,
          "EXPIRED",
        );
      },
    );
    await t.test(
      "settlement failure rolls back submission, progress and experience",
      async () => {
        const subject = await player("rollback_player");
        const batch = ok(
          await command("/admin/assignments", {
            sessionId: session.id,
            target: "selected",
            playerIds: [subject.id],
          }),
        );
        const id = batch.results[0].assignmentId;
        const entered = ok(
          await command(`/assignments/${id}/start`, {}, subject.token),
        );
        const stats = ok(
          await server.request(
            `/api/collections/game_player_stats/records?filter=${encodeURIComponent(`player="${subject.id}"`)}`,
            { token: server.superToken },
          ),
        ).items[0];
        await fetch(
          `${server.base}/api/collections/game_player_stats/records/${stats.id}`,
          { method: "DELETE", headers: { Authorization: server.superToken } },
        );
        const body = {
          requestId: randomUUID(),
          sessionLevelId: entered.levels[0].id,
          answer: "北极星",
        };
        assert.equal(
          (
            await call(
              `/assignments/${id}/answers`,
              subject.token,
              "POST",
              body,
            )
          ).data.error.code,
          "ACCOUNT_NOT_READY",
        );
        assert.equal(
          ok(await call(`/assignments/${id}`, subject.token)).completedLevels,
          0,
        );
        assert.equal(
          ok(await call(`/admin/assignments/${id}/submissions`)).items.length,
          0,
        );
        ok(
          await server.request("/api/collections/game_player_stats/records", {
            token: server.superToken,
            method: "POST",
            body: { player: subject.id, totalXp: 0 },
          }),
        );
        assert.equal(
          ok(
            await call(
              `/assignments/${id}/answers`,
              subject.token,
              "POST",
              body,
            ),
          ).player.totalXp,
          100,
        );
      },
    );
    await t.test(
      "session closure blocks old narrative access without allowing new dispatch",
      async () => {
        const narrative = ok(
          await command("/admin/narratives", {
            kind: "letter",
            title: "授权信件",
            payload: {
              variant: "modern",
              paragraphs: [{ content: "只给完成冒险的你" }],
            },
          }),
        );
        ok(await command(`/admin/narratives/${narrative.id}/publish`));
        const story = ok(
          await command("/admin/sessions", {
            title: "信件场次",
            levels: [{ question: question.id, xp: 0 }],
            completionTarget: { kind: "narrative", id: narrative.id },
          }),
        );
        ok(await command(`/admin/sessions/${story.id}/publish`));
        const batch = ok(
          await command("/admin/assignments", {
            sessionId: story.id,
            target: "selected",
            playerIds: [alice.id],
          }),
        );
        const id = batch.results[0].assignmentId,
          route = `/assignments/${id}/narratives/${narrative.id}`;
        assert.equal((await call(route, alice.token)).status, 404);
        const entered = ok(
          await command(`/assignments/${id}/start`, {}, alice.token),
        );
        ok(
          await command(
            `/assignments/${id}/answers`,
            { sessionLevelId: entered.levels[0].id, answer: "北极星" },
            alice.token,
          ),
        );
        ok(
          await command(`/admin/sessions/${story.id}/archive`, {
            reason: "版本下线",
          }),
        );
        ok(
          await command(`/admin/narratives/${narrative.id}/archive`, {
            reason: "停止新配置",
          }),
        );
        assert.equal(
          (await call(route, alice.token)).data.error.code,
          "SESSION_OFFLINE",
        );
        assert.equal(
          ok(await call(`/admin/assignments/${id}`)).status,
          "completed",
        );
        assert.equal((await call(route, bob.token)).status, 404);
        assert.equal(
          (
            await command("/admin/assignments", {
              sessionId: story.id,
              target: "selected",
              playerIds: [bob.id],
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "configured login rate limits reject brute force and retain other settings",
      async () => {
        const settings = ok(
          await server.request("/api/settings", { token: server.superToken }),
        );
        const rateLimits = withGameRateLimits(settings.rateLimits);
        ok(
          await server.request("/api/settings", {
            token: server.superToken,
            method: "PATCH",
            body: { rateLimits },
          }),
        );
        let limited = false;
        for (let i = 0; i < 32; i++) {
          const response = await server.request(
            "/api/collections/game_players/auth-with-password",
            {
              method: "POST",
              body: {
                identity: "nonexistent_rate_test",
                password: "Invalid-password-123",
              },
            },
          );
          if (response.status === 429) {
            limited = true;
            break;
          }
          assert.equal(response.status, 400);
        }
        assert.equal(limited, true);
        assert.equal((await call("/admin/me")).status, 200);
        const after = ok(
          await server.request("/api/settings", { token: server.superToken }),
        );
        assert.deepEqual(after.trustedProxy, settings.trustedProxy);
        for (const rule of settings.rateLimits.rules)
          assert.ok(
            after.rateLimits.rules.some((saved) => saved.label === rule.label),
          );
      },
    );
  },
);
