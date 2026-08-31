---
name: questions-admin-maintenance
description: 维护 Sitkin 答题后台管理仓库时使用，包括 React/Refine/Ant Design 管理端、PocketBase hooks、迁移、共享协议、测试，以及 1Panel 生产后端和数据库发布、备份、验收与回退。涉及本仓库的开发、修复、发布判断或生产数据库操作时触发。
---

# Sitkin 答题后台维护

本 Skill 服务于 `sitkin-pb-backend-management`。这个仓库不只是管理前端，也包含 PocketBase 后端源码、数据库迁移和生产发布材料。

## 先判断改动属于哪一层

| 改动 | 主要位置 | 发布方式 |
| --- | --- | --- |
| 管理页面、样式、表单、提示 | `src/`、`tests/` | push `main` 后由管理端 Action 构建并上传 `dist/` |
| API、权限、判题、经验、奖品、内容约束 | `backend/pb_hooks/` | 构建并验证 PocketBase 镜像，再经批准维护生产容器 |
| 集合、字段、索引、迁移账本 | `backend/pb_migrations/` | 新增增量迁移，隔离验证后在维护窗口发布后端和数据库 |
| 前后端共享协议 | `backend/contracts/game.ts` | 同步管理端与相邻 `questions-web`，按受影响项目分别发布 |
| 玩家展示或交互 | 相邻 `../questions-web` | 玩家端单独验证、单独发布 |

不要把管理端 GitHub Action 当作后端或数据库发布。它只验证并部署静态管理页面，不更新生产 PocketBase 容器，不运行迁移，也不导入数据。

## 开始工作

1. 读取根目录 `README.MD` 和 `docs/project-maintenance-and-release.md`。
2. 涉及后端时再读取 `backend/README.md`；涉及生产发布时必须读取 `backend/deploy/1panel/UPGRADE.md`、`backend/deploy/1panel/README.md` 和最新的 `docs/*deployment*.md`。
3. 检查 `git status --short`，保留用户已有修改，不清理、不覆盖无关文件。
4. 核对当前代码、实际运行版本和最新发布记录。带日期的生产信息只是上次验证快照，发布前必须只读复核线上状态。
5. 未经用户明确要求，不 commit、不 push、不部署、不连接生产环境、不修改真实数据。

## 开发与验证

- 管理端本地默认连接线上 API，本地页面写操作会修改真实数据。不要把生产库作为集成测试库；写入验收使用隔离 PocketBase 或专用测试对象，并先确认影响。
- 管理端常用验证：`pnpm test:admin`、`pnpm check:contracts --admin-only`、`pnpm build`。
- 修改共享协议时，以 `backend/contracts/game.ts` 为源，运行 `node backend/scripts/sync-contracts.mjs`；两个仓库不在同级时只做管理端检查并明确说明未验证玩家端副本。
- 修改 hooks、迁移、数据库规则或后端镜像时，按 `backend/README.md` 构建对应架构的隔离镜像，执行 `pnpm test:backend` 和镜像恢复演练。测试必须使用临时库，不挂载生产 `pb_data`。
- 业务结算、权限、经验、奖品、核销和内容引用约束由服务端负责；不要仅靠隐藏按钮或前端校验实现安全规则。
- 新数据库变更使用新的增量迁移文件。不要修改已经在生产执行过的迁移，不启用自动迁移来掩盖迁移账本差异。

## 发布管理前端

1. 完成与风险相称的单元测试、协议检查和构建。
2. 说明本次是否依赖尚未发布的后端接口或规则；若依赖，先发布并验收后端。
3. 仅在用户要求时 commit / push。push `main` 会触发 `.github/workflows/deploy.yml`。
4. Action 的只读 API 探测只能说明基本兼容，不能证明后端业务改动或数据库迁移已上线。

## 发布 PocketBase 后端或数据库

生产发布属于高风险维护。只有用户明确批准当前发布和维护窗口后才执行；已经批准开发，不等于批准生产切换或数据写入。

1. 只读确认容器、镜像、Compose、挂载、端口、CPU 架构、迁移账本和磁盘空间。已知的最近快照见项目发布文档，不把快照当成实时事实。
2. 先在隔离环境验证目标 AMD64 镜像、完整后端回归、空库迁移、旧库恢复副本和重启持久化。
3. 制作带版本、架构、校验值和发布说明的独立发布包；不把凭据、真实数据或私密内容放进镜像或仓库。
4. 停止目标业务写入后，完整备份 `pb_data`、实际 Compose、发布元信息及匹配的 hooks / migrations，并把备份恢复到隔离位置验证。不要只复制运行中的单个 SQLite 文件。
5. 确保同一份 `pb_data` 同时只由一个 PocketBase 实例打开；保持 `--automigrate=false`，只运行本次已审查的迁移。
6. 仅修改已确认的目标容器和配置，不停止 1Panel 中其他应用、AList 或 OpenResty，不开放 8090 到公网。
7. 切换后核对镜像、健康、端口、挂载、迁移账本、集合结构和关键业务记录。生产写入验收需单独获批。
8. 失败时优先保持或恢复原应用版本。生产出现新答题、经验、奖品或核销后，不得用旧数据库快照覆盖当前数据；先停写保存现状，优先前向修复。
9. 更新 `docs/` 正式发布记录，写清版本、授权、备份、验证、未执行事项和回退边界。

最近确认的生产布局为 1Panel 容器 `questions-game-v1`、Compose `/opt/1panel/apps/questions-game-v1/compose.yaml`、宿主目录 `/opt/1panel/apps/questions-game-v1/pb_data` 挂载到 `/pb/pb_data`、回环端口 `127.0.0.1:8090`。这些值必须在每次生产操作前重新核对。

## 安全边界

- 密码、超级管理员令牌、SSH 私钥、柜码、玩家答卷和领取信息不得发到聊天、写入前端变量、提交仓库或进入构建日志。
- 远程维护优先使用用户在本机建立的专用 SSH control socket；密码只在用户自己的终端输入，任务结束关闭连接。
- AList/CDN 媒体不在 `pb_data` 备份范围内，需独立确认保留和恢复策略。
- 删除、导入、批量下发、内容发布、迁移、账号初始化、密码重置和生产业务写入都需要与用户请求严格一致；不因“发布后端”顺便执行。
- 发布顺序通常为后端 / 数据库 → 管理端 → 玩家端，但只发布实际受影响的部分。

