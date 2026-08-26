---
name: sites
description: "Use when the user wants to build a website: landing page, portfolio, dashboard, portal, tracker, internal tool, or game. Builds a self-contained static site (HTML/CSS/JS with optional inline data) previewable locally, with honest boundaries on deployment."
whenToUse: "User asks to build, redesign, or extend a website or web app; or wants a landing page, portfolio, dashboard, portal, or internal tool."
---

# 站点技能（Sites）

构建自包含的静态网站：单页或多页 HTML/CSS/JS，数据可内联或来自随站 CSV/JSON，全部离线可用、右栏可预览。部署到外部托管由用户执行（或按用户意愿走本地构建产物交付），不依赖任何专有托管后端。

## 触发条件

- 输出/目标是网站、落地页、作品集、仪表盘、门户、追踪工具、小游戏。

## 工作流

### 1. 明确站点需求
- 确认：页面结构与路由（单页/多页）、数据来源、交互需求、受众与风格基调。
- 复杂交互（增删改数据）：询问是否需要本地持久化（用 localStorage 或随站 JSON 文件做读写演示），不默认接后端。

### 2. 搭建骨架
- 用 `write` 创建 `<项目>/index.html`（及 `styles.css`/`app.js` 或内联样式脚本）。
- 多页站点用扁平目录 + 相对链接（`pages/about.html`）；公共头尾用可复用片段说明，保持每页自包含优先。
- 可参考 `default-templates/templates/landing-page.html` 起步后再扩展。

### 3. 填充内容与数据
- 数据：表格数据写为 `data.csv`（或 `data.json`），页面内用 `fetch` 相对路径加载；无网络环境时降级为内联数据。
- 图片：用 `image_gen` 生成站点配图存入 `assets/`，并在交付中说明；不要外链不稳定的图床。
- 仪表盘/图表：内联 SVG/Canvas 自绘（参考 `visualize` 技能），不依赖外部 CDN。

### 4. 验证
- 本地预览：将 `index.html` 在右栏以 HTML 预览打开；或 `pwsh` 起临时静态服务（`python -m http.server` 或 `npx serve`，仅本机）后用 `browser_control` 打开 `http://127.0.0.1:<port>` 实测点击、表单、控制台报错。
- 链接检查：用 `grep` 校验所有 `href/src` 指向的本地文件存在；用 `pwsh` 校验 `data.csv` 可被 `Import-Csv` 解析。
- 响应式：在 `browser_control` 中调整窗口宽度抽查移动端布局。
- 可访问性基础：标题层级顺序、图片 `alt`、按钮可键盘操作。

### 5. 交付与部署边界
- 交付构建目录（`dist/` 或站点根）与本地预览说明。
- 部署：说明可选公开托管路径（GitHub Pages / Netlify Drop / 任意静态托管），上传/发布操作由用户在浏览器中完成；本技能不代替用户发布、不索取发布凭证。
- 域名/证书/数据库/鉴权类需求：明确列出由谁在哪个平台配置，不做虚假承诺。

## 边界与失败处理

- 不依赖 ChatGPT Sites 或任何专有托管后端；站点本体必须离线自包含。
- 不在站点中嵌入需授权的服务端密钥；`OPENAI_API_KEY` 之类凭据绝不写入站点文件。
- 用户提供后端接口时，仅按接口文档对接并标注失败降级。
- 构建产物校验失败（引用缺失、脚本报错）：先修复再交付，不跳过验证步骤。