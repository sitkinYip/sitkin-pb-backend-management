# 昵称保存 INTERNAL_ERROR 修复

状态：2026-08-28 已发布后端修复，正式容器健康检查通过。本次未修改任何线上玩家资料、账号或数据库结构，也未发布前端资源。

## 根因与复现

玩家资料表单即使只改昵称，也发送 multipart/form-data。原后端只检查 Content-Type，随后调用 `findUploadedFiles("avatar") || []`。PocketBase 0.40.1 在没有头像文件时返回 `http.ErrMissingFile`，在 JSVM 中成为异常；`|| []` 无法处理已抛出的异常，统一错误处理遂返回 HTTP 500 / INTERNAL_ERROR。

对应实现见 [PocketBase Event.FindUploadedFiles](https://github.com/pocketbase/pocketbase/blob/v0.40.1/tools/router/event.go#L102-L112)。

现有测试覆盖 JSON 修改昵称和 multipart 上传头像，但遗漏了“multipart 只有昵称、没有文件”。新增这一请求后，旧代码在真实 PocketBase 临时库中复现了与用户相同的 500 和错误消息。

## 修改

- 后端在已经解析的 multipart 文件集合中确认存在头像后，才调用文件读取方法。只改昵称保留原头像，显式 removeAvatar 仍能移除头像；文件读取异常不会被整体忽略。
- 玩家端在没有 avatar 字段时发送 JSON，有头像时继续发送 FormData，由浏览器设置 multipart boundary。
- 不修改界面、登录、等级、奖励逻辑或数据库结构。

## 验证与清理

- 修改前：新增 multipart 昵称回归失败，得到相同 HTTP 500 / INTERNAL_ERROR。
- 修改后：18 项完整后端测试通过，包括只改昵称、改名保留头像、上传、移除和文件访问权限；GET 回读确认保存结果。
- 玩家端 203 项单元测试通过，样式架构检查、lint 和正式构建通过；新增 JSON 改名与 multipart 上传的传输测试。
- 回归使用随机生成的隔离账号，不使用线上凭据。本次临时测试容器、数据库、镜像和新增二进制目录已清理；没有恢复常驻演示服务。

## 发布边界

两个仓库的修复尚未 commit/push。玩家端传输优化留待正常 GitHub Actions 发布；线上已有前端发送的 multipart 请求现在由修复后的后端兼容处理。不需要替换线上前端，未修改任何 UI。

前端 GitHub Actions 不更新 PocketBase 容器。本次确认旧容器的 api.js 与仓库原版本哈希完全相同后，在原镜像上仅覆盖 `/pb/pb_hooks/lib/api.js`，没有携带其他后端改动或数据库迁移。

## 线上发布与验收

- 正式镜像：`questions-pocketbase:0.40.1-v1.1-profile-fix-amd64`。
- 镜像 ID：`sha256:898d5227cc98791702e4b55606914e608f9cc9f5fb42b4df1559ac0139f6227c`。
- 修复文件 SHA-256：`78cf0ec84daa0349544d7a617cebc137c526c253fa1df31a94db683cefd20ee8`。
- 发布前先在服务器用新镜像启动无宿主数据挂载的临时容器：multipart 仅改昵称并回读、上传头像、改名保留头像、显式移除头像、JSON 修改、空昵称拒绝及未登录拒绝均通过。测试容器及临时库已删除。
- 停止正式容器后完整备份 pb_data，再切换镜像。备份位于服务器 `/opt/1panel/backups/questions-profile-fix-20260828-1538`，归档校验通过；旧镜像保留。
- 正式容器实际运行的镜像与文件哈希符合预期，状态为 healthy；正式域名 `/api/health` 返回 200，未登录 PATCH `/api/questions/v1/me/profile` 返回 401。
- 没有使用真实玩家账号进行修改操作；已验证的是相同发布镜像上的隔离业务请求，以及正式服务运行版本和健康状态。
- 正式端口仍为 `127.0.0.1:8090`；服务器 18090、19090 无监听，本机维护连接和对应临时端口已关闭。

发布补丁和重建材料位于服务器 `/opt/1panel/apps/questions-game-v1/releases/profile-fix-20260828`，运行版本写入根目录 `release.json`。根目录原始 `pocketbase-image.tar` 仍是基础镜像归档，重建本次热修复需在该基础镜像上应用补丁目录的 Dockerfile。根目录文件校验清单已同步且校验通过。

回退时从备份恢复 compose 配置并使用原镜像重新启动即可；本次没有 schema 迁移，无需恢复或覆盖玩家数据库。
