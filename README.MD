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

另有只允许手动触发的 `Build reviewed PocketBase release package`，供办公电脑无法运行 Docker 时，在选定 Git revision 构建、测试并下载冻结后端制品。它只有仓库只读权限，不含生产凭据，也不会连接或部署服务器；出包后的人工闸门流程见 [PocketBase 人工闸门发布程序](docs/pocketbase-release-program.md)。两个 Action 的职责不能互换。

## 发布边界

| 内容 | 发布方式 | 数据库影响 |
| --- | --- | --- |
| 管理前端 | push `main` 触发 Action，上传 `dist/` | 不修改数据库，也不更新 PB 容器 |
| PocketBase hooks / API | 隔离测试并打包 AMD64 镜像，获批后维护 1Panel 容器 | 可能改变业务行为，需完整备份与恢复验证 |
| 集合、字段、索引或数据维护 | 新增增量迁移或专用维护脚本，单独审批和发布 | 会影响数据库，必须停写、备份、隔离验证和记录回退边界 |
| 玩家端展示 | 相邻 `questions-web` 仓库单独发布 | 取决于是否同时包含后端改动 |

完整维护原则见 [项目维护与发布边界](docs/project-maintenance-and-release.md)，当前组件部署与功能激活状态统一从 [当前生产状态](docs/current-production.md) 进入，普通增量升级优先使用 [PocketBase 人工闸门发布程序](docs/pocketbase-release-program.md)，生产迁移与回退遵循 [后端发布安全规范](docs/backend-release-safety.md)。带日期的发布记录只保留当时审计事实；生产操作前仍须重新核对线上状态。

2026-11-20 16:09:24 +08:00，同一应用的 SUBSCRIPTION 分类审核通过后，服务端独立激活完成：仅将 `STARWARD_PUSH_SUBSCRIPTION_APPROVED=0` 改为 `1`，保留原镜像、数据、只读凭据、接收范围及账号同意；三次不同健康检查、零重启及 HTTPS 边界通过。随后一条新单人定向旅途消息首次获华为 `80000000`，用户明确确认收到系统通知；未补发历史消息，点击回源未验。`personal_journey` 仍只允许指定玩家，限现有旅途同意范围内、不关联场次的剧情来信和动态。后端仍为 11 月 19 日 `recorded` revision 15 的版本，运营台静态产物也未变。当前状态见 [生产入口](docs/current-production.md) 和 [本次分类激活](docs/harmony-push-subscription-activation-20261120.md)；历史发布与公告送达记录保留原事实。

## 后端源码与可选验收

`backend/` 是线上后端的可维护源码，包含数据库迁移、服务端判题/经验/奖品逻辑、协议和测试，不能当作临时数据删除。

只有修改后端逻辑时才需要运行 `pnpm test:backend` 等隔离验收；Docker 是这种后端测试/镜像打包方案的工具，不是前端启动要求。`PocketBase backend CI` 在后端文件变化时独立运行，其容器只在 GitHub runner 中创建，不是管理端静态发布的依赖。

后端代码变更仍需单独验收、备份并发布后端镜像；前端 push 不会更新线上容器。操作说明见 [后端 README](backend/README.md) 和 [1Panel 发布说明](backend/deploy/1panel/README.md)。

## 项目 Skill 与 UI 规范

项目内按职责提供两套 Skill：

- [questions-admin-maintenance](.agents/skills/questions-admin-maintenance/SKILL.md) 负责管理端、后端源码、迁移源码、共享协议、测试和静态发布规划，并按 [管理后台 UI 工程与样式规范](docs/admin-ui-engineering-standards.md) 约束 PC / 移动端设计。
- [questions-pocketbase-production](.agents/skills/questions-pocketbase-production/SKILL.md) 只负责真实生产 PocketBase / SQLite 的预检、备份、迁移、切换、失败闭锁和回退。

两者都不会把管理端 Action 误当成后端发布。开发、push、生产连接、迁移和真实业务写入分别授权；固定发布顺序已改为按生产者、消费者和功能激活闸门推导。

## 主要管理内容

专属等级头衔与 JSON 扩展下发功能见 [使用与接入说明](docs/extra-config.md)。数据库与后端已于 2026-09-08 发布，两个前端由用户自行发布，功能尚未激活；专属头衔只覆盖名称，扩展配置用于减少后续展示字段迭代的数据库迁移。

玩家与账号、等级、题目、题目分组与关键词匹配、题目通用线索、叙事内容、场次编排、指定/全部用户下发、进度干预、奖品核销与审计。已发布场次只允许通过独立接口修改展示白名单，结构、结算和引用仍通过新版本处理；所有结算和权限校验由服务端负责。管理端部署和功能激活进度以 [当前生产状态](docs/current-production.md) 为准。

题目、通知、剧情、奖品与场次表单（含线上展示设置）的实时展示预览已在本地实现，复用玩家端组件，未保存修改可直接预览。需分别发布玩家端和管理端，无 PocketBase 迁移；配置、联调与嵌入响应头要求见 [实时预览说明](docs/live-editor-preview.md)。
