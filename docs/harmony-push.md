# 赴星之约 HarmonyOS Push Kit

2026-11-18，两个 PocketBase 迁移和 Push 路由已 [部署生产](harmony-push-deployment-20261118.md)。在本次发布验收时，三个新集合均为空，总开关关闭。运营后台上线、正式凭据配置以及邀请包实际收发需单独确认，见 [当前生产状态](current-production.md)。

正式应用是 `com.sitkin.starward`。在现有 AppGallery Connect 项目中启用 Push Kit，核对应用归属、分发签名和 Push 服务，再创建只为推送使用的服务账号密钥。发送 URL 使用该项目的 **Project ID**，不能填写应用的 APP ID。服务端使用 HarmonyOS NEXT V3 REST API 的 PS256 JWT 鉴权。应用只上报 Push Token、随机安装标识和已通过 Push Kit 绑定的随机 profile 标识，无需获取硬件标识。

## 事件与接口

| POST 路径（前缀 `/api/questions/v1`） | JSON 请求 | 响应 |
| --- | --- | --- |
| `/me/push/register` | `{installationId, token, profileId}` | `{registered:true, revokeTicket}`；总开关关闭或玩家不在当前发送范围时返回 `{registered:false}` |
| `/me/push/unregister` | `{installationId}` | `{registered:false}`，仅删除当前登录玩家的该安装 |
| `/push/revoke` | `{installationId, revokeTicket}` | `{registered:false}`，无需会话，仅能删除与该凭据匹配的注册 |

注册使用游戏玩家原有 `Authorization: token`，强制改密和停用账号不得注册。安装标识和 profile 标识由客户端独立随机生成，允许 16–80 / 16–64 个 ASCII 字母、数字、短横线或下划线。注册凭据和 Token 不进入日志，均存于 PocketBase 私有集合。相同账号、安装和 profile 的 Token 更新保留解绑凭据；切换账号或 profile 会创建新凭据。断网退出可在联网后用原凭据补解绑。绑定自最近一次通过验证起保存 30 天，退出、切换或停用后不再作为发送目标。收到提示仍需使用现有权限检查和回源接口。

首批事件来自正式下发的**新场次**和已写入收件箱的**旅途来信／公告**。发布题目、没有产生新下发的重复请求、读取、答题及奖品操作不会触发。业务写入和队列进入同一事务，已有请求去重回执先于入队检查。后台每分钟批量取队列，临发送重新检查账号、绑定、场次或未读回执。只重试超时等可恢复错误，最多三次，复用同一个 `appMessageId`。华为明确指出当前 Token 格式无效时才删除该绑定，项目权限类错误不会删绑定。手机通知使用通用文案，包含必要的点击路由和匿名 profile，无题目、身份、答案、来信正文或奖品内容。离线最多缓存至事件发生后 10 分钟。云端接受只表示接受请求；实际送达尚需专用直板机验证。

## 正式消息的发送范围

从运营后台左侧进入「鸿蒙推送」（`/push-settings`），可在「仅白名单」和「全部开放」之间切换。按昵称或账号检索并选择玩家，填写修改理由，点击「保存推送范围」；首次切到全部开放时需确认。保存后由后端读取生效，无需重启容器或更新手机应用。两种模式都以新业务事件为触发条件，并检查账号资格与有效的设备绑定；开启或扩大范围不会补发历史场次、来信或公告。

| 配置 | 正式模式行为 |
| --- | --- |
| 仅白名单（默认，初始为空） | 仅名单内的游戏玩家可登记设备、产生推送队列并接收通知；空名单不推送 |
| 全部开放 | 符合业务条件且有有效设备绑定的游戏玩家均可接收；玩家仍须在 App 授权系统通知。保留已保存的白名单，便于切回 |

缩小范围时，名单外未开始发送的任务丢弃，发送前仍检查最新配置。已开始提交或已被华为接受的消息无法撤回。AppGallery 邀请名单只限制应用分发，白名单使用的是游戏玩家账号。两种模式都服从 `STARWARD_PUSH_ENABLED`，开发测试消息范围仍由 `STARWARD_PUSH_TEST_PLAYER_ID` 决定。

扩大范围后，尚未绑定或绑定已失效的玩家需要再次打开应用并允许系统通知，客户端才会重新登记设备。已有有效绑定的玩家不用重新授权；新登记也不会触发补发。

仅启用的 `game_admins` 可通过 `GET /api/questions/v1/admin/push-settings` 读取，或 `PATCH` 保存。请求体为 `{requestId, audience, playerIds, expectedRevision, reason}`；`audience` 取 `allowlist` 或 `all`，`playerIds` 是已存在的 PocketBase 玩家 ID，最多 1000 个，`reason` 去除首尾空格后须为 1–200 字符。成功返回 `{audience, playerIds, revision, serverEnabled, testMode, subscriptionApproved}`；最后一项是只读的订阅分类权益配置状态，不接受客户端写入。版本变化时返回 `409 PUSH_SETTINGS_CONFLICT`，重新读取后再编辑。空配置默认版本为 0。配置持久保存在私有集合 `game_push_settings`，操作原因进入审计，配置差异只记录模式、人数和版本，不记名单 ID、设备 Token 或服务凭据。

## 隔离启用与发布

1. 同步核对实际 1Panel 生产基线，为 `1794988800_harmony_push.js` 和 `1794988860_push_audience.js` 新建专用发布计划，核对 [Push 允许差异](../backend/deploy/1panel/allowed-delta.harmony-push.json)，按 [PocketBase 发布流程](pocketbase-release-program.md) 在备份副本先演练。新版本的镜像为基线 Alpine 增加 OpenSSL CLI，沿用 PocketBase 0.40.1 及原有数据目录。初次生产部署以 `STARWARD_PUSH_ENABLED=0` 启动，现有场次、来信和登录不会经 Push 发送通知。
2. 在隔离部署的 PocketBase 容器只读挂载专用 AGC 服务账号 JSON，通过 `STARWARD_PUSH_SERVICE_ACCOUNT_FILE` 指向容器内文件，只允许服务进程读取。另设 `STARWARD_PUSH_PROJECT_ID` 为该账号所属的 Project ID，`STARWARD_PUSH_ENABLED=1`，`STARWARD_PUSH_TEST_MODE=1`，`STARWARD_PUSH_TEST_PLAYER_ID` 为专用验收玩家记录 ID。测试开关默认为开启且必须指定精确玩家，只有该账号可以注册和收发。该模式使用官方 `testMessage:true`。手工验证真实测试时仅使用专用玩家及其安装，服务账号 JSON 和本机签名材料不要进入仓库、日志或发布压缩包。
3. 隔离环境使用专用玩家验收授权允许、拒绝和关闭，以及前台、后台和冷启点击回源。正式范围可另以隔离库和替身发送器验证：空白名单、新增名单、全部开放、不补发、收窄后跳过未发送的范围外任务，以及总开关关闭时仍可编辑范围。开启真实正式发送前，核对应用隐私说明、平台权益和生产基线，把「仅白名单」保存为首轮专用游戏账号；在授权窗口设置 `STARWARD_PUSH_TEST_MODE=0` 并启用总开关。用邀请渠道安装的发布签名包验证通知送达、点击和退出后停发，然后再决定是否在运营后台选择「全部开放」。新场次下发及公告使用 `MARKETING`，可能静默且有每机日频控。场次剧情来信和关卡消息仅对明确订阅且独立开启通知的玩家投递，权益未批仍为 `MARKETING`；原应用实际获批后另设 `STARWARD_PUSH_SUBSCRIPTION_APPROVED=1` 才发送 `SUBSCRIPTION`，不得用此配置替代权益申请。具体契约、取消语义与逐状态证据见 [2026-11-19 场次订阅](harmony-push-subscriptions-20261119.md)。回退时先设 `STARWARD_PUSH_ENABLED=0`，保留新增私有表及既有业务数据。

现有 1Panel 发布脚本只更新 Compose 镜像，并校验运行时只有数据目录挂载。关闭 Push 的代码和迁移可以按原流程演练；真实发送前须单独验证、审查带只读密钥挂载及环境开关的生产配置和回退流程。运营后台的发送范围设置不能替代这一步，也不应把密钥放进数据库备份目录。

本地业务验证在隔离 PocketBase 0.40.1 中使用替身发送器，不调用 Push Cloud。运行 `PB_DOCKER_IMAGE=<PocketBase 验证镜像> node --test backend/tests/harmony-push.integration.test.mjs`。带 OpenSSL 的镜像可加 `PB_PUSH_VALIDATE_OPENSSL=1`，实签合成服务账号 JWT，并独立校验其 PS256 签名。

[华为接入流程](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-gettingstart) · [服务账号 JWT](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-jwt-token) · [通知消息](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-send-alert) · [REST 参数](https://developer.huawei.com/consumer/cn/doc/harmonyos-references/push-scenariozed-api-request-param/)
