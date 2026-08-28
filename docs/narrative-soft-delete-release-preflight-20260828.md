# 信件 / 祝福软删除：发布前检查

日期：2026-08-28。本文为发布前检查快照。后续用户已批准正式切换，后端已上线，见 [正式发布记录](narrative-soft-delete-deployment-20260828.md)。下文“待批准”及生产旧版本信息为当时状态，不代表仍未部署；管理前端仍等待用户 push 发布。

## 生产只读核实

| 项目 | 检查结果 |
| --- | --- |
| 目标容器 | `questions-game-v1`，running / healthy |
| 运行时 / 架构 | PocketBase 0.40.1 / Linux x86_64 |
| 当前镜像 | `questions-pocketbase:0.40.1-session-offline-20260828-amd64` |
| 当前镜像 ID | `sha256:3bb5422d4466a0f046d73c1379ad3335f79038d9645fae5889b89b4c79872906` |
| 实际 Compose | `/opt/1panel/apps/questions-game-v1/compose.yaml` |
| Compose SHA256 | `78947bb44296dac4cc2df4c8b89861b69ca6c40745108e97996e5d8e859e70bf` |
| 当前 release.json SHA256 | `034b4161c989dfad84e0ba87486f40281c3517b3accbe0235c21ee24a7d0cba6` |
| 数据挂载 | `/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data` |
| 端口 | `127.0.0.1:8090:8090` |
| 磁盘可用空间 | 约 23GB |

SQLite 检查使用 `mode=ro`、`query_only=ON` 和单一读事务，仅输出汇总，不展示玩家凭据、答卷、正文或领取信息。

- 当前 31 个场次全部为已下线；下发记录为已取消 27、已完成 7。此为检查时既有状态，本次未修改。
- 信件 / 祝福共 5 份：草稿 1、已发布 4；没有已归档剧情内容，因此没有旧归档内容仍被场次使用的兼容清单需要人工处置。
- 题目 27、经验流水 12、关卡进度 22、线索解锁 16；奖品发放记录为 0。
- `1787788800_game_schema.js` 和 `1787911200_expand_audit_diff.js` 均已执行。`safeDiff` 字段 ID 为 `json558181816`，上限 2,000,000 字节。本次无新增迁移，不需要对生产执行 `migrate up`。
- 线上与待发布源码逐文件比较：只有 `pb_hooks/lib/admin.js` 和 `pb_hooks/lib/content-policy.js` 不同，其余 hooks 与两份迁移完全一致。

上述统计不是持续监控，正式切换前需重查。当前数据不能代替维护窗口内的完整停服备份。

## 发布产物

- 新镜像：`questions-pocketbase:0.40.1-narrative-delete-20260828-amd64`。
- 镜像配置摘要及服务器导入后的 ID：`sha256:481868ea16e6bc585ebd2c7ccb9f16110150a93569daa5154794f9dc1c3799da`。
- 本地目录：`/private/tmp/questions-narrative-delete-release-20260828.MjU5BG`。
- 包目录：上述目录的 `bundle/`。
- 归档：`questions-pocketbase-0.40.1-narrative-delete-20260828-amd64-upgrade.tar.gz`，约 16MB。
- 归档 SHA256：`7c8c23315c091c48ddafbf3db2bc4cb7be6767615e631a4fe9bb1e75e8a7d7f5`。
- 服务器目录：`/opt/1panel/apps/questions-game-v1/releases/narrative-delete-20260828`，目录权限 700。
- 已解压并逐文件校验于 `extracted/`；已导入新标签，但未修改实际 Compose 或重建正式容器。

基于已与生产逐层比对一致的上次发布镜像构建，仅复制当前 hooks 和既有迁移；PocketBase 二进制、系统依赖及启动配置沿用基线。构建配方保存在本地发布目录 `Dockerfile`。完整离线镜像归档已上传，服务器重建不依赖本地临时文件。

包内只有镜像、升级操作单、发布元信息及 SHA256 清单，没有业务数据库、真实账号、凭据、Compose 模板或前端资源。升级操作单已针对本次“无新增迁移”更新，不应执行首次安装或旧归档补齐步骤。

## 验证结果

1. 新 AMD64 镜像环境下完整后端回归 54 / 54 通过，包括并发引用保护、审计失败回滚、软删除及奖励保留。
2. 镜像内嵌代码的版本、空测试库迁移、认证 hooks、重启及停写测试库副本恢复验证通过。
3. 打包时镜像内所有 hooks / migrations 与本地源码逐一比较通过，实际归档解压后校验通过。
4. 上传后归档、内层文件和验收脚本校验通过，服务器镜像架构 / 版本 / 摘要符合预期。
5. 服务器隔离验收使用只读容器根文件系统、64MB tmpfs 测试数据、192MB 内存及 0.5 CPU 限额，端口只绑定随机回环端口；没有挂载任何生产路径。
6. 验证草稿 / 线上两种引用位置禁删、下线后删除、幂等重试、正文及 ID 保留、旧链接拒绝、经验与领取 / 核销数据保留、复制保留旧引用、未修复时禁止保存 / 发布、修复后可发布、旧归档读取兼容及删除后仍可核销。
7. 验收脚本适配服务器自带 Python 3.6，未安装软件。实际通过版本为服务器发布目录的 `verify-server-image-v2.py`，SHA256 `16803bde3b845640c05743dea0b4b7d935f3a137472dd04c2f7a61d0d2cbdf8d`。
8. 临时验收容器与 tmpfs 假数据已自动清理；正式容器仍为原镜像且 healthy，Compose 和根 release.json 校验值与检查前完全一致。

## 待批准的正式切换

1. 确认维护窗口，暂停答题和管理操作，重新核对目标配置与当前数据状态。
2. 仅停止 `questions-game-v1`，完整备份 `pb_data`、实际 Compose、release.json 及校验信息；保留旧镜像。
3. 在独立目录核对备份可恢复与新镜像兼容性。不覆盖原库、不创建生产测试账号、不重置密码。
4. 仅替换实际 Compose 中目标镜像标签，保持数据挂载、端口、网络和其他参数不变；无需数据库迁移。
5. 启动后核对镜像 / hooks 校验值、健康、权限、配置及业务数据无升级引起的变化，再通知用户 push 管理前端。

停服时长预计约 1–2 分钟，取决于当时备份与校验；目前尚未开始停服。审批前不执行后续步骤，维护连接暂时保留供用户确认后继续。若配置、数据或恢复验证不符，停止切换并报告，不自动删库、重导或恢复旧快照。
