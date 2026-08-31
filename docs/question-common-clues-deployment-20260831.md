# 题目通用线索与线上展示编辑后端发布记录

日期：2026-08-31。用户明确要求先部署 PocketBase 后端，两个前端由用户自行 push 发布。本次完成后端停服备份、恢复副本迁移验证、正式增量迁移、镜像切换和生产只读验收；未提交或 push 代码，未部署玩家端或管理端，未执行生产业务写入。

## 当前生产版本

- 容器：`questions-game-v1`，running / healthy，重启计数 0。
- 镜像：`questions-pocketbase:0.40.1-question-clues-live-settings-20260831-amd64`。
- 实际镜像 ID：`sha256:afc6feeba6d0884d3b485dec95e059344c998f2d90f84ad8e8bdd3809b6db482`。
- PocketBase：0.40.1，Linux AMD64。
- 正式 Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`，SHA256 `6c14986a8669858c31ed6bf4f7addc401dc25d733665356dac6f99a22244dd71`。
- 根 `release.json`：SHA256 `5a2c63662ac2e441f54a6c8f9c17358e9460703060aaeb7e95beaadd567584e2`；根 `SHA256SUMS` 全部通过。
- 数据挂载保持 `/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`，端口仍只绑定 `127.0.0.1:8090`。

## 发布材料与校验

- 服务器发布目录：`/opt/1panel/apps/questions-game-v1/releases/question-clues-live-settings-20260831`，权限 700；发布文件权限 600。
- 升级包：`questions-pocketbase-0.40.1-question-clues-live-settings-20260831-amd64-upgrade.tar.gz`，SHA256 `b48424609291b61943fc88be521dc0304978bd343d092d2d15dae847799e205c`。
- 源码摘要清单：SHA256 `7d2a961d3afde086830850fcd8b285d958bf589261535e5594855cebf9fd68f1`。
- 最终切换脚本：SHA256 `4db907e7f78e72f8fab8e06144551e823fb0537bc3077af24c682f83cb9870a8`，Python 3.6 语法与失败路径经双重审计。
- 外层归档成员、包内 `SHA256SUMS`、镜像 ID、Linux AMD64、PocketBase 版本及全部 hooks / migrations 摘要均通过。

## 备份与迁移

- 维护窗口从 `2026-08-31T12:04:46.941495+08:00` 到 `2026-08-31T12:05:30.041365+08:00`，约 43 秒。
- 完整停服备份目录：`/opt/1panel/backups/questions-question-clues-20260831.m5tfixir`，权限 700。
- 完整归档：`pre-upgrade.tar.gz`，3,514,567 字节，权限 600，SHA256 `4ab123ca4b55842cb037fe841f319a8809fbf5f9d60de090c14e705dd76401ca`。
- 归档包含完整 `pb_data`、实际 Compose、原 `release.json` 和校验清单；解压后逐文件类型、权限、属主、大小和内容摘要一致。
- 恢复副本执行 `1788143000_question_clues.js` 后连续启动、停止两次，数据与 schema 保持稳定；恢复演练副本在正式记录完成后删除，完整归档保留。
- 正式迁移独立于镜像切换执行。迁移账本只追加一次 `1788143000_question_clues.js`；物理表由 33 增至 34，31 张既有非系统表的结构、行数和聚合摘要完全不变。
- `_collections` 只新增 `game_question_clues`，旧集合定义逐行不变；SQLite 只新增目标表、查询索引和主键自动索引。新集合发布时为 0 条，未创建测试数据。

## 验收结果

1. 新容器使用固定目标镜像 ID，PocketBase 0.40.1，运行状态 healthy，重启计数 0。
2. Compose 解析结果除镜像外与原配置一致；挂载、回环端口、启动参数、健康检查、网络、只读根设置及重启策略未变化。
3. 新迁移在正式库中恰好 1 条，新集合恰好 1 个且记录数为 0；直接客户端访问规则保持关闭。
4. HTTPS 健康接口返回 200；未登录管理身份接口和玩家下发接口均返回 401。
5. 未创建生产账号，未新增通用线索，未编辑线上场次，未执行答题、经验、发奖、领取或核销测试；未停止或修改其他 1Panel 应用。
6. 初次服务器隔离 preflight 发现 PocketBase 在全新空库首次 `serve` 时会生成内置 installer system superuser；正式生产不受影响。脚本随后收紧为仅允许该固定系统初始化、catalog 不变且第二次启动全量稳定，再次 preflight 后通过。该行为与 [PocketBase 首次启动说明](https://pocketbase.io/docs/) 一致。

## 前端顺序与回退边界

- 后端已上线，但玩家端和管理端尚未部署。`game_question_clues` 必须继续保持为空。
- 用户下一步先 push / 发布 `questions-web`，确认线上玩家端已识别新 effect 与线索协议；再 push / 发布管理端；最后才配置第一条通用线索。
- 若新应用代码需要回退，可恢复原镜像并保留已经验证的加性集合和迁移账本；不得运行 migration down 或删除 `game_question_clues`。
- 一旦产生新答题、经验、奖品、核销或通用线索写入，禁止用维护窗口前备份覆盖当前库。应先停写保存现状，优先前向修复或只回退应用代码。
