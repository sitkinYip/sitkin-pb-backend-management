# 推送业务标题生产发布记录 · 2026-11-20

2026-11-20 16:49:22 +08:00，后端 `push-titles-20261120` 完成 `recorded`，revision 14；最终 status 为 terminal，无未决操作、阻塞或 active marker。用户随后明确确认“已收到，标题正确”。本轮仅发布后端，不更新原生邀请包、Web 或运营台。当前入口见 [当前生产状态](current-production.md)，功能边界见 [标题实施与验收](harmony-push-titles-20261120.md)。

## 改动与兼容

系统通知标题采用既有通知标题；新场次下发采用所属场次标题。来源仍须通过原账号、绑定、同意版本、未读、撤回及有效期等门禁，在 claim 事务内取得后只传给内存任务。标题合并空白、去控制与方向字符，最多60个 Unicode 码点，空值或异常值回退「赴星之约」。不新增数据库字段，不发送通知全文、题面、答案或奖励；正文提示、分类、点击数据、TTL 和接收范围保持。

旧原生包、Web 及运营台继续使用既有接口。`ENABLED=1`、`TEST_MODE=0`、`SUBSCRIPTION_APPROVED=1`、原项目和专用凭据只读挂载保持；本次发布不激活分类、不修改账号同意、不补发历史事件。新 `harmony-push-production-v2` 明确保留 approval 1，历史 v1 仍固定为0；隔离恢复和 stage 不挂正式密钥、不启用发送。

## 隔离验证与冻结制品

- 最终 AMD64 镜像完整后端测试154/154通过，显式启用 `PB_PUSH_VALIDATE_OPENSSL=1`，失败、取消、跳过均0；启动、重启及离线恢复通过。
- Push 目标集21/21通过（16个真实 PocketBase 用例、5个标题边界用例），含真实 Goja Unicode、当前标题刷新、长中文、emoji、空值与控制字符；这些用例属于完整集的交叉验证，计数不相加。
- 发布工具目标集58/58通过，Python 3.6语法与 selftest 通过。独立副本 mutation：runtime 1/1、发布工具2/2均检出；独立 runtime 和发布输入审查无阻塞。
- 本轮未改共享契约；admin-only生成检查通过。默认跨仓契约检查发现 Web 既有生成副本缺少11月19日订阅类型，保留该差异并未修改 Web，不记作全端契约检查通过。

首次出包因 OCI index 结构被严格单平台闸门拒绝，未产生可执行发布包。随后关闭 provenance，以同一 runtime config digest 重出单平台包，`verify-image-final` 通过；首轮失败记录保留，未放宽闸门。

| 项目 | 冻结值 |
| --- | --- |
| 生产镜像 | `questions-pocketbase:0.40.1-push-titles-20261120-amd64` |
| 实际 image/config digest | `sha256:6103a1c579a24642c9c31486a7203e4a15a0829c5613661e790a4dba96114930` |
| 平台／运行时 | Linux AMD64／PocketBase 0.40.1／`--automigrate=false` |
| bundle SHA256 | `e3b1f79ea4c649d66b94007275f0cc1b8a242148d7fb336b6c9bf78b32796d62` |
| runner SHA256 | `d1cebd8b15f5b822dc5a39b4c5a3f497580c1c1c415e990e12bead134eba746c` |
| 源码清单 SHA256 | `1f3c6e6cfd8b3b7d829a72517ec44869dec54243e54434643b5055a5254bb9fa` |
| 候选／生产 Compose SHA256 | `d9a5f824bf7bcad1dbf84c30c19cf63cccfdc37f124b7ee5af99a5607d26734d` |

包内源码与镜像代码一致，不含业务库、凭据或前端构建。Docker Desktop 的本地 image 身份与原始 config digest 分别核验，不能混用。

## 生产执行与验收

按本次用户授权，逐阶段核验后分别完成 TTY 的 STAGE、BACKUP、NO_MIGRATION、SWITCH、FINALIZE；控制器未自动跨阶段。备份完成独立恢复、文件及 SQLite 验证后才继续。`migration.mode=none`，允许差异清单全空；停服阶段 schema、集合、逐表摘要和完整账本无差异。切换只更换镜像，保留既有挂载、环境和运行契约。

最终记录为41个集合、46张表、18条迁移账本，账本 SHA256 仍为 `ecb46ffcbd8252680e7da2815a2e54a79046a5d749a5c19fe413ce2a4e9ef401`。同一目标容器 healthy、零重启，最近三条不同健康记录均退出0；HTTPS健康200、四项未认证接口401。发布报告与旧根材料已归档，旧审计不改写；新根材料写入本轮状态。

| 发布后材料 | SHA256 |
| --- | --- |
| 根 `release.json` | `277c34495881756a3b91cfb966b02c590389421d537e0afeab857aadbce4f212` |
| 根 `SHA256SUMS` | `f2222ca5e1f71b874d074d4f02d62847bcad1e2f932b0a32d08cd92575c75814` |
| 最终发布报告 | `b1f7947b70e1e658dcaadbdffcb456c0f94d493944e4210b9b52a4844496bf5e` |

发布阶段只做结构、健康和认证检查，报告中的 `productionWriteTestPerformed=false` 不代表随后未验证消息。发布完成后另向用户本人发送一条定向旅途消息：SUBSCRIPTION、首次尝试 `accepted / 80000000`，用户明确确认系统通知收到且标题正确。未生产下发场次来验标题；场次标题只有隔离真实 PocketBase 证据。点击回源仍未验，不能从回执已读字段推断该流程已通过。单条结果不保证所有设备或每日频次。

仓库生产模板只替换镜像指针，与实际 Compose 字节一致。仓库操作单标为 completed、禁止重用；冻结包保留原 pending 文本和校验值。生产已恢复真实流量，旧备份不能覆盖新增业务数据；后续问题按安全规范前向处理。最终再次只读查询仍为 recorded revision 14，维护连接已关闭，专用SSH socket确认不存在。生产盘点、状态和原始日志保留私有。公开脱敏摘要位于原生项目的 `artifacts/validation/push-titles-20261120/production.json` 与 `validation.json`，不包含玩家或设备ID、私人消息内容或凭据值。
