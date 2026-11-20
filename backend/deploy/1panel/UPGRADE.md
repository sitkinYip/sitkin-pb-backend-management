# 推送业务标题后端升级操作单

<!-- release-status: pending -->
<!-- release-id: push-titles-20261120 -->
<!-- source-image: questions-pocketbase:0.40.1-push-personal-journey-20261119-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-push-titles-20261120-amd64 -->

待执行，2026-11-20。用户已授权实现、发布并用自己账号验收推送标题。本单只适用于本批冻结包；不重用历史操作单，不更改历史发布与分类激活记录。后端独立发布，无数据库迁移、运营台发布或客户端新包。

## 唯一目标与基线

- 主机 sitkinYip；唯一服务 pocketbase、容器 questions-game-v1，项目 /opt/1panel/apps/questions-game-v1。
- PocketBase 0.40.1、Linux AMD64、--automigrate=false；既有 pb_data 与 127.0.0.1:8090 保持。
- source 实际 image/config ID：sha256:f3e1bc2ff3295772a50a497585bfcf51f4da1134ecdff3f9ec0ae06ac565e96a。
- 实际 Compose SHA256：f26ebeb828ff763341d036a37040e52e493fe269e533f73acf1792496b7a6088。
- 根 release.json SHA256：a6ee07602a7fd8a6fd22147b23a2b2e805c2100864d3974768dafe18d160b24b。
- 迁移账本 SHA256：ecb46ffcbd8252680e7da2815a2e54a79046a5d749a5c19fe413ce2a4e9ef401；十个业务迁移，最后为1795075320。正式 inventory 必须再次核对。
- 只读准备盘点 healthy、零重启，无待发送/发送中任务；停服前重新盘点，不能把零任务当作之后的事实。
- 原密钥只读挂载保持；不读取、复制或计算密钥内容摘要。
- 保留五项 Push 环境：ENABLED=1、TEST_MODE=0、SUBSCRIPTION_APPROVED=1、原 PROJECT_ID 和 SERVICE_ACCOUNT_FILE。显式使用 harmony-push-production-v2 固定契约；历史 v1 继续固定 APPROVED=0。
- 11月20日独立分类激活后的实际 Compose 与旧根发布清单的 Compose 不同；recordedComposeSha256 固定为7a78755f21f53f0cae98319c6d175fc052eebc5bf920af17bb02841a1de276c6。仍核对旧根元数据及其全部成员，不能将此兼容项扩展到其他漂移。

## 功能与兼容边界

来信/公告取仍获授权的通知标题；新场次下发取仍有效的场次标题。标题只在发送事务校验来源后加入内存载荷，不新增持久化字段。清理空白、控制与方向字符，按 Unicode 码点截断到60，空或异常标题回退「赴星之约」。正文、分类、点击路由、TTL、同意范围与已读/撤回/过期/失效门控保持。正文不包含来信全文、题目答案或奖励信息。

旧原生包和 Web 仍使用现有接口，不需要升级；客户端点击通知仍回源确认账号和目标。现有接收范围、订阅记录、绑定及凭据保持，不补发历史未发送事件。本次唯一生产业务写入验收为给 Sitkin（sitkinyip）发一条定向旅途通知。

## 唯一允许数据库差异

migration.mode=none，newFiles=[]，allowed-delta.push-titles.json 所有允许清单为空。停服备份至 no-migration 的 schema、集合定义、逐表摘要、迁移账本必须无变化。恢复生产流量后允许既有业务数据正常变化；schema 和完整历史账本仍须保持。禁止自动迁移、补数据或删除账本。

## 冻结与执行

1. 独立审查、完整后端测试和契约检查后提交受审 runner；正式只读 inventory 核对实际基线。冻结源码、固定官方 AMD64 runtime、镜像内容、两层 SHA256SUMS 与本单。
2. preflight 通过后独立 TTY 批准 STAGE，上传并隔离验证；不停服。
3. 核验 status 后批准 BACKUP，停止唯一服务，完整备份数据和实际版本材料。独立恢复副本验证文件保真、SQLite、无差异、两次启动及不重复迁移；生产保持停止。
4. 核验 status 后批准 NO_MIGRATION，确认库和账本未变；再批准 SWITCH。切换仅换镜像，全部运行契约、环境及两挂载不变。核对同一容器、零重启与三条不同且连续成功的 Docker 健康记录后恢复服务。
5. 核验 status 后批准 FINALIZE，写本轮发布及根元数据；必须 recorded，无未决 marker。现场 TTY 闸门依据 docs/pocketbase-release-program.md 第3–4节，由代理按本次用户授权逐阶段复核后输入当场短语；不修改控制器、不跳步或自动跨阶段。
6. HTTPS health=200，四条未认证接口=401；确认目标镜像、hooks、APPROVED=1 和接收范围不变。单独验证定向通知的实际标题、服务端 accepted 与真机系统通知，未收到手机反馈前不标记投递通过。

## 故障与收尾

状态未知先只读 status，保持闭锁；不盲重试、不迁移 down、不覆盖生产新数据、不修改旧记录。服务恢复真实流量后优先前向修复。完成后新增日期 deployment，更新 current-production、README 与生产模板；保留旧镜像、备份和审批激活审计，关闭专用 SSH socket。
