# 题目关键词匹配与分组后端升级操作单

<!-- release-status: pending -->
<!-- release-id: question-keywords-groups-20260831 -->
<!-- source-image: questions-pocketbase:0.40.1-question-clues-live-settings-20260831-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-question-keywords-groups-20260831-amd64 -->

## 发布范围

本操作单只用于 `questions-game-v1` 当前生产实例的增量后端发布。它新增题目关键词匹配和题目分组所需的服务端能力，不包含前台或后台管理系统发布，也不包含旧题目的业务数据回填。

本次迁移只允许新增一个私有空集合 `game_question_settings`，以及该集合对应的表和唯一索引。发布程序不得扫描、修改或回填现有题目、答案、奖励、账户或运行配置。

## 兼容性约束

- 现有答题端协议不变，旧答题端可继续使用。
- 旧管理端在新后端上未提交新字段时，服务端按“精确匹配、其他分组”处理；发布窗口内仍暂停管理端写入，直至 `finalize` 完成。
- 新管理端依赖本次后端能力，应在本次服务端发布完成后再部署。
- 新集合必须从迁移后到发布完成始终保持 0 行；后续旧题目归组由用户在管理端手工完成。

## 冻结基线

- 生产目录：`/opt/1panel/apps/questions-game-v1`
- Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`
- 数据目录：`/opt/1panel/apps/questions-game-v1/pb_data`
- 当前镜像：`questions-pocketbase:0.40.1-question-clues-live-settings-20260831-amd64`
- 当前镜像 ID：`sha256:afc6feeba6d0884d3b485dec95e059344c998f2d90f84ad8e8bdd3809b6db482`
- 当前 Compose SHA-256：`6c14986a8669858c31ed6bf4f7addc401dc25d733665356dac6f99a22244dd71`
- 当前 release.json SHA-256：`5a2c63662ac2e441f54a6c8f9c17358e9460703060aaeb7e95beaadd567584e2`
- 目标镜像：`questions-pocketbase:0.40.1-question-keywords-groups-20260831-amd64`
- 新迁移：`1788176000_question_settings.js`

主机身份和迁移账本哈希必须先通过只读 inventory 获取并写回 `release-plan.json`，再次 inventory 完全一致后才能构建发布包。

## 执行顺序

1. 使用仓库发布控制器执行只读 `inventory`，冻结主机、镜像、Compose、release.json、迁移账本与磁盘空间。
2. 构建并验证 `linux/amd64` 目标镜像，运行目标镜像测试和镜像源码校验。
3. 生成升级包；只使用包内冻结的 `deployment-plan.json`、`release-runner.py` 和校验和。
4. 执行 `preflight`，确认发布包、生产基线、允许差异和升级前数据库快照一致。
5. 执行 `stage`，只上传并加载候选镜像，不切换生产。
6. 依次执行四个相互独立的部署阶段，每一步完成后检查 `status`：
   - `backup`：停止生产并完成逻辑/物理备份，生产保持停止。
   - `migrate`：只在候选镜像和工作数据库上执行迁移及允许差异校验。
   - `switch`：切换生产镜像并完成健康检查和未授权探针。
   - `finalize`：确认生产数据库与工作数据库一致、增量集合仍为空并写入完成记录。

任何阶段出现基线漂移、未知状态或非零退出码，立即停止，只允许执行 `status` 取证，不得自动重试或跨越阶段。

## 允许差异

发布前后唯一允许的数据库结构差异是：

- 新迁移文件 `1788176000_question_settings.js`
- 新私有集合 `game_question_settings`
- 新表 `game_question_settings`
- 新索引 `idx_game_question_settings_question`

`game_question_settings` 在 `migrate`、`switch` 和 `finalize` 校验时都必须为空。生产业务数据写入与功能开关激活均不在本次发布授权范围内。

## 回滚边界

- 切换前失败：保持生产停止，依据状态记录恢复原 Compose 和原数据备份。
- 切换后但尚未发生新版本业务写入：可切回旧镜像；新增结构和迁移账本必须保留，不得执行向下迁移或删除集合。
- 一旦新版本开始写入 `game_question_settings`，禁止恢复旧数据库备份覆盖新数据。本次发布不会激活或回填该集合，因此完成时应仍为 0 行。
