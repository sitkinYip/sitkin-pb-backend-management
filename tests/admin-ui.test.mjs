import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import React from "react";
import { Form, Input, Select } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let vite, ui, guides, shared;
before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    envFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ui = await vite.ssrLoadModule("/src/game/ui.tsx");
  guides = await vite.ssrLoadModule("/src/game/guidance.ts");
  shared = await vite.ssrLoadModule("/src/game/shared.tsx");
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
  });
  assert.equal(result.props.forceRender, true);
  assert.equal(result.props.open, true);
  assert.equal(result.props.footer.props.children, actions);
  assert.equal(result.props.extra, undefined);
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
