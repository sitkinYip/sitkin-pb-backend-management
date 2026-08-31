---
name: questions-admin-maintenance
description: 维护 Sitkin 答题后台仓库的代码与文档时使用，包括 React/Refine/Ant Design 管理端、PocketBase hooks、增量迁移源码、共享协议、测试和管理端静态发布判断。仅检查或操作生产 PocketBase/SQLite 时改用 questions-pocketbase-production；同一任务还修改本仓库时两者并用。纯玩家端 UI 工作不触发。
---

# Sitkin 答题后台仓库维护

本 Skill 负责 `sitkin-pb-backend-management` 的开发、评审、验证和发布规划。相对本 Skill 的仓库根为 `../../..`，下列命令都在该根目录执行。它不授权生产连接、数据库写入、commit、push 或部署。

## 先按改动路由

开始时读取 `../../../README.MD`，在仓库根检查 `git status --short`，保留用户已有修改。随后只加载当前任务需要的资料：

| 模式 | 主要位置 | 必读资料 | 最低验证 |
| --- | --- | --- | --- |
| 管理 UI、表单、样式 | `../../../src/`、`../../../tests/` | `../../../docs/admin-ui-engineering-standards.md` | `pnpm test:admin`、类型检查、构建、响应式视觉检查 |
| hooks、权限、业务规则 | `../../../backend/pb_hooks/` | `../../../backend/README.md` | `pnpm test:backend`、目标镜像隔离验证 |
| 集合、字段、索引 | `../../../backend/pb_migrations/` | `../../../backend/README.md`、`../../../docs/backend-release-safety.md` | 空库迁移、旧库恢复副本、重启持久化 |
| 共享协议、跨端行为 | `../../../backend/contracts/game.ts`、`../../../../questions-web` | `../../../docs/project-maintenance-and-release.md` | 同步协议并验证所有受影响消费者 |
| 管理端静态发布 | `../../../.github/workflows/deploy.yml`、`../../../src/` | `../../../docs/project-maintenance-and-release.md` | 管理端完整检查；用户明确要求后才 push |
| 生产 PocketBase / SQLite | 1Panel、生产容器或 `pb_data` | 使用 `questions-pocketbase-production` | 仅在同一任务还修改仓库时保留本 Skill |

不要为了普通代码任务主动连接生产。只有发布规划需要了解当前组件状态时，才读取 `../../../docs/current-production.md`。

## 共享强制规则

- 管理端本地默认连接线上 API。本地页面写操作会修改真实数据；写入验收必须显式指向隔离 PocketBase，或由用户单独批准专用生产对象。
- 权限、结算、经验、奖励、核销、内容引用和幂等由服务端保证。隐藏按钮、只读表单和前端校验只改善体验，不是安全边界。
- `../../../backend/contracts/game.ts` 是共享协议源。修改后在仓库根运行 `node backend/scripts/sync-contracts.mjs`；无法检查相邻玩家端时，明确记录未验证项，不假装已同步。
- 已执行迁移不可修改。新结构使用新的增量迁移；测试只使用临时数据目录，不挂载生产 `pb_data`。
- 代码修改、commit、push、静态站部署、生产连接、迁移、业务数据写入和真实账号验收分别授权；一种授权不自动包含另一种。
- `push main` 只部署管理端静态文件，不发布 hooks、PocketBase 镜像或数据库迁移。

## 跨层兼容与发布规划

涉及 API、新字段、新集合或行为语义时，先写兼容矩阵，至少回答：旧玩家端配新后端、新玩家端配旧后端、旧管理端配新后端、新管理端配旧后端，以及新管理端是否会提前制造旧玩家端不能安全消费的数据。

- 发布顺序由兼容矩阵决定，不使用固定的“后端、管理端、玩家端”顺序。
- 把“代码完成”“后端部署”“玩家端部署”“管理端部署”“功能激活或产生首条新数据”“生产业务写入验收”分开报告。
- 后端只有在新能力可保持休眠且休眠条件可验证时才能先行；产生新数据的管理端必须晚于能够安全消费它的客户端。
- 可选字段必须定义缺失、显式空值和非空值的不同语义。一次性效果由服务端事务快照和幂等回执决定，前端不能在权威空结果时退回差量猜测。

具体矩阵和发布状态模型见 `../../../docs/project-maintenance-and-release.md`。

## 管理端 UI 工程规则

实现 UI 前完整读取 `../../../docs/admin-ui-engineering-standards.md`。核心约束如下：

- 沿用 Ant Design、Refine、现有主题 token 和 `../../../src/game/ui.tsx` 共享组件，不并入第二套设计系统，不用零散硬编码重做同类模式。
- 后台定位为可信、克制、高信息密度的运营工作台。优先任务清晰、可扫描和防误操作，不添加营销页式装饰、玻璃效果或无意义动画。
- 重复编辑采用摘要列表和渐进展开；不要同时展开十几条完整表单。原因、并发冲突、只读原因、危险操作和未保存状态必须明确。
- 桌面与手机都要设计，不把响应式理解为缩小字号。页面不能横向溢出；表格在自身区域滚动，抽屉不超过视口，手机表单改单列，底部操作考虑安全区。
- 覆盖加载、空、错误、只读、无权限、并发冲突、提交中、成功和长中文内容；保持键盘焦点、可见标签和减少动画支持。
- 优先复用 `PageCard`、`Field`、`AdminTable`、`EditorDrawer` 以及已有领域字段组件。`Form.Item` 的实际输入控件保持为直接子节点，避免破坏 Ant Design 绑定。

## 完成定义

1. 运行与风险相称的测试、协议检查、类型检查和构建；UI 改动按规范完成视觉矩阵，后端改动完成隔离 PocketBase 验证。
2. 更新受到影响的长期文档、功能说明和当前状态指针。带日期的 deployment 文档是当时审计记录，不改写为后来状态。
3. 清楚交代每个仓库和每个组件的已完成、未完成与不在范围；健康检查不等于业务写入验收。
4. 执行 `git diff --check`，不得清理或覆盖无关工作区内容。

若任务进入生产只读检查、备份、迁移、镜像切换、回退或恢复，使用 `questions-pocketbase-production`，不要把本文当成生产操作单；只有同一任务仍包含代码或文档改动时才两者并用。
