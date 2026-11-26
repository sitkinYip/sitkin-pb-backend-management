# 主界面聚合与批量已读后端发布记录

2026-11-26 17:21:52 +08:00 完成 `recorded` revision 14。本轮发布 PocketBase 后端，部署范围为 `GET /api/questions/v1/home` 和 `POST /api/questions/v1/notifications/read-all` 及其共享投影。玩家端与运营台另有发布流程。 [生产状态](current-production.md)

## 版本和制品

| 项目 | 值 |
| --- | --- |
| 发布标识 | `home-unread-20261126` |
| 源镜像 | `questions-pocketbase:0.40.1-push-titles-20261120-amd64` |
| 目标镜像 | `questions-pocketbase:0.40.1-home-unread-20261126-amd64` |
| 生产镜像 config digest | `sha256:17b6b91bab6070ee59161a112832de3755e1110af31e6b7ecb0883838cfe451c` |
| 生产 Compose SHA256 | `c9825e9d43e54cd469673f4a18e7d2c290bc3088a55a4253cd4abbbc83a8a800` |
| 升级包 SHA256 | `883e5805eb137ff4bd3598a957d1413154940aade77b3045f8f96d47df54cd55` |
| 冻结源码清单 SHA256 | `b2d0cbefdb4f6cdbf57bd7de41b6f5701112e7d44cff82b8019edb8f48a8a200` |
| 生产根 release.json SHA256 | `89b2a2e8f89f344e065f7a53a40307aed25af5996a91ac93ed3338eb4691b5da` |
| 生产根 SHA256SUMS 文件 SHA256 | `8324c5390711460515c294cfcd26170b2e57e03cd672dac7ced27a1b361dbf39` |

PocketBase 0.40.1，Linux AMD64。发布包校验、155 项后端测试与离线恢复演练通过。待执行操作单的冻结副本随包保存，工作区发布操作单保留本轮完成状态。

## 执行和验收

生产只读盘点与旧版本记录一致。通过 STAGE 隔离验证、停服完整备份与恢复演练后，确认无数据库迁移。17:21:12 +08:00 镜像切换进入 `verified`，随后完成根发布材料更新。最终复查为同一目标容器、零重启、连续三次健康检查成功、无未决操作或 active marker。

生产 HTTPS 健康检查返回 200。包含 `/api/questions/v1/home` 的五条匿名探针均返回 401。批量已读的账号隔离、幂等和可见范围已在隔离 PocketBase 验证。生产验收范围为健康、认证和结构。

账本 SHA256 为 `ecb46ffcbd8252680e7da2815a2e54a79046a5d749a5c19fe413ce2a4e9ef401`，18 条迁移账本、41 个集合、46 张表通过结构核验。沿用现有 Push v2 运行配置和专用只读密钥挂载。完整备份、旧镜像及发布记录保留于维护目录。恢复真实流量后，若需回退优先切回应用镜像，已产生的新回执保留。
