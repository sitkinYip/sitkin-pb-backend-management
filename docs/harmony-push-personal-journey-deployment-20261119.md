# 定向旅途消息生产发布记录 · 2026-11-19

2026-11-19 16:40:05 +08:00，后端 `push-personal-journey-20261119` 完成 `recorded`，revision 15；服务已恢复，无 `inFlight`、active marker、阻塞或下一发布操作。本文记录本次发布，不替代下次操作前的只读盘点。当前入口见 [当前生产状态](current-production.md)，模型及同意范围见 [定向旅途消息设计](harmony-push-personal-journey-20261119.md)。

## 范围与兼容

本次新增通知用途 `personal_journey`：仅向指定的有效玩家发送现有 `personal_journey_v1` 同意范围内的个人剧情来信和旅途动态，无需关联场次。它不代表任意“重要消息”、账号安全提醒或推广，也没有扩大既有订阅同意。原 `journey` 仍必须关联场次；默认公告兼容旧客户端并保持 MARKETING。未读、有效期、当前订阅 revision 和取消后的队列作废仍由后端复核；异常、未知或缺失 context 不降级为营销发送。

旧玩家端和旧运营台继续使用原接口与原通知字段。新运营台用途依赖本次后端，因此先完成后端，再通过 main 的正常静态部署流程发布管理端。管理端随后随 `7184170e97babe0e2074e08305b3b41261408695` 完成静态发布并核对线上产物；本次不要求新原生包。

保留已有正式 Push 配置：`ENABLED=1`、`TEST_MODE=0`、`SUBSCRIPTION_APPROVED=0`、既有项目与凭据路径、接收范围和账号级订阅。数据可写、专用凭据只读两挂载保持不变，没有读取或复制密钥、扩大名单、改开关或改同意。SUBSCRIPTION 权益仍未启用，个人旅途未批准时停发、不回退 MARKETING，不能据本次上线宣称该分类送达。15 点 MARKETING 公告的实际收发只属于 [独立配置及公告记录](harmony-push-production-activation-20261119.md)。

## 唯一迁移与验证

新增 `1795075320_push_personal_journey_notices.js`，生产账本恰好入账一次。`game_push_notice_contexts.session` 从必填改为可选，新增必填单选 `kind`（`session`、`account`），旧行回填 `kind=session` 并保留原三列。生产该表在备份、迁移及最终核查时为 0 行、规则保持私有；不能把空表升级当成非空历史回填的生产实测。

本次 `personal-journey-context-v1` verifier 精确核对该 SQL 列追加、既有三列全字段类型化投影、集合字段与规则、其他 schema／集合／业务行及每条旧账本记录。集合生成的 `updated` 允许正常前进，其他属性不变。18 条迁移、41 个集合、46 张表；`integrity_check=ok`。恢复演练和正式迁移分别比较，服务恢复后允许正常业务行增长，仍锁定 schema、集合及历史账本。

隔离测试使用真实 Docker PocketBase 与合成数据，未读正式凭据或使用生产库：

- 运行时代码完整集成套件 138/138 通过、0 失败、0 跳过，包含显式启用的 OpenSSL 验签；相关用例在本轮发布工具扩展前完成。
- 最终 r2 发布计划、控制器、worker、打包门禁定向套件 51/51 通过，包含 Python 3.6 AST／selftest、固定 Push 环境与挂载、false 保留／omitempty 兼容及 true／非法类型拒绝。
- 新真实迁移用例 1/1 通过：保留 1 条历史 context、拒绝 11 类 SQLite 备份漂移；实际新增 account context 在服务恢复后的结构检查中通过，在停服迁移比较中被拒绝。
- 独立 runner 副本移除旧行投影保护后，旧行负例实际失败，mutation 被捕获；共享源文件保持原字节。r2 只修 Compose 渲染差异，context verifier 与该项隔离证据沿用 r1，未伪称重新运行。

上述定向套件存在重叠，不能相加当作业务覆盖数。公开脱敏摘要位于原生项目 `artifacts/validation/push-personal-journey-20261119/release-verifier-r2-summary.json` 和 `production-summary.json`；原始日志、生产盘点、状态、备份和业务摘要只留私有审计目录。

## 冻结制品

| 项目 | 值 |
| --- | --- |
| 生产镜像 | `questions-pocketbase:0.40.1-push-personal-journey-20261119-amd64` |
| 实际 image/config ID | `sha256:f3e1bc2ff3295772a50a497585bfcf51f4da1134ecdff3f9ec0ae06ac565e96a` |
| 本地单平台 manifest 身份 | `sha256:158393f62324c7638acd4a9d85f96849dd56c34463b76e469b708511c410f298` |
| 平台／运行时 | Linux AMD64／PocketBase 0.40.1／`--automigrate=false` |
| r2 外层 bundle SHA256 | `b097cc74c1f0715e564f7c9e6631c871724bad46a8593e43144e80308fbc7916` |
| image archive SHA256 | `386495fbbfaf028c88de0ce43708611d477264da50cfe5723a823f8f71e4d376` |
| 外层／包内清单 SHA256 | `0982546aa1b4d0d5bdc05c16848737a8ff00acee88132067b3519046dfcfd424`／`ab9dcfc80d8c934107dbf24732daa84b4b742d5689816b85bf6bc280dd76896e` |
| deployment-plan SHA256 | `e6c3ee1895740bb1e90d02a2456721e58c4fa1b395cacf5e3740f9a4e3d3e134` |
| allowed-delta SHA256 | `2ccf50f55792642bed964bce6dda71e2fb540a2b9cae52757dd645baad0e0882` |
| runner SHA256 | `619c150911e9e67ac22c880beba8f5cd5d7b30b10b76257a36b4bc60b7fec32c` |
| 源码清单 SHA256 | `a8e07de18a5b3b12f579f2c3108870ce0ffca3421c6404f1daa20e5e5f7cc5dc` |
| 候选／生产 Compose SHA256 | `7a78755f21f53f0cae98319c6d175fc052eebc5bf920af17bb02841a1de276c6` |

镜像内 31 个 runtime 源文件按冻结清单验证；Dockerfile 为独立 build-only 项。镜像、归档原始 config digest、源码与候选 Compose 分别校验，不能混用 Docker Desktop 的 manifest ID 和实际生产 config ID。包不包含业务库、凭据或前端构建。

首次出包尝试因 image export 的 index 结构被严格单平台校验拒绝，尚未形成可部署包；改为单平台后形成 r1。r1 在远程 preflight 发现服务器 Compose 将显式 `bind.create_host_path:false` 渲染为 `{}`，在 stage 前闭锁，没有上传、停服或迁移。r2 只兼容实际 bind 对象中的 false 省略，仍拒绝 true、非布尔值、非法 bind、可写密钥、额外挂载及其他环境变化；源文件 SHA 不变。r2 重跑 51 项门禁、重新出包与独立复核，r1 失败证据和归档保留，没有覆盖或放宽旧包。

## 逐阶段执行

用户明确授权“改动验证没问题就上线后端及运营台”。代理依该次委托，在每阶段只读核验后分别执行现场 TTY 的 STAGE、BACKUP、MIGRATE、SWITCH、FINALIZE 短语；[人工闸门程序](pocketbase-release-program.md) 和控制器保持原闸门，没有跳步、修改批准机制或自动跨阶段。

| 阶段 | 实际结果（UTC+8） |
| --- | --- |
| STAGE | r2 预检 ready；冻结材料、镜像、候选及隔离启动验证通过，16:34:34 建立 prepared 状态 |
| BACKUP | 16:35:14 停止唯一目标服务；16:35:24 完成全量备份、逐文件恢复验证、恢复副本迁移及两次启动检查 |
| MIGRATE | 16:36:13 完成正式库指定迁移，符合允许差异且与恢复演练一致 |
| SWITCH | 只替换镜像，保留全部运行契约；同一容器、零重启、三条不同连续健康成功，16:39:17 验证通过并恢复服务 |
| FINALIZE | 16:40:05 写入 recorded revision 15 及根材料；无未决操作，未做新功能激活 |

备份 archive SHA256：`ede15b2ee3d6e069945659a408e0f6eb084c3a2e1abec97d5c8dff2f72544556`；文件清单 SHA256：`1135490a48342dbd032e247f7a39908d8e3e3b2e66e89219bb3ea99553b071d5`；恢复验证 SHA256：`4124a7583c887047d009f2062e3db1022c49b176c911cbbc9c60e664b5e595e6`。备份保持私有，不复制业务明文或凭据到公开记录。

## 发布后只读验收与边界

发布后快照为 healthy、零重启；最近三条不同健康检查开始于 16:40:02、16:40:17、16:40:32，均退出 0。runner 已验证 HTTPS health 200，以及未认证 `/api/questions/v1/admin/me`、`/api/questions/v1/assignments`、`/api/questions/v1/admin/push-settings`、`/api/questions/v1/me/push/journey-subscription` 四项均 401。认证探针与健康不能替代登录后的真实写入或分类送达；本轮未为发布执行生产入场、答题、已读或领取写入。

- 迁移账本 SHA256：`ecb46ffcbd8252680e7da2815a2e54a79046a5d749a5c19fe413ce2a4e9ef401`。
- 根 `release.json` SHA256：`a6ee07602a7fd8a6fd22147b23a2b2e805c2100864d3974768dafe18d160b24b`。
- 根 `SHA256SUMS` SHA256：`82a5889ff26979b8c64c27d16998de46199cf2a5fe266768fe49b2c4860d77ec`。
- 最终报告 SHA256：`cba8e7d51a76d02b320c9a99e61578171e8fdcb781e79c7faf9bad9a31ca11d7`。

仓库 Compose 只更新镜像指针，字节匹配已部署 Compose。仓库 UPGRADE 标为 completed、防止再次执行；r2 冻结包的 pending 原文及其 SHA 保留不变。13 点发布及 15 点独立配置的历史归档不改写。生产已经恢复流量，旧快照不能覆盖当前库；后续问题按安全规范前向处理。

## 管理端静态发布与线上产物

管理端源提交 `7184170e97babe0e2074e08305b3b41261408695` 的 [Deploy to Server](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44490560634) 于 2026-11-19 16:48:08 +08:00 完成、结论 success；对应 job `135444794345` 的全部步骤成功，包括 48 项管理端测试、admin-only 契约检查、只读兼容探针、构建与 SCP 上传。[PocketBase backend CI](https://github.com/sitkinYip/sitkin-pb-backend-management/actions/runs/44490560636) 于 16:48:05 完成、结论 success。此静态流水线没有再次迁移数据库或启用分类。

通过真实 HTTPS 读取正式首页引用的资源，与最终 production 本地 dist 完整字节匹配：

| 线上资源 | SHA256 |
| --- | --- |
| `/assets/index-DE1zhclC.js` | `e8d3b9ec240b9c0f75b65e6e86ce3918be0d091cc5bf333d88c98a6b3492f26a` |
| `/assets/index-Dlvq61_l.css` | `a1d09fcaacc157a47e2ac324acd3630b63f83152d723f438f5fed3aa2ea214a9` |

这是 CI 和公开线上静态产物核验，不冒充生产浏览器表单交互；本轮未为验证发送生产剧情来信。后端和运营台均已发布，SUBSCRIPTION 权益仍为 0，定向旅途消息的华为实际投递仍未验收。
