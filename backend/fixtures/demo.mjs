import { randomUUID } from "node:crypto";
export async function seedDemo(server) {
  async function command(path, body) {
    const result = await server.request(`/api/questions/v1/admin/${path}`, {
      token: server.adminToken,
      method: "POST",
      body: { requestId: `demo-${path}-${randomUUID()}`, ...body },
    });
    if (result.status !== 200)
      throw new Error(
        `Demo seed failed: ${path} ${JSON.stringify(result.data)}`,
      );
    return result.data;
  }
  const password = `Demo-${randomUUID()}`;
  const player = await command("players", {
    account: "demo_player",
    displayName: "远航者",
    password,
  });
  await command("players", {
    account: "demo_second",
    displayName: "另一位冒险者",
    password,
  });
  const question = await command("questions", {
    title: "星辰之门",
    kind: "text",
    content: [
      {
        text: "抬头看见繁星，向前望见海洋。请写下这四个字，开启旅程。",
        hint: "答案是一个关于远方的词。",
      },
    ],
    options: [],
    acceptedAnswers: ["星辰大海"],
    placeholder: "写下你的答案",
  });
  const choice = await command("questions", {
    title: "守门人的选择",
    kind: "choice",
    content: [{ text: "夜行时，哪颗星能为你指出北方？" }],
    options: [
      { key: "A", text: "月亮" },
      { key: "B", text: "北极星" },
    ],
    acceptedAnswers: ["B"],
  });
  for (const id of [question.id, choice.id])
    await command(`questions/${id}/publish`, {});
  const letter = await command("narratives", {
    title: "给远航者的一封信",
    kind: "letter",
    payload: {
      variant: "modern",
      hintText: "点击开启信件",
      paragraphs: [
        { content: "每一次认真寻找，都值得被记住。", align: "left" },
        {
          content: "愿你带着今天发现的勇气，继续走向更远的地方。",
          align: "left",
        },
      ],
      typingSpeedMs: 30,
    },
  });
  const bless = await command("narratives", {
    title: "开启你的专属星空",
    kind: "bless",
    payload: {
      phrases: [
        { text: "愿星光照亮前路", durationMs: 3000 },
        { text: "愿每一次出发都有新的收获", durationMs: 3000 },
      ],
      closingLines: [{ text: "旅途仍在继续", durationMs: 3000 }],
    },
  });
  for (const id of [letter.id, bless.id])
    await command(`narratives/${id}/publish`, {});
  const reward = await command("rewards", {
    name: "线下纪念卡",
    description: "完成冒险后领取的纪念品。",
    claimMethod: "staff",
    publicInstructions: "请向现场工作人员展示此奖品，由工作人员核销。",
  });
  const session = await command("sessions", {
    title: "星辰探险",
    description: "两道谜题、一封信，和一份在终点等待你的礼物。",
    presentation: { bgmMode: "silent", completionStyle: "normal" },
    levels: [
      { question: question.id, xp: 50, autoNext: false },
      {
        question: choice.id,
        xp: 50,
        penaltyPolicy: [{ type: "cooldown", seconds: 5 }, { type: "lock" }],
      },
    ],
    clues: [
      {
        trigger: "level_completed",
        levelIndex: 0,
        kind: "letter",
        narrative: letter.id,
        content: { title: "给远航者的信", text: "第一道门后，藏着一封信。" },
      },
      {
        trigger: "session_completed",
        kind: "text",
        autoPlay: true,
        content: { title: "终点的礼物", text: "请到前台领取你的纪念卡。" },
      },
    ],
    completionTarget: { kind: "narrative", id: bless.id },
    rewardRules: [
      { trigger: "session_completed", reward: reward.id, quantity: 1 },
    ],
  });
  await command(`sessions/${session.id}/publish`, {});
  const single = await command("sessions", {
    title: "单题体验",
    description: "体验一题即可完成的独立场次。",
    levels: [{ question: question.id, xp: 25 }],
    clues: [],
    rewardRules: [],
  });
  await command(`sessions/${single.id}/publish`, {});
  const batch = await command("assignments", {
    sessionId: session.id,
    target: "all",
  });
  return {
    playerAccount: "demo_player",
    playerPassword: password,
    playerId: player.id,
    sessionId: session.id,
    singleSessionId: single.id,
    assignmentId: batch.results.find((row) => row.playerId === player.id)
      .assignmentId,
  };
}
