# 场次进度订阅后端发布记录

2026-11-26 19:15:38 +08:00，`progress-watches-20261126` 进入 `recorded` revision 15。实际切换验证完成于 19:15:00。发布范围为 PocketBase 运行镜像及增量迁移。当前生产状态见 [生产状态](current-production.md)。

## 制品

| 项目 | 核验值 |
| --- | --- |
| 源镜像 | `questions-pocketbase:0.40.1-home-unread-20261126-amd64` |
| 目标镜像 | `questions-pocketbase:0.40.1-progress-watches-20261126-amd64` |
| 生产镜像 config digest | `sha256:4dc4f2d99e0bb2f7f695561fc5e11e5b45a2326152d932715a3e0b878af021a4` |
| 生产 Compose SHA256 | `8b46dcd1b88f150710590889f209485bd2ae02a537dd9fb01538cf49887d4496` |
| 升级包 SHA256 | `d2c47e99d7a4bca44e23d3d20a302ef4f937bbb00a56a2e739bf4183167e695a` |
| 源码清单 SHA256 | `e11abbb49029a51d5dcc55c2b0b6b96b35937985f987018bf3b31b1d60fb7429` |
| 根 release.json SHA256 | `a150fddf970c7fef553a3360caf66e875474e4434ca920c0869b2e00a10a1c56` |
| 根 SHA256SUMS 文件 SHA256 | `5d7d097c9457c1b136d2652f4d73f45af6575ffbf6d1460267826e8cef259983` |
| 最终发布报告 SHA256 | `e8fb8d7d7e19fbe8bda97a372ddf88f9a54a1294e045e1cde3f9bdd131ddba10` |

PocketBase 0.40.1，Linux AMD64。源码提交为 `c3237901b8ba0e7b85dfabd8f2c6896e2ceea9fd`，镜像内 hooks 与迁移逐字节匹配。版本专属操作单和允许差异随包冻结。成品镜像的场次订阅集成测试 6 项全过，包括原生 DTO 往返。

## 执行和验收

按生产发布控制器逐项完成 STAGE、BACKUP、MIGRATE、SWITCH 和 FINALIZE。停写备份经完整恢复演练，独立副本升级与重启验证通过后才迁移正式库。迁移于 19:12:05 完成，只应用 `1795680000_progress_watches.js`，新增 `game_progress_deliveries` 和 `game_progress_watches` 两个私有空表以及八个索引。最终记录 19 条迁移账本、43 个集合、48 张表，账本 SHA256 为 `4af5ab3dd1cc594f79d85d3790ba3c470142a744ac757d043ff0679233745e38`。历史账本、集合与结构通过允许差异校验。

同一目标容器零重启且三次连续健康成功。正式 HTTPS health 返回 200，包含两个新增进度入口的七条匿名探针均返回 401。最终只读复查为 recorded，无阻塞、活动标记或未决操作。维护连接已关闭。

保留既有旅途 Push v2 运行配置。进度 Push 审批变量保持未配置，新增两表在最终验收时为空。生产业务写入验收、进度 Push 激活和真实送达属于独立环节。此次发布操作未部署客户端和运营台。

备份、旧镜像和冻结发布材料保留。恢复真实流量后若需回退，优先审核旧镜像能否沿用当前加性结构，保留新数据与迁移账本。
