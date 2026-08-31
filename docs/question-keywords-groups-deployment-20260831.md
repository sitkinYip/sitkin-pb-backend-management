# 题目关键词匹配与分组后端发布记录

日期：2026-08-31。用户批准提交服务端发布安全修正并执行 R4；玩家端和管理端由用户另行 push、构建和发布。本次完成后端完整测试、停服备份、恢复副本迁移验证、正式加性迁移、镜像切换和只读生产验收；未回填旧题，未创建题目设置，未执行真实答题、经验、奖品或核销写入。

本文是本次后端发布结束时的不可变事实快照；后续组件部署和功能激活见 [当前生产状态](current-production.md)。

## 生产版本

- releaseId：`question-keywords-groups-r4-20260831`，最终 phase=`recorded`，revision 15。
- Git 基线：`72775ee925d1bee54456564b20294a443913adc5`；本地提交未 push。
- 容器：`questions-game-v1`，container ID `526ce1f2b2170ca1cda622681effa6e9ab183c370d190cd157f5ebbd831e2078`。
- 镜像：`questions-pocketbase:0.40.1-question-keywords-groups-r4-20260831-amd64`。
- 实际镜像 config digest：`sha256:b80955c122e8e6e6b9932d98dfeab80dc123f22baeff88a2b5b47f155f0f164a`；PocketBase 0.40.1，Linux AMD64。
- 正式 Compose SHA-256：`a0144f9794b3c4a84f7f0e8165b0620c5d3e585fa2b432eb75f00dc60a9b3bb5`。
- 根 `release.json` SHA-256：`d2af039db461837b832399a78e8100ae53e8ed446d049f8f835deb0de4239a86`；根 `SHA256SUMS` SHA-256：`87faeb333c27f2f68e4e422b2e8234662696cdabf54631aae8d0be40ae5a62b3`。
- 数据挂载保持 `/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`；端口仍只绑定 `127.0.0.1:8090`。

## 发布材料与验证

- 升级包：`questions-pocketbase-0.40.1-question-keywords-groups-r4-20260831-amd64-upgrade.tar.gz`，SHA-256 `584dcb20e279296f45d72a995895c3309e0adb33d0e0733eb7d6c0a4e39a7016`。
- 源码清单 SHA-256：`9496ecba6e26d99b8e81b6c5edafd5c0d16e8d77b1bc1250ec2c62e2e20f9dda`；冻结执行器 SHA-256：`69c51752a833e0dd876ac0a449e8468509d1aea6c8c89023fe26525a7142cf6d`。
- 冻结计划 SHA-256：`25e619dbb6d9baea48ebbc2210e040e7fdb233ca57b5b162609888a061bb6a4d`；最终事件链头 SHA-256：`0d762b6f1831174fb53db838dac5935da6c78ec487daf251b831aae12aea4880`。
- R4 AMD64 镜像通过 112 项后端测试，以及版本、空库迁移、认证 hooks、容器重启和离线数据库副本恢复验证。

## 备份与迁移

- 停服维护从 `2026-08-31T12:54:05Z` 开始，服务于 `2026-08-31T12:56:46Z` 完成切换验证，约 161 秒；最终记录于 `2026-08-31T12:57:31Z` 完成。
- 备份目录：`/opt/1panel/backups/questions-game-v1/question-keywords-groups-r4-20260831.7f4dd8ee5b1f86ab0c7886f2b29affa1`。
- 完整归档 `pre-upgrade.tar.gz` 为 4,022,602 字节，SHA-256 `1fea4ce49b5834f63d71411254bca716955f661fcffe910f209131db04d4be78`；文件清单 SHA-256 `29f3c956c1a3fa486bf04d14c3d27019acf20cef5a9191008c389d1fac0b377a`。
- 恢复验证报告 SHA-256：`0b3664fbf34b154e1f350103be0410379da8dea365c6528991bda5aa205a2872`；恢复副本迁移并连续启动两次后保持稳定。
- 正式迁移只追加 `1788176000_question_settings.js`；迁移前数据库摘要为 `6eef89e69f6f21c176b17812a2845bd11f917b96dabe35107d19e98131a96532`，迁移后为 `1e00d42df1b435ae2a601abd602be36a5f51c399b9916fb36842bf35f0b003dd`。
- 迁移账本 SHA-256 更新为 `296348491ac81cba553be08650417cf89a84d9c89d61472eb0109566dc32032b`；12 条迁移记录中全部历史行摘要保持不变。
- 只新增私有集合/空表 `game_question_settings`、唯一查询索引 `idx_game_question_settings_question` 和 SQLite 主键自动索引；新表发布结束时为 0 行。
- PocketBase 同时为 `game_question_clues` 的两个既有索引补写缺失的 `sqlite_stat1` 记录。校验器证明只有这两个真实索引对应的新增统计，47 条旧统计无删除、无改值；业务表没有变化。

## 生产验收

1. 目标容器 running / healthy，重启计数 0；切换闸门记录了同一容器的 3 次连续成功健康检查，最终检查时 Docker 健康日志共 5 条。
2. Compose 解析结果除镜像外保持冻结；唯一数据挂载、回环端口、启动参数、安全策略、健康检查和重启策略未漂移。
3. schema digest 为 `7030d490785f70da7b0cc66e8bb31b06802a68f38db4cc54ce23d750bcfd4229`；30 个集合、35 张表、12 条迁移记录与恢复演练一致。
4. `game_question_settings` 保持私有且为 0 行；旧题没有回填，现有答题继续使用精确匹配和“其他”分组默认值。
5. 正式 HTTPS 健康接口返回 200；未登录管理身份接口和玩家下发接口均返回 401。
6. 未部署两个前端，未操作生产题目设置、玩家、场次、答案、经验、奖品、领取或核销；未停止或修改其他 1Panel 应用。

## 先前阻断与回退边界

- 第一次尝试在停止态端口校验处阻断；第二次发现允许清单遗漏 SQLite 主键自动索引；第三次发现迁移会补写既有索引统计。三次均在正式迁移和镜像切换前证明数据库、Compose、镜像和迁移账本未变并恢复原服务，状态、日志、备份和 blocked marker 均保留。
- R4 使用新的 releaseId 和收紧后的验证器：`sqlite_stat1` 只允许为 schema 中真实存在的索引新增记录，禁止删除、修改旧统计、重复键、未知索引或新增表级统计。
- 新管理端上线后，运营可逐题编辑或使用“归类”入口手工回填；该动作属于生产业务写入，需另行确认。
- 应用代码需要回退时可切回旧镜像，但必须保留新增集合和迁移账本，不得执行 migration down 或删除设置记录。
- 一旦开始写入题目设置或产生新答题、经验、奖品、领取、核销数据，禁止用本次维护前备份覆盖当前库；优先前向修复或只回退应用代码。
