# 当前生产状态

最后同步：2026-11-19 11:37:25 +08:00。依据 [场次订阅与 Push 分类后端发布记录](harmony-push-subscriptions-deployment-20261119.md)。发布状态为 `recorded`，revision 15，无未决操作或阻塞。日期记录保存当时事实；下次操作仍须只读复核现场。

## 当前组件状态

| 组件或闸门 | 状态 | 说明 |
| --- | --- | --- |
| PocketBase 数据库迁移 | 已部署 | `1795075200_push_subscriptions.js` 恰好入账一次；本轮新增三个私有集合在迁移、切换和最终验收均为空 |
| PocketBase hooks / API | 已部署 | `questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64`；保留原业务接口，增加场次订阅、独立通知确认与取消语义 |
| 运营后台新消息用途和订阅权益显示 | 本轮未验生产上线 | 后端镜像不部署管理端静态资源，仍需单独发布并验证 |
| 原生邀请包的新订阅交互 | 本轮后端验收未覆盖 | 构建、签名、分发、直板机交互和真实收发分别记录，不能用后端健康替代 |
| 正式 Push 总开关与发送凭据 | 总开关实际关闭；本轮未配置凭据 | 运行容器无 `STARWARD_PUSH_*` 环境变量，仅有数据目录挂载；本次迁移不激活发送 |
| `SUBSCRIPTION` 分类权益开关 | 实际关闭 | `STARWARD_PUSH_SUBSCRIPTION_APPROVED` 未设置；华为权益申请、配置启用和真实分类投递分别确认 |
| 生产订阅写入及真实通知验收 | 本轮未执行 | 三个新表保持为空，不把隔离替身发送器或未认证 401 当作生产业务通过 |
| 既有业务 | 保留 | 加性迁移和旧客户端兼容；迁移停服期间未许可的既有数据和历史账本保持不变 |

2026-11-18 的基础 Push 结构及其当时验收见 [上轮发布记录](harmony-push-deployment-20261118.md)。此前专属头衔与扩展配置的历史状态见 [2026-09-08 记录](extra-config-player-titles-deployment-20260908.md)。

## 最近核对的运行基线

- releaseId：`push-subscriptions-20261119`；`recorded` 于 2026-11-19 11:36:51 +08:00，revision 15；无 `inFlight`、active marker 或阻塞。
- 生产镜像：`questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64`，实际 image/config ID `sha256:3cd3693dc9045afbb7293a9fd66bb9538ef8349ba34dd3bb4b4a868daa2736f1`。
- PocketBase 0.40.1 / Linux AMD64；`--automigrate=false`；唯一容器 `questions-game-v1`。
- Compose SHA256：`564f5c9234a94f4a8eb162b1a8543ca4c694b9270630066fe0e584d60590e3ec`。仓库模板 `backend/deploy/1panel/compose.production.yaml` 同步此镜像指针；线上只替换镜像，仍为单个 `/pb/pb_data` 挂载、回环 `127.0.0.1:8090`。
- 切换时同一容器产生三条不同且连续成功的 Docker 健康检查，重启为 0。2026-11-19 11:37:25 +08:00 的只读复核仍为同一容器、healthy、零重启，最近三次独立探测均成功。
- HTTPS 健康 200；未认证 `/api/questions/v1/admin/me`、`/api/questions/v1/assignments`、`/api/questions/v1/admin/push-settings` 均为 401。
- 迁移账本 SHA256：`fc529327b8f0b7ce5969f0e285b66c0f58cd7b2ff17d7a5e33b4f0eb74b10266`。16 条账本记录、39 个集合、44 张表；本轮仅新增一个迁移和三个私有空表。
- 根 `release.json` SHA256：`9005ab1c43d459eb81ad8b7118a940535577528cf0edf41a44686fcedb02fdce`；根校验清单 SHA256：`e4555a4285854f0e47fcd255411cbe6d6c0f3c76557b35f5141694dfa36c0d0b`。
- 最终报告 SHA256：`1681bb3f9d3fedc68b8274235ed2f995048d177ee3eb79c4283ac0d66415f762`。发布包及其源码清单为复现依据，不能只依赖未包含本轮工作区的 Git HEAD。

以上是本次发布及紧随其后的只读快照。生产恢复后不能用停服备份覆盖新业务数据。正式凭据、总开关或分类权益的后续启用属于独立运行配置变更，需新记录，不能复用本次包自动激活。

## 当前操作单

`backend/deploy/1panel/UPGRADE.md` 和包内 `README.md` 保留本轮冻结输入原文及其 pending 标记，便于逐字复核；实际完成状态以本次 `recorded` 证据和日期记录为准。该操作单不得再次执行。下次发布必须重新盘点、完整替换待执行操作单并冻结新计划；不得据模板或旧记录重建生产库。
