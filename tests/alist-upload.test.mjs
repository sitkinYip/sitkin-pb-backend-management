import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

let vite;
let alistService;

before(async () => {
  // Load the actual browser service with Vite's import.meta.env handling.
  // No dev port, local env files, credentials or real Alist requests are used.
  vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    envFile: false,
    server: { middlewareMode: true, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ alistService } = await vite.ssrLoadModule("/src/services/alist.ts"));
});

after(async () => {
  await vite?.close();
});

function fixture(t, { token = "test-token", response } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => token },
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    return Response.json(response ?? { code: 200, data: null });
  });
  return calls;
}

test("Chinese image names are replaced before upload; CDN URL uses the same name", async (t) => {
  const calls = fixture(t);
  const file = new File(["image-bytes"], "关卡背景 图 #1.PNG", {
    type: "image/png",
  });
  const result = await alistService.uploadFile(file, "img");
  assert.match(result.filename, /^[a-f0-9]{32}\.png$/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PUT");
  assert.match(calls[0].url, /\/api\/fs\/put$/);
  assert.equal(
    calls[0].headers["File-Path"],
    encodeURIComponent(alistService.getUploadPath(result.filename, "img")),
  );
  assert.equal(result.url, alistService.getPublicUrl(result.filename, "img"));
  assert.equal(calls[0].headers["Content-Type"], "image/png");
  assert.equal(calls[0].headers["As-Task"], undefined);
  assert.equal(calls[0].body, file);
  assert.equal(file.name, "关卡背景 图 #1.PNG");
  assert.equal(await file.text(), "image-bytes");
});

test("same-name uploads, including English names, get different object keys", async (t) => {
  fixture(t);
  const file = new File(["bytes"], "photo.jpg", { type: "image/jpeg" });
  const results = await Promise.all(
    Array.from({ length: 100 }, () => alistService.uploadFile(file, "img")),
  );
  assert.equal(new Set(results.map((item) => item.filename)).size, 100);
  assert(results.every((item) => /^[a-f0-9]{32}\.jpg$/.test(item.filename)));
});

test("extensions are normalized, with MIME fallback for missing or unsafe suffixes", async (t) => {
  const calls = fixture(t);
  for (const [name, mime, type, extension] of [
    ["片段.最终版.MP4", "video/mp4", "video", "mp4"],
    ["配音.MP3", "audio/mpeg", "audio", "mp3"],
    ["封面", "image/webp", "img", "webp"],
    ["背景.图片", "image/png", "img", "png"],
    ["背景.", "image/jpeg", "img", "jpg"],
    ["图.svg+xml", "image/svg+xml", "img", "svg"],
    ["clip", "video/quicktime", "video", "mov"],
    ["录音", "audio/mp4", "audio", "m4a"],
    ["截图.PNG", "", "img", "png"],
    ["未知", "", "img", "bin"],
    ["未知", "constructor", "img", "bin"],
    ["x.png?x=1#片段", "image/png", "img", "png"],
    ["文件.abcdefghijklmnop", "", "img", "bin"],
  ]) {
    const result = await alistService.uploadFile(
      new File(["bytes"], name, { type: mime }),
      type,
    );
    assert.match(result.filename, new RegExp(`^[a-f0-9]{32}\\.${extension}$`));
    assert.equal(
      decodeURIComponent(calls.at(-1).headers["File-Path"]),
      alistService.getUploadPath(result.filename, type),
    );
    assert.equal(result.url, alistService.getPublicUrl(result.filename, type));
    assert.equal(result.taskId, undefined);
  }
});

test("renaming works without crypto.randomUUID on the HTTP development domain", async (t) => {
  fixture(t);
  t.mock.method(globalThis.crypto, "randomUUID", () => {
    throw new Error("randomUUID must not be required");
  });
  const result = await alistService.uploadFile(new File(["x"], "中文.png"), "img");
  assert.match(result.filename, /^[a-f0-9]{32}\.png$/);
});

test("large uploads keep task IDs and polling uses the renamed directory entry", async (t) => {
  const calls = fixture(t, {
    response: { code: 200, data: { task: { id: "upload-task" } } },
  });
  const file = new File(["bytes"], "影片.MP4", { type: "video/mp4" });
  // Avoid allocating 50 MB while still exercising the exact size boundary.
  Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 + 1 });
  const result = await alistService.uploadFile(file, "video");
  assert.equal(result.taskId, "upload-task");
  assert.equal(calls[0].headers["As-Task"], "true");
  assert.match(result.filename, /^[a-f0-9]{32}\.mp4$/);
  assert.equal(result.url, alistService.getPublicUrl(result.filename, "video"));

  const pending = [];
  t.mock.method(globalThis, "setTimeout", (callback) => {
    pending.push(callback);
    return 0;
  });
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ code: 200, data: [] }),
  );
  t.mock.method(alistService, "listFiles", async (type, refresh) => {
    assert.equal(type, "video");
    assert.equal(refresh, true);
    return [{ name: result.filename }];
  });
  let completed = 0;
  alistService.pollUploadTask(
    result.taskId,
    result.filename,
    "video",
    () => completed++,
    (message) => assert.fail(message),
  );
  assert.equal(pending.length, 1);
  await pending.shift()();
  assert.equal(completed, 1);
  assert.equal(pending.length, 0);
});

test("exactly 50 MB remains synchronous", async (t) => {
  const calls = fixture(t);
  const file = new File(["bytes"], "视频.mp4");
  Object.defineProperty(file, "size", { value: 50 * 1024 * 1024 });
  const result = await alistService.uploadFile(file, "video");
  assert.equal(calls[0].headers["As-Task"], undefined);
  assert.equal(result.taskId, undefined);
});

test("logged-out uploads do not send a request", async (t) => {
  const calls = fixture(t, { token: null });
  await assert.rejects(alistService.uploadFile(new File(["x"], "a.png"), "img"), {
    message: "请先登录",
  });
  assert.equal(calls.length, 0);
});

test("Alist errors are surfaced without returning a CDN URL", async (t) => {
  fixture(t, { response: { code: 500, message: "storage unavailable" } });
  await assert.rejects(alistService.uploadFile(new File(["x"], "a.png"), "img"), {
    message: "storage unavailable",
  });
});
