# 一次账号级旅途订阅（2026-11-19）

本轮将用户授权的订阅范围明确为「分配给我的新场次、剧情来信与关卡动态」。玩家在设置中订阅一次，再独立确认接收该范围的推送，之后无需逐场订阅。公告和运营推广保留 MARKETING。本文记录实现、隔离验证及本轮生产后端部署。2026-11-19 13:21:03 +08:00 已完成 `recorded`、revision 15；新增账号级 API 和两张私有空表已部署。正式发送总开关与分类权益仍关闭，未配置发送凭据，不能把接口上线当作通知送达。机械发布证据见 [本轮生产记录](harmony-push-account-subscription-deployment-20261119.md)。

## 契约与授权

- `GET /api/questions/v1/me/push/journey-subscription` 返回裸对象 `{scope:"personal_journey_v1",subscribed,pushEnabled,revision,subscriptionApproved}`。缺少记录时是 false / false / 0；最后一项只读，来自服务端权益配置。
- `PUT` 同一路径只接收 `{requestId,scope:"personal_journey_v1",subscribed,pushEnabled,expectedRevision}`。先保存 true / false，再经独立确认保存 true / true；取消为 false / false。尚未订阅时直接 true / true 返回 `409 PUSH_JOURNEY_SUBSCRIPTION_CONFIRMATION_REQUIRED`。通知开关不得独立为 true。
- 数据绑定当前已认证的游戏玩家；无需也不接受 playerId。账号停用或强制改密沿用既有认证失败。参数不合规为 `400 INVALID_INPUT`；版本变化为 `409 PUSH_JOURNEY_SUBSCRIPTION_CONFLICT`。错误沿用 `GameFailureEnvelope`。
- 首次显式 false / false 会建立版本 1 的拒绝记录。已有同状态可返回原版本。每次真实变更递增版本，requestId 去重与输入指纹沿用事务命令；重放回执是历史快照，客户端必须再 GET 获取当前事实。
- 两个新增私有集合为 `game_push_journey_subscriptions`、`game_push_journey_deliveries`，迁移默认均为空。旧逐场订阅记录保留审计，不转换为账号级同意。即使旧记录已开启，只要没有新范围的明确同意也不投递。
- 旧 `/me/push/subscriptions` 与 `/assignments/:id/push-subscription` 在通过必要认证和归属检查后返回 `409 PUSH_SUBSCRIPTION_SCOPE_CHANGED`，提示使用新版设置；不继续写入旧授权或把历史行伪装为当前授权。

## 事件与分类

| 事件 | 所需条件 | 分类与未获批行为 |
| --- | --- | --- |
| 新场次实际分配给本人 | 事件发生时账号级双开关均为 true，且发送范围、账号和有效绑定允许 | 获批并启用后 SUBSCRIPTION；未批不入队 |
| 本人场次剧情来信／关卡动态 | 同上，且后台明确选择 journey 与一个场次，产生本人的真实通知回执 | 获批并启用后 SUBSCRIPTION；未批不入队 |
| 公告／运营推广／旧运营台默认用途 | 原有发送范围、系统通知授权与设备绑定 | MARKETING，与旅途订阅独立 |
| 未订阅、仅订阅未确认通知、取消、旧逐场同意 | 不满足新范围授权 | 不投递，不降级成 MARKETING |

SUBSCRIPTION 仍要求华为在原应用批准相应权益，`STARWARD_PUSH_SUBSCRIPTION_APPROVED=1` 只是获批后的本地门禁。未批时保存订阅不会承诺送达或每日 20 条额度。剧情来信不冒充 MAIL / IM。原分类规则参考 [华为通知消息自分类](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-apply-right/)。

实际通知模板不暴露题面、答案、私人来信或奖励：订阅消息固定为「你订阅的旅途动态有新消息，打开应用查看。」；公告为「旅途有新消息，打开应用查看。」。点击仍通过现有业务路由回源，不以 Push 载荷作为业务事实。

取消或关闭通知在同一事务中丢弃该玩家尚未完成的旅途任务，包含旧逐场队列和旧账号订阅版本；重新订阅不恢复旧任务。发送前还检查当前授权、订阅版本、账号、绑定、场次或通知有效性；权益被关闭时，已排队的订阅消息也丢弃。已经交给华为的请求无法撤回。扩大后台名单、登记新设备或开启订阅均不补发历史事件。

## 验证与发布边界

最终后端验证命令：`PB_DOCKER_IMAGE=questions-pocketbase:starward-push-crypto-test PB_PUSH_VALIDATE_OPENSSL=1 node --test --test-concurrency=2 backend/tests/*.test.mjs`，134 / 134 通过，0 失败、0 跳过。包括真实隔离 PocketBase 0.40.1、合成账号的 OpenSSL PS256 实签及独立验签。

随后只补充测试断言，覆盖同时待发的新场次及来信在取消后丢弃，并删除旧迁移测试的失效辅助函数；运行时未变。相关两个测试文件定向复验 5 / 5 通过。独立复制源码后移除权益入队门禁，未批权益用例因多产生两条队列实际失败；共享源码没有为此改动。

本轮新增用例覆盖默认关闭、严格输入、两阶段确认、账号隔离、停用和强制改密、乐观版本冲突、重放回执后权威状态、重启持久化、旧同意不扩权、旧 API 409、一次同意覆盖后续场次及来信、取消后重订不复活、未批不入队和旧队列停发、公告仍 MARKETING、已读及场次下线停发。订阅不产生额外入场、答题、进度或已读写入。替身发送器调用实际消息构造器，不能作为真实华为送达证据。

迁移恢复副本演练核对全部旧集合定义及旧授权数据不变，只新增两个预期空私有集合；SQLite schema 与 [允许差异](../backend/deploy/1panel/allowed-delta.push-journey-subscription.json) 相符，再次启动保持为空。旧迁移文件和历史发布允许差异未修改。

运营台 48 / 48 测试通过、Vite 生产构建成功，生成契约校验和 `git diff --check` 通过。构建存在既有大 chunk 提示。运营台四处说明随本次配套静态部署发布，实际 CI 与线上产物须另验，不能仅用本地构建替代。

直板机使用独立 HTTPS 隔离库、自然合成场次和来信完成 9 组验证，包括双阶段确认、取消、幂等回执回源、503 重试、退出及无额外玩法写入；原生本地 257 / 257 测试通过。六张申请素材来自这组真实原生页面。发送器为合成提供方、权益关闭，未使用生产数据或正式发送凭据。独立环境已退出、解绑并清理。

华为原应用已撤回旧逐场申请，按新账号范围附六张页面重新提交，状态为订阅分类审核中。后台与原生实现不代表权益获批，也不承诺未批准的日额度。当前正式容器的 `STARWARD_PUSH_*` 环境变量为空，仅挂载原数据目录；发送总开关、分类权益及实际云端收发仍待独立启用和验收。
