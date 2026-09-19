# 桌面交互深审：候选修复与明确未覆盖项

## 结论与范围

本报告交付**有边界的代码修复和隔离行为证据，不是“所有桌面功能已通过”**。

- 维护源码：`release-v1.0.28-worktree`，源码版本记录为 1.0.60；运行实例为 1.0.62。未构建、发布或替换运行实例。
- 保留前任与前批全部脏改；没有重置、stage、commit、修改已验收的 `electron/pet/pet-window.cjs`。
- 接续任务的独占入口为 main/preload/app/modal/theme/renderer-pet/window-drag/wallpaper。主进程还包含其他域既有修复，不能将整文件 diff 归功于本轮。
- `coverage-interaction.json` 保留 **27 个源文件的修改前 SHA-256、632 条源码入口、22 组功能及原有 diff 原文/摘要**，新增 **49 个操作级条目**及当前源文件摘要。每个可验证操作指向具体测试标题；18 个未完成端到端验证的操作单独列出。
- 632 条入口是自动提取的事件监听、IPC、菜单项、表单控件索引；并非632个独立测试或完整产品需求。它们保留 `unverified`，不能用整文件通过推导每个入口已验证。`currentLine` 能匹配时给出现行位置，匹配不到为 null，原始行号不变。新增 `currentEntries` 全量重扫现行入口（含新增监听/IPC），与修改前清单分开，文本匹配只作为定位线索。

## 已完成的修复和证据

全部新增回归位于 `tests/deep-audit-interaction.test.cjs`。测试通过 VM、假 WebContents、假 DOM、假 IPC、依赖注入文件操作检查**实际生产函数/实际 IPC 注册**，不复制一份理想实现求绿。

| 操作/缺陷 | 修复或确认 | 正常/失败/竞态证据 |
|---|---|---|
| 编辑菜单目标 | 主壳、guest、独立窗口、侧栏浏览器挂菜单；undo/redo/cut/copy/paste/pasteAndMatchStyle/selectAll 显式绑定发起 WebContents，而非弹菜单后的全局焦点 | `menus dispatch ALL…` 覆盖7条命令；禁用flags/空选择；关闭后回调不操作；命中乱序和窗口关闭测试 |
| 图片菜单与公网隔离 | 图片复制取鼠标点并四舍五入；复制图片地址；公共浏览器菜单 `allowLocal:false`，不解释网页伪造工作区元数据 | `public-page menu…` 使用假剪贴板及假 copyImageAt；不访问真实剪贴板 |
| 窗口拖拽 | 非有限数/字符串/空坐标拒绝；坏移动终止；最大化恢复、逐窗口状态和结束幂等 | `drag rejects…`、`drag restore…`；不验证原生混合DPI |
| 弹窗焦点 | 剔除负tabindex、禁用fieldset、inert、aria-hidden、CSS隐藏；正tabindex排序；MutationObserver前同步Tab；动态隐藏/禁用控件不保留或恢复焦点 | 新候选/边界/动态隐藏测试，加原 `modal-focus.test.cjs` 嵌套/空弹窗/恢复fixture |
| Escape/IME/终端resize | Escape只关可见顶层弹窗，拒绝composition/keyCode229/repeat/defaultPrevented；resize指针隔离，cancel/blur/close移除全部监听，键盘上下键及非有限起点拒绝 | `shell Escape…`、`terminal resize isolates…`；壁纸卡键盘补IME/repeat保护 |
| 浏览器普通文本输入 | contenteditable写textContent，input/textarea用各自原生setter；mutation时再次拒绝断连/只读/禁用/不适用类型 | `browser type behaves…`、`browser type revalidates…`；不触碰真实网页密码/账号 |
| 浏览器select | exact value优先于可见文本；disabled option/optgroup/control不变更，合法选择派发input/change | `select rejects…` |
| pet IPC真正接线 | 原守卫函数已存在但注册未使用：现9条IPC全部验证当前实际页面。共享壳仅state/preferences/feed/focusMain；interact/environment/move/hit仅宠物 | actual registration VM：伪造对象、子frame、导航后URL、错fileURL无副作用；query/hash允许；隐藏合法；disposed不复活 |
| send-only IPC错误恢复 | 非法 `pet:setInteractive/setHitProfile` 直接忽略，不抛未捕获主进程异常 | 实际 `ipcMain.on` callback行为测试 |
| 桌面截图迟到 | 开始前、capture后、legacy readFile后重验控制generation和发起页面；旧capture不得清新会话frame/store | `desktop capture stop/restart…`、`desktop capture stops before…`；测试Stop后重启、导航/关闭、精确ArrayBuffer切片 |
| 主题picker异步 | 旧save完成不能关闭新打开picker、父设置或抢焦点；失败/未应用仍可恢复 | `theme picker async…`；不等同完整主题保存并发状态验证 |
| 桌宠手势 | 首指独占，非法点/时间倒退拒绝；pending环境请求期间up立即失效；blur/cancel/lostcapture释放；外来指针不能取消 | `pet engine preserves…`、`pet renderer pointer-up…`，抚摸→拖拽→结束、cancel幂等 |
| 桌宠键盘 | 原生button的detail=0 click可互动；鼠标click不重复奖励；ContextMenu/Shift+F10、Escape焦点恢复，IME/repeat不误操作 | `pet renderer keyboard…` |
| 桌宠菜单失败/重复 | 喂食待定禁用并去重；结束后按库存/饱腹恢复资格；喂食/主窗口聚焦/休息拒绝都有可见错误反馈 | `pet menu feed…`，成功库存耗尽、失败重试和3条拒绝路径 |
| 壁纸复制失败清理 | copy/验证失败仅清随机temp。rename若迟到报错，仅在大整数dev/ino证明仍为本次文件时删除final；其他写者不删 | `wallpaper failed validation…`、`wallpaper rename failure…`；原late-rename测试仍通过 |

### 壁纸清理的中间失败记录

第一次修正只保留final，触发原 `wallpaper-service.test.cjs` 的“rename已成功但随后返回失败”用例。第二次加入Number身份检查，在NTFS大文件ID上不能证明归属，仍未通过。最终使用 `{ bigint: true }` 获取精确 dev/ino：既保护另一写者，也清掉可证明为本次rename的文件，旧契约无需改动。未知/零身份宁可留下受控孤儿，不无证据删除文件。

这不是跨进程完全原子锁承诺。基于文件身份的检查与unlink之间仍依赖受控目录不被恶意并发替换；此项应由存储/安全域做进一步跨进程攻防验证。

## 回归结果

接续初始13条已有新回归全部通过，随后扩到27条：

- **新交互回归：27/27通过。**
- **10文件相关回归：95项，94通过、0失败、1跳过。**
- 跳过项：`Wallpaper Engine path containment keeps the host platform case semantics`，现行为Windows不适用大小写敏感主机断言；不是全平台通过。
- 运行约0.3秒，全部前台完成；未启动后台全量测试，避免与验收成员唯一全量基线进程争用。
- `electron/main.cjs`、`renderer/app.js` 语法检查通过。`renderer/pet/pet.js` 在 `index.html` 以 `type="module"` 加载；初次误用CommonJS `node --check` 报 import 模式错，改用 `--input-type=module --check` 后通过。未把调用方式错误当产品缺陷。

相关回归文件：

1. `tests/deep-audit-interaction.test.cjs`
2. `tests/desktop-tray.test.cjs`
3. `tests/modal-focus.test.cjs`
4. `tests/pet-interaction-engine.test.cjs`
5. `tests/pet-behavior-engine.test.cjs`
6. `tests/theme-catalog.test.cjs`
7. `tests/theme-layout-ui.test.cjs`
8. `tests/wallpaper-library.test.cjs`
9. `tests/wallpaper-service.test.cjs`
10. `tests/wallpaper-lifecycle.test.cjs`

旧测试中包含source contract断言；即使通过也不自动升级为原生GUI行为证据。新测试明确标注VM/mock边界。

### 隔离复跑

在维护仓执行下列Node封装；子测试只继承OS最小环境，HOME/USERPROFILE/APPDATA/LOCALAPPDATA/TEMP/TMP统一指向本次mkdtemp，运行后清理。没有任何真实能力端点或服务token被传入。

```powershell
node -e "const cp=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'); const temp=fs.mkdtempSync(path.join(os.tmpdir(),'hd-interaction-')); const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,PATH:process.env.PATH,TEMP:temp,TMP:temp,HOME:temp,USERPROFILE:temp,APPDATA:temp,LOCALAPPDATA:temp}; const files=['deep-audit-interaction','desktop-tray','modal-focus','pet-interaction-engine','pet-behavior-engine','theme-catalog','theme-layout-ui','wallpaper-library','wallpaper-service','wallpaper-lifecycle'].map(x=>'tests/'+x+'.test.cjs'); const result=cp.spawnSync(process.execPath,['--test',...files],{env,stdio:'inherit'}); fs.rmSync(temp,{recursive:true,force:true}); process.exit(result.status ?? 1)"
```

`node tests/deep-audit-interaction.test.cjs --write-evidence` 是显式报告投影工具，会保留不可变baseline与preExistingDiff，更新49操作及当前hash。它不是Host runner证明或批准动作。默认 `--test` 不写报告。

## 未覆盖矩阵（不删除、不冒充pass）

1. 原生跨应用纯文本/HTML/RTF复制、密码字段剪切、图片粘贴、格式剥离结果、空剪贴板及多级原生编辑历史。
2. 实际鼠标跨段落选择、全平台Ctrl/Cmd快捷键；本轮证明的是菜单目标和指定键盘处理器，不是Chromium编辑引擎。
3. 真实托盘/窗口显隐、最小化恢复、独立会话和混合DPI多显示器拖拽。旧tray callback fixture不能代替OS操作。
4. 全主题/模式/字体加载/颜色范围、保存失败和全部异步状态切换；picker关闭竞态已修，不代表主题状态本身的完整竞态全部被验证。
5. 实际壁纸选择框/取消、每个codec预览、GPU视频park/resume/解码恢复；服务层临时文件和序号fixture已验证。
6. 真实Steam安装库、当前项目/同步；只读伪造配置及临时目录验证，不访问用户私有库。
7. 桌宠自动喂食/库存域/主动陪伴/全部风格的端到端组合、真实多屏物理/攀爬/投掷/栖息。
8. 屏幕阅读器朗读、所有主题对比度测量、200%缩放和可视Tab顺序、减少动画渲染矩阵。

上述细项已拆进coverage的18条 `unverified` 操作，22组的状态采用端到端保守口径。全部632源码入口仍可追踪，其他域入口应与master coverage交叉引用，不应将本报告变成“入口清单等于通过”。

## 可访问性与技能审查

已读取 `ui-ux-pro-max`，定向检索 `keyboard focus modal --domain ux`，命中可见焦点、焦点不被遮挡（AA/AAA区分），以及quick-reference §1–3。应用在动态隐藏焦点、键盘菜单、异步按钮状态及失败反馈。未改变视觉设计、图标或主题palette；未声称完成真实对比度/读屏/缩放清单。

## 交付边界

- 已验收原生宠物生命周期任务不在本次重新修改范围。
- main/preload已有其他域整合保持；未修改验收成员独占的4个旧UI测试。
- 不把本次27项回归数量当用户要求数量；覆盖缺口仍需独立验收和后续有边界的真实GUI/平台验证。
- 本文件与coverage是候选证据；团队任务完成仍需总审独立accept，不是成员自批准。
