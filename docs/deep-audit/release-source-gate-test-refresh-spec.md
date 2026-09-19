# 发布源码门三处过期期望：修复规格（1.0.63 发布会卡在这里）

**背景**：`npm run release:publish -- run --version 1.0.63` 在第 1/12 阶段 `local-source-gates` 失败，报 `SMOKE_PHASE_FAILED:1:ordinary`。全部门禁与安全动作**均未发生**（未打标签、未推送、未发布资产），发布器可续跑。

**定性（已核实，非猜测）**：三处都是**测试期望过期**，不是行为丢失。依据是逐 token 核对实现现状：

| 断言期望的 token | 实际所在文件 | 结论 |
|---|---|---|
| `applySyncResponse` / `storeFullSnapshot` / `applyIncrement` | **`MobileAssetCache.java`**（三者都在） | 实现已从 Activity 移入专职类 |
| `X-Harness-Mobile-Sync-Complete` | **`ManifestDownload.java`** | 分页/同步完成契约随下载器一起搬走 |
| `closeSkinPicker()`、`disposeWallpaperCardPreviews`、`disposeWallpaperEnginePreviews` | **`renderer/app.js`**（三者都在） | 存在，但**整段文本不逐字匹配** |

**因此修法是更新期望、保留原意**；**严禁删除断言或放宽到无意义匹配**（仓库明文禁止为让门变绿而弱化契约）。

## 修复 1 —— `tests/mobile-sync-entry-ui.test.cjs:123`

现状：
```js
assert.match(mainActivity, /mobileAssetCache\.(?:applySyncResponse|storeFullSnapshot|applyIncrement)\(/u)
```
**为什么过期**：`MainActivity.java` 里**没有任何**这三个 token；它们都在 `MobileAssetCache.java`。

**建议改法（保原意：原生缓存可被同步结果更新）**：把检查对象改为缓存类本身：
```js
assert.match(assetCache, /(?:applySyncResponse|storeFullSnapshot|applyIncrement)\(/u)
```
**前提**：该测试文件顶部已有 `assetCache` 这个源码变量（同文件 `:120` 已在用 `assetCache`，故**成立**）。

## 修复 2 —— `tests/mobile-sync-entry-ui.test.cjs:143`

现状：
```js
assert.match(mainActivity, /X-Harness-Mobile-Sync-Complete/u)
```
**为什么过期**：该 header 现在由 `ManifestDownload.java` 使用（见其 `:105` 的 `!"0".equals(connection.getHeaderField("X-Harness-Mobile-Sync-Complete"))`）。

**建议改法（保原意：同步完成契约仍被校验）**：断言下载器使用该 header，例如
```js
assert.match(manifestDownload, /X-Harness-Mobile-Sync-Complete/u)
```
**未核实项（执行前须先做）**：该测试文件顶部**是否已加载** `ManifestDownload.java` 为某个变量。**若未加载，需新增一处读取**（例如 `const manifestDownload = read('mobile/android/app/src/main/java/io/harnessdesktop/mobile/ManifestDownload.java')`，变量名与文件内既有风格保持一致）。**我没有核实这一点，故不预填变量名。**

## 修复 3 —— `tests/wallpaper-library-ui.test.cjs:26`

现状：
```js
assert.match(app, /function closeSkinPicker\(\) \{\s*disposeWallpaperCardPreviews\(\)\s*disposeWallpaperEnginePreviews\(\)\s*skinPickerHost\.close\(\)/u)
```
**为什么过期**：`app.js` 同时含有 `closeSkinPicker()`、`disposeWallpaperCardPreviews`、`disposeWallpaperEnginePreviews` 三处 token，但**函数体的实际文本/顺序与该正则不符**（很可能是后续改动在中间加入了语句或调整了顺序）。

**建议改法（保原意：关闭皮肤选择器时必须释放两类预览）**：先读 `renderer/app.js` 中 `function closeSkinPicker()` 的**实际函数体**，再据实写成"在其体内依次出现两次 dispose 与 `skinPickerHost.close()`"的正则（用 `[\s\S]*?` 允许中间语句，而不是要求紧邻）。

**未核实项**：`app.js` 中该函数的实际文本。**执行前必须先读**，不要凭猜改写——这正是本仓库反复出现的"精确源码钉"陷阱。

## 执行顺序建议（每步单独验证）

1. 读 `renderer/app.js` 的 `closeSkinPicker` 函数体 + 读 `tests/mobile-sync-entry-ui.test.cjs` 顶部源码加载段（确认 `manifestDownload` 变量是否存在）
2. 按上面三条改期望
3. `node --test tests/mobile-sync-entry-ui.test.cjs tests/wallpaper-library-ui.test.cjs`
4. 三个测试全绿后，提交（发布器要求干净树）
5. 重跑 `npm run release:publish -- run --version 1.0.63`

## 边界

本会话**未修改这三处测试**（避免留下"改过但未验证"的门禁断言）；发布因此仍停在第 1/12 阶段，**且没有任何不可逆动作**。
