# Questions 游戏后端

2026-11-19 已完成场次订阅与 Push 分类后端发布。生产镜像为 `questions-pocketbase:0.40.1-push-subscriptions-20261119-amd64`；新增迁移 `1795075200_push_subscriptions.js`，三个新私有集合在验收时均为空。Push 总开关和订阅分类权益开关实际关闭。本次备份、迁移和检查结果见 [发布记录](../docs/harmony-push-subscriptions-deployment-20261119.md)，管理端、正式凭据与邀请包进度见 [当前生产状态](../docs/current-production.md)。

固定 PocketBase **0.40.1**，原生 JS hooks + SQLite 事务，无额外常驻 Node 服务。Node 24 仅用于开发、测试和部署辅助脚本。api.sitkin.top 代理到 `questions-game-v1` 的 127.0.0.1:8090，生产保持 `--automigrate=false`。下方 v1/v1.1 初始化步骤是历史参考，不得再次初始化现有库或对旧实例执行新迁移。

**日常开发两个前端不需要启动本目录的服务。** 在各自仓库根目录执行 `pnpm install --frozen-lockfile`、`pnpm dev` 即可，默认直接连接线上 API。以下隔离测试、Docker 和镜像发布仅供修改后端时使用，不是前端开发环境要求；页面上的写操作会影响线上真实数据。

本目录也承担生产后台数据库的版本化维护：`pb_hooks/` 随后端镜像发布，`pb_migrations/` 通过新的增量文件演进集合和索引。管理端静态 Action 不会发布这里的代码或数据库。统一边界见 [项目维护与发布边界](../docs/project-maintenance-and-release.md)，普通增量升级使用 [PocketBase 人工闸门发布程序](../docs/pocketbase-release-program.md)，生产预检、备份、迁移失败闭锁与回退必须遵循 [后端发布安全规范](../docs/backend-release-safety.md)。

2026-09-08 专属等级头衔与通用扩展配置后端已发布，三个新表保持为空。使用、协议和后续免加列的操作说明见 [扩展配置指南](../docs/extra-config.md)，验证记录见 [本次验收](../docs/extra-config-validation-20260908.md)。办公电脑上的 PocketBase 仅通过 Docker 运行，不直接启动本机二进制。

## 工程边界

| 目录                       | 用途                                                          |
| -------------------------- | ------------------------------------------------------------- |
| `pb_migrations/`           | 版本化业务集合和索引；基础 Push 与场次订阅的六个私有集合已迁移   |
| `pb_hooks/lib/api.js`      | `/api/questions/v1` 路由及输入边界                            |
| `pb_hooks/lib/gameplay.js` | 入场、判题、顺序、经验、奖励、线索                            |
| `pb_hooks/lib/admin.js`    | 内容版本、下发、现场干预与核销                                |
| `pb_hooks/lib/db.js`       | 事务、幂等命令、权限与审计                                    |
| `pb_hooks/lib/rules.js`    | 纯规则；Unicode 标准化与 JSVM 兼容                            |
| `contracts/game.ts`        | 两个前端共用的协议源文件                                      |
| `tests/`                   | 真实 PocketBase 集成测试与纯规则测试                          |
| `fixtures/demo.mjs`        | 仅含虚构人物和奖品的演示内容                                  |
| `deploy/`                  | 镜像和持久卷配置；不含业务数据或凭据                          |

玩家与工作人员使用独立认证集合。注册与直接写业务集合关闭；所有结算由服务器在事务内完成。请求 ID、唯一索引和经验流水防止双击、网络重试及并发重复发奖。填空题可按配置执行精确匹配或“包含全部关键词”，题目分组仅进入管理端目录；没有设置的旧题保持 `exact + 其他`。题面、答案和匹配模式继续受线上场次引用锁保护，分组可通过独立归类接口维护。功能激活和生产写入验收仍单独记录。

“全部用户”是下发时所有有效玩家的快照，不自动覆盖日后新建账号。同系列进行中的任务跳过；已完成默认跳过，勾选重新下发才创建新任务并再次正常获得经验、奖品。等级只在每次新任务首次入场检查。

## 可选：隔离后端测试（Docker）

仅在需要验证后端逻辑、迁移或打包镜像时使用。执行本节才需要安装并启动 Docker；以下命令均在本目录执行。演示不会随任一前端的 `pnpm dev` 自动启动。

```sh
# 按目标 CPU 二选一；Apple Silicon 本地为 arm64，服务器常见 amd64。
node scripts/prepare-runtime.mjs arm64
docker build --platform linux/arm64 -f deploy/Dockerfile -t questions-pocketbase:0.40.1-v1 .

# 测试自己创建、自己清理临时库，不使用现有数据库。
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1 node --test tests/*.test.mjs
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1 node scripts/verify-image.mjs

# 保持运行，终端输出后端地址及本地测试账号文件位置。
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1 node scripts/demo.mjs
```

下载脚本只取官方发布包，按代码中固定 SHA256 校验后解压；需要系统 `unzip`。不要混用 ARM 二进制与 x86 镜像。镜像内只有运行时、hooks 和 migrations，不包含测试夹具、私密导出、`.env` 或管理员密码。

### PocketBase 0.40.1 空库启动注意

隔离空库测试必须分别记录 migration 后首次 `serve` 前、首次 `serve` 后和第二次 `serve` 后的状态。PocketBase 0.40.1 在全新空库首次 `serve` 时可能创建固定的 installer system superuser；只允许在无公网的临时空库中把这一条版本化系统记录视为预期变化，同时要求 catalog 和全部业务数据不变，第二次启动全量稳定。

恢复副本和生产已有库不允许出现新的 installer 账号，发现时立即停止。升级 PocketBase 后重新验证该行为，不能把 0.40.1 特例泛化到其他版本。完整判定见 [后端发布安全规范](../docs/backend-release-safety.md#8-pocketbase-0401-空库启动特例)。

演示脚本生成随机密码并写入权限 600 的本地文件；它是**临时演示环境**，停止脚本即清理该库。长期测试应使用下面的独立持久卷方案。不要把生产账号、真实柜码写入 fixtures。

玩家端在 `questions-web` 启动：

```sh
VITE_POCKETBASE_URL=http://127.0.0.1:8090 pnpm dev --host 127.0.0.1
```

后台在本仓库根目录启动：

```sh
VITE_POCKET_BASE_HOST=http://127.0.0.1:8090 pnpm exec vite --host 127.0.0.1 --port 5189
```

将示例 8090 换为演示脚本实际输出的端口。两个变量仅在主动连接隔离实例时需要；普通开发和构建都默认线上 API。不能把本机 HTTP 地址打包到正式静态资源里。退出演示脚本会清理临时库；这些账号和数据不是线上内容。

## 正式环境状态

生产使用 `deploy/1panel/compose.production.yaml` 的回环 8090；`compose.yaml` 的 18090 仅用于历史隔离演练。场次订阅后端于 2026-11-19 11:36:51 +08:00 进入 `recorded`：新增迁移恰好一次，三个新私有表保持为空，同一容器三次不同健康检查成功且零重启，HTTPS 健康 200、三个未认证接口 401。本轮未配置正式发送凭据或开启总开关、订阅分类权益，也未执行生产业务写入验收。实际基线与后续验证见 [当前生产状态](../docs/current-production.md)。

以下均为首次替换部署的历史和后续演练参考，不代表当前版本或当前待办，勿再次初始化生产库。

### 后续增量发布入口

`scripts/release-pocketbase.mjs` 是本地控制器，`deploy/1panel/release-runner.py` 是冻结进发布包并由服务器执行的失败闭锁 worker。控制器只复用用户已打开的 SSH ControlMaster；它不需要本机 Docker，也不会保存密码或自动跨越人工闸门。`inventory` 使用 pending 计划只读盘点；出包后依次使用 `preflight`、`stage`、多次单阶段 `deploy` 和 `status`。完整参数、CI 出包和中断恢复规则见 [人工闸门发布程序](../docs/pocketbase-release-program.md)。

当前 v1 verifier 只接受无迁移或“新增且保持为空、保持私有的集合”这种加法迁移。修改既有结构/数据、破坏性迁移和历史 0.22.12 恢复不允许套用该程序；必须先增加经过审查的 verifier 或另写专属操作单。

## 独立持久实例与 1Panel 发布

2026-08-27 已由用户提供的容器配置与终端输出确认：旧服务为 PocketBase **0.22.12**，服务器 **x86_64 / linux/amd64**；启动命令 `/pb/pocketbase serve --http=0.0.0.0:8090`，工作目录 `/`，主机 `/opt/1panel/apps/pocketbase` 挂载到容器 `/pb`。Compose 位于 `/opt/1panel/docker/compose/pocketbase/docker-compose.yml`。目录列表已确认 `/pb/pb_data`、`/pb/pb_migrations`、旧二进制和旧版本 ZIP 存在。服务实际使用的数据库文件、其他集合使用方、代理网络和外部媒体位置仍需核实。

用户已确认没有其他项目共用并授权替换。现有域名 `api.sitkin.top` 的 `/` 代理到 `127.0.0.1:8090`，面板缓存关闭。新实例使用独立目录和端口，验收后切换现有域名，**禁止两个容器同时使用同一 `pb_data`**。不覆盖旧二进制，不把新 hooks/migrations 放入旧实例；跨越 [0.23 的不兼容变更](https://github.com/pocketbase/pocketbase/releases/tag/v0.23.0)，采用新空库复配内容，旧库的备份恢复演练使用匹配的 0.22.12。

此次具体配置与备份、上传、初始化和回退步骤见 [1Panel 操作单](deploy/1panel/README.md)，使用 `deploy/1panel/compose.yaml`：新容器 `questions-game-v1`，新目录 `/opt/1panel/apps/questions-game-v1/pb_data`，仅监听 `127.0.0.1:18090`，离线镜像禁止自动拉取。初始化完成不等于可以切换，必须先准备账号、内容和两个前端。

开发机可重复生成已校验的离线发布归档（输出目录必须尚不存在）：

```sh
node scripts/package-1panel.mjs /absolute/new-release-directory
```

打包脚本会校验镜像架构、运行时版本和内嵌业务代码，导出 AMD64 镜像，写入校验文件，再解压实际产物验证。只包含镜像、Compose、操作单和发布元信息，不包含 `pb_data`、真实内容、凭据或前端构建。此脚本在开发机运行，服务器安装不需要 Node。

为已确认的服务器架构构建独立标签，不覆盖本机 ARM64 演示镜像：

```sh
node scripts/prepare-runtime.mjs amd64
docker build --platform linux/amd64 -f deploy/Dockerfile -t questions-pocketbase:0.40.1-v1-amd64 .
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1-amd64 node --test tests/*.test.mjs
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1-amd64 node scripts/verify-image.mjs
```

`deploy/runtime` 一次只存放一种架构；再次构建 ARM64 前须重新执行对应下载命令。在 Apple Silicon Docker 上运行 AMD64 测试属于模拟执行，不能替代实际服务器上的发布验收。

该 AMD64 镜像已在本机通过 18 项后端测试及内嵌代码的空库迁移、认证、重启和停写复制恢复验证。发布包已由用户上传至服务器，内部 SHA256 全部通过；服务器 Compose 为 v2.24.5。用户提供新实例迁移成功、容器启动、回环映射 18090 和健康接口 200 的输出；尚未完成管理员、内容和业务验收，旧代理未切换。旧库归档下载及旧容器重启已由用户确认，真实归档恢复仍未核验。

新超级管理员可使用补充脚本 [create-superuser.sh](deploy/1panel/create-superuser.sh)，上传后在可信的服务器交互终端执行 `sh create-superuser.sh`。密码由容器子 shell 隐藏读取，不写入宿主机命令或历史，但原生 CLI 仍会通过短时进程参数接收密码，因此不可用于不可信的共享主机。脚本已验证特殊字符密码可登录、重复创建不会覆盖原密码；它不创建业务 `game_admins`，也不修改已发出的镜像归档。

1Panel Compose 模板也已在本地隔离目录及随机端口演练，验证健康检查、22 个集合迁移、认证边界和重启持久化。随机端口在 Docker 重启后可能变化，测试需重新读取映射；正式模板固定为 18090，不受该测试地址变化影响。

`deploy/compose.yaml` 的 `./pb_data` 是相对该 Compose 文件的示例目录，不能误指到旧正式库。该文件还不是本次上线的最终配置：正式配置需选择已验收的 `questions-pocketbase:0.40.1-v1-amd64` 镜像，并另行确认端口与代理连通方式。镜像需先构建或在 1Panel 导入同架构镜像；如需传输，可在本机 `docker save`，服务器 `docker load`。不要将凭据写入镜像或提交仓库。

```sh
# 仅对已经确认的空库/隔离副本执行。自动迁移默认关闭。
docker compose -f deploy/compose.yaml run --rm pocketbase migrate up --dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --automigrate=false
docker compose -f deploy/compose.yaml up -d
```

首次实例可通过受保护的本地维护入口完成超级管理员初始化。业务管理端使用 `game_admins`，**不使用超级管理员令牌**。通过安全的临时环境注入以下变量，然后运行 bootstrap；不把实际密码贴进聊天、命令历史、构建日志或前端环境：

| 变量                                                   | 用途                              |
| ------------------------------------------------------ | --------------------------------- |
| `PB_URL`                                               | PocketBase 根地址，远程须为 HTTPS |
| `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD`         | 一次性管理脚本认证                |
| `QUESTIONS_ADMIN_ACCOUNT` / `QUESTIONS_ADMIN_PASSWORD` | 新业务管理员的账号密码            |

```sh
node scripts/bootstrap.mjs
node scripts/configure-security.mjs
# 核对输出规则及其他应用影响后才应用；远程额外加 --allow-remote。
node scripts/configure-security.mjs --apply
```

bootstrap 创建业务管理员，不重复运行来重置已有账号。登录限速脚本保留已有规则；如果旧实例原来关闭限速，启用时也会激活那些规则，必须先审查。玩家登录每 IP 每分钟 30 次、后台 20 次、改密 5 次；现场共享 Wi-Fi 需结合实际人数监测并调整。答题另有每任务服务端频率限制。代理的 trusted headers 不由脚本猜测修改，应确认反向代理覆盖客户端伪造的转发头后再配置。API Settings 的定义见 [PocketBase 官方说明](https://pocketbase.io/docs/api-settings/)。

正式入口需要 HTTPS、受限超级管理员入口、头像上传大小与代理超时匹配；容器默认只向 localhost 映射 8090。若 1Panel 代理运行在其他容器，应通过明确的私有网络连通，不能盲目将数据库管理端口暴露公网。

当前管理端 GitHub Actions 保留 push 到 main 自动部署静态文件，玩家端保留 push 后发布预览、正式版手动发布。API 默认线上地址，可选变量 `QUESTIONS_POCKETBASE_URL` 用于覆盖，迁移开关 `QUESTIONS_BACKEND_V1_READY` 已移除。后端测试 CI 只在后端文件变化时独立运行，不阻塞单纯的管理端静态发布，也不会自动更新生产容器。工作流修改需提交并 push 后才会在 GitHub 执行。

发布顺序：完整备份 → 隔离恢复验证 → 后端迁移与 hooks → 建业务管理员及限速 → 导入并复核草稿 → 两个前端构建 → 测试账号验收 → 维护窗口切换。前端 CI 不代替后端验收。

## 备份与回退

当前已验证镜像内嵌代码的空库迁移、容器停止/重启、**停写后复制整个数据目录到另一个目录**并恢复账号和业务记录。该演练使用本地虚构数据，不代表已经备份或恢复过线上数据。

正式切换前：

1. 停止旧业务写入，保存完整 `pb_data`、匹配的二进制/hooks/migrations、配置及密钥依赖，记录版本和校验值。
2. PocketBase 内置备份也可使用，但必须将对应归档实际恢复到隔离实例验证。禁止只复制运行中的单个 SQLite 文件；可能遗漏 WAL、附件和设置。
3. 外部 AList/CDN/S3 媒体不在本地数据库目录备份范围，需单独保留。旧题目 JSON 导出也**不是**完整数据库备份。
4. 正式库已有新答题/核销后，先暂停业务、保存新库快照并核对奖励与经验。不能直接拿旧备份覆盖已核销记录；优先前向修复。

迁移的 down 明确拒绝破坏性删除；回退使用经演练的整套版本与快照。参考 [官方部署与备份说明](https://pocketbase.io/docs/going-to-production/)。

## 旧内容复配

原始导出、转换 JSON 和真实媒体链接均留在本机私密备份目录，不纳入 Git。

```sh
node scripts/convert-legacy.mjs /absolute/private-backup-directory
PB_DOCKER_IMAGE=questions-pocketbase:0.40.1-v1 node scripts/verify-content.mjs /absolute/private-backup-directory/converted-game-v1.json

# 事先安全设置业务管理员环境变量；默认只生成草稿。
node scripts/import-content.mjs /absolute/private-backup-directory/converted-game-v1.json
```

远程导入需要 HTTPS 和显式 `--allow-remote`；`--publish` 仅在人工复核后使用。相同输入文件重复导入复用幂等键；**修改文件后是新批次，会新建内容，不是覆盖旧记录**。转换会规范化包含空格的媒体 URL、重建 Letter/Bless 关联；不迁移旧用户名、头像、等级、时间窗。经验暂设每题 50，不推断真实奖品规则或个人领取信息，须在后台复核后发布。转换不验证远程媒体永久可用性或授权范围。

公开题图/BGM 可继续使用 AList；柜码、个人取件信息只写到具体玩家奖品的领取信息。把私密文件上传到公开 CDN 后，即使数据库隐藏链接也无法撤销已泄露的 URL；这类素材应另用受保护存储，当前不提供外部 CDN 私有文件授权代理。

## 维护与验收

修改协议后执行 `node scripts/sync-contracts.mjs`；同步两端时，两个仓库须保持相邻目录。只检出管理端的 CI 使用 `node scripts/sync-contracts.mjs --check --admin-only`，不要求另一个仓库存在。业务规则在 `rules.js` / `gameplay.js` / `admin.js` 维护，页面不得另算经验、通过状态或领取权益。新增迁移使用新文件，不修改已执行迁移。

管理员操作顺序：等级 → 题目/叙事草稿 → 题目分组与匹配模式 → 发布 → 题目通用线索 → 场次编排 → 发布 → 创建玩家 → 下发 → 实时进度 → 奖品核销。题目归类、通用线索与已发布场次展示修改都必须填写原因并通过版本指纹防并发覆盖。所有现场干预必须填写原因，误核销用撤销核销保留审计，不删除原奖品记录。

目前后台列表按小规模现场运营取全量后分页。若后续积累大量历史记录，优先补服务端分页、归档与查询索引；现阶段不支持多机构租户、库存预占、物流发货或柜机自动开锁。
