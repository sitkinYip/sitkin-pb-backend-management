# 信件 / 祝福软删除：正式后端发布记录

日期：2026-08-28。用户明确批准“可以开始切换”后，完成停服备份、隔离恢复验证、正式镜像切换和生产只读验收。后端已上线；管理前端等待用户提交并 push 触发 Action，本任务未执行 git commit / push。

## 当前生产版本

- 容器：`questions-game-v1`，running / healthy。
- 镜像：`questions-pocketbase:0.40.1-narrative-delete-20260828-amd64`。
- 实际镜像 ID：`sha256:481868ea16e6bc585ebd2c7ccb9f16110150a93569daa5154794f9dc1c3799da`。
- PocketBase 保持 0.40.1，Linux AMD64；系统依赖沿用已验证的上次生产镜像。
- 实际 Compose：`/opt/1panel/apps/questions-game-v1/compose.yaml`。仅镜像标签变化，解析后的所有其他配置逐项相等。
- Compose SHA256：`e52612b5217d825d22b277166cae1751edae97ce890b93415ca39c6512f87857`。
- 数据挂载保持 `/opt/1panel/apps/questions-game-v1/pb_data` → `/pb/pb_data`。
- 端口保持 `127.0.0.1:8090:8090`，原启动参数、网络和安全配置不变。
- 维护开始：20:17:02；新容器健康及数据验证完成：20:17:36（Asia/Shanghai）。维护约 34 秒。

## 备份与发布材料

- 完整备份目录：`/opt/1panel/backups/questions-narrative-delete-20260828._41rmhbv`，权限 700。
- `pre-upgrade.tar.gz` 权限 600，包含停服后的完整 `pb_data`、原 Compose、原 `release.json` 和原根校验清单。
- 备份归档 SHA256：`67cc2e7fb0bf1aa01190aa8fa37446f0eea9edc5244540116386ddba6395395a`。
- 同目录保存 `database-before.json`、`database-after.json`、`files-before.json` 和 `backup-verification.json`，均为校验记录，不展示业务正文、密码或领取信息。
- 服务器发布目录：`/opt/1panel/apps/questions-game-v1/releases/narrative-delete-20260828`。
- 升级包：`questions-pocketbase-0.40.1-narrative-delete-20260828-amd64-upgrade.tar.gz`，约 16MB。
- 升级包 SHA256：`7c8c23315c091c48ddafbf3db2bc4cb7be6767615e631a4fe9bb1e75e8a7d7f5`。
- 重建当前版本使用发布目录 `extracted/pocketbase-image.tar`。根目录原 `pocketbase-image.tar` 仍为历史基础包，未覆盖或删除，不能误用它重发旧版本。
- 根 `release.json` 已记录新版本、上一个镜像、备份和实际发布材料位置。SHA256 为 `680478fe49208cc3b59eff67743e7294c9a1e6db9abef0aa5fb3aa6d83265bd7`；根 `SHA256SUMS` 已同步且全部验证通过。
- 分阶段操作与校验结果保存在发布目录 `switch-state.json`；操作脚本 `switch-backend.py` 保留用于审计，不应盲目重复执行。

## 验证结果

1. 停服后完整备份，解压到独立恢复目录，对照文件内容校验值、权限、属主和类型逐项一致。
2. SQLite 完整性检查通过。恢复副本用新镜像在无网络容器中启动成功，不挂载生产目录；停止恢复实例后，33 张数据库表的结构与记录仍与备份一致。
3. 正式切换前再次核对生产库、原配置和备份摘要。仅替换镜像，没有运行数据库迁移、内容导入、密码重置或新账号初始化。
4. 正式启动后，33 张表的结构和记录（包括业务记录、配置、权限及迁移账本）与停服快照逐表校验一致；经验、奖品、领取信息及核销状态未改动。
5. 所有线上 hooks 和两份既有迁移的 SHA256 与发布源码一致；只有 `admin.js` 和 `content-policy.js` 相对上一生产版本发生业务代码变化。
6. 生产 HTTPS 健康接口返回 200；未登录访问管理身份与玩家下发接口均返回 401。未使用真实玩家或管理员账号进行生产业务写入验收。
7. 发布前新 AMD64 镜像后端回归 54 / 54 通过，镜像内嵌代码恢复验证和服务器隔离业务验收通过，详见发布前检查记录。
8. 交付前再次运行管理端测试 39 / 39 通过，共享契约检查和 TypeScript / Vite 构建通过；保留既有大 chunk 体积警告。

## 清理与交接

- 最终容器检查为 running / healthy，重启计数 0。本次专用 SSH 维护连接已正常关闭，未修改其他连接。
- 恢复验证容器已停止并自动删除。确认备份完整后，仅删除本次独立 `restore-check` 恢复副本；可从上面的完整备份重新生成。
- 原生产库、旧镜像、备份和发布包保留，没有停止其他应用或修改 Alist、OpenResty、SSH 密钥 / 密码。
- 管理前端尚未发布。现在可以提交并 push 管理后台 main 触发既有 Action，需包含本次新增文件；答题页无需更新。
- 新引用保护已在后端生效，即使旧管理页面仍使用“归档”入口，也不能绕过线上 / 草稿引用保护。
- 不应无条件回退到缺少新保护的旧后端。已有新答题或核销后，不得用旧数据库快照覆盖当前数据；应先停写核对，优先前向修复。
