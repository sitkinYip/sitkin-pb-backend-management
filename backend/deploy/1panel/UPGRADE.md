# 场次进度订阅后端升级操作单

<!-- release-status: completed -->
<!-- release-id: progress-watches-20261126 -->
<!-- source-image: questions-pocketbase:0.40.1-home-unread-20261126-amd64 -->
<!-- target-image: questions-pocketbase:0.40.1-progress-watches-20261126-amd64 -->

本轮于 2026-11-26 19:15:38 +08:00 进入 `recorded` revision 15。原待执行文本和允许差异清单随冻结包归档。下一次发布使用新的盘点和操作单。 [本次发布记录](../../../docs/progress-watches-deployment-20261126.md)

## 已执行范围

- 发布 PocketBase 0.40.1 Linux AMD64 镜像与 `1795680000_progress_watches.js`。新增两个私有空集合及对应索引，面向已授权的账号提供场次进度详情。
- 按 STAGE、BACKUP、MIGRATE、SWITCH、FINALIZE 独立确认。停写备份经过恢复和升级演练，正式迁移只应用一次。切换仅替换 Compose 镜像指针并保留既有生产约束。
- 最终核对连续三次健康探测成功、零重启、HTTPS 200、七条匿名探针 401、新表为空。旅途 Push v2 延续，进度 Push 确认保持关闭。
- 归档发布报告、备份和旧版依据，关闭专用 SSH。客户端、运营台、进度 Push 激活和生产写入验收单独交付。

恢复真实流量后若需回退，先审核旧镜像与现有加性结构的兼容性，保留当前业务数据。
