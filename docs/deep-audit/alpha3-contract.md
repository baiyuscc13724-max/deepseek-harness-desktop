# 旧名称兼容测试：退休产物拒绝契约校准

2026-09-12；FINAL_READY，待总审独立接受。本项只改 `tests/official-alpha3-compatibility-regression.test.cjs` 及本报告；正式安装器、核心变换、其他测试保持冻结。不包含新提出的问答选项交互修复。

## 原红与契约依据

原测试 SHA-256：`EEAA8B9FCB5E8841E440A4A65DF1B958000520FB7349B97083D17FDD290D3FD5`。

`acceptance-alpha3-contract-before-v1`：7 tests，6 pass，1 fail，0 skip；精确失败是原第187行的 compatibility installer 测试，内部第202行要求源码出现 `for (const removed of [runtimeClient, hostApiProxyRuntime,`。其余 dispatch 断言已经通过。该变量名列表在此前核心安装整合中改为依据显式 `nodeModulesRoot` 构建路径，因此源码正则已过时；这次不是新增产品代码修复。

当前正式 `assertInstalledNativeCapabilities` 仍对三个退休路径执行真实 `access`：存在就抛 `Retired ${version} compatibility artifact is unexpectedly installed: ${removed}`，只有 ENOENT 被允许继续。它不负责自动删除残留。把正则改成另一组变量名不能充分验证该拒绝边界，因此替换为真正调用正式函数的临时文件系统验证，而非扩大正则求绿。

## 替换和新增证据

保留原测试标题、alpha.5/alpha.4/alpha.3/alpha.2 dispatch 全部其他断言，仅将旧变量名列表断言换为实际临时包行为：

1. 复制13个当前真实 alpha.5 capability 包的 package.json 与准确 client/index 实现文件到临时 node_modules，目录前缀包含空格和中文。调用 `assertInstalledAlpha5NativeCapabilities(tempRoot)`，完整包身份、版本、内容 hash 与 anchor 均通过；整棵临时树的路径、目录和文件 SHA 不变。
2. 分别加入以下退休残留，各自 package.json 指明 alpha.3 版本；一次只有一个残留，精确断言异常全文和目标路径：
   - `@deepseek-ai/dsh-client-runtime/lib/client.js`
   - `@deepseek-ai/dsh-host-apiproxy/lib/index.js`
   - `@deepseek-ai/dsh-session-persistence-sqlite/package.json`
3. 每次拒绝后，完整临时树路径、目录和文件 SHA 与调用前相等：既不误改当前 capability 文件，也不自动清理退休残留。仅测试自身移除刚创建的残留，随后正式预检再次通过；不是将测试 cleanup 记成安装器功能。
4. 新增一项真实临时 core adapter 检查：错误包身份、alpha.3 旧版本分别被 `patchInstalledSessionCoreClient(tempFile)` 和完整 native 预检拒绝；原字节不变。恢复正确身份和一个完整已知输入后，正式 adapter 安装成功且输出匹配完整 proof，只允许目标 client 内容变化，不新增/删除其他路径；重复返回 false，native 预检仍通过。

退休残留的 client/index 内容是惰性的合成标记，不加载或执行，测试的是它们被发现时的拒绝边界。**文件名中的 alpha3 是历史名称，实际 TARGET 已经是 alpha.5**：本项证明当前 alpha.5 图拒绝 alpha.3 残留，而不是声称启动了完整 alpha.3 运行时或执行了其无显式临时根参数的默认 wrapper。alpha.3/alpha.4 dispatch 在本文件仍仅是源码契约证据。所有读写 adapter 均传入显式临时目标，未执行默认安装器、发布 CLI、当前运行实例或真实残留清理。

## 验证结果与冻结值

| 证据 | 结果 |
|---|---|
| `acceptance-alpha3-contract-before-v1` | 7 = 6 pass + 1旧正则 fail |
| `acceptance-alpha3-contract-after-v1` | 13/13 pass：本兼容文件8 + 冻结核心安装文件5 |
| 事件解析错误 / source drift / test drift / audit drift | 前后均0 |
| syntax / diff-check | 通过 |

- 新兼容测试 SHA：`858A512CA81D0DB6383B4BC0E253B97078B1FADDBB606B23523F9F332F1832DF`
- 正式安装器 SHA（前后不变）：`034CFD41CC9E78C46ED6ABA1D1971236F496EDF3D587F2342FF039450BB239DF`
- 核心变换 SHA（前后不变）：`E86C9D2D96D850D8E0BF545E3343A793C7729CD173F6B0A9252B33458B2952BC`
- before event SHA：`757841A6C30099A9C88F0E4A7C8FED20021D22A3EDA18BC392F38277F288D438`
- after event SHA：`D56217AB1F64CFECD393929A8CE51ABE5D215EFF2FAF1154D4699F3751E2F656`
- after TAP SHA：`736E48E6303D826283107CE46C2E5AF08C40F521E466D02F8F74B9CB0D041954`

完整记录分别在 `.artifacts/deep-audit-20260912/acceptance-alpha3-contract-before-v1/result.json` 和 `.artifacts/deep-audit-20260912/acceptance-alpha3-contract-after-v1/result.json`。原红保留，不覆盖失败目录。

## 安全复跑

```powershell
node .artifacts/deep-audit-20260912/run-isolated.cjs acceptance-alpha3-contract-review-v1 tests/official-alpha3-compatibility-regression.test.cjs tests/deep-audit-session-core-install.test.cjs
```

使用尚未存在的新 mode，环境/HOME 经隔离，offline guard 不放宽。runner 固定排除以下四个危险入口并拒绝自定义覆盖，不能遗漏：

- `installed alpha.5 MCP client and Goal tool are exact complete patched artifacts`
- `one publisher command exposes the immutable resumable release order`
- `publisher fails closed unless the desktop manifest is signed and verified before commit or mirroring`
- `the real release audit accepts the checked-in publisher contract`

此处通过不意味着真实 GUI、原版本整体运行、下载/发布流程或用户文件清理通过。当前安装代码未发现该边界上的行为错误，因此没有生产变更，也没有改正式代码来迎合测试。
