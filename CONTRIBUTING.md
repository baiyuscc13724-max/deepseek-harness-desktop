# Contributing to Harness Desktop

感谢参与 Harness Desktop。

## 原则

1. 官方 DeepSeek Harness Web UI 是唯一工作台，不增加第二套会话、工作区、模型、权限、插件或终端界面。
2. 不直接修改上游 Agent Loop；核心升级通过固定 `@deepseek-ai/dsh` 版本进入桌面版。
3. 桌面壳只保留窗口、Runtime 生命周期、更新、自检和必要安全边界。
4. 新功能必须考虑 Windows、macOS 与 Linux，并避免扩大 Preload/IPC 权限。
5. 不提交 API Key、token、用户路径、账号信息或其他本机敏感数据。
6. 上游兼容修改必须注明对应 DeepSeek Harness 版本并补充验证证据。

## 提交前

```bash
npm run verify
npm run verify:release
```

涉及安装或窗口交互时，还应构建并验收实际安装包和便携版。

## Repository workflow

Canonical repository: `baiyuscc13724-max/deepseek-harness-desktop`

- `main`: stable/release-ready line
- `develop`: integration branch
- `release/v0.9`: v0.9 release-candidate stabilization

通常向 `develop` 提交变更；发布修复由维护者指定目标分支。
