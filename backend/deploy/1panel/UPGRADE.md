# 主界面聚合与批量已读后端升级操作单

<!-- release-status: completed -->
<!-- release-id: home-unread-20261126 -->
<!-- source-image: questions-pocketbase:0.40.1-push-titles-20261120-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-home-unread-20261126-amd64 -->

本轮于 2026-11-26 17:21:52 +08:00 进入 `recorded` revision 14。操作单保留本次源、目标与验收范围。待执行原文已随冻结包归档，下一次发布使用独立盘点与新操作单。 [本次发布记录](../../../docs/home-unread-deployment-20261126.md)

## 本轮范围

- `GET /api/questions/v1/home` 使用当前玩家身份读取场次、奖品和来信，三份投影与各自原有列表一致。新客户端在主界面使用聚合读取，旧客户端继续走原有入口。旧后端缺少聚合路由时，新客户端回退到原有列表接口。
- `POST /api/questions/v1/notifications/read-all` 每批接受最多 200 个来信 ID。只更新该账号当前可见的回执，重复提交返回原已读时间。之后到达、其他账号、撤回和过期来信均不在该批更新范围内。单封回执端点继续供旧客户端及回退使用。
- 本轮仅发布 PocketBase 后端镜像。PocketBase 0.40.1，Linux AMD64，`--automigrate=false`。既有生产 `harmony-push-production-v2`、只读密钥挂载、接收范围和运行参数随当前源 Compose 核对。客户端和运营台可分别发布。

## 无迁移验证

`migration.mode=none`，四个允许差异数组均为空。停写备份、恢复演练和 `NO_MIGRATION` 校验以同一份生产基线为准。检查迁移账本、集合、schema 和脱敏表摘要。候选 Compose 由源 Compose 仅替换镜像指针，工作区生产模板在本轮 recorded 后更新。

## 发布和验收

1. 按发布程序复用用户已打开的 ControlMaster 执行 `inventory`，核对容器、运行镜像摘要、挂载、源 Compose、根发布材料、迁移账本与空间。以一致的现场基线冻结发布包，核对包与 sidecar 校验和。
2. 用同批包和 runner 完成只读 `preflight`。获批后依次核验并执行 `STAGE`、`BACKUP`、`NO_MIGRATION`、`SWITCH` 和 `FINALIZE`。从 BACKUP 到 SWITCH 成功期间保持维护状态。逐阶段核对 `status`，确认当前操作结束且无未决标记。
3. 核对目标镜像摘要、hooks、原 Compose 运行约束与稳定健康。验证 HTTPS health 返回 200，原认证探针与 `GET /api/questions/v1/home` 的匿名请求返回 401。匿名探针只证明认证边界。聚合投影、批量回执、旧接口兼容和账号隔离以隔离 PocketBase 用例核验。
4. 发布后保存日期记录并更新生产指针与模板。生产来信已读属于账号业务写入，真实账号验收需对应授权。

中断先查询 `status`。结果未知时按失败闭锁流程处置。真实流量恢复后若需回退，核对当前镜像、运行契约与最新数据，优先回退应用镜像并保留已生效的回执。
