import { LiveSessionSettingsDrawer } from "../src/game/LiveSessionSettingsDrawer";
import type { AdminCatalog, AdminSession } from "../src/game/contracts";
// Real business components with an in-memory catalog. All business writes reject.
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { App } from "antd";
import { ContentPage } from "../src/game/ContentPages";
import { OperationPage } from "../src/game/OperationPages";
import { ColorModeContextProvider } from "../src/contexts/color-mode";
import { pb } from "../src/pocketbase";
import "../src/styles/admin.css";
pb.baseUrl = window.location.origin;
const question = {
  id: "fixture-question",
  title: "已保存的测试题目",
  kind: "text",
  placeholder: "输入答案",
  content: [
    { text: "已保存正文", hint: "", imageUrl: "", imageUrls: [], videoUrl: "" },
  ],
  options: [],
  acceptedAnswers: ["private-answer"],
  status: "draft",
  groupName: "其他",
  fuzzyMatch: false,
};
const catalog = {
  questions: [question],
  sessions: [
    {
      id: "fixture-session",
      seriesKey: "fixture",
      revision: 1,
      status: "draft",
      title: "场次预览测试",
      description: "一段入场说明",
      minLevel: "",
      maxLevel: "",
      presentation: {},
      completionTarget: { kind: "narrative", id: "fixture-narrative" },
      liveSettingsVersion: "fixture",
      levels: [
        {
          id: "level-1",
          question: question.id,
          xp: 10,
          autoNext: true,
          presentationOverride: {},
        },
        {
          id: "level-2",
          question: question.id,
          xp: 10,
          presentationOverride: { hideTitle: true },
        },
      ],
      clues: [
        {
          id: "clue-start",
          trigger: "start",
          kind: "text",
          autoPlay: true,
          content: {
            title: "开场线索",
            text: "这是开场提示",
            url: "",
            imageUrls: [],
            buttonText: "查看线索",
          },
        },
        {
          id: "clue-manual",
          trigger: "manual",
          kind: "text",
          content: {
            title: "手动线索",
            text: "手动解锁正文",
            url: "",
            imageUrls: [],
            buttonText: "查看",
          },
        },
      ],
      rewardRules: [],
    },
  ],
  players: [],
  rewards: [],
  narratives: [
    {
      id: "fixture-narrative",
      seriesKey: "fixture",
      revision: 1,
      status: "draft",
      kind: "letter",
      title: "预览来信",
      payload: {
        variant: "modern",
        description: "剧情预览说明",
        hintText: "点击开启信件",
        typingSpeedMs: 60,
        paragraphs: [
          {
            content: "这是一段用于预览的剧情文字。",
            align: "left",
            delayMs: 0,
          },
        ],
        phrases: [{ text: "愿你前程似锦", durationMs: 1000 }],
        closingLines: [{ text: "故事仍在继续", durationMs: 1000 }],
        backgroundImages: [],
      },
    },
  ],
  ranks: [],
};
const originalFetch = window.fetch;
window.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (url.includes("/api/")) {
    if (init?.method && init.method !== "GET")
      return new Response(
        JSON.stringify({ error: { message: "隔离测试禁止业务写入" } }),
        { status: 403 },
      );
    return Response.json(
      url.endsWith("/admin/catalog") ? catalog : { items: [] },
    );
  }
  return originalFetch(input, init);
};
createRoot(document.getElementById("root")!).render(
  <MemoryRouter
    initialEntries={[
      location.search.includes("session") ? "/?sessionId=fixture-session" : "/",
    ]}
  >
    <ColorModeContextProvider>
      <App>
        <div className="admin-shell" style={{ padding: 16 }}>
          {location.search.includes("session-live") ? (
            <LiveSessionSettingsDrawer
              session={
                { ...catalog.sessions[0], status: "published" } as AdminSession
              }
              catalog={catalog as unknown as AdminCatalog}
              questions={(catalog as unknown as AdminCatalog).questions}
              open
              onClose={() => {}}
              refresh={async () => {}}
            />
          ) : location.search.includes("notification") ? (
            <OperationPage section="notifications" />
          ) : (
            <ContentPage
              section={
                location.search.includes("session")
                  ? "sessions"
                  : location.search.includes("narrative")
                    ? "narratives"
                    : location.search.includes("reward")
                      ? "rewards"
                      : "questions"
              }
            />
          )}
        </div>
      </App>
    </ColorModeContextProvider>
  </MemoryRouter>,
);
