# 当前生产状态

最后同步：2026-09-08 15:29 +08:00。本次数据库和后端已部署，依据 [专属头衔与扩展配置发布记录](extra-config-player-titles-deployment-20260908.md)。带日期记录保留历史事实；后续操作仍须只读复核现场。

## 当前组件状态

| 组件或闸门                     | 状态                           | 说明                                                                                 |
| ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------ |
| PocketBase 数据库迁移          | 已部署                         | `1788825600_player_titles_extra.js` 执行一次；新增三个私有集合发布时为空             |
| PocketBase hooks / API         | 已部署                         | `questions-pocketbase:0.40.1-extra-config-player-titles-20260908-amd64`              |
| 玩家端扩展配置版本             | 待用户自行发布，本次未验证部署 | 用户负责 push 与自动构建部署                                                         |
| 管理端专属头衔／扩展配置版本   | 待用户自行发布，本次未验证部署 | 用户负责 push 与自动构建部署                                                         |
| 专属头衔及扩展配置激活         | 未激活                         | `game_player_level_titles`、`game_extra_definitions`、`game_extra_configs` 均为 0 行 |
| 既有题目线索／关键词／分组功能 | 服务端能力保留                 | 本次不操作其配置，不据历史空表记录推断当前激活状态                                   |
| 生产业务写入验收               | 未执行                         | 未创建字段、下发头衔、答题或发奖                                                     |

后端可在空表状态兼容现有前端。完成两个前端发布后，再通过管理端配置新能力；业务下发不属于本次后端发布。使用说明见 [扩展配置指南](extra-config.md)。

## 最近核对的运行基线

- 容器：`questions-game-v1`，healthy，重启计数 0，连续三次真实健康探测通过。
- PocketBase：0.40.1，Linux AMD64，`--automigrate=false`。
- 实际镜像 ID：`sha256:108261dbc3f2d877b85706cded3023fb49cf62e72feabb8b3231214691b9c80e`。
- Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`；仓库模板 `backend/deploy/1panel/compose.production.yaml`。
- Compose SHA256：`6fdb0247f00f0aff045bce4f919419afdf08fee9943fcbfdb492148789072a1f`。
- 数据挂载：`/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`。
- 端口：仅 `127.0.0.1:8090:8090`；HTTPS 健康及认证边界为 200 / 401 / 401。
- 迁移账本 SHA256：`306cba996e23f57925aab42e3020b4a58d11291fb26af002d632bd68d5f44d8b`。
- 根 release.json SHA256：`72c7374cad24dc463de72524a3dc2511f712f0ce3658f258325160ced1929207`。
- releaseId：`extra-config-player-titles-20260908`，phase=`recorded`，revision 15，无未决阶段。

以上是验收快照，不能代替下次现场检查。实际状态不符时停止，不自行选择旧基线继续。

## 当前操作单

`backend/deploy/1panel/UPGRADE.md` 为本次已完成操作单，没有待执行的生产升级。不可变副本保留在服务器冻结发布包；下一次必须生成新的 source、target、迁移允许差异和 pending 操作单，不能复用这次 ready 计划。
