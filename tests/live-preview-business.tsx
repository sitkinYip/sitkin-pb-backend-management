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
  sessions: [],
  players: [],
  rewards: [],
  narratives: [],
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
  <MemoryRouter>
    <ColorModeContextProvider>
      <App>
        <div className="admin-shell" style={{ padding: 16 }}>
          {location.search.includes("notification") ? (
            <OperationPage section="notifications" />
          ) : (
            <ContentPage section="questions" />
          )}
        </div>
      </App>
    </ColorModeContextProvider>
  </MemoryRouter>,
);
