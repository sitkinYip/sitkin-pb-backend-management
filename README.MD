# Sitkin Backend Management (Sitkin 后台管理系统)

<div align="center" style="margin: 30px;">
    <a href="https://refine.dev">
    <img alt="refine logo" src="https://refine.ams3.cdn.digitaloceanspaces.com/readme/refine-readme-banner.png">
    </a>
</div>
<br/>

Sitkin Backend Management 是一个基于 [Refine](https://github.com/refinedev/refine) 和 React 构建的现代后台管理系统，旨在提供高效的内容管理体验。本项目集成 Pocketbase 作为后端服务，支持多语言（i18n）和丰富的交互功能。

## 🛠️ 技术栈 (Tech Stack)

- **核心框架**: [Refine](https://refine.dev/), [React 19](https://react.dev/)
- **构建工具**: [Vite](https://vitejs.dev/)
- **UI 组件库**: [Ant Design](https://ant.design/)
- **后端服务**: [Pocketbase](https://pocketbase.io/)
- **国际化**: i18next

## ✨ 功能模块 (Features)

本项目包含以下核心管理模块：

- **用户认证 (Authentication)**

  - 支持完整的登录、注册及找回密码流程。

- **信件管理 (Letter Management)**

  - 管理应用内的信件内容，支持富文本编辑及样式预览。

- **关卡管理 (Levels Management)**

  - 灵活配置游戏或应用关卡，支持题目编辑与选项管理。

- **短语管理 (Phrase Management)**
  - 维护常用短语及词条库，提升内容复用性。

## 🚀 快速开始 (Getting Started)

### 环境要求

请确保你的开发环境已安装以下工具：

- [Node.js](https://nodejs.org/) (推荐 LTS 版本)

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:5173 即可查看开发环境。

### 构建生产版本

```bash
npm run build
```

### 预览生产构建

```bash
npm run start
```

## 📚 了解更多 (Learn More)

想要了解更多关于 Refine 的信息，请查看官方文档：

- **Refine Documentation** [Docs](https://refine.dev/docs)
- **Ant Design** [Docs](https://refine.dev/docs/ui-frameworks/antd/tutorial/)
- **React Router** [Docs](https://refine.dev/docs/core/providers/router-provider/)

## 📄 License

MIT
