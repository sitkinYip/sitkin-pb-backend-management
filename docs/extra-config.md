# 专属头衔与扩展配置使用说明

本功能的目标是减少后续数据库迁移：本次新增三个集合并完成通用接口后，普通展示字段可以通过后台定义、下发，再由前端直接消费，无需每个字段都增加数据库列或发布 PocketBase 镜像。新的业务行为仍按其职责编写代码。

状态：生产迁移和后端切换已于 2026-09-08 完成，见 [发布记录](extra-config-player-titles-deployment-20260908.md)。两个前端由用户自行发布；三个新表为空，尚未下发生产配置。验证记录见 [本次实现与验收](extra-config-validation-20260908.md)。最初的表盘点和设计取舍见 [调研方案](extra-config-and-player-titles-plan-20260908.md)。

## 1. 专属等级头衔只改变名称

后台「用户管理 → 专属头衔」选择已有成长等级，输入专属名称和原因即可保存，也可撤销恢复默认。

- 一个用户在一个等级只有一条配置；未配置、已撤销时使用全局等级默认名称。
- 可提前配置未来等级；当前等级和下一级预告会采用该用户的专属名称。
- 经验阈值、等级顺序、关卡资格和结算规则完全沿用现有体系。调整用户等级仍通过后台调整经验完成。
- 成长等级 ID 是关联依据，不能在这里新建用户自己的等级或经验阈值。
- 下发名称只更新显示，不额外播放获赠／升级动画。真正升级时现有演出显示解析后的名称。
- 保存和撤销必须填写原因，使用乐观版本检查，并记录操作前后审计；同一请求重试不重复写入。

数据库 `game_player_level_titles` 的 `extra` 为后续头衔附加信息预留，当前保持空对象，不开放任意写入，也不把它作为另一份头衔名称来源。将来需要启用该列，只需相应接口和客户端适配，无需再加列。

## 2. 后台创建一个新的扩展字段

入口：「扩展配置 → 字段定义 → 创建字段定义」。

1. 填写稳定字段标识（例如 `profileGreeting`）和显示名称（例如「专属问候」）。标识须为字母开头，支持字母、数字、下划线，最多 60 位。
2. 选择允许下发的对象和输出位置。用户资料选择 global／rank 与 profile；关卡提示选择对应对象与 level。
3. 选择可见性：玩家可见或仅管理员可见。内部内容不会进入玩家接口或账号认证记录。
4. 选择展示方式：通用文本直接显示 `text` 属性；仅传输则保留在 `extra` 中，前端按需接入新功能。
5. 编辑字段结构 JSON，填写原因并保存。

默认模板已经可以直接用作欢迎语：

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "label": "展示文案",
      "required": true,
      "maxLength": 2000
    }
  }
}
```

例如希望同时向前端下发颜色枚举、开关与数量，可在 properties 增加：

```json
{
  "tone": {
    "type": "string",
    "enum": ["normal", "celebration"],
    "default": "normal"
  },
  "showIcon": { "type": "boolean", "default": false },
  "count": { "type": "number", "minimum": 0, "maximum": 20, "default": 0 }
}
```

这些属性需要由使用它们的前端组件解释；通用文本组件只展示显示名称与 text，不执行 HTML、脚本或业务规则。

支持的声明类型：object、array、string、url、number、boolean。对象使用 properties，数组使用 items；属性可有 label、required、default。字符串可使用 enum／maxLength，数组可使用 maxLength，数值可使用 minimum／maximum。URL 只允许既有安全规则认可的 HTTP(S) 地址。

已有下发记录的定义不能改标识、可见性、范围、渲染方式或已有属性结构。可以在对象中增加可选属性，服务端会复验存量配置；数组元素结构变化等不兼容调整使用新字段标识。停用定义会暂停其全部配置的生效，重新启用会恢复。

## 3. 下发配置

入口：「扩展配置 → 下发记录 → 下发配置」。

选择字段后，表单按定义生成文本、数值、开关或枚举控件；对象和数组提供 JSON 编辑。选择目标、接收范围、操作和原因，先「预览影响」，核对名单、已有配置及规范化后的新值，再确认。

已有配置在预览表格中可展开查看完整值。预览之后如果用户名单、定义或配置版本变化，确认会返回冲突，需要重新预览；普通网络中断可重试原确认操作。

### 接收范围

| 选项             | 语义                                                               |
| ---------------- | ------------------------------------------------------------------ |
| 指定用户         | 去重后为选定的有效用户写入配置，停用账号列为跳过                   |
| 全部当前有效用户 | 执行时的名单快照，未来新建用户不会自动获得；重复请求仍返回首次名单 |
| 公共默认         | 无独立用户绑定，对有权访问目标的现有和未来用户生效                 |

单次最多 100 位用户，超限拒绝整个请求，不暗中分批。一个命令处理一个字段定义和一个目标；需要不同用户不同值时分别下发。各写入在同一事务内完成，逐条记录 before/after 审计。

### 目标范围

| API scopeType    | 后台名称         | ID 含义                                                      |
| ---------------- | ---------------- | ------------------------------------------------------------ |
| global           | 全局             | 无 ID；例如用户资料问候                                      |
| rank             | 成长等级         | `game_level_definitions.id`                                  |
| question         | 题目版本         | `game_questions.id`，影响该题在有权访问的关卡中的展示        |
| session          | 场次版本         | `game_sessions.id`                                           |
| assignment       | 一次场次任务     | `game_assignments.id`，只能绑定任务所属用户                  |
| session_level    | 场次小关卡       | `game_session_levels.id`                                     |
| assignment_level | 某次任务的小关卡 | 关卡 ID＋所属任务 ID，必须属于同一场次且接收者是任务所属用户 |

「等级」与「小关卡」不是同一类对象。给用户下发场次／关卡配置不会授予入场或解锁权限；未入场／未来题目的扩展不会提前返回玩家。效果预览是管理员核对配置的工具，并不改变访问资格。

复制场次或题目产生新的记录 ID 时，扩展绑定不会自动复制。旧绑定继续指向旧版本；个人和单次任务配置也不自动复制。

### 覆盖与撤销

同一输出位置、同一字段命名空间按以下顺序解析，后者优先：

- 用户资料：global → rank。
- 场次详情：global → session → assignment。
- 答题关卡：global → question → session → assignment → session_level → assignment_level。

每一层内，指定用户优先于公共默认；目标具体程度优先于用户具体程度。例如关卡公共值会覆盖个人全局值，要单独改变该用户此关内容，应下发用户＋该关卡的配置。

整个命名空间对象替换，不深度合并，数组整体替换；缺失属性只应用定义自身的默认值，不混入低优先级对象的属性。

| 操作／值               | 含义                                                 |
| ---------------------- | ---------------------------------------------------- |
| 设置完整配置           | 此范围采用新的完整对象                               |
| 屏蔽继承值             | 本层抑制该字段；更高优先级仍可覆盖                   |
| 撤销                   | 撤销本层记录并恢复继承，不会恢复这条记录的上一次旧值 |
| `{}`                   | 合法时是空对象／默认值配置，不等于撤销               |
| `false`、`0`、空字符串 | 类型允许时是有效值                                   |
| `null`                 | 当前不支持，拒绝写入                                 |

刚下发后可「撤销本批次」。撤销会验证该批次的记录仍保持返回时的版本；任何一条被后来修改，整个批次撤销都会拒绝。关闭编辑器后，也可从下发记录逐条选择「撤销」。

「查看用户生效值」展示玩家最终可见的 extra、通用文本和来源绑定，便于排查覆盖。该窗口不展示 admin 可见性字段；管理员可在下发记录中查看其原配置。

## 4. 玩家端接入约定

共享类型源为 `backend/contracts/game.ts`，变更后运行 `node backend/scripts/sync-contracts.mjs` 同步两端。以下对象支持可选字段：

- `GamePlayer.extra / extraDisplay`：用户资料配置，来自 `/me` 以及已有返回玩家对象的接口。
- `GameAssignment.extra / extraDisplay`：场次详情配置，不加入场次概要列表。
- `GameLevel.extra / extraDisplay`：已允许查看的答题关卡配置。
- `GameRank.defaultName / customTitle`：默认名称与个人名称，`name` 保持最终可显示名称。

示例玩家数据：

```json
{
  "extra": {
    "profileGreeting": { "text": "欢迎回来，星河守护者", "showIcon": false }
  },
  "extraDisplay": [
    {
      "key": "profileGreeting",
      "label": "专属问候",
      "text": "欢迎回来，星河守护者"
    }
  ]
}
```

普通新字段通过 `extra` 字典自动保留，核心玩家／任务协议仍严格解析；未知字段只在 extra 容器内透传，不能覆盖 DTO 顶层。消费一个新命名空间时建议在组件边界验证类型：

```ts
const greeting = z
  .object({
    text: z.string(),
    showIcon: z.boolean().optional(),
  })
  .safeParse(player.extra?.profileGreeting);

if (greeting.success) {
  // 使用 greeting.data；不把这里的值用于经验、奖励或权限判断。
}
```

当前 `ExtraMessages` 通用组件已接入玩家身份卡、场次详情和答题关卡，使用普通 React 文本渲染；新建 text 渲染字段可以立即复用。资料与答题详情沿用约 5 秒轮询；后台标签页、网络中断和浏览器调度会影响实际刷新时间，不承诺实时推送。

旧后端未提供 extra 时组件显示原有内容；旧玩家端会忽略新 extra，但仍可显示服务端解析后的专属头衔 name。损坏的可选配置单独忽略，不使正常答题接口或页面整体失败。

## 5. 接口与存储

接口前缀均为 `/api/questions/v1`。以下管理接口要求 game_admins 身份。

| 方法与路径                               | 用途                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET `/admin/players/:id/titles`          | 查询用户各等级的专属头衔                                                                                 |
| POST `/admin/players/:id/titles`         | `action=save/revoke`，携带 levelId、expectedRevision、reason、requestId；save 需 name                    |
| GET `/admin/extra-definitions`           | 读取字段定义                                                                                             |
| POST `/admin/extra-definitions`          | 创建／更新／停用定义；携带 id（更新时）、key、label、status、schema、expectedRevision、reason、requestId |
| POST `/admin/extra-configs/query`        | 分页读取记录；支持 definitionId、playerId、scopeType、batchId、page；每页 20 条                          |
| POST `/admin/extra-configs/preview`      | 校验并返回名单、规范化值和 version；只读，不写回执                                                       |
| POST `/admin/extra-configs/dispatch`     | 与预览输入一致，并增加 expectedVersion、requestId；事务提交                                              |
| POST `/admin/extra-configs/revoke-batch` | batchId、records（id/revision）、reason、requestId；原子撤销选定批次记录                                 |
| POST `/admin/extra-configs/inspect`      | playerId、context；任务上下文增加 assignmentId，关卡上下文再加 sessionLevelId；只读                      |

定义的 schema 由 scopes、contexts、visibility、renderer、fields 组成；fields 是前文中的对象声明。新记录 expectedRevision 为 0。POST 查询／预览／查看生效值是只读动作，不要求 requestId。

配置预览／提交输入示例（ID 为示意，使用实际记录 ID 替换）：

```json
{
  "definitionId": "字段定义ID",
  "scopeType": "session_level",
  "scopeId": "小关卡ID",
  "audience": "selected",
  "playerIds": ["用户ID"],
  "action": "value",
  "extra": { "text": "给这位用户的专属提示" },
  "reason": "配置本场专属提示"
}
```

服务器生成 targetKey／recipientKey，客户端不得自定义；全局公共值用规范化键 global／public。`game_extra_configs` 对 `(definition, targetKey, recipientKey)` 建唯一索引。每行只存一个字段命名空间的对象值，玩家响应才按定义 key 聚合。

写接口白名单阻止通过头衔或 extra 修改真实经验／资格字段。直接集合 API 保持私有；多态目标的存在、任务归属和范围由后端验证。不要直接在 PocketBase 管理 UI 中绕过业务 API 写配置，否则会跳过版本、校验和审计。

## 6. 容量与业务边界

- 最多 100 个字段定义、单次下发最多 100 位用户。
- 单个配置及字段定义最多 16 KiB；对象最多嵌套 4 层、每层 50 键、数组最多 50 项、单文本最多 4000 字符（可配置更小）。
- 单个输出对象 extra 最多 64 KiB；一次解析器在同一详情响应中分配的配置与通用展示内容合计最多 256 KiB。超出读取预算时按稳定字段顺序忽略后续可选配置，不能把大正文当作通用 extra 存储。
- 配置按合法目标与当前用户批量读取；一次请求内复用索引，不按每道题重新查扩展表。管理目录不加载全部扩展记录，另用分页查询。
- JSON 不承担高频搜索／排序／统计／唯一约束／强外键。字段发展到这些职责时，应使用专用列、索引或表。
- 经验、奖励、判题、入场资格、解锁、核销、权限和任务状态不能由通用配置驱动。
- 不提供定时生效、任意脚本、动态业务规则或一次性弹窗。普通显示值实时解析，历史任务重开时也可能看到新值；奖品和演出历史仍按原快照语义处理。
- 首版对象注册表包括前文七种范围；新对象类型通常只需后端权限／解析适配和 UI 接入，是否迁移取决于新增约束，不必为了新展示键增加列。

## 7. 首次发布与后续迭代

本次只增加 `1788825600_player_titles_extra.js`，创建三个空私有集合，不修改原表，不回填用户或内容。符合现有新增空集合 verifier 的类别；真实发布仍须冻结匹配源码和迁移差异，不能复用上次发布的 allowed-delta／版本操作单。

新表及索引：

- `game_player_level_titles`：`idx_game_player_level_titles_owner`，以及 SQLite 主键自动索引。
- `game_extra_definitions`：`idx_game_extra_definitions_key`，以及 SQLite 主键自动索引。
- `game_extra_configs`：`idx_game_extra_configs_binding`、`idx_game_extra_configs_lookup`、`idx_game_extra_configs_request`，以及 SQLite 主键自动索引。

生产迁移时三个集合保持为空；创建字段定义和首次下发属于后续激活。后端可在空表状态先行，前端兼容后再开放运营使用。新管理端依据 catalog.capabilities 禁用旧后端不支持的入口。

回退旧应用代码可保留这三个表；禁止用 down migration 删除配置，更不能通过恢复旧数据库覆盖发布后新产生的答题历史。各组件的实际发布状态按原有发布规范单独记录。

首次发布完成后，新增受支持类型与范围内的展示字段只需：后台定义 → 下发 → 前端读取新键（或复用通用文本组件）。无需增加数据库列，也无需为每个键重新发布 PocketBase。
