# SUBSCRIPTION 独立运行配置激活 · 2026-11-20

2026-11-20 16:09:24.657197 +08:00（`2026-11-20T08:09:24.657197Z`），生产独立配置状态为 `enabled-verified`。本轮只将同一服务的 `STARWARD_PUSH_SUBSCRIPTION_APPROVED` 从 `0` 改为 `1`，保留镜像、数据、挂载、端口、运行限制、发送总开关、正式模式、运营范围和账号同意。随后仅向当前授权玩家新发一条定向旅途消息，首次获华为接受，用户明确确认收到系统通知；点击回源仍未验。

## 根因与前置事实

用户在华为看到原「赴星之约」应用的订阅分类审核通过，但后台定向旅途消息未收到。主任务直接核实同一应用的分类页面已通过；服务器只读结果仍为 `ENABLED=1`、`TEST_MODE=0`、`SUBSCRIPTION_APPROVED=0`。目标账号有效且无需强制改密，已有两阶段同意与一条有效、账号代次匹配的设备绑定；目标未读收件没有对应 Push 任务。

平台审批不会自动同步本地环境变量。`push-journey-subscription.js` 仅在 approval 精确为 `1`、且当前范围已订阅及明确接收通知时允许 SUBSCRIPTION。后台 `sendNotification` 先创建应用内通知和收件，再尝试入队；门禁不满足时不建 Push 任务，因此表单成功不等于华为已接收。此次确认的阻断点是服务端分类开关仍关闭，不是为绕过用户同意而扩大发送范围。

启用前只读快照为 1 条账号订阅、1 条有效设备绑定、0 条 Push 投递。历史未入队消息不会因开关变化自动补建；不得为排障手工插入队列或重放已完成的业务命令。

## 唯一配置差异与身份

| 项目 | 本次事实 |
| --- | --- |
| 不变的镜像 tag | `questions-pocketbase:0.40.1-push-personal-journey-20261119-amd64` |
| 不变的实际 image/config ID | `sha256:f3e1bc2ff3295772a50a497585bfcf51f4da1134ecdff3f9ec0ae06ac565e96a` |
| Compose 激活前 SHA256 | `7a78755f21f53f0cae98319c6d175fc052eebc5bf920af17bb02841a1de276c6` |
| Compose 激活后 SHA256 | `f26ebeb828ff763341d036a37040e52e493fe269e533f73acf1792496b7a6088` |
| 唯一有效差异 | `services.pocketbase.environment.STARWARD_PUSH_SUBSCRIPTION_APPROVED`：字符串 `0` → `1` |
| 其余 Push 环境 | `ENABLED=1`、`TEST_MODE=0`、既有项目及凭据文件路径保持 |
| 挂载 | 原数据目录可写、原专用凭据只读，仍为两项 bind；没有读取、复制或轮换密钥 |
| 冻结操作脚本 SHA256 | `788e8e670a76b3dcb8665f7a71c95ba64361bfe116ac982e640670702105bfc5` |

配置激活阶段没有构建或替换镜像、迁移数据库、修改账号授权、接收名单、策略 revision 或既有业务内容；后续新建的单人验证来信另行记录。独立记录位于服务器 `/opt/1panel/config-records/questions-game-v1/push-subscription-activation-20261120/`；原发布仍是 11 月 19 日 `recorded` revision 15，不伪造新代码发布或迁移阶段。

## 实施与验证

新版本专属守卫先生成单变量候选，使用 `docker compose config --format json` 深比较全部有效配置。激活前取得同 `pb_data` 发布锁，拒绝未决发布与待发送队列，核对冻结 Compose、不可变镜像、原容器、只读 schema／迁移账本／运营策略摘要、旧根审计和凭据文件元信息。写入 `applying` 后，在变更 Compose 前建立共享持久 active marker；失败保留状态及 marker，成功后只清除自身原字节对应的 marker。

只对 PocketBase 执行 `up --no-start --no-deps --pull never`，先验证新停止态容器的镜像、精确环境、命令、挂载及运行不变量，再启动。实际结果：

| 验证项 | 实际结果 |
| --- | --- |
| 独立激活阶段 | `enabled-verified`，完成时间如本文开头 |
| 镜像与运行配置 | `sameImage=true`、`sameRuntimeExceptApproval=true` |
| 数据与旧审计 | 运营策略、schema、迁移账本与旧根审计摘要保持 |
| 凭据 | 原只读挂载仍可读，仅核元信息与容器可读性，不保存内容或摘要 |
| 稳定健康 | 同一新容器 ID，重启计数 0；3 条不同开始时间、连续成功的健康记录 |
| HTTPS | `/api/health` 200；`admin/me`、`assignments`、`admin/push-settings`、`me/push/journey-subscription` 四项未认证请求均为 401 |
| 仓库模板 | `compose.production.yaml` 仅同步该变量，实际 SHA 与新生产 Compose 完全一致；本地渲染通过，没有再次执行生产切换 |
| 单条 SUBSCRIPTION | 一条新单人事件，无场次关联；`accepted`、attempts 1、providerCode `80000000`、`testMessage=false`，用户明确确认系统通知收到 |

旧根 `release.json` SHA256 仍为 `a6ee07602a7fd8a6fd22147b23a2b2e805c2100864d3974768dafe18d160b24b`，旧根 `SHA256SUMS` 仍为 `82a5889ff26979b8c64c27d16998de46199cf2a5fe266768fe49b2c4860d77ec`。旧日期记录和冻结计划保持历史事实，本次新 Compose 由独立记录锚定，不能静默回写旧清单。

16:10:50.041（北京时间），主任务仅选当前授权玩家 1 人，提交 1 条新的 `personal_journey`，`kind=account`、无场次关联，原草稿未改。新任务分类为 `SUBSCRIPTION`、范围 `personal_journey_v1`、同意 revision 17；第一次尝试为 `accepted / 80000000`，正式发送模式。用户随后明确回复「已收到系统通知」。主任务未点开通知或标已读，也没有补发历史事件；该手机确认来自用户，不冒称新增原生 UI 自动化结果。

16:11:50 最终只读核对仍为同一已验证容器、healthy、零重启，`ENABLED=1`／`TEST_MODE=0`／`APPROVED=1`，无 active marker，旧根审计未变。维护 socket 已关闭并确认路径不存在。公开脱敏证据见 [生产激活及单条收发](../../starward_hm/artifacts/validation/push-subscription-activation-20261120/production.json)。

## 后续发布与回退边界

现有 `harmony-push-production-v1` 普通发布 profile 仍固定 `APPROVED=0`、`executorMayActivate=false`。这是旧工具真实能力，未在本轮修改。下次镜像／后端发布必须重新盘点本次独立状态，并另审对 `APPROVED=1` 的明确支持；不能直接复用旧 profile 悄悄关闭分类、忽略校验或改写本次审计。隔离恢复容器仍不得挂正式密钥或启用发送。

守卫没有自动重试或 rollback 模式。失败或结果未知时先只读判断状态与 marker；如需撤回本次变更，使用保存的原 Compose 将 approval 恢复 0，其余镜像、数据、挂载、策略保持，并重新检查停止态及同 ID 启动后的健康。不得恢复旧数据库、删除业务记录或使用旧 activation 的 `rollback-off` 改变总开关。本轮实际未执行回退。

当前统一入口为 [当前生产状态](current-production.md)。原生侧记录见 [本轮根因与激活](../../starward_hm/docs/push-subscription-activation-2026-11-20.md)。分类通过与开关启用不保证设备显示或每日送达次数；云端接受、手机接收和点击回源分别验收。
