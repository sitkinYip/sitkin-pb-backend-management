# 当前生产状态

最后同步：2026-11-20 16:11:50 +08:00。同一应用的 SUBSCRIPTION 分类已在华为页面核实审核通过，独立配置激活完成 `enabled-verified`：只将 `STARWARD_PUSH_SUBSCRIPTION_APPROVED` 从 0 改为 1，保留镜像、数据库、挂载、正式发送、运营范围及账号同意。新容器同 ID、零重启、三条不同健康成功，HTTPS 200 与四项匿名 401 通过；策略、schema、迁移账本和旧根审计未改。16:10:50 仅向当前授权玩家新发一条无场次定向旅途消息，首次尝试 `accepted / 80000000`、分类 SUBSCRIPTION、正式模式；用户明确确认收到系统通知，点击回源未验。最终同一容器仍 healthy、零重启，无 active marker，维护连接已关闭。详见 [本次独立激活](harmony-push-subscription-activation-20261120.md)。后端代码仍为 11 月 19 日已 `recorded`（revision 15）的定向旅途版本，管理端静态产物也保持原版本，见 [原发布记录](harmony-push-personal-journey-deployment-20261119.md)。

| 组件或闸门 | 当前状态 | 已知边界 |
| --- | --- | --- |
| PocketBase hooks / API | `questions-pocketbase:0.40.1-push-personal-journey-20261119-amd64` 已上线 | 新增 `personal_journey`，只向指定玩家发送现有同意范围内的剧情来信和旅途动态，不要求关联场次；不是通用重要、账号安全或推广入口 |
| context 迁移 | `1795075320_push_personal_journey_notices.js` 恰好入账一次 | `session` 可选、`kind` 必填；旧 context 保持 session 原义。18 条迁移账本、41 集合、46 表；验收时 context 为私有且 0 行 |
| 运行健康与认证边界 | healthy、零重启、三条不同连续健康成功；HTTPS 200、四个未认证接口均 401 | 证明发布和认证边界，不等于生产业务写入或 SUBSCRIPTION 投递验收 |
| Push 运行配置 | `ENABLED=1`、`TEST_MODE=0`、`SUBSCRIPTION_APPROVED=1`；数据可写与专用密钥只读两挂载 | 本次仅改分类开关；原接收范围、revision、账号同意及凭据保持，未读取或复制密钥 |
| SUBSCRIPTION 权益及首条验证 | 同一应用已审核通过、服务端已启用；一条新单人定向消息首次 `accepted / 80000000`，用户确认系统通知收到 | 仍需双阶段同意、有效绑定、未读与时效等门禁；没有历史补发。单条结果不保证每日频次或所有设备，点击回源未验 |
| 管理端“定向旅途消息（无需关联场次）” | 已静态发布并核对线上产物 | [Deploy 44490560634](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44490560634) 与 [backend CI 44490560636](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44490560636) 成功；JS/CSS 完整 SHA256 匹配最终 production 构建，此项不是生产表单交互或分类投递验收 |

当前生产实际 image/config ID 仍为 `sha256:f3e1bc2ff3295772a50a497585bfcf51f4da1134ecdff3f9ec0ae06ac565e96a`；Compose SHA256 为 `f26ebeb828ff763341d036a37040e52e493fe269e533f73acf1792496b7a6088`，仓库生产模板仅同步本次 approval 单变量。激活前 Compose 为 `7a78755f21f53f0cae98319c6d175fc052eebc5bf920af17bb02841a1de276c6`。根 `release.json` SHA256 仍为 `a6ee07602a7fd8a6fd22147b23a2b2e805c2100864d3974768dafe18d160b24b`，根清单仍为 `82a5889ff26979b8c64c27d16998de46199cf2a5fe266768fe49b2c4860d77ec`；旧记录描述当时基线，不回写新配置。

11 月 19 日镜像发布使用 `personal-journey-context-v1` verifier，r1/r2 与逐阶段 TTY 的历史详见原发布记录；本次没有重跑迁移或该发布程序。现有 `harmony-push-production-v1` 发布 profile 只允许保留 `APPROVED=0`，`executorMayActivate=false` 的事实不变。下次后端发布必须另审并明确支持当前 `APPROVED=1` 基线，不能复用旧 profile 悄悄关闭分类、忽略 checksum 或改写本次独立审计；恢复副本仍不得挂正式密钥或启用发送。

## 15 点独立 Push 运行配置历史快照

以下原文保留 15 点独立启用和定向 MARKETING 公告验证的当时事实；其中“当前镜像”和“旧 runner”等措辞只描述当时版本，不代表上面的最新部署状态。

最后同步：2026-11-19 15:32:21 +08:00。生产 Push 独立运行配置已完成关闭阶段和启用阶段，记录为 `enabled-verified`（15:12:56）；沿用原账号级镜像、数据库与迁移账本，只增加五项环境变量和一个只读凭据挂载。当前发送总开关已开，正式模式已设，订阅分类权益开关仍关闭。正式定向公告已获华为成功码，用户确认邀请测试手机收到。详情见 [独立运行配置记录](harmony-push-production-activation-20261119.md)。

| 组件或闸门 | 当前状态 | 已知边界 |
| --- | --- | --- |
| 镜像、数据库和迁移 | 沿用 13 点已发布版本 | 同 image/config ID；本轮没有新镜像或迁移，旧发布审计和校验清单保持原样 |
| Push 运行配置 | `ENABLED=1`、`TEST_MODE=0`，现有服务账号只读挂载 | 关闭阶段 15:10:30、启用阶段 15:12:56 均验证相同新容器身份、零重启与三次不同健康检查；HTTPS 200、三个未认证探针 401 |
| 运营接收范围 | 保留用户保存的 `all`、revision 2 | 原两项保留玩家 ID 不变；本轮不改成单人白名单、不更新策略 revision |
| 生产设备注册 | 当前用户已建立一条有效绑定 | 解绑票据有效，手机设置中先前的同步错误消失；不记录 token、票据或设备标识 |
| SUBSCRIPTION 权益 | 华为仍审核中，`STARWARD_PUSH_SUBSCRIPTION_APPROVED=0` | 新场次、剧情来信和关卡动态停发，不降级消耗 MARKETING；邀请测试审核通过不等于分类权益可用 |
| 定向公告真实发送 | 15:27:20 仅向当前用户提交一条 MARKETING 合成公告，正式模式；首次尝试 accepted / `80000000` | 用户确认另一台邀请测试手机收到；USB 手机最终在登录页、未见该卡，不能混用两台证据。邀请包点击回源仍待验；不是 SUBSCRIPTION 已通 |

当前生产 Compose SHA256 为 `3ef3d9ca68ded2b6356d8b96273686f3c377fbfd44255fdd812defde45dd8341`；原镜像实际 image/config ID 仍为 `sha256:2304010161587e4409b4073befce684cfb6b48e52c6ac711107aead2c043a43a`。独立配置记录位于 `/opt/1panel/config-records/questions-game-v1/push-production-activation-20261119/activation-state.json`，不是对旧 release state 的覆盖。旧 runner 只支持单数据挂载；后续发布必须显式支持当前只读 secret 挂载并重新盘点基线，不能用改写旧审计消除差异。

## 13 点发布与静态部署历史快照

以下保留 13:21—13:31 的当时事实，其中“发送关闭、尚未配置凭据、仅数据挂载”等描述已由上面的独立配置变更更新，不代表当前状态。

最后同步：2026-11-19 13:31:06 +08:00。后端依据 [账号级旅途订阅发布记录](harmony-push-account-subscription-deployment-20261119.md)，状态 `recorded`、revision 15，无未决操作或阻塞；下方容器基线保留 13:23:51 的只读验收快照，13:31:06 再查仍为 recorded、healthy 与零重启。本次匹配账号级范围的管理端说明已随 `8902dfe8e973659b38a559b45d6ae71674106756` 静态部署，并以线上 JavaScript / CSS 的完整 SHA256 核验。日期记录保存当时事实，下次操作仍须只读复核现场。

### 13 点发布组件快照

| 组件或闸门 | 状态 | 说明 |
| --- | --- | --- |
| PocketBase 数据库迁移 | 已部署 | `1795075260_push_journey_subscription.js` 恰好入账一次；本轮新增两个私有集合在迁移、切换、最终验收及随后只读核查均为空 |
| PocketBase hooks / API | 已部署 | `questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64`；新账号级订阅 API 使用 `personal_journey_v1`，默认关闭、独立通知确认、可取消，不承接旧逐场同意 |
| 运营后台匹配账号级范围的说明 | 已静态发布并核验产物 | [Deploy to Server #73](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44465491873) 成功；线上 JS 与本地已验构建字节一致，新范围与未批停发说明存在。未执行本轮生产表单写入或 Chrome UI 验收，管理端发布不会更新 PB |
| 原生邀请包的新账号订阅交互 | 本轮后端验收未覆盖 | 0.1.3（5）构建、签名、分发、直板机交互和真实收发在原生项目分别记录，不能用后端健康替代 |
| 正式 Push 总开关与发送凭据 | 总开关实际关闭；本轮未配置凭据 | 运行容器无 `STARWARD_PUSH_*` 环境变量，仅有数据目录挂载；本次迁移不激活发送 |
| `SUBSCRIPTION` 分类权益开关 | 实际关闭 | `STARWARD_PUSH_SUBSCRIPTION_APPROVED` 未设置；华为权益申请、配置启用和真实分类投递分别确认 |
| 生产订阅写入及真实通知验收 | 本轮未执行 | 两个新表保持为空，不把隔离替身发送器或未认证 401 当作生产业务通过 |
| 既有业务与旧订阅客户端 | 普通游戏 API 保留；旧订阅 API 明确不透明兼容 | 旧逐场订阅接口返回 `409 PUSH_SUBSCRIPTION_SCOPE_CHANGED`，需新版设置管理账号级范围；迁移只增加空表，历史结构、数据和账本按允许差异验证 |

本日较早的逐场订阅发布见 [历史记录](harmony-push-subscriptions-deployment-20261119.md)，其中旧分类和兼容结论只描述当时版本。2026-11-18 基础 Push 结构见 [基础发布记录](harmony-push-deployment-20261118.md)；专属头衔与扩展配置见 [2026-09-08 记录](extra-config-player-titles-deployment-20260908.md)。

### 13 点发布运行基线

- releaseId：`push-account-subscription-20261119`；`recorded` 于 2026-11-19 13:21:03 +08:00，revision 15；无 `inFlight`、active marker 或阻塞。
- 生产镜像：`questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64`，实际 image/config ID `sha256:2304010161587e4409b4073befce684cfb6b48e52c6ac711107aead2c043a43a`。
- PocketBase 0.40.1 / Linux AMD64；`--automigrate=false`；唯一容器 `questions-game-v1`。
- Compose SHA256：`20e7a02a749a43af61344ef9f3b64f9e51be3e77daae0fd9f366f33a43f00ff9`。仓库模板 `backend/deploy/1panel/compose.production.yaml` 同步此镜像指针；线上只替换镜像，仍为单个 `/pb/pb_data` 挂载、回环 `127.0.0.1:8090`。
- 切换时取得三次健康成功证据；2026-11-19 13:23:51 +08:00 只读核查为 healthy、零重启，最近三次不同探测开始于 13:23:17、13:23:32、13:23:48，均退出 0。
- HTTPS 健康 200；未认证 `/api/questions/v1/admin/me`、`/api/questions/v1/assignments`、`/api/questions/v1/admin/push-settings`、`/api/questions/v1/me/push/journey-subscription` 均为 401。
- 迁移账本 SHA256：`292925750bca0895480457ab13947dddc9889b5a817e5d7f82ed17fd3392490c`。17 条账本记录、41 个集合、46 张表；本轮仅新增一个迁移和两个私有空表。
- 根 `release.json` SHA256：`7fdf89a2c37db7171acb7bf9e279171d9f5cbdea70bec54ef60c999a9b300fa2`；根校验清单 SHA256：`6cd8f9dc7ce4865fdb73cf09ab65fc7b994ba1138d25a942d2de7dbf2fabf9cb`。
- 最终报告 SHA256：`a09978ae6f1f450c3a64ae3b087198e152d8e5a4172f282d18a72e5687a2906e`。发布包及其 31 项源码清单为复现依据，不能只依赖冻结时尚未包含本轮工作区的 Git HEAD。

以上是本次发布及紧随其后的只读快照。生产恢复后不能用停服备份覆盖新业务数据。正式凭据、总开关或分类权益的后续启用属于独立运行配置变更，需新记录，不能复用本次包自动激活。当前个人旅途消息在分类权益未批准时停发，不回退 MARKETING；平台公告与推广继续归 MARKETING。新范围已在华为重新申请、尚在审核，审核中不等于权益可用或每日投递额度已保证。

### 原发布操作单

`backend/deploy/1panel/UPGRADE.md` 和包内 `README.md` 保留本轮冻结输入原文及其 pending 标记，便于逐字复核；实际完成状态以本次 `recorded` 证据和日期记录为准。该操作单不得再次执行。下次发布必须重新盘点、完整替换待执行操作单并冻结新计划；不得据模板或旧记录重建生产库。

### 13 点管理端部署边界

此前逐场版本的管理端已静态发布并经 Chrome 只读核验：总开关与订阅权益关闭，原白名单为 2 人，未提交配置或发送。该事实不代替本次账号级范围说明的部署核验。

本次匹配说明随 `8902dfe8e973659b38a559b45d6ae71674106756` 提交并发布。[Deploy to Server #73](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44465491873) 完成 48/48 管理端测试、生成契约检查、未认证后端只读探针、构建及上传；[PocketBase backend CI #20](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44465491909) 完成 134 项测试（133 通过、0 失败、1 个需显式环境开关的 OpenSSL 用例跳过）及镜像恢复演练。本地此前已显式开启该可选用例，134/134 通过。

13:30:33 直接 HTTPS 读取正式首页和公开静态文件：`index-BjXlDNvB.js` 的 SHA256 为 `c93872a55a19fcf397002bbe6fde7b7923b831813c3ab85046318f119849a6f1`，与已验本地构建完全一致，CSS 亦逐字节一致；账号级默认关闭和不降级消耗营销额度的说明均存在。此项是线上产物核验，不代替实际生产表单交互。没有登录、保存设置或触发通知，未执行本轮生产业务写入。

13:31:06 再次只读检查后端：`recorded` revision 15，无未决操作或阻塞，healthy、零重启且最近三次不同健康检查成功；两个新表仍为空，发送总开关、权益和凭据配置仍关闭。后台默认公告仍属 MARKETING，个人旅途只有新账号范围同意、独立通知确认和分类批准等条件同时成立后才有资格发送。静态部署不会迁移数据库或激活正式 Push。
