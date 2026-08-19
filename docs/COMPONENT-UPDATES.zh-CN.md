# Harness Desktop 组件增量更新协议

> 状态：v1.0.26 生产启用。v1.0.26 是首次完整 Bootstrap 迁移包；本协议始终保留完整安装包兜底。

## 目标

- 日常桌面壳、Harness 官方运行时和插件变更只发布变化组件。
- CNB 为首选下载源，GitHub 为自动后备源。
- 更新在用户可写目录中暂存，不覆盖正在运行的 `app.asar`。
- 所有清单必须通过内置公钥验证 Ed25519 签名；所有组件必须同时验证大小、SHA-256、归档路径和逐文件索引。
- 新版本只有通过下一次启动健康检查后才成为 last-known-good；失败自动回滚。
- Bootstrap、Electron、原生模块、安装器或更新助手不兼容时自动回退完整安装包。

## 信任边界

1. HTTPS 只提供传输保护，不作为发布者身份的唯一依据。
2. Bootstrap 内置一个或多个可信 Ed25519 公钥，只接受已知 `keyId`。
3. 顶层清单签名覆盖兼容范围、组件描述、镜像 URL、完整包兜底和组件签名。
4. 每个组件描述再单独签名，允许镜像复制归档而不能修改版本、大小、哈希或目标。
5. 私钥不得进入仓库、构建产物、日志或更新清单；发布工具只从受保护文件或 CI Secret 读取。
6. 同版本不同 SHA-256 被视为发布冲突，客户端拒绝继续。
7. 未知字段、未知组件目标、HTTP URL、URL 凭据、路径穿越、符号链接和大小写冲突全部拒绝。

## 顶层清单

```json
{
  "schemaVersion": 1,
  "releaseVersion": "1.0.24",
  "channel": "stable",
  "publishedAt": "2026-08-19T00:00:00.000Z",
  "keyId": "release-2026",
  "bootstrap": {
    "minVersion": "1.0.24",
    "maxVersion": "1.2.99"
  },
  "components": [
    {
      "id": "desktop-shell",
      "version": "1.0.24",
      "kind": "zip",
      "target": "shell",
      "platform": "win32",
      "arch": "x64",
      "size": 1234567,
      "unpackedSize": 3456789,
      "sha256": "<64 hex>",
      "urls": ["https://cnb...", "https://github..."],
      "required": true,
      "restart": true,
      "signature": "<Ed25519 base64>"
    }
  ],
  "fallback": {
    "version": "1.0.24",
    "size": 157286400,
    "sha256": "<64 hex>",
    "urls": ["https://cnb...exe", "https://github...exe"]
  },
  "notes": "...",
  "signature": "<Ed25519 base64>"
}
```

签名输入是删除当前对象 `signature` 字段后，对所有对象键递归排序、数组保持原顺序得到的 UTF-8 canonical JSON。签名算法固定为 Ed25519。

## 组件归档

ZIP 根目录必须包含 `component.json`：

```json
{
  "schemaVersion": 1,
  "id": "desktop-shell",
  "version": "1.0.24",
  "target": "shell",
  "files": [
    { "path": "electron/main.cjs", "size": 1234, "sha256": "<64 hex>" }
  ]
}
```

归档要求：

- 最多 20,000 个负载文件。
- 路径只能是相对 POSIX 路径，禁止空片段、`.`、`..`、盘符、绝对路径和 NUL。
- Windows 下按大小写不敏感规则检查重复路径。
- 禁止符号链接和其他特殊文件。
- 解压后必须与索引精确一致，不能有未声明文件。
- 目录名称使用内容寻址：`<id>-<version>-<sha256 前16位>`，已提交目录永不原地修改。

## 本地目录

```text
<userData>/component-updates/
  current.json
  state.json
  components/
    desktop-shell/<内容寻址目录>/...
    harness-runtime/<内容寻址目录>/...
    desktop-plugins/<内容寻址目录>/...
  staging/<releaseVersion>/...
```

`current.json` 是 Bootstrap 唯一读取的活动指针；组件目录不可变。`state.json` 保存状态机、上一健康版本、待应用版本和失败原因。

## 状态机

```text
idle
  -> staging
  -> ready
  -> applying
  -> awaiting-health
  -> idle                 健康确认
  -> rollback-required
  -> failed               指针恢复 last-known-good
```

规则：

- 只有 `ready` 可以请求重启应用。
- 独立助手在主程序退出后把已验证暂存目录提交为不可变组件目录，再切换 `current.json`。
- 新版本启动后运行打包自检、组件索引验证和运行时探针。
- 健康确认前发生启动失败、超时或连续崩溃时，Bootstrap 恢复上一指针并重新启动一次。
- 回滚失败时不继续循环启动，提示用户使用完整安装包修复。

## 组件边界

- `shell`：renderer、桌面业务主进程和不含原生二进制的壳资源。
- `harness-runtime`：官方 DSH 生产依赖和补丁后运行时；使用新的版本目录，旧运行时退出前不删除。
- `plugins`：内置桌面插件资源。
- Bootstrap、Electron executable、原生 `.node`、更新助手和安装器仍走完整安装包。

首个迁移版本需要把稳定 Bootstrap/助手安装进完整包。此后普通组件发布不再重复生成 Windows EXE 或 macOS DMG/ZIP。

## 跨平台清单源

完整安装包兜底与 CPU 架构相关，因此每个目标必须使用独立签名清单。`component-update-sources.json` 的 `targets` 按运行目标选择源，例如 `win32-x64`、`darwin-x64`、`darwin-arm64`；旧的 `manifestUrls` 只作为没有目标专用入口时的兼容后备。每份清单使用固定组件 ID（`desktop-shell`、`harness-runtime`、`desktop-plugins`），只包含该目标组件，并指向同目标的 EXE、DMG 或 ZIP 兜底。客户端不会把 Intel 兜底用于 Apple Silicon，也不会把 Windows 安装包用于 macOS。

## 发布规则

普通发布：

1. 从干净提交准备组件输入目录。
2. 生成逐文件索引和 ZIP。
3. 计算大小、SHA-256 和 Ed25519 描述签名。
4. 生成并签名顶层清单。
5. 先上传不可变组件资产，再上传清单。
6. CNB/GitHub 两端资产校验一致后，最后原子更新稳定频道入口。

完整发布仍用于 Bootstrap/Electron/原生模块/安装器变化、首次安装和增量修复失败。

## 本地真实更新验证

完成源码测试并生成隔离的 unpacked 测试包后，可运行：

```text
npm run test:component-local -- --app-exe <win-unpacked/Harness Desktop.exe> --profile <隔离测试目录>
```

脚本先运行打包自检，再生成本地 Ed25519 测试密钥和 1.0.24 shell 组件，走真实 ZIP 索引/哈希/签名验证、不可变目录提交、独立 Electron-as-Node 助手、父进程退出等待、原子指针切换与 `--component-health-check`。随后暂存一个缺失 renderer 的 1.0.25 shell，验证稳定 Bootstrap 在可变 shell 加载前失败时自动恢复 1.0.24，并把失败版本和原因保留在状态中。测试资料只写入传入的隔离 profile，不使用当前稳定 Desktop 的 userData，也不上传任何资产。

## 当前生产约束

- `component-update-sources.json` 固定受审 Ed25519 公钥，按 `win32-x64`、`darwin-x64`、`darwin-arm64` 选择 CNB 优先、GitHub 后备的稳定清单。
- 生产私钥不进入源码、清单、构建产物或日志；CI 只从 Secret 读取，私人仓库只保存 AES-256-GCM 加密备份，恢复密钥分离保存。
- 组件资产和版本清单不可变；必须先上传并双源验哈希，最后提交稳定频道清单。
- 任何健康检查失败、同版本哈希冲突、未知 keyId 或兜底架构不匹配都默认失败，不继续激活。
- v1.0.25 及更早版本未内置生产源，必须先安装一次 v1.0.26 完整包；之后 shell/runtime/plugins 的兼容变更才走增量更新。
