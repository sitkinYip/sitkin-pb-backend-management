# 当前生产状态

本文件是生产状态的稳定入口，随组件发布和功能激活更新。带日期的 deployment 文档保留当时事实，不因为后续发布而改写；真正执行生产操作前仍必须只读复核线上状态。

最后同步：2026-08-31 20:57 +08:00。后端基线依据 [题目关键词匹配与分组后端发布记录](question-keywords-groups-deployment-20260831.md)，两个前端继续依据上一轮公开静态资产只读检查。

## 当前组件状态

| 组件或闸门 | 状态 | 说明 |
| --- | --- | --- |
| PocketBase 数据库迁移 | 已部署 | `1788176000_question_settings.js` 已执行一次；私有集合 `game_question_settings` 发布验收时为 0 条 |
| PocketBase hooks / API | 已部署 | 生产镜像为 `questions-pocketbase:0.40.1-question-keywords-groups-r4-20260831-amd64` |
| 玩家端兼容版本 | 已部署，未因本次后端发布改动 | `main` / `56043fc`；本次题目分组不进入玩家 DTO，现有答题协议保持兼容 |
| 管理端题目关键词/分组版本 | 尚未部署 | 后端接口已就绪；新管理端由用户另行 push、构建和发布，当前不可通过线上管理端配置新能力 |
| 题目通用线索功能激活 | 可进入人工激活，当前数据状态未复核 | 后端发布时集合为空；本次文档任务未登录后台读取当前数量，也未创建线索 |
| 题目关键词匹配与分组激活 | 未激活 | `game_question_settings` 为 0 条；旧题继续按 `exact + 其他` 处理，未回填旧题 |
| 生产业务写入验收 | 未执行 | 未创建线索、未编辑场次、未使用真实账号答题或发奖 |

本次关键词匹配与分组的服务端发布已经完成，玩家端无需随本能力发布。下一步由用户发布新管理端；确认管理端生效后，再由运营逐题编辑或使用“归类”入口手工回填。回填、开启关键词模式和真实答题验收仍是独立生产写入授权。

## 最近核对的运行基线

- 容器：`questions-game-v1`，最近验收为 healthy，重启计数 0。
- PocketBase：0.40.1，Linux AMD64。
- 实际镜像 ID：`sha256:b80955c122e8e6e6b9932d98dfeab80dc123f22baeff88a2b5b47f155f0f164a`。
- Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`；仓库镜像模板为 `backend/deploy/1panel/compose.production.yaml`。
- Compose SHA-256：`a0144f9794b3c4a84f7f0e8165b0620c5d3e585fa2b432eb75f00dc60a9b3bb5`。
- 数据挂载：`/opt/1panel/apps/questions-game-v1/pb_data` 到 `/pb/pb_data`。
- 端口：仅 `127.0.0.1:8090:8090`。
- 迁移账本 SHA-256：`296348491ac81cba553be08650417cf89a84d9c89d61472eb0109566dc32032b`。
- 当前最近正式记录：[2026-08-31 题目关键词匹配与分组后端发布记录](question-keywords-groups-deployment-20260831.md)。

这些值是最近审计快照，不是生产操作的替代检查。服务器状态与本文件不一致时立即停止，不自行选择一个版本继续。

## 当前操作单状态

当前没有待执行的生产升级操作单。`backend/deploy/1panel/UPGRADE.md` 是滚动槽，目前保留本次 R4 发布的完成版内容，下一次发布前必须完整替换和重审；不可变副本保留在服务器发布包、Git 历史和日期记录中。`backend/deploy/1panel/README.md` 是 0.22.12 首次替换部署历史。

下一次升级必须先建立新的 source / target 兼容矩阵，更新版本专属操作单并使其与 `release.json`、迁移列表和发布包完全一致，再按 [后端迁移与生产发布安全规范](backend-release-safety.md) 执行。
