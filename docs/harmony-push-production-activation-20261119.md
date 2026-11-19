# 2026-11-19 生产 Push 独立运行配置记录

15:12:56 +08:00，既有账号级后端完成生产 Push 运行启用，独立配置状态为 `enabled-verified`。本轮不是新镜像发布或数据库迁移；只在原 Compose 增加五项环境变量及一个只读服务账号挂载，并保留用户保存的接收范围。当前尚未取得 SUBSCRIPTION 分类权益，不能把注册成功或公告测试称为新场次、剧情来信已可通知。

## 基线与唯一差异

| 项目 | 结果 |
| --- | --- |
| 原已发布版本 | `push-account-subscription-20261119`；13:21:03 进入 `recorded`、revision 15；[当时发布记录](harmony-push-account-subscription-deployment-20261119.md) 保持原样 |
| 镜像 | `questions-pocketbase:0.40.1-push-account-subscription-20261119-amd64`，未重建或替换 |
| 实际 image/config ID | `sha256:2304010161587e4409b4073befce684cfb6b48e52c6ac711107aead2c043a43a`，OFF/ON 均保持 |
| 原 Compose SHA256 | `20e7a02a749a43af61344ef9f3b64f9e51be3e77daae0fd9f366f33a43f00ff9` |
| 配置关闭阶段 SHA256 | `5b70e6e79bde7499ce507fa1b509a406671c3e402f8e3ab54602f110d49ea6d7` |
| 配置启用阶段 SHA256 | `3ef3d9ca68ded2b6356d8b96273686f3c377fbfd44255fdd812defde45dd8341` |
| 运营范围 | 用户保存的 `audience=all`、revision 2、两项保留玩家 ID 原样保持；没有改名单或 revision |
| 数据与审计 | 原 pb_data 路径与挂载未替换；迁移账本、Schema、根 `release.json` 和 `SHA256SUMS` 未改；没有重跑迁移或恢复旧数据，正常设备注册及公告入队写入保留 |
| 独立记录 | `/opt/1panel/config-records/questions-game-v1/push-production-activation-20261119/activation-state.json` |

候选有效配置经逐项比较，除以下五个变量和一个挂载外，与原基线相同；ON 比 OFF 仅改变 `STARWARD_PUSH_ENABLED`：

| 环境变量或挂载 | 当前值 |
| --- | --- |
| `STARWARD_PUSH_ENABLED` | `1` |
| `STARWARD_PUSH_TEST_MODE` | `0` |
| `STARWARD_PUSH_PROJECT_ID` | 原匹配项目，未变更归属 |
| `STARWARD_PUSH_SERVICE_ACCOUNT_FILE` | `/run/secrets/starward-harmony-push.json` |
| `STARWARD_PUSH_SUBSCRIPTION_APPROVED` | `0` |
| 额外只读 bind | 服务器独立 secrets 目录内的既有 JSON → 上述容器路径；`read_only=true`、不自动创建源文件 |

凭据在服务器核验所有者、权限、严格字段、项目匹配和 RSA 格式；不保存内容或密钥摘要。密钥不放入 pb_data。随后正式发送返回 `80000000`，实际云端鉴权通过；不以格式检查替代发送结果。

## 已完成的运行与设备验证

- 本地先使用合成 RSA、空数据库和无外网的 Docker 内部网络，完成 OFF→ON→OFF→原基线四阶段演练；校验精确挂载/环境、不可变镜像身份、重建后同一容器 ID、健康检查和只读凭据。临时容器、网络、数据与合成密钥均已清理；不曾将真实 JSON 挂载到本地容器，也没有外发。
- 生产 OFF 阶段于 15:10:30、ON 阶段于 15:12:56 完成。每阶段先在未启动新容器检查精确配置，启动后使用同一容器 ID 复核；各有三次不同健康探针成功、重启计数 0。HTTPS 健康为 200，三个未认证接口探针均为 401。
- 当前用户已建立一条生产 Push 绑定，解绑票据有效；USB 测试机此前设置中同步错误消失。用户说明同账号在两台手机登录，邀请测试手机确认收到系统 Push；USB 手机收尾实际在登录页。本轮没有证明两台同时登记，不输出 token、票据或设备标识。
- 生产启用前 bindings/jobs 均为 0；随后注册产生上述绑定。本轮没有入场、答题、奖品结算、额外已读或迁移写入。

运行证据与不含凭据的结果摘要在同工作区原生项目 `artifacts/private/push-production-activation-20261119/` 私有目录保存；对外文档仅记录上述状态和摘要，不复制玩家 IDs、登录会话或密钥内容。原生侧完整状态见该项目 `docs/push-production-activation-2026-11-19.md`。

## 公告测试与订阅权益边界

15:27:20，操作者通过运营后台只向当前用户提交一条新的 MARKETING 合成公告，未向 `all` 广播，`testMessage=false`。15:28 首次尝试 accepted，providerCode=`80000000`；用户明确确认另一台邀请测试手机收到系统 Push。USB 设备未见该卡，最终实际在登录页，不将其未显示外推为邀请包未送达。邀请包点击后回源仍待本轮验收。

15:32:21 只读核对：生产 healthy、零重启、Compose 摘要仍匹配启用候选；1 条有效绑定；新公告仍未读，当前玩家已读数较发送前保持 6，答题提交仍为 63，入场/答题命令计数没有变化。用户此前两条公告在约 10 秒、13 秒内读完，在分钟级 worker 取队列前已不符合未读条件，discarded / attempts 0，未调用华为；不能把它们计作消耗营销投递额度。

当前发送器只保留 providerCode，没有保存华为 requestId；单条自助追踪需 requestId 与 token，这是后续诊断可补的边界，不因此重发已经 accepted 的通知。用户确认的正式邀请手机展示与云端接受分别记录，不冒充 USB 截图或两机送达证据。

华为页面实查：0.1.3 邀请测试已审核通过并处于测试中，SUBSCRIPTION 分类申请仍审核中。当前 approval 固定关闭，新场次、剧情来信与关卡动态不会入队，也不会降为 MARKETING 消耗营销额度；平台公告/推广保留 MARKETING。未来分类实际获批后，需独立启用 approval 并以新生成的专用事件验证，不能声称已保证每天 20 次到达，不补造此前未入队的历史事件。

## 回退与后续发布

若启用阶段异常，优先恢复同镜像、同数据和同只读挂载的 OFF 候选，并重做新容器身份及三次健康检查；只有凭据挂载本身不能成立时才恢复原 Compose。不得恢复数据库快照、删除迁移账本或改旧发布记录。

原冻结 runner 只支持单数据挂载，当前只读 secret 挂载属于独立记录的运行配置。后续代码发布须显式支持此挂载并重新盘点现场；本轮没有扩展 runner，也不能修改旧审计伪装成原发布自动激活。仓库 Compose 模板仍保留原发布模板，实际现状以 [当前生产状态](current-production.md) 及本记录为准。
