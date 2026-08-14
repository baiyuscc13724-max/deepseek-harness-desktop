# Security Policy

Harness Desktop 启动本机 DeepSeek Harness Runtime。模型访问、工具执行、工作区文件操作和权限审批都由官方 Harness 工作台负责；桌面壳只提供最小运行与窗口边界。

## 不应提交到仓库

- API Key、OAuth token、GitHub token 或本地会话凭证；
- 用户工作区私有内容；
- 包含敏感路径、请求正文或凭证的日志。

提交与发布前必须执行源码密钥扫描。官方 Harness 设置中的密钥不得复制到桌面端配置、CLI 参数、应用日志或发布产物。

## Electron 边界

- Renderer 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- Preload 只暴露 Runtime 启动/状态、更新偏好/检查和外部链接白名单；
- 没有任意进程启动、文件系统、终端、Git、Provider、MCP 或插件 IPC；
- WebView 只能附加和导航到本机 `127.0.0.1` / `localhost` HTTP Runtime；
- 新窗口默认拒绝；外部 HTTP/HTTPS 链接由系统浏览器打开；
- 桌面端只终止自己创建的 Harness 子进程，对已存在的本地 Runtime 只连接不接管。

## 更新

- 桌面版更新从仓库 GitHub Releases API 检查；
- DeepSeek Harness 核心只从 DeepSeek 官方 manifest 检查；
- 更新响应设置超时和最大大小；
- 核心更新只提示，不在用户机器上静默替换依赖；
- 每个新核心版本必须随桌面版重新构建并通过兼容性与安装包验收。

## 漏洞报告

敏感问题请通过仓库 Security Advisory 私下报告。普通加固讨论可使用仓库 Issues，但不要发布密钥、token、利用细节或私有日志。
