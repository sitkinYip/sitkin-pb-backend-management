import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import React from "react";
import { Form, Input, Select } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite, ui, guides, shared, clueFields, questionClues, liveSettings;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    envFile: false,
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
    },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ui = await vite.ssrLoadModule("/src/game/ui.tsx");
  guides = await vite.ssrLoadModule("/src/game/guidance.ts");
  shared = await vite.ssrLoadModule("/src/game/shared.tsx");
  clueFields = await vite.ssrLoadModule("/src/game/components/ClueFields.tsx");
  questionClues = await vite.ssrLoadModule(
    "/src/game/QuestionClueManager.tsx",
  );
  liveSettings = await vite.ssrLoadModule(
    "/src/game/LiveSessionSettingsDrawer.tsx",
  );
});
after(async () => {
  await vite?.close();
});

test("field help preserves the single controlled input, validation and explicit placeholder", () => {
  const rules = [{ required: true }];
  const field = ui.Field({
    name: "title",
    label: "题目标题",
    rules,
    children: React.createElement(Input, { placeholder: "保留自定义提示" }),
  });
  assert.equal(field.type, Form.Item);
  assert.equal(field.props.name, "title");
  assert.equal(field.props.rules, rules);
  assert.equal(field.props.children.type, Input);
  assert.equal(field.props.children.props.placeholder, "保留自定义提示");
  assert(field.props.extra);
});

test("initial values and multiline arrays still bind through guided fields", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      Form,
      {
        name: "test",
        initialValues: { title: "原始题目", answers: ["北京", "北京市"] },
      },
      React.createElement(
        ui.Field,
        { name: "title", label: "题目标题" },
        React.createElement(Input),
      ),
      React.createElement(
        ui.Field,
        { name: "answers", label: "可接受答案（每行一个）" },
        React.createElement(shared.LinesInput),
      ),
    ),
  );
  assert.match(html, /value="原始题目"/);
  assert.match(html, /北京\n北京市/);
  assert.match(html, /id="test_answers"/);
  assert.match(html, /for="test_answers"/);
});

test("field selects get searchable labels without changing values or options", () => {
  const options = Array.from({ length: 8 }, (_, index) => ({
    value: String(index),
    label: `选项 ${index}`,
  }));
  const field = ui.Field({
    label: "奖品",
    name: "reward",
    children: React.createElement(Select, { options, value: "3" }),
  });
  assert.equal(field.props.children.props.options, options);
  assert.equal(field.props.children.props.value, "3");
  assert.equal(field.props.children.props.showSearch, true);
  assert.equal(field.props.children.props.optionFilterProp, "label");
  const small = ui.Field({
    label: "玩家",
    children: React.createElement(Select, { options: options.slice(0, 2) }),
  });
  assert.equal(small.props.children.props.showSearch, true);
});

test("table columns keep usable widths and scrolling stays inside the table", () => {
  const render = () => "custom";
  const result = ui.AdminTable({
    rowKey: "id",
    dataSource: [],
    pagination: false,
    columns: [
      { title: "题目", dataIndex: "title" },
      { title: "状态", dataIndex: "status" },
      { title: "操作", render },
    ],
  });
  const table = result.props.children[1];
  assert.equal(table.props.tableLayout, "fixed");
  assert.equal(table.props.scroll.x, 680);
  assert.equal(table.props.columns[2].render, render);
  assert.equal(table.props.pagination, false);
  assert(table.props.columns.every((column) => column.width >= 100));
});

test("table respects custom column width, pagination and time renderers", () => {
  const render = () => "existing";
  const result = ui.AdminTable({
    scroll: { x: 900, y: 400 },
    pagination: { current: 3, pageSize: 20 },
    columns: [{ title: "时间", dataIndex: "created", width: 210, render }],
  });
  const table = result.props.children[1];
  assert.equal(table.props.columns[0].width, 210);
  assert.equal(table.props.columns[0].render, render);
  assert.equal(table.props.scroll.x, 900);
  assert.equal(table.props.scroll.y, 400);
  assert.equal(table.props.pagination.current, 3);
  assert.equal(table.props.pagination.pageSize, 20);
  assert.equal(ui.displayTime(""), "—");
});

test("editors keep forceRender and submit controls while moving actions into the footer", () => {
  const actions = React.createElement("button", null, "保存");
  const result = ui.EditorDrawer({
    title: "编辑",
    open: true,
    forceRender: true,
    width: 900,
    extra: actions,
    classNames: { wrapper: "caller-wrapper", body: "caller-body" },
    styles: { wrapper: { width: 850 }, body: { padding: 8 } },
  });
  assert.equal(result.props.forceRender, true);
  assert.equal(result.props.open, true);
  assert.equal(result.props.footer.props.children, actions);
  assert.equal(result.props.extra, undefined);
  assert.match(result.props.classNames.wrapper, /admin-editor-wrapper/);
  assert.match(result.props.classNames.wrapper, /caller-wrapper/);
  assert.equal(result.props.classNames.body, "caller-body");
  assert.equal(result.props.styles.wrapper.width, 850);
  assert.equal(result.props.styles.wrapper.maxWidth, "100vw");
  assert.equal(result.props.styles.body.padding, 8);
});

test("question clues keep an explicit safe kind allowlist and an authoritative ordered payload", () => {
  assert.deepEqual(
    clueFields.questionClueKindOptions.map((option) => option.value),
    ["text", "image", "video", "link"],
  );
  const payload = questionClues.questionClueSavePayload(
    {
      reason: "  批量补充线索  ",
      clues: [
        {
          id: "clue-existing",
          kind: "image",
          content: { imageUrls: [" one.png ", "", "two.png"] },
          autoPlay: true,
        },
        {
          kind: "link",
          content: { title: "资料", url: "https://example.com" },
          autoPlay: true,
        },
      ],
    },
    "question-version-3",
  );
  assert.equal(payload.reason, "批量补充线索");
  assert.equal(payload.expectedVersion, "question-version-3");
  assert.equal(payload.clues[0].id, "clue-existing");
  assert.deepEqual(payload.clues[0].content.imageUrls, ["one.png", "two.png"]);
  assert.equal(payload.clues[0].autoPlay, true);
  assert.equal(payload.clues[1].id, undefined);
  assert.equal(payload.clues[1].kind, "link");
  assert.equal(payload.clues[1].autoPlay, false);
});

test("published-session payload strips every structural and completion field", () => {
  const payload = liveSettings.liveSettingsPayload(
    {
      reason: "  修正线上展示  ",
      title: "线上标题",
      description: "线上说明",
      presentation: {
        bgmMode: "custom",
        bgmUrl: "bgm.mp3",
        backgroundMode: "custom",
        backgroundUrl: "cover.jpg",
        hideTitle: true,
        completionStyle: "finale",
      },
      levels: [
        {
          id: "level-1",
          question: "locked-question",
          presentationOverride: {
            bgmMode: "silent",
            completionStyle: "finale",
          },
          autoNext: true,
        },
      ],
      clues: [
        {
          id: "session-clue-1",
          position: 99,
          kind: "text",
          trigger: "level_completed",
          sessionLevel: "level-1",
          content: { text: "更新后的正文" },
          autoPlay: true,
        },
      ],
      rewardRules: [{ reward: "locked" }],
      minLevel: 10,
    },
    "live-version-7",
  );
  assert.equal(payload.reason, "修正线上展示");
  assert.equal(payload.expectedVersion, "live-version-7");
  assert.deepEqual(Object.keys(payload.presentation).sort(), [
    "backgroundMode",
    "backgroundUrl",
    "bgmMode",
    "bgmUrl",
    "hideTitle",
  ]);
  assert.equal(payload.presentation.completionStyle, undefined);
  assert.deepEqual(payload.levels, [
    {
      id: "level-1",
      presentationOverride: { bgmMode: "silent" },
    },
  ]);
  assert.deepEqual(payload.clues, [
    {
      id: "session-clue-1",
      position: 0,
      content: {
        title: "",
        text: "更新后的正文",
        url: "",
        imageUrls: [],
        buttonText: "",
        description: "",
        tips: "",
      },
      autoPlay: true,
    },
  ]);
  assert.equal(payload.minLevel, undefined);
  assert.equal(payload.rewardRules, undefined);
});

test("clue editors expose batch actions, validation, previews and narrow APIs", async () => {
  const [content, commonClues, live, fields] = await Promise.all([
    readFile(new URL("../src/game/ContentPages.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/game/QuestionClueManager.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/game/LiveSessionSettingsDrawer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/game/components/ClueFields.tsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(content, /import \{ PresentationFields \}/);
  assert.doesNotMatch(content, /function PresentationFields/);
  assert.match(commonClues, /\/admin\/questions\/\$\{/);
  assert.match(commonClues, /历史已答/);
  for (const action of ["上移", "下移", "复制", "删除"]) {
    assert.match(commonClues, new RegExp(action));
  }
  for (const message of [
    "请填写文字线索正文",
    "请至少填写一张线索图片",
    "请填写视频 URL",
    "请填写外部链接 URL",
  ]) {
    assert.match(fields, new RegExp(message));
  }
  assert.match(
    live,
    /\/admin\/sessions\/\$\{encodeURIComponent\(session\.id\)\}\/live-settings/,
  );
  assert.match(live, /CluePlayerPreview/);
  assert.match(live, /叙事入口预览受限/);
  assert.match(live, /requirePrimary/);
});

test("every active area has guidance and critical rules stay explicit", () => {
  assert.equal(Object.keys(guides.pageGuides).length, 12);
  for (const guide of Object.values(guides.pageGuides)) {
    assert(guide.description);
    assert.equal(guide.steps.length, 3);
  }
  assert.match(guides.fieldGuides["对已完成用户重新下发"].hint, /经验和奖品/);
  assert.match(guides.fieldGuides["可复用的领取说明"].hint, /个人取件码/);
  assert.match(guides.fieldGuides["下发范围"].hint, /不包含以后新建/);
  assert.match(guides.fieldGuides["累计经验下限"].hint, /不是/);
});

test("responsive rules fix viewport sizing and replace fixed form rows with grids", async () => {
  const css = await readFile(
    new URL("../src/styles/admin.css", import.meta.url),
    "utf8",
  );
  assert.match(css, /box-sizing: border-box/);
  assert.match(css, /min-height: 100dvh/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.admin-editor-wrapper\s*\{[^}]*max-width:\s*100vw/s);
  assert.match(
    css,
    /@media[^}]*max-width:\s*575px[\s\S]*\.admin-clue-editor-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.doesNotMatch(css, /body\s*\{[^}]*overflow:\s*hidden/);
  for (const path of ["ContentPages.tsx", "OperationPages.tsx"]) {
    const source = await readFile(
      new URL(`../src/game/${path}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /<Table(?:\s|>)/);
    assert.doesNotMatch(source, /width:\s*(?:160|220)\s*\}\}/);
    assert.match(source, /admin-field-grid/);
  }
});

test("question selectors and catalog titles expose question IDs", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/game/ContentPages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/admin.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /<Tooltip title=\{`题目 ID：\$\{row\.id\}`\}>/);
  assert.match(source, /optionFilterProp="searchText"/);
  assert.match(source, /className="admin-question-option-id"/);
  assert.match(source, /题目 ID：\{String\(option\.value\)\}/);
  assert.match(css, /\.admin-question-option-id\s*\{[^}]*font-size:\s*12px/s);
});

test("question editor wires group backfill and keyword matching controls", async () => {
  const source = await readFile(
    new URL("../src/game/ContentPages.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /name="fuzzyMatch"/);
  assert.match(source, /必须包含的关键词（每行一个）/);
  assert.match(source, /filterQuestions\(/);
  assert.match(source, /调整题目分组/);
  assert.match(source, /\/admin\/questions\/\$\{grouping\.id\}\/group/);
  assert.match(source, /线上引用中的题目也可调整/);
});
