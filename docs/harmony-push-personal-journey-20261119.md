# 不关联场次的定向旅途消息（2026-11-19）

本轮新增后台用途「定向旅途消息（无需关联场次）」，仅发给指定玩家。内容仍限于玩家已经明确订阅的个人剧情来信与旅途动态，不扩成任意「重要消息」，不改已有同意或自动开启通知。场次动态和公告保留原有行为。

## 逐状态验收

| 场景 | 预期 | 验证状态 |
| --- | --- | --- |
| 管理端选择定向旅途消息 | 只能选指定用户，不要求场次；切换用途不会带入旧场次范围 | 本机浏览器与隔离真实 PB 通过；空接收人不发请求，成功后重置表单 |
| 无场次且双阶段订阅已同意 | 创建真实未读收件记录；权益、账号与绑定允许时按 SUBSCRIPTION 入队 | 隔离真实 PB 通过；仅合成发送器 |
| 未订阅／未确认通知／权益未启用 | 应用内仍可收信；不入队，也不降级 MARKETING | 隔离真实 PB 通过 |
| 撤回、已读、过期、取消订阅后重新开启 | 未发送的旧任务不发送，不补发或复活 | 隔离真实 PB 通过 |
| 旧场次上下文升级 | 旧数据保持场次含义；缺损或未知类型不获得订阅投递资格 | 恢复副本迁移、再次启动及缺损注入通过；其余业务、集合定义与 schema 不变 |
| 兼容旧运营台 | 未指定用途仍作为公告；现有场次用途仍需真实场次归属 | 隔离真实 PB 通过 |
| 生产及华为实际送达 | 需发布迁移和运营台，且华为实际批准相应订阅范围后另验 | 未执行 |

「MARKETING 每日额度」指华为的频控条数，不是购买次数包或余额。服务类分类也受设备频控、权益与用户通知设置约束；不承诺任意消息保证抵达。规则见 [华为通知消息分类](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-apply-right/)。

## 收费与频控的区别

华为 HarmonyOS 指南 [如何收费](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/push-faq-11/) 明确回答免费。`MARKETING` 的每日 2 或 5 条是每应用、每设备、每自然日的频控，不是付费余额；服务与通讯类别采用不同频控，也不代表任意消息无限量。

用户提到的 MeoW，其开发者 [API 文档](https://www.chuckfang.com/MeoW/api_doc.html) 写明非会员 3 秒 1 条、每分钟 15 条、每小时 60 条、每天 1000 条。这足以说明其他应用能够提供更高频的服务，但该文档未披露实际使用的华为云侧分类及获批权益，不能由此推断本应用已经具备同样权益。MeoW 的自定义 `category` 参数用于其消息列表分类，不能当成华为通知类别。

## 发布边界

新前向迁移修改现有 `game_push_notice_contexts`：新增必填 `kind=session/account`、旧行回填 `session`，原 session 关联改为可选。收件、账号订阅、投递数据结构及原生 DTO 不变，已有两阶段同意不改写。无需为该选项重新打原生包。

已新增窄范围 `personal-journey-context-v1` 验证器及固定 `contextEvolution`，不能复用上一轮新增空集合的允许差异。它只允许本次既有上下文表的字段变化，严格校验历史行投影、其余 schema/集合/业务行/历史账本不变。显式运行契约保留现有五项 Push 环境变量和专用只读凭据挂载；不读取凭据、不修改旧审计。逐阶段发布闸门仍保留，当前尚未执行生产迁移或切换，也不修改华为申请或权益配置。

发布顺序必须先完成后端迁移及新运行代码，再发布运营台。不能只推送静态前端，让旧后端接受尚不认识的新用途。

## 本地验证

- `PB_DOCKER_IMAGE=questions-pocketbase:starward-push-crypto-test PB_PUSH_VALIDATE_OPENSSL=1 node --test --test-concurrency=2 backend/tests/*.test.mjs`：138 / 138 通过，0 失败、0 跳过，包含新增 4 组真实 PocketBase 集成用例，以及合成 RSA/OpenSSL 实签和独立验签。云端发送器为合成实现，未加载正式凭据或调用华为发送。
- `pnpm test:admin`：48 / 48 通过，0 失败、0 跳过。首次运行暴露引导文案由固定三步变为四步的问题；恢复三步后复验通过，没有修改测试规避。
- `pnpm build`：TypeScript 与 Vite 生产构建通过；保留既有大 chunk 提示，无新依赖。
- `node backend/scripts/sync-contracts.mjs --admin-only --check`、`git diff --check`：通过。只更新本仓库生成契约；本轮不改玩家 Web 或原生代码。
- 本机浏览器在独立临时库完成 3 次真实表单提交：定向仅 A 收件且 assignment 为空；场次消息仅参与者 B 收件；全体公告 A/B 均收件。另验证用途/范围切换清理旧值、必填无请求、提交成功恢复默认。43 项浏览器/API断言包含重复 HTTP 检查，另外核对 3 项持久上下文，不作业务完成百分比。5 张私有截图经独立检查无阻塞；预览 iframe 为本地空替身，不计作玩家端视觉验收。专属 DB、容器和 Vite 均已清理；浏览器所有外网请求被阻止，生产未访问。
- 静态独立审查未发现阻塞。变异测试曾在独立副本尝试移除接收范围门禁，但 4 次均在初始化管理员时遇 socket 中断，未到目标断言，明确记为受阻，不声称测试捕获了变异。原始源码未改，138 项正常测试结果独立保留。

脱敏证据位于原生仓库 [后端与迁移摘要](../../starward_hm/artifacts/validation/push-personal-journey-20261119/backend-summary.json)、[浏览器提交与环境清理](../../starward_hm/artifacts/validation/push-personal-journey-20261119/ui-summary.json)。本轮没有原生运行代码改动，未重新构建、装机或测试华为实际送达；这些不能由本地结果替代。

## 专用发布验证器验收

51/51 发布计划、控制器、执行器和出包测试通过，包含 Python 3.6 AST 兼容及离线自检。另 1/1 真实 Docker PocketBase 迁移测试通过：保留一行既有上下文的全部旧列，拒绝 11 类 SQLite 副本漂移；正式恢复服务后的新增 account 上下文允许，停服迁移期间的同类新增仍拒绝。独立执行器副本移除旧行保护后，负例真实失败，变异已检出。实际 resolved Compose 及 JS/Python 双侧计划校验通过。证据：[验证器源码摘要与命令](../../starward_hm/artifacts/validation/push-personal-journey-20261119/release-verifier-summary.json)。
