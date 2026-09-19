# 桌宠原生生命周期深审

- 源码版本：1.0.60；运行实例：1.0.62。没有安装、发布或修改运行实例，源码修复尚未在其上生效。
- 原文件 `electron/pet/pet-window.cjs` SHA256：`9e94c8855aae5687c51cc1514e0fe10d7096e08f477fae4659462db13cf5da41`；修改前 git diff 为空。仅定点修改该文件，未重置其他脏改。

## 新行为回归与修复

`tests/deep-audit-pet-native.test.cjs` 在修改前实际 **1 pass / 4 fail**，修改后 **5 pass / 0 fail**：

1. dispose 后 environment/ensure/syncPreferences 不再重建窗口。
2. NaN、±Infinity、null、字符串、undefined 坐标在创建或移动窗口前拒绝；有效负坐标保持 34px 恢复带。
3. 合法移动、hide→wake 不变，复用同一个窗口。
4. 自身 `renderer/pet/index.html` 可带合法 query/hash；外部 URL/其他 file URL 导航被拒；所有新窗口默认拒绝。
5. 旧窗口延迟 load/closed 回调不能对替代窗口推送状态或清空当前引用。

## 隔离与证据界限

- 测试不导入 Electron，只使用 EventEmitter 构造假 BrowserWindow 与固定 screen；没有窗口显示、屏幕抓取、真实剪贴板、网络/API、真实偏好文件读写。
- 执行进程环境采用 allowlist（SystemRoot/WINDIR/PATH/PATHEXT/TEMP/TMP/COMSPEC），其余变量移除；HOME/USERPROFILE/APPDATA/LOCALAPPDATA/DSH_HOME 均指向不存在的 `X:\harness-inert-fixture`，不创建该目录。
- 执行：`node --test tests/deep-audit-pet-native.test.cjs`（经上述环境清理）。
- 这证明控制器合成行为，不等同实际 Electron 生命周期、多显示器/DPI、OS 窗口命中区视觉验收。实际桌宠窗口与屏幕阅读器仍 **unverified**。
- `main.cjs` 的 pet IPC sender/主frame/精确URL验证在交互主任务另行记录，不冒充本文件覆盖。
