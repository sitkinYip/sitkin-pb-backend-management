# 专属等级头衔与扩展配置后端升级操作单

<!-- release-status: completed -->
<!-- release-id: extra-config-player-titles-20260908 -->
<!-- source-image: questions-pocketbase:0.40.1-question-keywords-groups-r4-20260831-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-extra-config-player-titles-20260908-amd64 -->

## 目标与范围

用户要求通过维护隧道发布本次 PocketBase 数据库和 hooks；两个前端由用户自行 push 和自动部署。本次不提交或推送前端、不创建生产字段定义、不下发专属头衔或扩展值、不执行真实答题。

唯一目标为 `questions-game-v1`，项目 `/opt/1panel/apps/questions-game-v1`，Compose 为其中 `compose.yaml`，唯一数据目录为其中 `pb_data`，端口保持 `127.0.0.1:8090`，PocketBase 保持 0.40.1 / Linux AMD64 / `--automigrate=false`。

source 为 `questions-pocketbase:0.40.1-question-keywords-groups-r4-20260831-amd64`，目标为 `questions-pocketbase:0.40.1-extra-config-player-titles-20260908-amd64`。完整 image ID、Compose、根发布信息、迁移账本和主机身份基线以同批 `release-plan.json` 为准，必须经本次只读 inventory 核实后才能冻结制品。历史来源为 `docs/question-keywords-groups-deployment-20260831.md`，历史值不能替代现场核验。

## 兼容与休眠

| 组合                       | 行为                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| 旧玩家端＋新后端，无配置   | 默认名称和原有答题行为不变                                                  |
| 旧玩家端＋新后端，有配置   | name 可显示专属名称；忽略 extra，被动文案可能不显示；不改变经验、权限或奖励 |
| 新玩家端＋旧后端           | 可选扩展缺失时安全回退                                                      |
| 旧管理端＋新后端           | 独立配置集合不被旧接口覆盖                                                  |
| 新管理端＋旧后端           | 根据 capabilities 禁用不支持的入口                                          |
| 新管理端＋新后端＋旧玩家端 | 本次保持三个新表为空；新配置待用户完成前端发布后另行激活                    |

发布阶段暂停管理端配置写入，直到 finalize 完成。停服窗口从 backup 开始，到 switch 验证健康结束；期间答题 API 暂不可用。每步先核对上一阶段结果，程序不会自动跨阶段。

## 精确允许差异

只追加迁移 `1788825600_player_titles_extra.js`，只创建三个空私有集合及表：

- `game_player_level_titles`：`idx_game_player_level_titles_owner`、`sqlite_autoindex_game_player_level_titles_1`。
- `game_extra_definitions`：`idx_game_extra_definitions_key`、`sqlite_autoindex_game_extra_definitions_1`。
- `game_extra_configs`：`idx_game_extra_configs_binding`、`idx_game_extra_configs_lookup`、`idx_game_extra_configs_request`、`sqlite_autoindex_game_extra_configs_1`。

上述集合在迁移、切换和 finalize 时均须为 0 行且所有直接访问规则保持私有。原有表、字段、索引、集合定义及历史迁移账本不可改写；不回填现有用户、题目、场次、等级、经验或奖励。精确物理允许清单见同批 `allowed-delta.json`，采用现有 `additive-empty-collections-v1` verifier。

`sqlite_stat1` 仅允许现有 verifier 认可的、绑定真实索引的新增统计；不得删除或修改旧统计，不允许未知索引、重复键和新增表级统计。

## 制品与执行

1. 使用用户建立的 ControlMaster，只复用 socket，执行仓库 HEAD 未修改 runner 的 `inventory`。基线不符时停止。
2. Docker AMD64 构建并核对镜像内代码；此次源码可能未提交，冻结包保存完整源文件摘要与不可变归档，不宣称 HEAD 独立复现。
3. 用 `package-1panel.mjs --upgrade` 从匹配 plan、allowed-delta、操作单生成 ready 计划和完整 sidecar。执行两层 SHA256 校验。
4. 对冻结包执行 `preflight`；按当场显示的准确短语确认 `stage`，上传、校验、加载并隔离运行候选镜像，生产仍运行旧服务。
5. 第一次 `deploy`：停服，证明没有其他进程打开 SQLite，备份完整 pb_data 和版本材料；独立恢复、校验文件与 SQLite，在副本迁移并两次重启。通过后生产仍保持停止。
6. 核验状态后第二次 `deploy`：重验备份、source 与允许差异，仅对正式库执行一次已审迁移。
7. 核验状态后第三次 `deploy`：仅更换 Compose 镜像；先创建停止态容器并核对，再启动，要求同一容器、零重启和三条不同的连续成功健康探测。
8. 核验状态后第四次 `deploy`：再次验证未激活空表、结构及迁移账本，记录并核验根发布材料。恢复流量后的正常既有业务行变化不误判为回退依据。

所有执行使用 `release-pocketbase.mjs` 与同批冻结 runner；每次 deploy 只推进一个阶段。只读验收包含 HTTPS health 200、管理身份和玩家任务未认证 401；不等同业务写入验收。

## 中断与回退

非零结果、断线或未知状态先运行 status，不重试 stage/migrate，不运行临时命令绕过 blocked。保留状态、备份和证据，不删除半成品表或迁移账本。迁移成功而应用失败时优先前向修复或经批准只回退应用镜像，保留加性结构。

只在证明正式库、Compose 和迁移账本完全未变并作出明确恢复决定后，才能恢复原服务。发生新答题、经验、奖品或配置写入后，禁止旧数据库快照覆盖当前库；本次不执行 down 或自动恢复旧快照。

完成后更新当前生产状态和新增日期发布记录，分别记录数据库、后端、两个前端及功能激活状态，关闭专用维护连接。保留备份和旧镜像，不顺手清理其他服务。

## 执行结果

2026-09-08 15:29 +08:00 已完成，phase=recorded、revision 15，服务 healthy、重启 0，三个新表为空。完整记录见 `docs/extra-config-player-titles-deployment-20260908.md`。本工作区操作单改为完成版，服务器冻结制品中的原始 pending 副本不修改。
