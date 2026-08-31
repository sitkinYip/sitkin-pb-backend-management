---
name: questions-pocketbase-production
description: 准备、检查、执行或恢复 Sitkin 答题服务在 1Panel 上的生产 PocketBase/SQLite 发布时使用，包括生产只读预检、完整备份、迁移、镜像切换、验收、故障闭锁和回退。普通代码开发、隔离测试和管理端静态发布不触发。
---

# Sitkin PocketBase 生产运维

本 Skill 只处理真实生产 PocketBase、SQLite、容器和 `pb_data`。相对本 Skill 的仓库根为 `../../..`。开发、打包、生产连接、停服、迁移、切换和业务写入分别授权。

## 先选择模式

所有模式先完整读取 `../../../docs/current-production.md` 和 `../../../docs/backend-release-safety.md`，检查实际状态与文档是否一致，然后按需加载：

| 模式 | 额外资料 | 允许动作 |
| --- | --- | --- |
| 生产只读检查 | 最新正式 deployment 记录 | 只读查询与报告；不创建状态文件、不改服务器或项目文档 |
| 发布准备 | `../../../backend/README.md`、`../../../docs/pocketbase-release-program.md`、拟发布包和新版本专属操作单 | 本地或只读 CI 构建、隔离验证和材料审查；不因准备完成自动连接或切换生产 |
| 正式发布 | `../../../docs/pocketbase-release-program.md`，以及标为“待执行”且与 source、target、迁移和 `release.json` 完全匹配的操作单 | 仅在本次目标、版本、维护窗口和动作范围已明确批准后执行 |
| 故障恢复 | 当次状态文件、实际现场证据、匹配操作单和 deployment 记录 | 保持停写、只读判定结果，再按批准方案前向修复或回退 |
| 首次安装或 0.22.12 历史恢复 | 再读取 `../../../backend/deploy/1panel/README.md` | 仅用于该历史场景，不套入普通增量升级 |

`../../../backend/deploy/1panel/UPGRADE.md` 当前已标为完成，不是下一次发布操作单。缺少匹配且已审查的操作单时，只能准备和报告缺口，不能开始生产变更。

生产内容配置、真实玩家写入、账号初始化、密码重置、批量下发、删除和清理都需要另外匹配用户请求。

## 普通增量发布默认入口

无迁移，或只新增发布时为空且规则保持私有的集合时，使用 `../../../backend/scripts/release-pocketbase.mjs` 控制器和冻结进发布包的 `release-runner.py`，不得重新拼一组临时 SSH/Docker 命令替代相同检查。当前 `additive-empty-collections-v1` 不支持修改既有 schema/规则、数据回填、删除或重命名；遇到不支持的差异时停止，先增加受审 verifier 或新建专属流程，不能放宽计划绕过。

控制器只复用用户自己建立的 ControlMaster socket，并用必失败 ProxyCommand 阻止 socket 消失后新建 TCP/认证连接。`inventory` 只接受 pending 计划以及路径、字节都与当前 Git HEAD 一致的 runner；`preflight/stage/deploy/status` 只接受由同批 `SHA256SUMS` 锚定的 ready 计划与 runner。办公电脑不能使用 Docker 时，只能用手动、仓库只读、Action 固定完整 SHA 且出包前复核 clean checkout 的 `Build reviewed PocketBase release package` workflow；该 workflow 不是生产发布授权。

`stage` 和每次 `deploy` 都要求交互 TTY 精确确认。一次 `deploy` 最多推进 backup、migrate/no-migration、switch、finalize 中的一步；第一次危险阶段后服务保持停止，后续步骤必须重新核对状态并再次确认。systemd worker 可以在隧道断开后完成已经批准的当前步骤，但不会跨闸门。连接中断或结果未知时只运行 `status`，不盲目重试；`blocked` 后不得退回临时手工命令继续原发布。

## 正式发布的不变量

1. 获批进入停服、备份、迁移或切换后，首个生产变更前建立私密单向状态机：`prepared → backup-verified → (production-migrating → production-migrated | migration-not-required) → switching → verified → recorded`。任一阶段失败转入 `blocked` 并记录原因和证据哈希；纯只读检查不写状态。
2. 每个危险步骤前重检目标容器、实际 image ID、Compose 哈希、挂载、回环端口、迁移账本和冻结源码清单；早先 preflight 不是锁。
3. 同一份 `pb_data` 同时只允许一个 PocketBase 实例打开，生产保持 `--automigrate=false`，8090 不开放公网，也不停止其他 1Panel 应用。
4. 镜像 tag 不是不可变身份。发布包、固定摘要的 Linux AMD64 runtime、稳定读取的源码清单、内嵌 binary / hooks / migrations、实际 image ID 和 Compose 必须逐层核对；出包失败不得留下看似完整的最终目录。
5. 停写后备份完整 `pb_data`、实际 Compose 和匹配版本材料。只有独立解压、文件保真、SQLite 完整性、schema / 账本 / 脱敏摘要检查和目标镜像重启验证都通过，才能标记 `backup-verified`；迁移、no-migration、switch 和 finalize 前还必须重新验证备份归档、文件清单、大小、所有权及全部 SHA256，备份失效时不得继续写正式库。空间预检按真实 filesystem device 合并 upload、展开包、Docker 导入、备份、恢复和迁移工作量，必须保留冻结 reserve；停服后再按精确文件清单复算一次。
6. 正式迁移前先迁移恢复副本并按允许清单比较前后差异；正式库只运行一次已审查迁移。
7. 生产写入验收默认不属于只读发布验收。没有单独授权时，只做健康、认证边界、结构和脱敏摘要检查。
8. 服务健康并可能恢复真实流量后，既有业务行摘要允许变化；schema、迁移文件、迁移账本中每条历史记录的全字段摘要、表列、集合定义必须保持冻结，未激活的新表仍必须为空。不得只比较迁移文件名，也不得用停服快照严格相等误判正常写入或在有新写入后自动恢复旧快照。
9. 全新隔离空库首次 `serve` 可按版本化允许项处理 PocketBase 0.40.1 固定 installer system superuser；恢复副本和生产已有库出现新 installer 账号即闭锁。
10. 发布根固定在项目 `releases`，生产路径及 release/upload/backup 根的祖先不得经 symlink，必须 root-owned、不可被组或其他用户写入；跨发布全局锁和 active marker 按生产 dataHostPath 的 realpath 固定在持久目录 `/var/lib/questions-pocketbase-release-locks`，重启后仍须闭锁未决操作。正式停服后还要用 fuser 证明没有非 Docker 进程持有 SQLite。
11. 镜像 tag 每个危险阶段都要重新锚定冻结 image ID；迁移容器直接使用 immutable digest，切换先创建停止态 Compose 容器，核对运行参数、挂载、端口和安全策略后才能启动。健康门必须保持同一 container ID、零重启，并从 Docker `Health.Log` 观察至少三条不同且连续成功的真实探测记录，不能把重复轮询同一 `healthy` 状态当成稳定性证据。
12. 冻结计划、runner、压缩包和 sidecar 必须来自同一输出目录并通过外层校验；pending 盘点计划不能直接执行生产变更。计划审核、隧道登录、每阶段确认、故障决策和功能激活始终保留人工责任。
13. `stage` 在任何长耗时解包、Compose、镜像检查前，必须以原子 no-replace 方式发布 attempt marker 并持久消费上传会话；断线或失败保留 marker 人工诊断。phase 已前进但 stage/active marker 尚未删除仍是结果未知，不能报告成功。状态、最终根 metadata 等跨文件提交要留 intent/commit 或等价持久证据；`recorded` status 还要重验当前根 metadata 与清单全部成员，任何撕裂或事后漂移一律保守闭锁，不实现自动猜测恢复。

## 失败和结果未知时闭锁

命令非零、SSH 中断、退出状态未知、账本不符、部分 schema 出现、哈希漂移、镜像内容不符或恢复验证失败，都按故障处理。

1. 保持停写；若故障发生时尚未停写，只停止已确认的目标业务写入并保存现状。不能把“继续写入”当作选项。
2. 不自动重试 `migrate up`，不启动未经确认的新镜像，不运行 migration down，不删半成品表或账本，不自动用旧快照覆盖数据库。
3. 保存当前完整数据库状态、账本、schema、实际镜像、Compose 哈希和脱敏日志，再只读判断命令是否已经完整完成。
4. 只有证明库、Compose 和账本未变，并明确决定恢复原服务后才解除停写。迁移成功而应用失败时，优先只回退应用镜像并保留加性结构。
5. 产生新答题、经验、奖品、领取、核销或新功能数据后，旧快照不得覆盖当前库；优先前向修复。

## 按模式收尾

- 只读检查：只报告事实、差异和阻断，不修改 `current-production.md` 或服务器状态。
- 发布准备：报告包、目标架构、测试、操作单和授权缺口，不宣称已经上线。
- 正式发布：分别记录数据库、后端、玩家端、管理端、功能激活和生产写入验收；更新 `../../../docs/current-production.md`、根与后端 README、生产 Compose、功能状态，并新增不可改写的日期 deployment 记录。
- 故障恢复：保留现场和经批准的备份，记录决策与未恢复事项；不顺手删除旧镜像、数据或无关服务。
- 完成真实远程维护后关闭专用 SSH control socket；密码、令牌、答卷、柜码和领取信息不得进入聊天、仓库或日志。
- 用户本机维护脚本和 control socket 路径不属于发布源码；提交前明确排除未跟踪的本地入口文件。
