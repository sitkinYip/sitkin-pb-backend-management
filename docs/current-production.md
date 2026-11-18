# 当前生产状态

最后同步：2026-11-18 16:52:45 +08:00。依据 [鸿蒙 Push 后端发布记录](harmony-push-deployment-20261118.md)。日期记录保留当时的验收事实；下次操作仍须只读复核现场。

## 当前组件状态

| 组件或闸门 | 状态 | 说明 |
| --- | --- | --- |
| PocketBase 数据库迁移 | 已部署 | `1794988800_harmony_push.js`、`1794988860_push_audience.js` 各入账一次；新增三个私有集合在发布时均为空 |
| PocketBase hooks / API | 已部署 | `questions-pocketbase:0.40.1-harmony-push-20261118-amd64`；未认证 Push 设置接口返回 401 |
| 运营后台「鸿蒙推送」入口 | 待单独核验 | 管理前端部署不随 PocketBase 镜像切换；需验证正式页面和已登录配置读写 |
| 正式发送凭据与总开关 | 本次未配置、开关关闭 | 新设置集合为空；默认仅白名单且名单为空。凭据挂载和打开总开关分别验收 |
| 支持 Push 的邀请包及生产通知 | 本次未验 | 先配置专用游戏玩家白名单与邀请包，再验华为接收、系统通知、点击回源 |
| 既有业务 | 保留 | 本次只新增 Push 结构，未对既有业务配置回填，也未用生产账号做业务写入验收 |

此前专属头衔与扩展配置的部署与当时激活状态见 [2026-09-08 发布记录](extra-config-player-titles-deployment-20260908.md)。本次未复核其业务配置或前端上线情况。

## 最近核对的运行基线

- 容器：`questions-game-v1`，同一容器连续通过 3 次独立健康检查，重启计数为 0。
- PocketBase：0.40.1，Linux AMD64，`--automigrate=false`。
- 实际镜像 ID：`sha256:7f49ae9fade29775bc0f661091997f220e415f42da5ad61f9f2413258ddbaa23`。
- Compose SHA256：`be9c189aedd4f3a6b4c31302e292c5f1115e53ae785daa8e148bc0bff56cbb25`；对应仓库模板 `backend/deploy/1panel/compose.production.yaml`。本次只更换镜像，保留原数据挂载和 `127.0.0.1:8090`。
- 公开 HTTPS 健康返回 200；未认证的后台身份、玩家场次、Push 设置接口均返回 401。
- 迁移账本 SHA256：`7d2a3ab699f55ef39ecdaf932a66aa7ac167598e5fa96c0a71331b38536a02d6`。
- 根 `release.json` SHA256：`f53c0bda7d8c4f4ea4a945e099883d00b930b664e274408410ff23cf8118deb9`。
- releaseId：`harmony-push-20261118`，phase=`recorded`，revision 15，无未决阶段或阻塞。

以上是发布验收时的快照。后续凭据配置如更改运行 Compose，须作为独立变更记录及复核，不复用本次冻结包更新根发布材料。

## 当前操作单

`backend/deploy/1panel/UPGRADE.md` 为已完成操作单，没有待执行的生产升级。下次须独立核对 source、target、迁移允许差异与现场状态，再准备新的待执行操作单。Push 运营配置见 [鸿蒙 Push 接入说明](harmony-push.md)。
