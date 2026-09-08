# 题目与通知实时预览

本地代码已实现，尚未部署。范围是新版 `/questions` 的新建、编辑及只读题目抽屉，以及 `/notifications` 的发送表单。场次流程、旧版表单、通用线索编辑器、草稿分享不在本次范围。

## 使用方式

桌面打开题目编辑器后，表单右侧展示玩家端真实组件。修改展示字段约 200ms 后更新，不需要保存。窄屏使用「编辑 / 预览」切换，表单保持挂载，草稿不会因切换丢失。桌面尺寸预览在表单下方显示 1200px 宽窗口；空间不足时只在预览区域横向滚动。

题目支持标题、填空/单选、输入占位提示、题面段落、可展开提示、多图片、视频与选项。可切换未作答、答错、答对展示；提交按钮只说明如何切换模拟状态，不执行判题。答案和关键词不会传给预览页。场次隐藏标题、背景、进度、通用线索等关联设置不参与本次预览。

通知支持正文详情、未读/已读、通知弹窗、弹窗标题与按钮文案。确认操作仅修改内存，发送时间采用打开预览时的模拟时间。接收人、接收范围和过期时间不参与视觉预览，不代表通知已发送或送达。

两种预览均支持浅色/深色主题和重置。普通文本修改保留预览输入与滚动；切换模拟状态或重置会重置交互。预览中的链接不可跳转；图片和视频可查看，媒体服务仍须允许播放器所在域名访问。

## 实现与边界

- 后台 `src/game/preview/LivePreview.tsx` 监听 Ant Design 表单，`draft.ts` 只提取展示字段。
- 共享协议定义在 `backend/contracts/game.ts`，通过现有 `sync-contracts.mjs` 同步两端。协议版本为 1；此变更不涉及后端接口、hooks 或数据库。
- 玩家端 `preview/index.html` → `src/features/preview/main.tsx` → `EditorPreview.tsx` 使用独立 HTML 入口启动，不挂载正式身份、API 查询和持久化 provider。复用 `QuestCard` / `DesktopQuestCard`、`NotificationLetterView`、`NotificationDialog` 与媒体组件。
- 两端校验精确 origin、来源窗口和预览 channel。玩家端还校验数据结构、协议版本及递增 revision。预览不接收令牌、答案、接收人，不执行业务写入、正式进度存储或埋点。
- iframe 不开放导航、弹窗或原生表单提交。富文本链接点击也在 React 捕获阶段阻止。
- 连接超时或版本不匹配时后台保留表单并提示重新连接。非法草稿在预览中显示错误，后续有效修改自动恢复。

## 本地联调

玩家端启动：`pnpm dev`（默认 5173）。后台启动：

```sh
VITE_PLAYER_PREVIEW_URL=http://127.0.0.1:5173/preview/ pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort
```

访问后台的 `/tests/live-preview.html` 或 `/tests/live-preview.html?kind=notification` 可使用隔离假表单，完全不需要后台登录和业务 API。不要使用正式管理表单随手保存生产数据。

后台生产默认预览地址是 `https://sitkin.top/questions-next/preview/`，可用 `VITE_PLAYER_PREVIEW_URL` 覆盖。玩家端生产默认仅允许 `https://vae.sitkin.top` 作为父页面；其他确切来源通过 `VITE_PREVIEW_ADMIN_ORIGINS` 配置，逗号分隔。localhost、127.0.0.1 和 local.sitkin.top 仅在开发模式额外允许。

## 兼容与发布

| 组合 | 行为 |
| --- | --- |
| 旧玩家端 + 当前后端 | 原有功能不变 |
| 新玩家端 + 当前/旧后端 | 预览不使用后端接口；正式业务协议未改变 |
| 旧管理端 + 当前后端/新玩家端 | 原有功能不变，没有预览入口 |
| 新管理端 + 当前/旧后端 | 现有保存/发送接口不变；预览不写数据库 |
| 新管理端 + 旧玩家端 | 预览握手超时并提示不可用，仍可编辑和保存 |
| 新管理端 + 新玩家端 | 协议版本一致且允许嵌入时可用，不产生新格式业务数据 |

建议先执行玩家端 `pnpm build:preview`，将完整产物发布到 `/questions-next/`，再发布管理端。无需发布 PocketBase 或执行迁移。上线前确认 `/questions-next/preview/` 加载独立的 `preview/index.html`（不能 fallback 到玩家首页），并且该预览入口的 HTTP 响应允许后台嵌入：CSP `frame-ancestors https://vae.sitkin.top`，不能同时被 `X-Frame-Options: DENY/SAMEORIGIN` 阻断。仅为预览入口设置所需权限，不必放宽正式业务页面。

当前状态：源码完成；本地验证见本次交付。玩家端发布、管理端发布、线上嵌入响应头验收、生产业务写入均未执行。

## 本次本地验证

- 管理端 47 项测试通过；玩家端原有 284 项及新增 5 项预览测试通过，两端类型检查与生产构建通过，协议副本一致。
- 隔离浏览器验证实时文本更新、保留答题输入、通知确认及弹窗更新；1440、1024、768、390、320 宽度无页面横向溢出。
- `/tests/live-preview-business.html` 使用真实题目抽屉（内存假题库），`?notification` 使用真实通知表单。夹具将业务请求替换为本地响应，拒绝所有写入。
- 真实表单已验证旧值回显、编辑同步、答对模拟、深色主题、1200px 桌面组件、iframe 刷新后自动恢复，以及 320px 抽屉和通知编辑；未产生外部网络请求或页面运行错误。
- 线上嵌入响应头、实际 CDN 媒体可达性及真实设备软键盘仍需部署后验收。本次未执行生产写入。

## 入口与首屏隔离

正式 `src/main.tsx` 保持静态导入 `App` 并直接 render，不再按路径分支或使用顶层动态导入。`pnpm build:production` 只有正式首页入口，不构建预览专用模块；`pnpm build:preview` 为 `/questions-next/` 生成首页与 `preview/index.html` 两份 HTML。两者复用源组件，无须复制 UI。

后台默认使用 `/questions-next/preview/`。若服务器接收到不带尾斜杠的 `/questions-next/preview`，应重定向并保留 channel、parentOrigin 查询参数。静态目录索引必须先于玩家首页 SPA fallback；发布时保留完整 `dist/preview/` 目录及共享 assets。

本地旧的 `VITE_PLAYER_PREVIEW_URL=.../admin-preview` 覆盖值需改为 `.../preview/` 并重启后台开发服务；旧入口已移除。
