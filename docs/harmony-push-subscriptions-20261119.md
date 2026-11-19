# 场次订阅及推送分类（2026-11-19）

> 历史实现记录：同日后续用户确认改为一次账号级「旅途动态」订阅。以下逐场契约和未批权益时的 MARKETING 回退只描述旧切片；当前实现见 [账号级旅途订阅](harmony-push-account-subscription-20261119.md)。旧逐场同意不会转换为更大范围授权，旧 API 在新实现中返回 409。本文既有验证结果不改写。

用户已授权原生端按具体场次订阅剧情来信及关卡消息，公告和运营推送继续 MARKETING。本文记录实现边界及待验项；代码或构建完成不代表权益已批准、生产已部署或设备已收到。

## 官方依据

[华为通知消息自分类](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-apply-right/)于本轮复核：SUBSCRIPTION 需要具体订阅、对应取消入口、默认关闭的订阅消息推送、订阅后独立确认推送、消息体现订阅关系。系统通知授权不能代替订阅。未获权益的分类会归为资讯营销，服务类也有设备频控。剧情来信不作为邮件 MAIL 或真人通讯 IM。

## 契约和兼容

- `GET /api/questions/v1/assignments/:id/push-subscription` 返回 `{assignmentId,subscribed,pushEnabled,revision}`。无记录时默认 false / false / 0。只能读取自己的场次。
- `PUT` 同一路径严格接收 `{requestId,subscribed,pushEnabled,expectedRevision}`。`pushEnabled` 为 true 必须同时 subscribed。首次订阅先保存 true / false，再由独立弹窗确认 true / true；取消 false / false。版本冲突 `PUSH_SUBSCRIPTION_CONFLICT` / HTTP 409，其他认证、场次、参数错误沿用现有业务错误。重复同一 requestId 不会二次写入；回执是原操作快照，之后应回源。
- 未订阅直接提交 true / true 返回 `PUSH_SUBSCRIPTION_CONFIRMATION_REQUIRED` / HTTP 409。取消和关闭通知不受场次下线、撤回或过期阻挡；新订阅或开启通知要求场次仍发布、本人场次未撤回且未过结束时间。开始前可预约订阅。
- `GET /api/questions/v1/me/push/subscriptions` 返回 `{items:[{assignmentId,title,subscribed,pushEnabled,revision}],subscriptionApproved}`。仅列当前账号实际存在的订阅记录，含已取消项以便管理。
- 管理端 `/admin/push-settings` 额外返回只读 `subscriptionApproved`，由 `STARWARD_PUSH_SUBSCRIPTION_APPROVED=1` 控制，默认 false。仅在原应用实际获批后配置，不通过发送未批分类碰运气。
- 管理端发送通知新增可选 `messagePurpose: 'journey' | 'announcement'`，缺省 announcement 兼容旧运营台。journey 必须 `target: 'session'` 并提供具体 sessionId；收件回执关联该玩家的对应场次。公告仍可使用原接收范围。
- 本轮不改玩家 Web 业务 UI；生成的契约类型随权威源同步。

## 分类与投递

| 事件 | 订阅要求 | 实际分类 |
| --- | --- | --- |
| 新下发场次 | 事件发生时尚无该场次订阅 | MARKETING |
| 某场次剧情来信／关卡消息 | 本人已订阅且独立开启该订阅通知 | 权益获批为 SUBSCRIPTION；未批为 MARKETING，仍受资讯营销配额 |
| 某场次消息但未订阅／取消通知 | 不满足 | 不入队，不降级发送 |
| 公告／运营推广／旧运营台未标用途消息 | 原有应用推送授权与发送范围 | MARKETING |

订阅推送正文使用不含私人题目、答案、奖励的固定文案，明确写出“订阅”。客户端点击仍按现有 Push 业务路由回源。订阅不是入场、答题或已读写入。

消息用途、订阅版本和入队分类冻结在私有集合。发送前再核对订阅、账号、通知未读／有效性、场次有效性和权益门禁；取消后已排队事件不发送，取消再订阅也不恢复旧队列。已交给华为的消息无法撤回。旧记录和旧客户端不被自动订阅。

## 逐状态验收计划

- 已验（隔离真实 PocketBase）：默认关闭、只订阅不通知、独立开启、取消、相同 requestId 重放及不同载荷冲突、乐观版本冲突。
- 已验：越权账号、强制改密、停用账号、撤回／下线／过期场次；下线项仍可管理，撤回后仍可关闭通知及取消。
- 已验：订阅有效+权益未批 MARKETING；已批 SUBSCRIPTION；无订阅／关闭通知不入队；公告和新下发不误分类。使用替身发送器读取实际生产消息构造器输出，不代表华为已批准或真机已收到。
- 已验：入队后取消、取消后重订不复活、已读／撤回不发送；权益门关闭时已排队 SUBSCRIPTION 丢弃。通知过期仍由既有发送前检查处理，本轮未做新专项。
- 已验：恢复副本迁移和再次启动只增加 3 个预期空私有集合，全部旧集合定义不变，真实 SQLite schema 与 [发布允许差异](../backend/deploy/1panel/allowed-delta.push-subscriptions.json) 完全一致。

最终完整后端验证：`PB_DOCKER_IMAGE=questions-pocketbase:starward-push-crypto-test PB_PUSH_VALIDATE_OPENSSL=1 node --test --test-concurrency=2 backend/tests/*.test.mjs`，退出 0，133 / 133 通过，0 失败、0 跳过；包含真实 OpenSSL PS256 合成服务账号签名和独立验签。[摘要及源码哈希](../artifacts/validation/push-subscriptions-20261119/backend-summary.json)。首轮因历史迁移用例枚举需增加本轮私有空表、关闭通知边界的旧断言待更新而失败；修正后完整重跑通过。

本后端切片未执行：运营台 UI 构建／浏览器、直板机新订阅操作、真实华为新分类投递、生产迁移和开关配置、权益申请及邀请包分发。这些由当前总任务分别记录，不以本轮测试替代。
