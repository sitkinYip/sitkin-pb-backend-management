# 当前生产状态

本文件是生产状态的稳定入口，随组件发布和功能激活更新。带日期的 deployment 文档保留当时事实，不因为后续发布而改写；真正执行生产操作前仍必须只读复核线上状态。

最后同步：2026-08-31 12:30 +08:00。后端基线依据 [题目通用线索与线上展示编辑后端发布记录](question-common-clues-deployment-20260831.md)，两个前端依据公开静态资产只读检查。

## 当前组件状态

| 组件或闸门 | 状态 | 说明 |
| --- | --- | --- |
| PocketBase 数据库迁移 | 已部署 | `1788143000_question_clues.js` 已执行一次，发布验收时 `game_question_clues` 为 0 条 |
| PocketBase hooks / API | 已部署 | 生产镜像为 `questions-pocketbase:0.40.1-question-clues-live-settings-20260831-amd64` |
| 玩家端兼容版本 | 已部署，静态资产已验证 | `main` / `56043fc`；公开构建 `index-DwPm3g1f.js` 包含 `transitionEffects` 和 `effects` |
| 管理端兼容版本 | 已部署，静态资产已验证 | `main` / `7424ba6`；公开构建 `index-DeTSjWBN.js` 包含通用线索与 `live-settings` 入口 |
| 题目通用线索功能激活 | 可进入人工激活，当前数据状态未复核 | 后端发布时集合为空；本次文档任务未登录后台读取当前数量，也未创建线索 |
| 生产业务写入验收 | 未执行 | 未创建线索、未编辑场次、未使用真实账号答题或发奖 |

本次兼容矩阵要求的后端、玩家端和管理端发布已经完成。下一步可以由运营在确认登录与基本页面正常后人工配置首条题目通用线索；配置前仍应只读确认当前集合状态。功能激活和真实业务写入验收继续作为独立状态记录。

## 最近核对的运行基线

- 容器：`questions-game-v1`，最近验收为 healthy，重启计数 0。
- PocketBase：0.40.1，Linux AMD64。
- 实际镜像 ID：`sha256:afc6feeba6d0884d3b485dec95e059344c998f2d90f84ad8e8bdd3809b6db482`。
- Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`；仓库镜像模板为 `backend/deploy/1panel/compose.production.yaml`。
- 数据挂载：`/opt/1panel/apps/questions-game-v1/pb_data` 到 `/pb/pb_data`。
- 端口：仅 `127.0.0.1:8090:8090`。
- 当前最近正式记录：[2026-08-31 后端发布记录](question-common-clues-deployment-20260831.md)。

这些值是最近审计快照，不是生产操作的替代检查。服务器状态与本文件不一致时立即停止，不自行选择一个版本继续。

## 当前操作单状态

当前没有待执行的生产升级操作单。`backend/deploy/1panel/UPGRADE.md` 是滚动槽，目前仍保留已经用于 2026-08-31 发布的完成版内容，下一次发布前必须完整替换和重审；本次不可变副本保留在服务器发布包、Git 历史和日期记录中。`backend/deploy/1panel/README.md` 是 0.22.12 首次替换部署历史。

下一次升级必须先建立新的 source / target 兼容矩阵，更新版本专属操作单并使其与 `release.json`、迁移列表和发布包完全一致，再按 [后端迁移与生产发布安全规范](backend-release-safety.md) 执行。
