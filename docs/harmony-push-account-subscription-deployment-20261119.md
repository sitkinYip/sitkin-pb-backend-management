# 2026-11-19 账号级旅途订阅后端发布记录

PocketBase 后端发布已完成：`1795075260_push_journey_subscription.js` 和账号级旅途订阅 hooks 已在生产进入 `recorded`。本轮仅新增两个私有空集合，旧逐场同意不迁入新账号范围。Push 总开关、订阅权益开关均实际关闭，无正式发送凭据配置。本记录不表示匹配的管理端说明已部署、原生邀请包已分发或真实华为通知已送达；后续状态见 [当前生产状态](current-production.md)。

## 冻结版本与只读证据

| 项目 | 已核验结果 |
| --- | --- |
| 发布状态 | `push-account-subscription-20261119`，`recorded`，revision 15，无进行中操作、未决标记或阻塞 |
| 完成时间 | 2026-11-19 13:21:03 +08:00；随后只读运行核查为 13:23:51 +08:00 |
| 源镜像 | `questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64` |
| 目标镜像 | `questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64`；PocketBase 0.40.1 / Linux AMD64 |
| 生产实际 image/config ID | `sha256:2304010161587e4409b4073befce684cfb6b48e52c6ac711107aead2c043a43a` |
| 本机单平台 manifest ID | `sha256:e869a071247dc37f956688b77a1f256e06b88a76c5356efaf8d26cedc83f87c6`，已严格映射到上述归档 config 摘要 |
| 冻结发布包 SHA256 | `426016cdf74f445be032f9a94a722e88ead0abfec82ecbfcd7c9c475e052de4a` |
| 冻结源码清单 SHA256 | `1941e2e944397b224e1aaf7965d1060175336972204c728e1a137fbccab406ed` |
| Compose SHA256 | `20e7a02a749a43af61344ef9f3b64f9e51be3e77daae0fd9f366f33a43f00ff9` |
| 迁移账本 SHA256 | `292925750bca0895480457ab13947dddc9889b5a817e5d7f82ed17fd3392490c` |
| 根 `release.json` SHA256 | `7fdf89a2c37db7171acb7bf9e279171d9f5cbdea70bec54ef60c999a9b300fa2` |
| 根校验清单 SHA256 | `6cd8f9dc7ce4865fdb73cf09ab65fc7b994ba1138d25a942d2de7dbf2fabf9cb` |
| 最终报告 SHA256 | `a09978ae6f1f450c3a64ae3b087198e152d8e5a4172f282d18a72e5687a2906e` |

发布包冻结 31 项镜像输入，运行时、hooks、迁移与已审源码逐项匹配；相关业务、测试与管理端 17 项源文件另与验收摘要一致。外层六项和内层七项校验和、精确归档成员、源码清单、操作单、执行器与允许差异清单均经独立只读复核。Docker Desktop 的单平台 manifest ID 与生产 Docker 的 config ID 不是同一身份层级；已核对归档 manifest 指向的 config 原始字节摘要，不能拿其中一个直接替代另一个。冻结时的 Git HEAD 尚未包含本轮工作区改动，不能单独用该基线重建镜像；复现以冻结输入及摘要为准。

## 停服备份、恢复演练与正式迁移

- 维护从 2026-11-19 13:14:30 +08:00 开始。完整停服备份为 5,155,546 字节，归档 SHA256 为 `b571ef345ef132a2c63953186b014ad0ae761a3cb406df1eac768894cb3bbc8b`，文件清单 SHA256 为 `2c569367b290bd0766323e1e6a069fdbc3ec6149b04cacb424335591022ff443`。
- 13:14:40 完成恢复副本验证：独立解压、逐文件和 SQLite 基线校验通过，在恢复副本运行新增迁移并验证固定镜像启动。验证报告 SHA256 为 `c77d16907d25ed0bb3c9bd964304f73c0f661e1966e6d2bc3f1739e670188543`，恢复副本迁移后摘要为 `66ec922ba8095f9ea9338cda486c5fb87bf606747f397169f757e657aa37bde5`。
- 13:18:27 完成正式迁移。唯一新文件 `1795075260_push_journey_subscription.js` 恰好入账一次；`game_push_journey_subscriptions`、`game_push_journey_deliveries` 均为私有且 0 行。允许差异仅为该迁移、两个私有空集合、两张表及对应索引；历史结构、集合定义、数据与账本通过校验。正式迁移验证报告 SHA256 为 `22bc5e66c98b890ab56e1830af2994747b28bde68d9051c0457d1160871f62d4`。
- 13:20:02 完成镜像切换验证，距维护开始约 5 分 32 秒。Compose 仅替换镜像，保持原数据目录、唯一 `/pb/pb_data` 挂载、回环 8090、原运行安全配置及 `--automigrate=false`；没有新增凭据、环境变量或覆盖配置。阶段之间仍由操作者独立输入 TTY 短语，未自动跨闸门。
- 13:21:03 完成最终记录。17 条迁移账本、41 个集合、46 张表；两个新表仍为空，最终数据库摘要为 `f873a96b6b8269df5b39272472cce7646949b3bab375cf83c6594f441b03e09c`，状态无阻塞和未决操作。

## 切换与最终只读验收

切换证据记录三次成功健康检查、重启计数 0。13:23:51 的只读复核再次确认目标镜像、healthy 与零重启；最近三次不同 Docker 探测分别开始于 13:23:17、13:23:32、13:23:48（+08:00），均退出 0，不是反复读取同一个 healthy 值。

HTTPS `/api/health` 返回 200；未认证 `/api/questions/v1/admin/me`、`/api/questions/v1/assignments`、`/api/questions/v1/admin/push-settings`、`/api/questions/v1/me/push/journey-subscription` 均返回 401。以上只证明服务健康和认证边界，没有以生产玩家执行订阅、入场、答题、已读或奖品写入验收。

服务恢复后可能已有真实流量，最终验证按发布程序检查结构与要求保持为空的新表，不把全库业务行摘要相等作为恢复旧快照的依据。本次审计时未观测到业务行差异，也不等于允许用停服备份覆盖后续数据。最终报告、根版本材料及其校验清单按摘要核对，冻结操作单与发布包保持原样；仓库 Compose 模板只在 `recorded` 后同步镜像指针。

脱敏生产证据保存在同工作区原生项目的 `artifacts/validation/release-0.1.3-20261119/backend-recorded.json`；包含阶段时间、文件摘要、运行状态、空表与权限事实，不含发送凭据或玩家口令。

## 兼容、激活与后续边界

新账号范围 `personal_journey_v1` 默认 false / false，先订阅，再独立确认接收通知；取消后旧待发队列不能绕过当前同意。旧逐场同意不自动扩大，旧逐场订阅 API 明确返回 `409 PUSH_SUBSCRIPTION_SCOPE_CHANGED`，普通游戏 API 保留。该边界不是对旧订阅客户端的透明兼容；0.1.3 原生候选须使用新的账号级 API。

13:23:51 实查容器无任何 `STARWARD_PUSH_*` 环境变量，仅挂载原数据目录；发送总开关、订阅权益和凭据配置均为 false。本次没有写入生产订阅、扩大白名单、绑定验收设备或发送真实通知。新账号范围已重新申请华为 SUBSCRIPTION 权益、仍在审核；权益未批时个人旅途消息停发，不降级为 MARKETING，平台公告和推广继续使用 MARKETING。

匹配的运营后台说明在本记录同步时尚待提交和静态部署；原生邀请包、首次正式分发隐私、系统通知授权、生产凭据及真实分类投递分别验收。本地 134/134 后端测试与 48/48 管理端测试不能替代上述生产事实，不承诺每天至少 20 次实际到达。

生产恢复流量后优先前向修复，保留加性结构和业务数据；不得执行 migration down、删除账本或重新执行本次冻结操作单。若需回退运行代码，另行审查新旧订阅 API 与队列的兼容边界，不能恢复过期快照或自动激活发送。
