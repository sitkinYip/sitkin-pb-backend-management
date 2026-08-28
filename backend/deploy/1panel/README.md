# 1Panel 替换部署操作单

适用服务器已确认：Linux x86_64；旧 PocketBase 0.22.12；只有本答题项目使用。用户已授权替换部署。

这份文件是操作单，不是已完成记录。发布包不含账号密码、测试库、真实题目或前端构建产物；导入镜像也不等于已上线。

## 已完成的正式部署（2026-08-28）

最新后端已更新为 `questions-pocketbase:0.40.1-session-offline-20260828-amd64`，包含场次下线、题库编辑限制及 2MB 审计迁移，见 [正式发布记录](../../../docs/session-offline-deployment-20260828.md)。现有实例升级使用 [升级操作单](UPGRADE.md)，下文首次安装与 v1.1 步骤保留作历史参考，不得重建或重导当前生产库。

新容器已接管 `127.0.0.1:8090:8090`，旧容器停止并取消自动重启，服务器 18090 已关闭。生产模板为 `compose.production.yaml`；下文 `compose.yaml` 保留 18090 隔离演练用途，不要直接覆盖当前生产配置。玩家为 https://sitkin.top/questions/，管理后台为 https://vae.sitkin.top/。

生产还关闭了空的默认 `users` 认证集合注册。维护脚本 `lock-unused-auth.pb.js` 在确认该集合为空后才关闭 createRule；需先备份、停止服务，用独立 `--hooksDir` 挂载本脚本后执行 `questions-lock-unused-auth`，再启动服务。不要将维护命令挂载到在线 hooks，不得对已有其他项目账号的集合执行。登录限速和可信代理也属于实例配置，恢复旧快照时需复查。

## 已初始化实例升级到 v1.1

v1.1 修正 PocketBase 密码字符边界：最多 71 位字符，同时保持 UTF-8 最多 72 字节。原 v1 镜像在 72 位英文密码下会返回 500。两个前端的密码输入上限也已对齐，答题页视觉未改。

如果服务器已经创建账号、导入 27 道题和 31 个场次，**不要重新初始化、覆盖或删除 `pb_data`，不要再次创建超级管理员，不要重复导入一份修改过的内容文件**。先备份已导入的新库，再导入新镜像、更新现有 Compose 的镜像 tag 并重建新容器；数据库挂载路径保持不变。此更新没有新增数据库迁移。

关闭临时验证端口需在最终切换时执行：停止旧 `pocketbase` 并取消其自动重启，将新容器唯一的主机映射改为 `127.0.0.1:8090:8090`，保持现有 API 代理目标不变，验收后确认服务器 18090 不再监听，再关闭 Mac 的 19090 SSH 隧道。**此流程尚需核对代理网络、部署两端前端、启用登录限速并完成旧备份恢复验证；不要仅因为镜像已构建就执行切换。** 不停止其他应用容器，不把 8090 绑定到公网。

## 路径与边界

| 项目       | 旧服务（保留）                  | 新服务                                   |
| ---------- | ------------------------------- | ---------------------------------------- |
| 容器       | `pocketbase`                    | `questions-game-v1`                      |
| PocketBase | 0.22.12                         | 0.40.1                                   |
| 主机目录   | `/opt/1panel/apps/pocketbase`   | `/opt/1panel/apps/questions-game-v1`     |
| 数据目录   | 原目录内 `pb_data`              | 新目录内 `pb_data`                       |
| 主机端口   | 8090                            | 仅 `127.0.0.1:18090`                     |
| 镜像       | 原 `alpine:latest` + 挂载二进制 | `questions-pocketbase:0.40.1-v1.1-amd64` |

不要将新数据目录指向旧 `pb_data`，不要给旧容器上传新 migrations，不删除旧容器或旧目录。新端口若被占用，停止操作，不停用占用它的其他服务。

## 1. 备份旧服务

这一阶段会短暂停止答题 API，选择无人使用的时间。只操作 `pocketbase`，不停止 OpenResty 或其他容器。

1. 在 1Panel 容器页停止旧 `pocketbase`，确认状态已停止。
2. 在文件管理中将完整 `/opt/1panel/apps/pocketbase` 压缩到新建的私密备份目录，例如 `/opt/1panel/backups/questions-before-v1-日期时间/`。不要只压缩 `data.db`，不要把备份放到网站根目录，也不要把归档生成在被备份的目录里。
3. 另外保存 `/opt/1panel/docker/compose/pocketbase/docker-compose.yml`、1Panel 当前 `api.sitkin.top` 的完整主配置与 `root` 代理源文。保留文件权限；备份目录仅管理员可读。证书私钥不贴到聊天，也不上传公开位置。
4. 确认压缩成功、文件大小非零后重新启动旧 `pocketbase`，确认旧后台仍可打开。将备份下载一份到自己的电脑安全保存。

这只是创建备份；切换前还要将归档解压到另一个隔离目录，以匹配的 0.22.12 启动检查表、附件和后台登录。恢复副本不能使用新版本，不共用旧目录，不对公网开放。已有真实 JSON 内容导出不能代替完整备份。外部 AList/CDN/S3 媒体需另行保留，不包含在本机 SQLite 备份内。

## 2. 上传发布包并校验

在 1Panel 文件管理中新建 `/opt/1panel/apps/questions-game-v1`。如果该目录已经有内容，先停下核实，不覆盖。

把发布归档上传到这里并解压。归档顶层包含：

- `pocketbase-image.tar`：离线 Docker 镜像，不含业务数据。
- `compose.yaml`：新实例配置。
- `release.json`：版本、架构、镜像内容标识。
- `SHA256SUMS`：上述文件与本操作单的校验值。
- `README.md`：本操作单。

后续命令在 **1Panel 的服务器终端**执行，不是在 PocketBase/OpenResty 容器终端执行：

```sh
cd /opt/1panel/apps/questions-game-v1
sha256sum -c SHA256SUMS
docker compose version
ss -ltn '( sport = :18090 )'
```

校验全部为 OK、Compose 可用、18090 没有监听者后继续。命令找不到或输出不符合预期就停止，不盲目安装软件或换端口。离线镜像不需要 Docker Hub 账号或镜像仓库访问。

## 3. 导入镜像并初始化独立空库

首次安装前确认没有名为 `questions-game-v1` 的容器，并且新目录没有 `pb_data`。`mkdir` 不加 `-p`，若已存在则中止核实，不删除或清空它。

```sh
docker load -i pocketbase-image.tar
docker image inspect questions-pocketbase:0.40.1-v1.1-amd64 --format '{{.Os}}/{{.Architecture}} {{.Id}}'
docker run --rm --network none questions-pocketbase:0.40.1-v1.1-amd64 --version
mkdir -m 700 pb_data
docker compose --env-file /dev/null -f compose.yaml config --quiet
```

镜像必须显示 `linux/amd64`，运行时必须显示 `pocketbase version 0.40.1`。不同 Docker 引擎的镜像 ID 可能表示索引或配置摘要，不能仅因 ID 表示不同判定损坏；以归档 SHA256、架构和版本核验为准，`release.json` 保留两种摘要用于排查。逐条运行下面命令，前一条报错时不要继续；迁移失败保留目录供排查，不重复创建空库或自动删库。

```sh
docker compose --env-file /dev/null -f compose.yaml run --rm --no-deps pocketbase migrate up --dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --automigrate=false
docker compose --env-file /dev/null -f compose.yaml up -d
docker compose --env-file /dev/null -f compose.yaml ps
curl --fail --silent --show-error http://127.0.0.1:18090/api/health
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:18090/api/questions/v1/admin/me
```

健康检查应成功，未登录访问业务接口应返回 401。401 仅证明接口及登录边界存在，不代表数据、账号、权限和业务流程已经验收。

**到这里先停下，不能把线上代理切过去。** 新实例尚无生产管理员、题目和玩家。新端口只绑定服务器回环，不要为了访问方便开放到公网。

## 4. 初始化与验收（协作完成后再切换）

通过受保护的维护入口建立超级管理员和业务 `game_admins`，不用测试密码；密码由用户私下设置，不放入命令历史、发布包、截图或前端。配置登录限速，核实代理 IP 头、头像大小限制及超时。

导入已保存的 27 道题、4 份叙事和 31 个场次，复核经验、等级、奖品、领取说明后发布，不导入本地测试账号或假核销记录。准备分别指向正式 API 的玩家端 `/questions/` 构建和管理端构建；当前离线包不包含这两个前端，不能只更换后端却保留旧前端继续营业。

在隔离入口验证两名玩家的建号、改密、下发、答题、经验、线索、奖品核销和再次下发。检查当前答题 UI 未变。已有本机测试不能代替这些服务器验收。

在 OpenResty 容器内部验证可以请求新目标 `http://127.0.0.1:18090/api/health`；如果不通，先核查网络模式，不盲目改成公网监听。面板中旧目标是回环地址，但截图不能证明容器实际网络模式。

## 5. 切换与回退

所有检查通过后安排维护窗口，保留旧前端发布目录副本、最终旧库快照及旧代理源文。

将 `api.sitkin.top` 的现有 `root` 代理目标从 `http://127.0.0.1:8090` 改为 `http://127.0.0.1:18090`，保持缓存关闭；核对完整 location 的头、TLS、限速和上传配置，经配置检查成功后加载。同步发布匹配的两个前端。原域名和 HTTPS 入口不变。

验收真实 HTTPS 下的登录、权限隔离、答题、媒体和核销，确认后才停止旧 `pocketbase`。保留旧容器、镜像、目录及备份，不自动清理。

如果尚无新的真实答题/核销，可恢复旧代理目标、旧前端并启动旧容器完成回退。如果已经产生新业务记录，先暂停新业务并保存整个新库，核对经验和核销记录后处理；不能直接用旧备份覆盖新业务记录。回退前后均应重新验证入口。

参考：[PocketBase 部署与备份](https://pocketbase.io/docs/going-to-production/)、[Docker Compose 服务配置](https://docs.docker.com/reference/compose-file/services/)。
