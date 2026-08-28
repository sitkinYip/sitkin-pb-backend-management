import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import ts from "typescript";

let vite;
let TextSyntaxHelp;

before(async () => {
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    envFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ TextSyntaxHelp } = await vite.ssrLoadModule(
    "/src/components/TextSyntaxHelp.tsx",
  ));
});

after(async () => {
  await vite?.close();
});

test("shared guidance starts collapsed and contains no form submission controls", () => {
  const html = renderToStaticMarkup(TextSyntaxHelp());
  assert.match(html, /文本语法说明/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, /<(?:button|input|textarea)\b/);
});

test("guidance covers the supported syntax and corrects the retired instructions", () => {
  const body = TextSyntaxHelp().props.items[0].children;
  const html = renderToStaticMarkup(body);
  for (const label of [
    "高亮文字",
    "外部链接",
    "站内跳转",
    "内嵌图片",
    "内嵌视频",
    "视频封面",
    "换行",
    "组合示例",
  ])
    assert(html.includes(label), label);
  assert(html.includes("[[需要强调的文字]]"));
  assert(html.includes("((查看详情||https://example.com))"));
  assert(html.includes("((返回首页||/))"));
  assert(html.includes("{{https://example.com/image.png}}"));
  assert(html.includes("&lt;&lt;https://example.com/video.mp4&gt;&gt;"));
  assert(html.includes("video.mp4||https://example.com/poster.jpg"));
  assert(html.includes("按 Enter 换行"));
  assert(html.includes("<code>\\n</code> 不会换行"));
  assert(html.includes("路径以单个 / 开头"));
  assert(html.includes("内嵌图片不提供点击大图预览"));
  assert(html.includes("不是 Markdown 或 HTML 编辑器"));
  assert(html.includes("复制 CDN 链接"));
  assert.doesNotMatch(
    html,
    /否则作为路由跳转|点击可预览大图|<(?:img|video|a|input|button)\b/,
  );
});

// Verify field wiring without coupling this repository's tests to the sibling app.
// The browser check additionally exercises these real forms with local fixtures.
async function helpFields(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const tree = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const labels = [];
  const visit = (node) => {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(tree) === "Form.Item"
    ) {
      const attributes = node.openingElement.attributes.properties;
      const extra = attributes.find(
        (item) =>
          ts.isJsxAttribute(item) && item.name.getText(tree) === "extra",
      );
      if (extra?.initializer?.getText(tree).includes("<TextSyntaxHelp")) {
        const label = attributes.find(
          (item) =>
            ts.isJsxAttribute(item) && item.name.getText(tree) === "label",
        );
        labels.push(label.initializer.text);
        const controls = node.children.filter((item) =>
          ts.isJsxSelfClosingElement(item),
        );
        assert.equal(
          controls.length,
          1,
          "help must not interfere with Form.Item's controlled input",
        );
        assert.equal(controls[0].tagName.getText(tree), "Input.TextArea");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return labels;
}

test("content forms attach help only to rich body, hint, clue and reward-instruction fields", async () => {
  assert.deepEqual(await helpFields("../src/game/ContentPages.tsx"), [
    "正文",
    "可展开提示",
    "文字内容",
    "可复用的领取说明",
  ]);
});

test("operation forms attach help to notification body and private claim details", async () => {
  assert.deepEqual(await helpFields("../src/game/OperationPages.tsx"), [
    "仅此用户可见的取件码 / 领取说明",
    "正文（支持原有富文本标记）",
  ]);
});

test("retained legacy forms use the shared component instead of duplicate instructions", async () => {
  for (const path of [
    "../src/pages/levels/components/ThreadEditor.tsx",
    "../src/pages/multiQuestClues/form-fields.tsx",
    "../src/pages/notifications/form-fields.tsx",
  ]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert(
      source.includes(
        'import { TextSyntaxHelp } from "@/components/TextSyntaxHelp";',
      ),
    );
    assert.doesNotMatch(source, /export const TextSyntaxHelp/);
  }
});
