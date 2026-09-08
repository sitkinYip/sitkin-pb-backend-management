# 专属等级头衔与扩展配置后端发布记录

日期：2026-09-08。用户要求通过已有维护隧道发布本次数据库和 PocketBase 后端，两个前端由用户自行 push 触发自动部署。本次已完成只读盘点、制品冻结、上传验证、停服备份、恢复副本演练、正式迁移、镜像切换和只读验收。未提交或推送代码，未发布两个前端，未下发生产头衔或扩展配置，未执行真实业务写入验收。

本文记录本次发布完成时的事实。后续状态见 [当前生产状态](current-production.md)，功能使用见 [扩展配置指南](extra-config.md)。

## 生产版本与材料

- releaseId：`extra-config-player-titles-20260908`，最终 phase=`recorded`、revision 15，无 inFlight、无 active marker、无 blocked。
- Git HEAD：`c411d95fc593731ab5b32059efde2b302278651d`，发布包含尚未提交的工作区后端源码；不能仅凭此 commit 复现。不可变发布包的镜像保存实际 hooks、migrations 和运行时，release.json 保存逐文件源码摘要。
- 目标镜像：`questions-pocketbase:0.40.1-extra-config-player-titles-20260908-amd64`。
- 实际 image ID：`sha256:108261dbc3f2d877b85706cded3023fb49cf62e72feabb8b3231214691b9c80e`；PocketBase 0.40.1 / Linux AMD64。
- 容器：`questions-game-v1`，ID `f6532d27321a2fddaf52db1b4b6d0b54dc4124e7205ad251dffb96e65db5671f`。
- Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`，SHA256 `6fdb0247f00f0aff045bce4f919419afdf08fee9943fcbfdb492148789072a1f`。
- 数据挂载保持 `/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`，端口仅 `127.0.0.1:8090`，自动迁移关闭。
- 服务器发布目录：`/opt/1panel/apps/questions-game-v1/releases/extra-config-player-titles-20260908`。
- 升级包 SHA256：`0ad56bedc42f7473e953b627d124e08f00f82359f9bdfc2d44536029e38c86ba`，大小 16898285 字节。
- 源码清单 SHA256：`80020f22eae03f365a909e59b170a108dc4a157755c1a97f6cbfc22036ccdf8c`；冻结执行器 SHA256：`69c51752a833e0dd876ac0a449e8468509d1aea6c8c89023fe26525a7142cf6d`。
- 控制器规范化计划 SHA256：`52b4c5578aca6af4941ec0090e7568326832502437105c78a91d9a83b1aab262`；最终事件链头：`9e12c93d0201c5ab20e3df970e66682a2425a5ee6a7961c59a9a2e65dcfec826`。
- 根 release.json SHA256：`72c7374cad24dc463de72524a3dc2511f712f0ce3658f258325160ced1929207`；根 SHA256SUMS SHA256：`22d4c54c7c2c7fb84061d44444fbfa4617cc1502489465da4c3c4a7b3a39453e`。
- 最终报告 SHA256：`28b568f9c6a144c313ca76e2cae4fbf80b576ab2f9d5f26cf4a38f9dc175b764`；根材料 commit 证据 SHA256：`baf8145365159f7546b5556fc66948af70076b12b73dc78efe38ab94636f0996`。

## 验证、备份和维护窗口

1. 只读 inventory 与上一版已记录的主机、镜像、Compose 和迁移账本一致；服务 healthy，可用空间约 23.5 GB。
2. 代码已通过后端 123 项、管理端 46 项、玩家端 284 项测试以及两端构建和响应式浏览器验收，见 [本地验证](extra-config-validation-20260908.md)。本次最终单平台 AMD64 镜像重新通过内嵌代码、固定运行时摘要、空库迁移、认证、重启和停写复制恢复验证。
3. 初次本地出包因 Docker 默认产生 OCI index 被既有校验器拒绝；未上传或修改生产。使用 `--provenance=false --sbom=false` 重新构建单平台镜像后通过，未放宽校验器。发布阶段没有 blocked 或重试迁移。
4. 维护开始 `2026-09-08T07:26:23Z`，切换验收 `2026-09-08T07:28:44Z`，约 141 秒；最终报告 `2026-09-08T07:29:17Z`，recorded 状态完成 `2026-09-08T07:29:18Z`。
5. 备份目录：`/opt/1panel/backups/questions-game-v1/extra-config-player-titles-20260908.b12cbc9efa9a5e49643786458c8a184f`。
6. 完整归档 `/opt/1panel/backups/questions-game-v1/extra-config-player-titles-20260908.b12cbc9efa9a5e49643786458c8a184f/pre-upgrade.tar.gz`，5075526 字节，SHA256 `54efa5447e6570ab60bab2d7b6b7958ad0c9a359a9580c910c5956875eb74e28`；文件清单 SHA256 `624a78b898aacc0306cbc67e31b7e96f88f59653d48f5ccf69bf9eb0f5218d87`。
7. 独立解压验证完整文件、SQLite、结构及脱敏摘要；目标镜像在恢复副本迁移并两次重启。备份验证报告 SHA256 `6abbc53c6a6a06ca04677e0164e4edbe991ff7ef2d3f2fec44222ddd73f79963`。
8. 每个后续阶段重验备份、镜像、源材料和允许差异。备份及旧镜像保留，未清理其他服务。

## 迁移与只读验收

- 正式迁移只执行一次 `1788825600_player_titles_extra.js`，新增 `game_player_level_titles`、`game_extra_definitions`、`game_extra_configs` 三个空私有集合及其已审索引。原有表、集合定义、业务行摘要及历史迁移记录保持不变。
- 迁移前数据库摘要 `d671fc93aa784031bbbf359757a22aa2f294fcc41e1011a5431b3c63c499ea78`，迁移后 `e1f6f9818add9d61647163235335b7e66940cd78d66b9ca7a75feaa87aefbaed`；迁移验证报告 SHA256 `e931f804cd3e6f6f2c72380406d9b3035be4f7d22ef42ab9a609fdb616f22b0c`。
- 当前迁移账本 SHA256 `306cba996e23f57925aab42e3020b4a58d11291fb26af002d632bd68d5f44d8b`；13 条记录，旧记录全字段摘要不变。
- 最终 schema digest `05bedea91a9df08643ef28bf2e0ce64237af42abdf28b80cbb4d7fe2e9832e15`，33 个集合、38 张表。三个新表从迁移到 finalize 均为 0 行，功能休眠。
- 同一目标容器连续三次不同的健康探测成功，restartCount=0；HTTPS health=200、管理身份和玩家任务未认证均为 401。
- finalize 后再次通过控制器 status 核对 recorded 及根发布材料。只读验收没有用真实账号答题、调整经验、创建字段、下发头衔或写奖品。

## 后续边界

两个前端的源码、push、构建和部署由用户负责，本次未操作。待前端部署后可在管理端定义字段和下发配置；新表当前为空，不等同已激活。后续普通展示键可复用 extra，无需每次增加数据库列。

回退应用必须保留新增集合和迁移账本。服务已恢复流量，禁止用维护前旧快照覆盖当前数据库；有问题优先前向修复或经批准只回退应用镜像。专用维护连接在最终核验后关闭。
