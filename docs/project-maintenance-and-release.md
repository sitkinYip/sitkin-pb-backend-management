# 项目维护与发布边界

本文是 `sitkin-pb-backend-management` 的长期维护入口。项目同时包含管理前端、PocketBase 后端、数据库迁移和 1Panel 发布材料；“发布后台管理页面”和“发布后台数据库”是两套独立流程。

## 项目组成

| 组成 | 位置 | 责任 |
| --- | --- | --- |
| 运营管理端 | `src/`、`tests/` | 玩家、等级、题库、叙事、场次、通知、下发、进度、奖品与核销界面 |
| PocketBase 后端 | `backend/pb_hooks/` | API、身份权限、内容约束、判题、经验、奖励、线索和审计 |
| 数据库定义 | `backend/pb_migrations/` | 集合、字段、索引、规则和增量迁移 |
| 共享协议 | `backend/contracts/game.ts` | 管理端与玩家端共用的接口类型与常量源 |
| 后端测试与打包 | `backend/tests/`、`backend/scripts/`、`backend/deploy/` | 隔离集成测试、镜像验证、恢复演练和 1Panel 发布材料 |
| 玩家端 | 相邻仓库 `questions-web` | 玩家答题、历史、线索和奖品展示，独立构建与发布 |

业务结算和访问控制必须由 PocketBase 服务端执行。管理页面可以改善操作体验，但不能成为权限或数据一致性的唯一防线。

## 三种发布路径

| 发布对象 | 触发与方式 | 会不会改生产数据库 |
| --- | --- | --- |
| 管理前端 | push `main`，`.github/workflows/deploy.yml` 测试、构建并上传 `dist/` | 不会。不会更新 PB 容器，也不会运行迁移或导入数据 |
| PocketBase hooks / 镜像 | 隔离构建和回归后，在获批维护窗口上传镜像并切换 1Panel 容器 | 通常复用现有数据库，但会改变服务端行为；必须备份和恢复验证 |
| 数据库结构 / 数据操作 | 新增增量迁移或经批准的专用维护脚本，与后端镜像一同单独发布 | 会。必须明确操作对象、停写、完整备份、隔离恢复、迁移验证和回退边界 |

管理前端 Action 中的 API 探测是只读兼容性检查，不代表新后端已经发布，也不能替代数据库验收。若页面依赖新接口或新规则，先发布并验收后端，再发布管理端；若玩家端协议或展示受影响，再单独发布 `questions-web`。

## 日常开发与验证

管理端本地默认连接 `https://api.sitkin.top`，所以本地页面的写操作同样会修改线上数据。普通界面开发可运行：

```sh
pnpm test:admin
pnpm check:contracts --admin-only
pnpm build
```

共享协议以 `backend/contracts/game.ts` 为源。两个仓库位于同级目录时运行 `node backend/scripts/sync-contracts.mjs`，随后检查两端；仅有管理仓库时使用 `--admin-only`。

修改 `backend/` 时，按 [后端说明](../backend/README.md) 构建隔离镜像并运行真实 PocketBase 集成测试和镜像恢复演练。测试库必须临时创建和清理，不能挂载生产 `pb_data`。新增数据库变更创建新的增量迁移文件，不修改已经应用的迁移。

## 生产后端与数据库维护

以下生产布局是 2026-08-28 正式发布后记录的快照，每次操作前必须重新只读核对：

- 1Panel 容器：`questions-game-v1`。
- 镜像：`questions-pocketbase:0.40.1-narrative-delete-20260828-amd64`。
- 实际 Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`。
- 数据目录：`/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`。
- 端口：`127.0.0.1:8090:8090`，不得直接暴露公网。
- PocketBase：0.40.1，Linux AMD64，生产保持 `--automigrate=false`。

生产切换只能在用户明确批准当前版本和维护窗口后执行。标准顺序为：

1. 只读核对运行版本、Compose、挂载、端口、迁移账本、磁盘和发布前提。
2. 在隔离环境完成目标 AMD64 镜像测试、数据库迁移、旧库恢复副本和重启持久化验证。
3. 生成独立发布包和校验清单；不包含账号密码、真实内容、`pb_data` 或前端构建。
4. 停止目标业务写入，完整备份 `pb_data`、实际 Compose、发布信息和匹配代码；把备份恢复到隔离位置并验证。
5. 确保同一份数据目录只由一个 PocketBase 实例打开，只运行已审查的增量迁移，不自动补迁移或重复初始化。
6. 切换目标镜像，核对健康、端口、挂载、迁移账本、集合结构和关键业务记录。
7. 记录发布结果、未执行操作、备份位置、验收与回退边界，再发布依赖它的前端。

不要只复制运行中的 `data.db`；SQLite WAL、附件和设置可能因此缺失。AList/CDN 等外部媒体也不属于 `pb_data` 备份，必须另行保留。已有新答题、经验、奖品、领取或核销后，禁止用旧备份直接覆盖当前库；应先停写保存现状并优先前向修复。

详细操作以 [1Panel 升级操作单](../backend/deploy/1panel/UPGRADE.md) 和 [1Panel 部署说明](../backend/deploy/1panel/README.md) 为准。最近一次正式切换见 [信件 / 祝福软删除发布记录](narrative-soft-delete-deployment-20260828.md)。带日期的发布记录用于审计，不代表当前实时状态。

## 权限、凭据与操作边界

- 未经明确要求，不 commit、不 push、不部署、不连接生产、不运行迁移、不导入或删除数据。
- 用户批准代码开发不等于批准生产发布；批准后端切换也不等于批准内容删除、批量下发、账号初始化或真实玩家写入测试。
- 密码、超级管理员令牌、SSH 私钥、柜码、玩家答卷与领取信息不得进入聊天、前端变量、仓库或 CI 日志。
- 远程维护使用用户自己建立的专用 SSH 连接，登录密码只在用户终端输入；结束后关闭维护连接。
- 不停止或修改 1Panel 中无关的 AList、OpenResty 和其他应用。

项目内 Codex 维护说明见 [questions-admin-maintenance Skill](../.agents/skills/questions-admin-maintenance/SKILL.md)。

