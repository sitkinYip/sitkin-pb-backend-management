# 当前生产状态

最后同步：2026-11-19 13:31:06 +08:00。后端依据 [账号级旅途订阅发布记录](harmony-push-account-subscription-deployment-20261119.md)，状态 `recorded`、revision 15，无未决操作或阻塞；下方容器基线保留 13:23:51 的只读验收快照，13:31:06 再查仍为 recorded、healthy 与零重启。本次匹配账号级范围的管理端说明已随 `8902dfe8e973659b38a559b45d6ae71674106756` 静态部署，并以线上 JavaScript / CSS 的完整 SHA256 核验。日期记录保存当时事实，下次操作仍须只读复核现场。

## 当前组件状态

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

## 最近核对的运行基线

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

## 当前操作单

`backend/deploy/1panel/UPGRADE.md` 和包内 `README.md` 保留本轮冻结输入原文及其 pending 标记，便于逐字复核；实际完成状态以本次 `recorded` 证据和日期记录为准。该操作单不得再次执行。下次发布必须重新盘点、完整替换待执行操作单并冻结新计划；不得据模板或旧记录重建生产库。

## 管理端部署边界

此前逐场版本的管理端已静态发布并经 Chrome 只读核验：总开关与订阅权益关闭，原白名单为 2 人，未提交配置或发送。该事实不代替本次账号级范围说明的部署核验。

本次匹配说明随 `8902dfe8e973659b38a559b45d6ae71674106756` 提交并发布。[Deploy to Server #73](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44465491873) 完成 48/48 管理端测试、生成契约检查、未认证后端只读探针、构建及上传；[PocketBase backend CI #20](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44465491909) 完成 134 项测试（133 通过、0 失败、1 个需显式环境开关的 OpenSSL 用例跳过）及镜像恢复演练。本地此前已显式开启该可选用例，134/134 通过。

13:30:33 直接 HTTPS 读取正式首页和公开静态文件：`index-BjXlDNvB.js` 的 SHA256 为 `c93872a55a19fcf397002bbe6fde7b7923b831813c3ab85046318f119849a6f1`，与已验本地构建完全一致，CSS 亦逐字节一致；账号级默认关闭和不降级消耗营销额度的说明均存在。此项是线上产物核验，不代替实际生产表单交互。没有登录、保存设置或触发通知，未执行本轮生产业务写入。

13:31:06 再次只读检查后端：`recorded` revision 15，无未决操作或阻塞，healthy、零重启且最近三次不同健康检查成功；两个新表仍为空，发送总开关、权益和凭据配置仍关闭。后台默认公告仍属 MARKETING，个人旅途只有新账号范围同意、独立通知确认和分类批准等条件同时成立后才有资格发送。静态部署不会迁移数据库或激活正式 Push。
