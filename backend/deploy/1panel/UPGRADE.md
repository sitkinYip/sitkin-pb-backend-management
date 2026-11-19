# 一次账号级旅途订阅后端升级操作单

<!-- release-status: pending -->
<!-- release-id: push-account-subscription-20261119 -->
<!-- source-image: questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64 -->

**待执行。** 本单只适用于本次冻结制品。上一轮逐场订阅操作单保留在 `push-subscriptions-20261119` 不可变发布包中，其生产 recorded 事实不改写。本次不升级 PocketBase、不替换或读取正式 Push 密钥、不启用发送或分类权益、不改运营名单，不发布前端或客户端。

## 目标和已核对基线

唯一生产目标是 `questions-game-v1`，目录 `/opt/1panel/apps/questions-game-v1`。沿用 PocketBase 0.40.1、Linux AMD64、`--automigrate=false`、原 `pb_data` 和回环 `127.0.0.1:8090`。2026-11-19 本次专用 SSH ControlMaster 只读 inventory 已核对：

- source 镜像 `questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64`，实际 image/config ID `sha256:3cd3693dc9045afbb7293a9fd66bb9538ef8349ba34dd3bb4b4a868daa2736f1`。
- Compose SHA256 `564f5c9234a94f4a8eb162b1a8543ca4c694b9270630066fe0e584d60590e3ec`。
- 根 `release.json` SHA256 `9005ab1c43d459eb81ad8b7118a940535577528cf0edf41a44686fcedb02fdce`。
- 迁移账本 SHA256 `fc529327b8f0b7ce5969f0e285b66c0f58cd7b2ff17d7a5e33b4f0eb74b10266`，包括八个既有业务 JS 迁移，最后为 `1795075200_push_subscriptions.js`。
- 容器正在运行且 healthy；本轮未变更生产。inventory 不是锁，后续各阶段仍须重新核对相同基线。

同批 pending 计划记录实际服务器身份、路径和 source 摘要。镜像来自已审但尚未提交的工作区，复现依据为包内不可变源码清单、镜像及逐文件 SHA256；不能声称当前 Git HEAD 单独包含本次实现。

## 功能边界和休眠状态

新增账号级固定范围 `personal_journey_v1`：「分配给我的新场次、剧情来信与关卡动态」。无记录时默认未订阅和未接收通知；订阅后须另行确认通知。旧逐场同意不转换为更大范围，新 API 才是当前授权来源。取消同一事务淘汰待发旅途任务，重新订阅不恢复旧任务。

**本次保持正式发送关闭。** 生产只读运行核查必须证明容器无 `STARWARD_PUSH_*` 环境变量、仅有原数据挂载，且新增账号级集合尚不存在。若出现凭据挂载、Compose override、环境注入或其它漂移，先停止并补充可审查流程；不得忽略配置或放宽 runner 的唯一挂载约束。此单及执行器不读取密钥、不增加环境变量或密钥挂载。

`STARWARD_PUSH_SUBSCRIPTION_APPROVED` 默认关闭。只有原应用实际获华为新范围权益后，才能另行启用该开关。获批前，个人旅途消息不入队、不降级为 MARKETING；公告/推广保留 MARKETING，但仍服从总开关。订阅记录可保存，不能因此承诺实际送达或每日额度。此次迁移及切换不执行生产业务订阅写入，不使新表提前激活。

## 兼容和顺序

| 组合 | 行为与发布要求 |
| --- | --- |
| 旧玩家端＋新后端 | 登录、场次、答题、来信、绑定保留。旧逐场订阅读写返回明确 409 要求升级；保留旧行审计但不继续扩权或发送。不是静默兼容旧订阅功能。 |
| 新玩家端＋旧后端 | 新账号 API 不存在，设置必须反馈读取失败，不能伪造关闭或已订阅。先完成后端 recorded，再验证并分发 0.1.3 邀请候选。 |
| 旧管理端＋新后端 | 原管理 API 和默认公告语义不变；通知用途仍由真实场次关联决定。无新管理员权限或名单扩大。 |
| 新管理端＋旧后端 | 新文案无法改变旧发送政策；本轮保持 sender off，后台文本更新在新后端 recorded 后单独部署。 |
| 新管理端＋新后端＋新玩家端 | 一次账号订阅、独立通知确认、版本与 requestId 去重；权益未启用则业务提醒停发。 |

代码与隔离证据：17 个已审路径逐字节吻合测试摘要；原生 257 项、后端 Docker 134 项和后续定向 5 项通过，运营台 48 项及构建通过；直板机 9 组隔离真实 HTTPS 检查通过。provider 为合成实现，不是华为实际投递。后台、玩家包、生产订阅写入和正式 Push 激活各自记录，不由镜像健康替代。

## 唯一允许迁移差异

只新增 `1795075260_push_journey_subscription.js`，使用已审 `additive-empty-collections-v1`。同批 `allowed-delta.json` 来源为 `allowed-delta.push-journey-subscription.json`：

- 两个规则均私有的空集合：`game_push_journey_subscriptions`、`game_push_journey_deliveries`。
- 两张表、两个主键自动索引，以及三个明确命名的索引：`idx_game_push_journey_subscriptions_player_scope`、`idx_game_push_journey_deliveries_delivery`、`idx_game_push_journey_deliveries_subscription`。
- 两个新表在迁移、切换和最终 recorded 时必须为空。旧逐场同意、通知、投递和业务数据不得回填、改写或删除。

全部历史迁移文件和每条账本记录保持不变。停服期间未许可的旧 schema、集合定义、表及数据摘要变化均闭锁；恢复健康后的真实业务写入不能用旧备份覆盖，新表仍须保持休眠为空。

## 冻结、上传和逐阶段批准

1. 在本机生成 Linux AMD64 目标镜像，核对固定官方 runtime 摘要、镜像内 hooks/migrations、不可变 manifest 与 archive config digest。用本次 source inventory、pending 计划、本单和允许差异执行 `package-1panel.mjs --upgrade`，生成冻结 ready 计划、归档和全部 sidecar；核对两层 SHA256。
2. 只读 preflight 必须通过。随后独立 `stage` 在现场 TTY 核对并输入完整 `STAGE` 短语，上传、导入并运行隔离候选验证；不停止或修改生产。
3. 确认维护窗口后独立 `deploy`，现场批准 `BACKUP`。从这里起停止唯一生产服务，完整备份并验证文件、SQLite、恢复副本迁移和连续两次启动；生产保持停止直至后续 switch 成功，维护时间包括各次人工闸门间隔。
4. 只读 status 证明前一阶段成功且无未决标记后，独立现场批准 `MIGRATE`，只迁移一次。复核结果后再独立现场批准 `SWITCH`，只改 Compose 镜像，先查停止态容器运行契约，再启动；同一容器、零重启、至少三条独立连续成功健康探针后才算恢复。
5. 独立现场批准 `FINALIZE`，核对新表为空、旧账本/结构不变和新迁移恰好一次，再写根版本材料。只读 status 必须为 recorded，无 inFlight 或未决 marker。
6. HTTPS 健康探针预期 200；未登录 `/admin/me`、`/assignments`、`/admin/push-settings`、`/me/push/journey-subscription` 均预期 401（统一前缀 `/api/questions/v1`）。这些只证明入口及认证边界，不能记为真实订阅写入或华为送达。

上述各阶段人工 TTY 要求来自 `docs/pocketbase-release-program.md` 第 3、4 节；执行器无 --yes/--force，不代输、不跳步、不自动跨闸门。此待执行单及本地出包不构成 stage、停服、迁移或激活已完成。

## 失败和收尾

断线、未知结果、备份摘要变化或任何差异先只读 status，不盲目重跑、不改 runner 闸门、不 migration down、不删表/账本/marker。保存当前状态和经验证备份，优先前向修复。新账号订阅产生后回退旧代码会改变授权语义，必须独立审查；有新业务流量后禁止用旧快照覆盖当前库。

recorded 后分别更新当前生产指针及日期记录，再进行后台静态发布、邀请包分发、专用玩家生产写入验收；正式凭据、sender、名单和权益激活不在本次机械发布中。保持旧发布归档和备份，不清理无关镜像或服务。结束后由负责人关闭专用连接。
