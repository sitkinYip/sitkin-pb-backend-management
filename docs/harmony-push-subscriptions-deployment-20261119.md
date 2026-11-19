# 2026-11-19 场次订阅与 Push 分类后端发布记录

PocketBase 后端发布已完成：`1795075200_push_subscriptions.js` 和对应 hooks 已在生产进入 `recorded`。本轮三个新增集合到最终验收均为空，Push 总开关及订阅分类权益开关实际关闭。本文不表示管理端或邀请包已经分发，也不表示真实通知已送达；后续状态统一见 [当前生产状态](current-production.md)。

## 冻结版本与只读证据

| 项目 | 已核验结果 |
| --- | --- |
| 发布状态 | `push-subscriptions-20261119`，`recorded`，revision 15，无进行中操作、未决标记或阻塞 |
| 完成时间 | 2026-11-19 11:36:51 +08:00；紧随其后的运行复核为 2026-11-19 11:37:25 +08:00 |
| 源镜像 | `questions-pocketbase:0.40.1-harmony-push-20261118-amd64` |
| 目标镜像 | `questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64`；PocketBase 0.40.1 / Linux AMD64 |
| 生产实际 image/config ID | `sha256:3cd3693dc9045afbb7293a9fd66bb9538ef8349ba34dd3bb4b4a868daa2736f1` |
| 冻结发布包 SHA256 | `7b35cfba68d985f628239de254af7cf5d61fd27355cfdf454006d33a914b5b57` |
| 冻结源码清单 SHA256 | `dfc6c08644dad1305598ac5d03d8bc18c33a9efd85b18acf7f0a49d0185544d4` |
| Compose SHA256 | `564f5c9234a94f4a8eb162b1a8543ca4c694b9270630066fe0e584d60590e3ec` |
| 迁移账本 SHA256 | `fc529327b8f0b7ce5969f0e285b66c0f58cd7b2ff17d7a5e33b4f0eb74b10266` |
| 根 `release.json` SHA256 | `9005ab1c43d459eb81ad8b7118a940535577528cf0edf41a44686fcedb02fdce` |
| 根校验清单 SHA256 | `e4555a4285854f0e47fcd255411cbe6d6c0f3c76557b35f5141694dfa36c0d0b` |
| 最终报告 SHA256 | `1681bb3f9d3fedc68b8274235ed2f995048d177ee3eb79c4283ac0d66415f762` |

发布来自已审工作区，包内冻结 29 个源码输入；Git HEAD 单独不能重建本镜像。官方 PocketBase runtime 摘要、镜像内文件、运行参数、内外两层归档清单均由原发布工具核验。Docker Desktop 本机单平台 manifest ID 与生产 Docker 的 config ID 表示不同身份层级；出包已核对导出配置原始字节摘要、RootFS diff IDs、平台和标签稳定性，不放宽任何身份校验。

## 停服备份、恢复演练与正式迁移

- 维护从 2026-11-19 11:05:48 +08:00 开始，完整停服备份为 5,147,652 字节、27 个归档条目；SHA256 `350d86f11b04ae245e9877d2f3313449d80ebccd0b679c06589cfd2f900378f2`，文件清单 SHA256 `2fa0d7819a9384f86825e609ecf34c845f32e6fffc645185fc6f3dcb5e0ff934`。独立解压后逐文件和 SQLite 基线验证通过。
- 2026-11-19 11:05:58 +08:00 完成恢复副本验证：只在副本运行新增迁移，随后用固定目标镜像启动两次，两次数据库摘要相同。仅新增 1 条迁移、3 个集合、3 张表和 11 个 schema 对象；旧结构、集合定义、业务数据及历史账本通过允许差异检查。备份验证报告 SHA256 `89820190babba314cacd116d56860a97ff940ab3a69acc0a52603e5e4bb3826d`。
- 正式迁移于 2026-11-19 11:09:06 +08:00 完成。`1795075200_push_subscriptions.js` 恰好入账一次，`game_push_subscriptions`、`game_push_notice_contexts`、`game_push_notice_deliveries` 均为私有且 0 行。正式验证报告 SHA256 `52042184fc36e27083cc633d2cbb4ada4fd66f14a0f603f120fc99688861b8cd`。
- 2026-11-19 11:10:17 +08:00 完成镜像切换验证，距停服开始约 4 分 29 秒。Compose 只换镜像，数据挂载、回环 8090、运行时版本、安全配置和 `--automigrate=false` 保留。阶段之间仍由操作者独立输入各自 TTY 短语；没有自动跨闸门。

## 切换与最终只读验收

切换证据来自同一 container ID，重启计数 0，Docker `Health.Log` 至少三条不同且连续成功的健康探测。2026-11-19 11:37:25 +08:00 再次只读复核，容器身份与切换证据一致；最近三次健康探测开始于 11:36:52、11:37:07、11:37:22（+08:00），均退出 0。不是重复读取同一个 healthy 值。

HTTPS `/api/health` 返回 200，未认证的 `/api/questions/v1/admin/me`、`/api/questions/v1/assignments`、`/api/questions/v1/admin/push-settings` 均返回 401。最终结构摘要 `5bb865af5ff2304f582df5fe47041824869de0ee1e1b5bee1c913af50e7e35ef`：16 条迁移账本记录、39 个集合、44 张表；三个新表到最终记录仍为空。服务恢复后，验证允许既有业务表随真实请求更新，不以全库行摘要相等作为恢复快照的依据。

最终报告、根版本材料及其校验清单已经只读取得并按状态中的摘要核验；冻结 status 还复核了根材料和 finalize intent/commit。UPGRADE 及发布包内容保留原样，不用完成后的仓库模板反写旧制品。

## 激活边界与后续工作

2026-11-19 11:37:25 +08:00 实查容器没有 `STARWARD_PUSH_*` 环境变量，只有 `/pb/pb_data` 一个挂载；Push master 实际为 off，`SUBSCRIPTION` approval 实际为 off。本轮没有配置发送凭据、扩大运营范围、写入新订阅、绑定验收设备、发送真实通知或执行生产业务写入验收。

分类和取消语义的隔离真实 PocketBase 测试已单独完成，不能代替生产通知验收。新管理端需独立上线；邀请包、系统授权、明确订阅与独立通知确认、取消后的旧队列处理、正式凭据和华为分类权益均按各自闸门验证。新场次下发与公告仍使用 `MARKETING`；`SUBSCRIPTION` 只有实际权益获准且配置明确启用后才能使用。

生产恢复流量后，旧备份不能覆盖当前库。优先前向修复；需回退应用时另行审查，保留加性结构与业务数据，并先处理发送开关及取消订阅语义。不要执行 migration down 或删除账本。本次没有清理旧镜像、恢复依据或其它服务。
