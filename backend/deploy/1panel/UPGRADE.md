# 定向旅途消息后端升级操作单

<!-- release-status: pending -->
<!-- release-id: push-personal-journey-20261119 -->
<!-- source-image: questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-push-personal-journey-20261119-amd64 -->

待执行；本单仅适用于本次冻结制品。用户已授权验证后上线后端及运营台。本次不会调整华为分类权益、接收名单、订阅范围或凭据；沿用现有发送开启、正式模式、订阅权益未启用的运行状态。历史发布归档及独立 Push 激活记录保持不变。

## 唯一目标与基线

- 主机 sitkinYip；唯一容器 questions-game-v1，项目 /opt/1panel/apps/questions-game-v1。
- PocketBase 0.40.1、Linux AMD64、--automigrate=false；既有 pb_data 和 127.0.0.1:8090 保持。
- source 实际 image/config ID：sha256:2304010161587e4409b4073befce684cfb6b48e52c6ac711107aead2c043a43a。
- source Compose SHA256：3ef3d9ca68ded2b6356d8b96273686f3c377fbfd44255fdd812defde45dd8341。
- 根 release.json SHA256：7fdf89a2c37db7171acb7bf9e279171d9f5cbdea70bec54ef60c999a9b300fa2。
- 迁移账本 SHA256：292925750bca0895480457ab13947dddc9889b5a817e5d7f82ed17fd3392490c，最后业务迁移为1795075260。
- 只读盘点时 healthy、零重启；context 表零行。停服前重新盘点，不能把当前零行假定为迁移时仍为空。
- 保留数据 rw 挂载和既有 /opt/1panel/secrets/questions-game-v1/starward-harmony-push.json 到 /run/secrets/starward-harmony-push.json 的只读挂载；不读取密钥内容。
- 保留现有五项 Push 环境配置：ENABLED=1、TEST_MODE=0、PROJECT_ID、SERVICE_ACCOUNT_FILE 和 SUBSCRIPTION_APPROVED=0。值必须由专用运行契约校验，禁止借切换镜像调整功能开关。

## 兼容性和发布顺序

旧玩家端和旧运营台在新后端继续使用原接口、原通知字段。新运营台的 personal_journey 不兼容旧后端，因此先完成后端迁移、镜像切换和只读验收，再推送 main 发布运营台。客户端已有 personal_journey_v1 一次订阅语义，本功能不需要新客户端包。

新用途只允许指定玩家，且只能发送现有旅途订阅同意范围内的个人剧情来信和旅途动态；不作为任意重要通知绕过华为分类的入口。公告和推广继续 MARKETING；旅途分类未获批或开关关闭时停发，不降级营销。

## 唯一允许迁移差异

新增1795075320_push_personal_journey_notices.js，使用本轮受审的 personal-journey-context-v1 验证器。只允许 game_push_notice_contexts 的 session 从必填改为可选、新增必填 kind（session/account）；所有既有上下文补 kind=session，原始 id/notification/session 和其他字段保持。所有其他集合定义、schema、逐表数据摘要和历史迁移账本记录必须保持；不新增业务表，不修改玩家、场次、通知、订阅或设备数据。异常、缺失或未知 kind 不允许降级发送。

## 冻结与执行

1. 固定源码清单与官方 AMD64 runtime 摘要，核对镜像内 hooks/migrations、候选 Compose、两层 SHA256SUMS 和新 allowed-delta；来源、目标与本单一致。
2. 只读 preflight 通过后，独立现场 TTY 批准 STAGE；导入并运行隔离验证，不停服。
3. BACKUP 阶段停止唯一服务，完整备份 pb_data、实际 Compose、根版本材料；在独立恢复副本验证文件保真、SQLite 完整性、新迁移允许差异、两次启动和迁移不重复。生产此时保持停止。
4. 核对 status 无未决后独立批准 MIGRATE，只执行一次；再次只读核验后独立批准 SWITCH。切换只替换镜像，全部运行契约、环境及两挂载不变。确认同一容器、零重启和三条不同的连续健康记录后恢复服务。
5. 独立批准 FINALIZE，写新发布记录和根版本材料。status 必须 recorded，无未决 marker。现场 TTY 闸门来自 docs/pocketbase-release-program.md 第3–4节；本次依据用户“改动验证没啥问题就上线”的明确委托，由代理在逐阶段复核后执行当场短语，不修改控制器、不跳步或自动跨阶段。
6. 验 HTTPS health 200、既有四项未认证接口401和目标镜像/代码身份。健康及认证探针不等于生产业务写入或华为真实投递通过。
7. 后端完成后再发布运营台，核对线上 JS/CSS 字节与已验产物。当前分类权益未启用，不能宣称定向旅途 Push 已实际送达。

## 故障与收尾

任何差异或结果未知先只读 status，保持闭锁；不盲重试迁移、不删表/账本、不运行 down、不更改旧发布证据。服务恢复真实流量后禁止旧快照覆盖当前库，优先前向修复；回退旧代码亦需先审兼容性。

完成后写本轮日期 deployment、更新 current-production、README 和生产模板；保留本单冻结副本、旧备份、原镜像及独立激活审计，不清理无关服务。生产 Push 分类获批后的启用需另行核验和记录。
