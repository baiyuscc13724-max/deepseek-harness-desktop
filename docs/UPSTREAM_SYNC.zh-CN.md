# 上游同步策略

## 原则

- `deepseek-ai/deepseek-harness` 是核心与唯一工作台来源；
- 桌面端不复制官方功能，也不对官方 UI 建立第二套状态模型；
- `@deepseek-ai/dsh` 使用精确版本，不直接追 `latest`；
- 新版本先经过自动测试、真实启动、Windows 安装包与便携版验收，再随桌面版发布；
- 用户机器只检查和提示核心更新，不静默改写安装目录。

## 最低升级验收

1. 桌面端能启动 bundled `dsh web`，也能安全连接已有本地 Runtime；
2. 官方工作台能选择工作区、配置模型、创建会话并完成真实请求；
3. 模型下拉、Harness 权限、插件、技能、MCP 与官方设置正常；
4. 中文路径、空格路径、中文输入和常见 DPI 正常；
5. 桌面更新行仍能嵌入官方通用设置；
6. 关闭桌面程序后没有遗留由它创建的 dsh/node 进程；
7. `npm run verify`、`verify:release`、packaged self-test 与产物审计全部通过；
8. Inno Setup 安装版和便携版在 Windows 真机启动通过。

## 自动发现

Dependabot 和定时 Upstream Watch 只负责发现新版本，不自动合并或发布。通过验收后更新固定依赖版本并发布新的 Harness Desktop 版本，已安装客户端会在官方通用设置里检测到它。
