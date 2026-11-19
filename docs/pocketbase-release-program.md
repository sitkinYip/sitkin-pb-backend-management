# PocketBase 人工闸门发布程序

本程序把普通 PocketBase 增量发布拆成“只读盘点、冻结制品、上传、逐阶段批准、只读验收”五段。它自动执行可重复验证的机械工作，但不会代替人决定目标、迁移允许差异、维护窗口、故障恢复或功能激活。

发布控制器在办公电脑上只需要 Node.js、仓库代码和用户已经建立的 SSH ControlMaster 连接；真正的 Docker 构建可在有 Docker 的电脑或 GitHub Actions 完成，部署时不要求办公电脑运行 Docker。本程序不会创建登录密钥、保存密码、创建 SSH 隧道、commit、push、部署两个前端或写入生产业务数据。

## 自动化边界

程序自动完成：

- 只读采集服务器身份、当前镜像、Compose、根发布材料、迁移账本和磁盘空间；
- 严格校验待审计划、允许迁移差异、操作单标记、镜像平台、运行时版本、源码摘要和两层 `SHA256SUMS`；
- 建立私密上传会话并上传冻结包；
- 停止唯一目标服务，完整备份 `pb_data`、Compose、根 `release.json` 和根校验清单；
- 独立解压备份，逐文件验证，在恢复副本上迁移并连续启动两次；
- 对受支持的迁移比较 SQLite schema、迁移账本、集合、行数和不暴露业务明文的摘要；
- 对正式库执行一次显式迁移，原子替换 Compose 中唯一的镜像字段，验证容器、挂载、回环端口、健康和未登录 401 边界；
- 记录不可跳步的状态、事件哈希链、备份证据和最终发布报告。

人仍然负责：

- 审查 source/target、服务器身份、迁移文件和物理 schema 允许清单；
- 把 `UPGRADE.md` 改成与本次版本完全匹配的待执行操作单；
- 选择已审查的 Git revision 出包，并核对下载制品摘要；
- 打开密码登录隧道、安排停写窗口，并在每个危险阶段输入当场生成的完整确认短语；
- 处理任何 `blocked` 或结果未知，不凭猜测重试；
- 另行决定前端发布、功能激活、生产写入验收、文档更新、commit 和 push。

因此，稳定路径大约 80%–90% 是程序化的，剩余部分刻意保留为人工闸门。

## 两份计划和一份操作单

发布准备使用三份可审查输入：

1. 从 `backend/deploy/1panel/release-plan.example.json` 复制本次 `release-plan.json`。它必须保持 `schemaVersion: 1`、`status: "pending"`，记录准确的服务器、source、target、迁移和只读探针。
2. 从 `backend/deploy/1panel/allowed-delta.example.json` 复制本次 `allowed-delta.json`。无迁移时四个数组都为空；有迁移时必须逐项列出新迁移、新私有集合、新 SQLite schema object 和发布时必须为空的表。
3. 完整替换 `backend/deploy/1panel/UPGRADE.md`，并且只出现一次以下机器标记：

   ```text
   <!-- release-status: pending -->
   <!-- release-id: 与计划一致 -->
   <!-- source-image: 与计划一致 -->
   <!-- target-image: 与计划一致 -->
   ```

输入计划不能直接部署。出包程序验证三者和代码、镜像完全一致后，才生成 `schemaVersion: 2`、`status: "ready"` 的 `deployment-plan.json`。后续可变命令只接受这份冻结计划、包内执行器和外层校验清单。

`releaseId` 长度为 8–64 个安全字符；`healthTimeoutSeconds` 为 90–1800 秒，并至少配置一个非健康接口、预期 401 的认证边界探针。`releaseRoot` 固定为项目目录下的 `releases`；release/upload/backup 根及现有祖先必须由 root 持有且不可被组或其他用户写入，叶目录进入发布后收紧为 0700。服务器还需要 Python 3.6+、Docker Compose、systemd-run 和 fuser；缺少任一项都只报告 blocker。

预检不是只看一个 `minimumFreeBytes` 数字。runner 会按 filesystem device 合并上传包、展开目录、Docker layer/snapshot 导入、完整备份、独立恢复和迁移工作区的最坏写入量，再叠加计划中的保留空间；正式停服并取得精确文件清单后还会复算一次。共享同一磁盘的多个路径只保留一份 reserve，但所有预计写入会累加，空间不足直接闭锁。

verifier `additive-empty-collections-v1` 仍只支持没有新迁移，或只新增发布时为空且规则保持私有的新集合及其 schema object。

2026-11-19 增加专属 verifier `personal-journey-context-v1`，仅接受 `1795075320_push_personal_journey_notices.js`。它只允许 `game_push_notice_contexts.session.required` 从 true 改 false、末尾新增指定的 required 单选 `kind`（值及顺序为 `session`、`account`），并把全部历史行的 `kind` 回填为 `session`；集合生成的 `updated` 时间允许正常前进，其余字段、规则、索引及集合元数据不变。SQLite CREATE TABLE 必须是原语句精确追加该列；原三列的类型、顺序和所有行的全字段投影摘要必须不变。其他业务表、系统表、schema object、集合及历史迁移账本仍沿用严格不变校验，不是通用字段更新或数据回填豁免。对应 `allowed-delta.personal-journey.json` 的三个新增对象数组为空，`contextEvolution` 必须等于固定常量。恢复演练与正式迁移仍分别验证；switch 后新建的 account 来信属于正常业务行变化，不再用停服行摘要锁住在线库。

已启用正式 Push 的本次源环境可显式填写 `production.pushRuntime`，其 `profile` 只能为 `harmony-push-production-v1`，另含既有 `projectId`、固定 `secretHostPath`/`secretContainerPath` 和 `recordedComposeSha256`。它只支持本项目现有专用密钥从 `/opt/1panel/secrets/questions-game-v1/starward-harmony-push.json` 只读挂到 `/run/secrets/starward-harmony-push.json`，同时严格保留 ENABLED=1、TEST_MODE=0、SUBSCRIPTION_APPROVED=0 及既有项目/文件路径五项环境变量。数据挂载仍可写；不允许第三个挂载、自动创建宿主路径、别的密钥路径、可写密钥或新增 Push 环境变量。密钥只核文件类型、所有者、权限、路径及单硬链接，不读取内容，也不进入发布包或备份。未声明该 profile 的历史计划仍只允许原数据挂载和无 Push 环境。

`source.composeSha256` 始终锚定盘点时的真实 Compose。若独立配置启用后旧根校验清单仍记录启用前 Compose，`recordedComposeSha256` 只精确锚定这一个历史清单值；实际源 Compose 仍必须逐字匹配 `source.composeSha256`，根清单其余成员照常逐字校验。正常 finalize 写新根记录前保留旧根材料，其历史归档不修改。恢复副本、迁移及隔离 serve 容器均只有自己的数据挂载、`network=none`，不会挂正式密钥或传入 Push 环境；镜像自身也禁止烘焙任何 `STARWARD_PUSH_*` 环境变量。保留已有生产配置不等于本轮激活订阅分类，`executorMayActivate` 仍为 false。

其他修改既有字段/索引/规则、回填或删除数据、重命名、破坏性迁移仍须先实现并审查新的 verifier 或使用新的专属人工操作单；不能放宽 JSON 来绕过闭锁。

## 1. 只读盘点

先用用户自己的 `server.command` 建立 ControlMaster，并保持窗口打开。控制器只复用这个 socket，不会在失效时退回密码、密钥或新的普通 SSH 登录。

在仓库根使用绝对路径运行：

```sh
pnpm release:pocketbase inventory \
  --socket /private/tmp/questions-deployment-ssh-SESSION/control \
  --plan /absolute/repo/backend/deploy/1panel/release-plan.json \
  --runner /absolute/repo/backend/deploy/1panel/release-runner.py
```

`inventory` 是唯一接受 pending 计划的命令，也只能执行路径和字节都与当前 Git `HEAD` 完全一致的 runner；未提交、已暂存但尚未进入 HEAD 或工作树被修改的 runner 都拒绝远端执行。把输出中的实际 hostname、machine-id 摘要、image tag/ID、Compose 和根发布材料摘要、迁移账本以及迁移文件集合人工核回计划；任何无法解释的差异都先停止。

## 2. 在有 Docker 的环境冻结制品

有 Docker 的电脑可在仓库根运行：

```sh
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-<release-id>-amd64 \
node backend/scripts/package-1panel.mjs \
  /absolute/new-release-output \
  --upgrade \
  --plan /absolute/repo/backend/deploy/1panel/release-plan.json \
  --allowed-delta /absolute/repo/backend/deploy/1panel/allowed-delta.json
```

输出目录必须事先不存在。程序先在目标同一父目录的隐藏临时目录生成并验证全部文件，只有包内和外层校验都通过才一次 rename 为最终目录；失败不会留下外观完整的交接目录。最终目录包含压缩包及 `README.md`、`release.json`、`deployment-plan.json`、`allowed-delta.json`、`release-runner.py`、`SHA256SUMS` sidecar，不得只拿压缩包而丢掉同批 sidecar。出包还固定核对官方 Linux AMD64 runtime 二进制摘要，并在镜像校验前后及最终交付前复核源码清单没有变化。

办公电脑不能运行 Docker 时，提交并审查本次 `release-plan.json`、`allowed-delta.json` 和 pending `UPGRADE.md`，然后在所选 Git revision 手动运行 GitHub Actions 的 **Build reviewed PocketBase release package**。输入必须是计划中的完整 target image tag。该 workflow 只有 `contents: read`，第三方 Action 固定完整 commit SHA，并在测试后重新证明 checkout 没有 tracked/untracked 漂移；它构建、测试、出包并上传短期 artifact，不含生产凭据，也不会连接或部署生产。下载同一次 run 的完整 artifact 后，先核对 Actions 显示的 artifact digest，再在解压目录执行：

```sh
shasum -a 256 -c SHA256SUMS
```

## 3. 只读预检与上传

下面用同一制品目录反复运行；所有参数都必须是绝对路径。先执行只读 preflight：

```sh
pnpm release:pocketbase preflight \
  --socket /private/tmp/questions-deployment-ssh-SESSION/control \
  --plan /absolute/release-output/deployment-plan.json \
  --runner /absolute/release-output/release-runner.py \
  --bundle /absolute/release-output/questions-pocketbase-<version>-<release-id>-amd64-upgrade.tar.gz \
  --checksums /absolute/release-output/SHA256SUMS
```

通过后运行相同参数的 `stage`。它会先再次 preflight，展示目标和影响范围，要求 TTY 中逐字输入 `STAGE ...` 短语，随后创建私密上传会话、传输并在服务器重新验证外层归档、包内成员、镜像、源码和候选 Compose。服务器在解包、Compose 渲染、镜像 archive 检查等长耗时步骤之前，先用原子 no-replace 标记独占本次 stage 并持久消费上传会话；并发请求只有一个能成功，断线或后续校验失败会保留 marker 要求人工诊断。该阶段还会执行 `docker load`，并创建、启动、检查和删除隔离验证容器，因此会改变主机镜像/临时容器状态；但不停止生产服务、不迁移数据库、不改 Compose，也不切换生产镜像。

## 4. 每次只批准一个危险阶段

`deploy` 使用与 `preflight` 完全相同的参数。每次调用最多推进一个阶段，并在真正提交前再次读取 revision 和 phase：

```text
prepared
  → backup-verified
  → production-migrated | migration-not-required
  → verified
  → recorded
```

- 第一次 `deploy` 执行完整停服备份和恢复副本演练。目标服务从这里开始保持停止，直到后续 switch 成功；不要把各次人工确认之间的时间遗漏在维护窗口估算里。后续 migrate/no-migration、switch 和 finalize 都会重新计算备份归档、文件清单及 sidecar 的摘要；备份被删、被替换或损坏会直接闭锁。
- 第二次执行正式 `migrate`，或明确确认 `no_migration`。
- 第三次只切换 Compose 镜像并验证运行服务。程序先用 `compose up --no-start --pull never` 创建停止态容器，确认实际 image ID、运行参数、计划中精确的数据／专用只读密钥挂载、回环端口和安全策略，再启动服务；同一 container ID、零重启且 Docker `Health.Log` 中至少三条不同的连续成功探测记录出现后，才算稳定健康。服务健康后可能立即恢复真实流量，因此验证锁定 schema、迁移账本文件及每条历史账本记录、集合定义和未激活空表；既有业务表的行摘要允许随真实请求变化，不能因此误判发布失败。
- 第四次写入最终报告并同步根 `release.json`、根 `SHA256SUMS`，不做业务功能激活。根目录两份材料无法在普通文件系统中一次替换时，会先写不可变 finalize intent，替换并复核两份目标后再写 commit 证据；中途断电不会被误报完成，而是由持久 active marker 保持闭锁。

每次都会显示本阶段动作并要求不同的完整确认短语。程序没有 `--yes`、`--force`、一次跑完或自动跨闸门模式。

## 5. 中断、状态和失败闭锁

服务器危险阶段通过一次性 systemd worker 运行，所以隧道中断不会杀死已获批的当前阶段，但 worker 绝不会自动开始下一阶段。按真实 `pb_data` 路径生成的 active marker 保存在 root 私有的 `/var/lib/questions-pocketbase-release-locks`，服务器重启也不会让另一个 releaseId 绕过未决操作。状态文件与事件日志若恰在两次持久写之间断电，`status` 会保守显示 `blocked / outcome unknown`，不会因自身报错而诱导重试。单次 RPC 最多预留 35 分钟，`deploy` 可持续观察已经批准的 worker 最多 2 小时；超过观察时间不代表 worker 被取消。发生连接中断、超时或客户端看不到确认结果时，不要再次运行 `stage` 或 `deploy`。重新建立同一路径的 ControlMaster 后先执行：

```sh
pnpm release:pocketbase status \
  --socket /private/tmp/questions-deployment-ssh-SESSION/control \
  --plan /absolute/release-output/deployment-plan.json \
  --runner /absolute/release-output/release-runner.py \
  --checksums /absolute/release-output/SHA256SUMS
```

`status` 不需要再次上传 bundle。phase 已前进但 stage/active marker 尚未持久删除，仍按结果未知处理；控制器不会把这个极短崩溃窗口误报成成功。只在它明确显示前一阶段成功、没有 `inFlight`、没有任何未决 marker 且 `nextOperation` 与计划一致时，才重新发起下一次 `deploy`。`recorded` 也不是无条件快路：状态读取会重新核对 finalize intent/commit、当前根 `release.json`、根 `SHA256SUMS` 及清单中的每个成员，记录后发生漂移会保守报告闭锁。

任一异常都会进入 `blocked` 或保留结果未知标记。程序不会自动重试 migration、删除容器/表/账本、运行 migration down、恢复旧快照或回退镜像。此时保持停写，保存 state、事件、systemd journal、当前数据库/Compose/容器证据，按 `docs/backend-release-safety.md` 单独审查恢复方案。生产已经恢复流量或产生新业务写入后，旧备份不能覆盖当前库。

## 完成不等于全部发布

`recorded` 只表示此次 PocketBase 后端机械发布阶段完成。还需按兼容矩阵分别确认玩家端、管理端、功能激活和生产写入验收，并更新 `docs/current-production.md`、长期 README、生产 Compose 模板和新的日期 deployment 记录。最后由用户关闭专用 ControlMaster；不要把本地 `server.command`、socket、密码、令牌或业务数据提交到仓库。
