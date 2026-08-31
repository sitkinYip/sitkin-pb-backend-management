# Sitkin 后台管理系统

基于 React、Refine、Ant Design 和 PocketBase 的游戏运营后台。本仓库同时维护管理前端、PocketBase hooks、数据库增量迁移、共享协议、后端测试和 1Panel 发布材料；不是单纯的静态管理页面项目。

- 管理后台：https://vae.sitkin.top/
- 接口：https://api.sitkin.top
- 玩家端：https://sitkin.top/questions/

## 本地开发

只需 **Node.js 24、pnpm 10.28.2**。不需要 Docker、本地数据库、SSH 隧道，也不需要同时克隆玩家端。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:5173`。与玩家端同时开发时可使用 `pnpm dev --port 5174`，然后访问 `http://localhost:5174`。

默认直接连接线上接口，无须创建环境文件。要切换接口时，复制 `.env.example` 为 `.env.local`，修改 `VITE_POCKET_BASE_HOST`（根地址，不含 `/api`）。前端变量会进入浏览器，不能放超级管理员密码或其他密钥。

**本地操作同样会修改线上真实数据**。请使用专门的测试玩家和场次验证，不要把线上数据库作为集成测试库。旧媒体若有防盗链限制，可沿用 `local.sitkin.top` 并在本机 hosts 添加 `127.0.0.1 local.sitkin.top`；不需要 Docker。

后台使用 `game_admins` 中的账号登录，不是 PocketBase 超级管理员邮箱。默认首页为玩家管理；注册入口不开放。

## 常用命令

```bash
pnpm test:admin                    # 登录、退出和路由的单元测试，无需数据库
pnpm check:contracts --admin-only  # 仅检查当前仓库的协议副本
pnpm build                        # 生成 dist/，无需 Docker
```

修改共享协议后，将两个仓库放在同级目录，执行 `node backend/scripts/sync-contracts.mjs` 同步两份代码，再运行 `pnpm check:contracts` 检查两端。普通页面开发、构建和发布不需要相邻仓库。

## GitHub Actions 发布

沿用原流程：**push 到 `main` 自动构建并部署管理端**，也支持手动触发 `Deploy to Server`。

使用已有 Secrets：`HOST`、`USERNAME`、`SSH_KEY`、`SERVER_PATH`。API 默认使用线上地址；`QUESTIONS_POCKETBASE_URL` 只作为可选覆盖，不再要求 `QUESTIONS_BACKEND_V1_READY` 迁移开关。

发布前执行管理端单元测试、协议检查、只读 API 探测和构建，然后上传 `dist/`。不会创建 Docker 容器、导入数据或更新 PocketBase。源码需要提交并 push，Actions 才会部署这些修改；此前的本地打包上线不会替你提交 Git。

## 发布边界

| 内容 | 发布方式 | 数据库影响 |
| --- | --- | --- |
| 管理前端 | push `main` 触发 Action，上传 `dist/` | 不修改数据库，也不更新 PB 容器 |
| PocketBase hooks / API | 隔离测试并打包 AMD64 镜像，获批后维护 1Panel 容器 | 可能改变业务行为，需完整备份与恢复验证 |
| 集合、字段、索引或数据维护 | 新增增量迁移或专用维护脚本，单独审批和发布 | 会影响数据库，必须停写、备份、隔离验证和记录回退边界 |
| 玩家端展示 | 相邻 `questions-web` 仓库单独发布 | 取决于是否同时包含后端改动 |

完整维护原则和后端数据库发布流程见 [项目维护与发布边界](docs/project-maintenance-and-release.md)。最近一次生产后端记录见 [题目通用线索与线上展示编辑发布记录](docs/question-common-clues-deployment-20260831.md)；此前的 [信件 / 祝福软删除发布记录](docs/narrative-soft-delete-deployment-20260828.md) 作为历史快照保留。生产操作前仍须重新核对线上状态。

2026-08-31 后端 migration、hooks 与 API 已上线，但本次没有提交、push 或部署玩家端和管理端，`game_question_clues` 在发布验收时保持为空。必须先发布兼容版玩家端，再发布管理端，最后才能配置第一条题目通用线索。

## 后端源码与可选验收

`backend/` 是线上后端的可维护源码，包含数据库迁移、服务端判题/经验/奖品逻辑、协议和测试，不能当作临时数据删除。

只有修改后端逻辑时才需要运行 `pnpm test:backend` 等隔离验收；Docker 是这种后端测试/镜像打包方案的工具，不是前端启动要求。`PocketBase backend CI` 在后端文件变化时独立运行，其容器只在 GitHub runner 中创建，不是管理端静态发布的依赖。

后端代码变更仍需单独验收、备份并发布后端镜像；前端 push 不会更新线上容器。操作说明见 [后端 README](backend/README.md) 和 [1Panel 发布说明](backend/deploy/1panel/README.md)。

## 项目 Skill

项目内提供 [questions-admin-maintenance Skill](.agents/skills/questions-admin-maintenance/SKILL.md)，用于维护本仓库时识别前端、PocketBase 后端和数据库的边界，并按风险选择验证与发布流程。该 Skill 明确包含生产后端镜像和数据库发布，但不会把管理端 Action 误当成后端发布，也不会在缺少明确授权时操作生产环境。

## 主要管理内容

玩家与账号、等级、题目、题目通用线索、叙事内容、场次编排、指定/全部用户下发、进度干预、奖品核销与审计。已发布场次只允许通过独立接口修改展示白名单，结构、结算和引用仍通过新版本处理；所有结算和权限校验由服务端负责。题目通用线索和线上展示编辑的管理界面当前仍只在源码中，等待用户 push 发布。
