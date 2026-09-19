# 全功能入口台账与用户操作聚类

更新时间：2026-09-12（独立验收阶段更新，具体时点见各run manifest）

本轮必要限定修复的独立验证已完成，等待总审最终汇总。本次冻结：115个人工用户操作聚类、1394原子入口事实、617初始源码模块；598域细项中104项在精确当前源码/test绑定下有限接受，10条当前记录、9条stale历史记录，0partial。其余494域细项及全部115个宽泛用户聚类仍未获得整体独立验收，不能称全功能完成。FIFO41/41、alpha加core13/13、移动分页/PreparedSync联合链、问答正式temp组合122=119pass+3历史skip分别保留独立证据，不累加成需求数。共享installer的新CECD16…已用四条新记录RUNTIME-3／MODELS-3／SESSION-CORE-3／CORE-INSTALL-2重绑；旧034与原始日志均保留。当前scripts索引103，历史100/102与原发现92不改。222个官方安装依赖/36个字面工具仍只是查漏来源；没有部署当前GUI或手机。

唯一最终Node基线已执行：324文件，2929=2889pass/7fail/33skip，0cancel/timeout及source/test/audit drift；4个危险精确标题not-executed，不计pass/skip。包含当前Teams与九契约67/67，不另重跑旧623。逐文件/具名事件见`final-baseline-summary.json`、`final-nine-contracts.json`及`coverage-master.json`；这是全量测试基线，不是所有实际用户功能通过。

用户已确认使用**安卓App，移动流量和外部WiFi多种情况**。实时指令延迟与外网恢复仍为两项P1：16个真实网络格及8类恢复均0执行。修复前49命令/约7.77s HOL证据保留为历史；新独立链61命令=60ACK+1预期断线，34不同源码形成42绑定行、107实际CJS文件绑定。相同506112B/1400会话、6并发、下行64KiB/s与双向FIFO30–46ms抖动下，整包→31页使ACK P95 7808.549→334.032ms，队列7737.762→256.677ms；代价是完整下载7846.440→11985.768ms。prepare98.735ms门外、原子commit0.840ms门内；31新JVM检查、9HTTP、7旧manifest、7旧cache与26源码编译/API147/D8通过。64KiB/s计的是下行binary WS消息payload（路由外包＋AES-GCM密文），不是HTTP正文或物理公网；不计WS/TLS/TCP/IP开销。详见`mobile-hol-independent-acceptance.json`。问答实装6F382的44项Chromium细分检查通过，但真实Android原生丢触摸、复制粘贴/IME、composer/LLM与公网自动恢复仍未完成验证；旧200和其它大流的HOL不因此消失。

独立新基线：`.artifacts/deep-audit-20260912/source-baseline.json`；SHA256 `2c29d0e939957a0920830831bd724fd9ae504ca992250d5a4e5f9456b12dbc03`。

## 验收规则

- 用户操作、入口索引、源码模块三层分离；数量均不是覆盖率。动态菜单/工具schema及平台组合仍须逐域反查。
- 每一正常/负面恢复/并发切换/隔离/无障碍场景单独绑定证据级别 static-review / unit / real-adapter / synthetic-Electron / e2e。无证据不pass；不适用必须 applicable:false+reason。
- 域成员fixed只是候选；independentlyAccepted 必须由验收者针对精确源码/test hash复验。当前所有用户操作未独立接受。
- 脚本/原生pet及此前明确分配的官方依赖已有只读owner；额外222安装依赖的owner字段仅为候选归类建议，不扩大任何授权。超出写scope的生产修复仍须总审持久化授权。
- 旧35失败、provider44/迁移4/MCP49及Teams60s超时只作历史，绝不计入本轮新增覆盖。
- 真实发布/当前GUI/外部API/真实手机均禁行；平台与UI未执行项保留限制。

## 用户操作（人工聚类，待域清单与证据闭环）

| ID | owner域 | 操作 | 关联入口数（非覆盖率） | 独立验收 |
|---|---|---|---:|---|
| USER-c890c86ded0b | interaction | 复制选中文字 | 6 | unverified |
| USER-85fa3cf58aa4 | interaction | 剪切输入内容 | 1 | unverified |
| USER-aff2717caf0c | interaction | 粘贴文本及格式 | 1 | unverified |
| USER-b6a989460a46 | interaction | 粘贴纯文本 | 1 | unverified |
| USER-93d240dffbb8 | interaction | 复制图片 | 1 | unverified |
| USER-fb1b734bc7be | interaction | 复制链接地址 | 1 | unverified |
| USER-2d4ed0c7895f | interaction | 撤销编辑 | 1 | unverified |
| USER-40d8a56a4614 | interaction | 重做编辑 | 1 | unverified |
| USER-f38774b40597 | interaction | 全选与取消选择 | 2 | unverified |
| USER-0b2c794c48a7 | interaction | 快捷键路由与焦点归属 | 7 | unverified |
| USER-225ac42394c8 | interaction | 右键菜单并发与关闭 | 7 | unverified |
| USER-ddd4b98bb2c9 | interaction | 输入法与多行输入 | 28 | unverified |
| USER-dabcc40bc9f5 | interaction | 模态框键盘逃逸与焦点恢复 | 13 | unverified |
| USER-b3982ca9feaf | interaction | 窗口最小化最大化关闭 | 6 | unverified |
| USER-697bf922451f | interaction | 托盘显示退出与隐私 | 4 | unverified |
| USER-36be79d18ec4 | interaction | 主题选择自定义保存 | 34 | unverified |
| USER-9db0f88b0fdc | interaction | 背景导入应用删除 | 39 | unverified |
| USER-b64f7b1f7715 | interaction | 桌宠显示隐藏与互动 | 25 | unverified |
| USER-f40528fabba9 | interaction | 桌宠喂食TOK与进度 | 4 | unverified |
| USER-930001dbd214 | session-files | 会话创建与工作区选择 | 4 | unverified |
| USER-7743f42bd351 | session-files | 会话切换与搜索 | 8 | unverified |
| USER-247833ad072a | session-files | 会话重命名归档删除恢复 | 1 | unverified |
| USER-8e4de2af79f7 | session-files | 会话队列停止与压缩 | 8 | unverified |
| USER-dca7008daa2f | session-files | 附件导入和下载 | 3 | unverified |
| USER-f69b142baf84 | session-files | 文件树刷新展开与定位 | 5 | unverified |
| USER-01a3c4e3ad85 | session-files | 来源会话绑定预览 | 1 | unverified |
| USER-394498c58518 | session-files | 文档文本源码预览 | 1 | unverified |
| USER-815f7e7b046f | session-files | HTML隔离试玩 | 1 | unverified |
| USER-b8f1ea1d240c | session-files | 图片音视频PDF预览 | 1 | unverified |
| USER-24ee9009f50f | session-files | 安全副本系统打开与显示 | 1 | unverified |
| USER-9c36264879d6 | session-files | 复制文件引用与路径 | 1 | unverified |
| USER-1f0c49d71356 | session-files | 会话文件编辑草稿 | 1 | unverified |
| USER-cdaa6fb5e987 | session-files | 终端创建输入调整关闭 | 16 | unverified |
| USER-bdc88e3fcdfd | session-files | Git发现认证与工作树 | 2 | unverified |
| USER-108c32ad960e | session-files | 项目切换隔离与协作 | 1 | unverified |
| USER-4635bf7133bf | session-files | 历史查询与时间线定位 | 2 | unverified |
| USER-8d5406fec02f | models-plugins | Provider新增修改删除和恢复 | 10 | unverified |
| USER-e6a7175cbe73 | models-plugins | 模型发现目录与准入 | 24 | unverified |
| USER-93100873fe47 | models-plugins | 主子模型路由保存切换 | 14 | unverified |
| USER-956b8e2d43ed | models-plugins | 凭据引用验证及隔离 | 17 | unverified |
| USER-ea2a4f121007 | models-plugins | 额度刷新缓存账号切换 | 7 | unverified |
| USER-e4297db5fa18 | models-plugins | 插件市场查询安装更新移除 | 22 | unverified |
| USER-692e51d1e91a | models-plugins | Skills发现与触发 | 1 | unverified |
| USER-bb269c0aff2a | models-plugins | MCP创建保存删除连接 | 6 | unverified |
| USER-e99ae29f3830 | models-plugins | MCP失败清理重连恢复 | 1 | unverified |
| USER-c692fb1cf063 | models-plugins | 本地记忆开关配置 | 6 | unverified |
| USER-efafdb7d0767 | models-plugins | 记忆搜索与作用域 | 7 | unverified |
| USER-ae3a2715c829 | models-plugins | 记忆remember和suggest | 2 | unverified |
| USER-8c48ab0110cd | models-plugins | 记忆修改删除导出 | 8 | unverified |
| USER-70a129cbb402 | models-plugins | 记忆pack临时交接 | 6 | unverified |
| USER-f808139e3af1 | models-plugins | 提醒创建查询取消及逾期 | 4 | unverified |
| USER-33c37a275947 | models-plugins | Web搜索抓取引用 | 7 | unverified |
| USER-f3eb78561df9 | models-plugins | 图片生成编辑附件交付 | 5 | unverified |
| USER-9ff0f5535aba | browser-control | 浏览器URL导航搜索 | 5 | unverified |
| USER-0a81dcbd7d09 | browser-control | 浏览器前进后退刷新 | 16 | unverified |
| USER-935035268195 | browser-control | 标签创建切换关闭列表 | 14 | unverified |
| USER-18890a388ed6 | browser-control | 历史搜索打开删除清空 | 13 | unverified |
| USER-f272e9432ff6 | browser-control | Profile站点数据清除与重置 | 9 | unverified |
| USER-fa3399b2cbf4 | browser-control | 用户浏览器菜单复制剪切粘贴 | 1 | unverified |
| USER-5950fbab5abb | browser-control | 浏览器下载上传与逐次确认 | 6 | unverified |
| USER-dc3649aa2177 | browser-control | DOM观察引用失效与检查 | 6 | unverified |
| USER-e69200aaa65b | browser-control | 结构化点击输入滚动选择 | 19 | unverified |
| USER-9c0895b1cc68 | browser-control | 截图与视频状态帧读取 | 8 | unverified |
| USER-a4fe3b83d3c5 | browser-control | console网络有界诊断 | 4 | unverified |
| USER-5e98fc39b81f | browser-control | JS弹窗处理 | 3 | unverified |
| USER-2b9ae120b3d1 | browser-control | 浏览器后台授权恢复和停止 | 6 | unverified |
| USER-d872103540a5 | browser-control | 桌面全屏截图与多屏坐标 | 5 | unverified |
| USER-7ce25dc41e20 | browser-control | 桌面结构树ref动作 | 16 | unverified |
| USER-73e5f4943177 | browser-control | 共享授权本次永久撤销 | 4 | unverified |
| USER-b45b011ae7bb | browser-control | 全桌面鼠标键盘滚轮 | 8 | unverified |
| USER-f08255239a98 | browser-control | 锁屏挂起停止与未知结果恢复 | 4 | unverified |
| USER-c671dbb584ec | mobile | 配对二维码信任撤销 | 23 | unverified |
| USER-2ccd9e5e21db | mobile | 设备发现选择重命名 | 38 | unverified |
| USER-1d6e01abfd64 | mobile | 局域网连接断线重连 | 24 | unverified |
| USER-41ca8b6bb651 | mobile | P2P协商与中继回退 | 38 | unverified |
| USER-6269b16863a6 | mobile | 网络切换与传输配置 | 22 | unverified |
| USER-0824939a3ba2 | mobile | 四域项目会话导航 | 23 | unverified |
| USER-7da7711bf2e2 | mobile | 手机输入复制粘贴和IME | 19 | unverified |
| USER-40de83baa5a3 | mobile | 手机附件选择上传大小限制 | 10 | unverified |
| USER-0951fd53ee92 | mobile | 手机返回深链和小屏弹窗 | 25 | unverified |
| USER-bccce4018645 | mobile | 原生控制授权状态观察停止 | 24 | unverified |
| USER-8aff91884900 | mobile | 原生点击长按滚动手势 | 14 | unverified |
| USER-9b8228dd3aa0 | mobile | 打开App URI设置文件 | 6 | unverified |
| USER-5067e1b6cd53 | mobile | 截图和实时设备流 | 36 | unverified |
| USER-f7f19c41a0ba | mobile | 通知后台恢复与前台服务 | 21 | unverified |
| USER-659da3ec91f7 | mobile | 同步快照增量乱序并发 | 36 | unverified |
| USER-739434890bf3 | mobile | 主题独立设置与文字缩放 | 4 | unverified |
| USER-c5a75f440310 | mobile | Android与iOS版本兼容及构建 | 7 | unverified |
| USER-1c1dc6f02cf6 | runtime-storage | 启动运行时发现与崩溃恢复 | 5 | unverified |
| USER-e2aba26f5742 | runtime-storage | 运行时缓存下载和解压 | 5 | unverified |
| USER-d961ab491105 | runtime-storage | 用户目录迁移与多实例 | 5 | unverified |
| USER-c710fe038d42 | runtime-storage | 存储扫描预览清理取消 | 2 | unverified |
| USER-71fcebb38997 | runtime-storage | 全量更新检查下载安装 | 30 | unverified |
| USER-3ce5e9934539 | runtime-storage | 组件更新签名暂存健康回滚 | 25 | unverified |
| USER-22cac8b6b0bf | runtime-storage | 预览更新启用退出恢复 | 16 | unverified |
| USER-94f7f1c9a8d4 | runtime-storage | 端口代理进程树停止 | 6 | unverified |
| USER-9587325e8ba9 | runtime-storage | 能力桥授权来源隔离 | 11 | unverified |
| USER-7310806c4c05 | runtime-storage | 官方补丁识别迁移和拒绝漂移 | 16 | unverified |
| USER-b748e83d79fa | runtime-storage | 官方核心文件Shell作业超时 | 7 | unverified |
| USER-0e62b44f4faa | runtime-storage | 源码语法测试性能门禁 | 34 | unverified |
| USER-87c2af8f438d | runtime-storage | 打包资产与大小审核 | 11 | blocked |
| USER-1c4a3adcde97 | runtime-storage | 正式发布签名双云镜像 | 36 | blocked |
| USER-7d3af51baaaa | runtime-storage | 商店MSIX品牌资产 | 5 | blocked |
| USER-a2affef3d77f | runtime-storage | Android发布范围与桌面资产保护 | 6 | blocked |
| USER-41c62bf59d5a | runtime-storage | 第三方许可依赖功能映射 | 1 | unverified |
| USER-4d14f1ee86dd | teams-legacy | 任务分级与建队计划 | 6 | unverified |
| USER-7e987c030ec5 | teams-legacy | 成员启动状态恢复 | 9 | unverified |
| USER-26296263c896 | teams-legacy | 任务认领租约提交独立接受 | 15 | unverified |
| USER-5f2f02ee4a74 | teams-legacy | Stop两阶段Resume | 2 | unverified |
| USER-9e6dccb7693a | teams-legacy | 持久收件箱与有界消息 | 3 | unverified |
| USER-4ad28bc04477 | teams-legacy | 真实Store并发锁与relay取消 | 6 | unverified |
| USER-d52ce9d9e919 | teams-legacy | 自动接力授权与轮数边界 | 1 | unverified |
| USER-184556d06f5b | teams-legacy | 项目Git工作区与深路径 | 42 | unverified |
| USER-d7ea175d2870 | teams-legacy | 跨项目隔离和handoff | 2 | unverified |
| USER-8d976cc5cdd2 | teams-legacy | 并行扩展与资源冲突 | 2 | unverified |

## 原子入口索引

每行精确文件/行号/hash及五场景状态见 `coverage-master.json`；下面只展示入口事实，不将静态发现称为pass。

| ID | owner/归属 | 入口 | 操作 | 状态 |
|---|---|---|---|---|
| MENU-KEYBOARD-315c65f30741 | browser-control/domain-assigned | electron/bridge/windows-desktop-ui.cjs:165 | desktop | unverified |
| MENU-KEYBOARD-467deda8772e | browser-control/domain-assigned | electron/bridge/windows-desktop-ui.cjs:170 | window | unverified |
| IPC-c07746b833c2 | browser-control/domain-assigned | electron/main.cjs:6056 | browser:state | unverified |
| IPC-31e01691da44 | browser-control/domain-assigned | electron/main.cjs:6060 | browser:setVisible | unverified |
| IPC-282535d0e048 | browser-control/domain-assigned | electron/main.cjs:6064 | browser:setContentVisible | unverified |
| IPC-1feaaa41ad60 | browser-control/domain-assigned | electron/main.cjs:6068 | browser:setPanelWidth | unverified |
| IPC-5e1e25f2d4d1 | browser-control/domain-assigned | electron/main.cjs:6075 | browser:setWideMode | unverified |
| IPC-e412d246abd1 | browser-control/domain-assigned | electron/main.cjs:6081 | browser:historySearch | unverified |
| IPC-3b460e34aa05 | browser-control/domain-assigned | electron/main.cjs:6085 | browser:historyOpen | unverified |
| IPC-c084de819cc9 | browser-control/domain-assigned | electron/main.cjs:6092 | browser:historyRemove | unverified |
| IPC-0e10b278e140 | browser-control/domain-assigned | electron/main.cjs:6097 | browser:historyClear | unverified |
| IPC-fed8d892ed53 | browser-control/domain-assigned | electron/main.cjs:6103 | browser-page:user-navigation-intent | unverified |
| IPC-2c6187649bcf | browser-control/domain-assigned | electron/main.cjs:6113 | browser:navigate | unverified |
| IPC-537bfde8ed7a | browser-control/domain-assigned | electron/main.cjs:6117 | browser:newTab | unverified |
| IPC-5304fc279f9a | browser-control/domain-assigned | electron/main.cjs:6121 | browser:switchTab | unverified |
| IPC-b1e5919f58c1 | browser-control/domain-assigned | electron/main.cjs:6126 | browser:closeTab | unverified |
| IPC-610eea49a06b | browser-control/domain-assigned | electron/main.cjs:6130 | browser:back | unverified |
| IPC-3f0736807395 | browser-control/domain-assigned | electron/main.cjs:6140 | browser:forward | unverified |
| IPC-47c8ec1e5b73 | browser-control/domain-assigned | electron/main.cjs:6150 | browser:reload | unverified |
| IPC-16f71ddba656 | browser-control/domain-assigned | electron/main.cjs:6157 | browser:stop | unverified |
| IPC-3cdf5c82d8e1 | browser-control/domain-assigned | electron/main.cjs:6162 | browser:clearSiteData | unverified |
| IPC-e123053d933f | browser-control/domain-assigned | electron/main.cjs:6166 | browser:clearAllData | unverified |
| IPC-47d1ae344868 | browser-control/domain-assigned | electron/main.cjs:6170 | browser:resumeModelControl | unverified |
| IPC-70c09ea0093f | browser-control/domain-assigned | electron/main.cjs:6174 | browser:confirmModelAction | unverified |
| IPC-1ba175b40424 | browser-control/domain-assigned | electron/main.cjs:6180 | browser:rejectModelAction | unverified |
| IPC-f1fc25e8b7a9 | browser-control/domain-assigned | electron/preload.cjs:84 | browser:state | unverified |
| IPC-6ab95bd0d01e | browser-control/domain-assigned | electron/preload.cjs:85 | browser:setVisible | unverified |
| IPC-e221d1bc88fc | browser-control/domain-assigned | electron/preload.cjs:86 | browser:setContentVisible | unverified |
| IPC-858bb4a94e77 | browser-control/domain-assigned | electron/preload.cjs:88 | browser:setPanelWidth | unverified |
| IPC-74ab69b4c039 | browser-control/domain-assigned | electron/preload.cjs:89 | browser:setWideMode | unverified |
| IPC-deeb1ecae062 | browser-control/domain-assigned | electron/preload.cjs:90 | browser:historySearch | unverified |
| IPC-4dbe5655189e | browser-control/domain-assigned | electron/preload.cjs:91 | browser:historyOpen | unverified |
| IPC-9e626952736a | browser-control/domain-assigned | electron/preload.cjs:92 | browser:historyRemove | unverified |
| IPC-af20b0ff10cb | browser-control/domain-assigned | electron/preload.cjs:93 | browser:historyClear | unverified |
| IPC-21843cbbb6ce | browser-control/domain-assigned | electron/preload.cjs:94 | browser:navigate | unverified |
| IPC-36254de907ea | browser-control/domain-assigned | electron/preload.cjs:95 | browser:newTab | unverified |
| IPC-85471b4cd5e4 | browser-control/domain-assigned | electron/preload.cjs:96 | browser:switchTab | unverified |
| IPC-49ca6fc85312 | browser-control/domain-assigned | electron/preload.cjs:97 | browser:closeTab | unverified |
| IPC-048a55e39416 | browser-control/domain-assigned | electron/preload.cjs:98 | browser:back | unverified |
| IPC-e367fc8edf4d | browser-control/domain-assigned | electron/preload.cjs:99 | browser:forward | unverified |
| IPC-a08f36e0f983 | browser-control/domain-assigned | electron/preload.cjs:100 | browser:reload | unverified |
| IPC-15aaece5f91c | browser-control/domain-assigned | electron/preload.cjs:101 | browser:stop | unverified |
| IPC-0e390fcff22f | browser-control/domain-assigned | electron/preload.cjs:102 | browser:clearSiteData | unverified |
| IPC-7ae9c1812fef | browser-control/domain-assigned | electron/preload.cjs:103 | browser:clearAllData | unverified |
| IPC-56114263bbc3 | browser-control/domain-assigned | electron/preload.cjs:104 | browser:resumeModelControl | unverified |
| IPC-f9027959b03a | browser-control/domain-assigned | electron/preload.cjs:105 | browser:confirmModelAction | unverified |
| IPC-ff697ddb29a9 | browser-control/domain-assigned | electron/preload.cjs:106 | browser:rejectModelAction | unverified |
| PLUGIN-TOOL-OR-CONFIG-73a20ab6b3c0 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:11 | browser | unverified |
| PLUGIN-TOOL-OR-CONFIG-d0dfbc458664 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:12 | computer-use | unverified |
| PLUGIN-TOOL-OR-CONFIG-b46a85516795 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:13 | default-templates | unverified |
| PLUGIN-TOOL-OR-CONFIG-2b940b476891 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:14 | deep-research | unverified |
| PLUGIN-TOOL-OR-CONFIG-a6f8933636d6 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:15 | plugin-management | unverified |
| PLUGIN-TOOL-OR-CONFIG-fe1d752e8a96 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:16 | documents | unverified |
| PLUGIN-TOOL-OR-CONFIG-d0990a263c04 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:17 | pdf | unverified |
| PLUGIN-TOOL-OR-CONFIG-1c3711f0b5b3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:18 | spreadsheets | unverified |
| PLUGIN-TOOL-OR-CONFIG-8edc31d1ac70 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:19 | presentations | unverified |
| PLUGIN-TOOL-OR-CONFIG-ea573440928b | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:20 | template-creator | unverified |
| PLUGIN-TOOL-OR-CONFIG-b2f52db49964 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:21 | sites | unverified |
| PLUGIN-TOOL-OR-CONFIG-50446d8b0672 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:22 | visualize | unverified |
| PLUGIN-TOOL-OR-CONFIG-136f495a2a6e | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:74 | apps | unverified |
| PLUGIN-TOOL-OR-CONFIG-5e2a5d3886b0 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/client.js:90 | skills | unverified |
| PLUGIN-ACTION-0038800f5696 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:tabClose | unverified |
| PLUGIN-ACTION-0aab976f2e75 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:screenshot | unverified |
| PLUGIN-ACTION-1b3ee6cd93e5 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:type | unverified |
| PLUGIN-ACTION-235fc44b2b9e | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:reload | unverified |
| PLUGIN-ACTION-2db77e9092b4 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:mediaInfo | unverified |
| PLUGIN-ACTION-2f348b06e1f4 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:navigate | unverified |
| PLUGIN-ACTION-2ffc1951fc5f | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:download | unverified |
| PLUGIN-ACTION-3a00809f7385 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:back | unverified |
| PLUGIN-ACTION-5faae875cb99 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:dialog | unverified |
| PLUGIN-ACTION-76bdc6e8440c | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:wait | unverified |
| PLUGIN-ACTION-76e80fb6b432 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:tabOpen | unverified |
| PLUGIN-ACTION-7efee66ae04e | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:forward | unverified |
| PLUGIN-ACTION-80212f83f753 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:scroll | unverified |
| PLUGIN-ACTION-84b0e2780af3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:select | unverified |
| PLUGIN-ACTION-8578b9f6b7f6 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:upload | unverified |
| PLUGIN-ACTION-918511acbac3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:console | unverified |
| PLUGIN-ACTION-9b0aa5655fec | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:status | unverified |
| PLUGIN-ACTION-a93ef293aa0e | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:inspect | unverified |
| PLUGIN-ACTION-aa11081fc351 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:observe | unverified |
| PLUGIN-ACTION-b284132c8a76 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:network | unverified |
| PLUGIN-ACTION-c5c710eeecda | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:hover | unverified |
| PLUGIN-ACTION-c97969edec4e | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:mediaFrame | unverified |
| PLUGIN-ACTION-cffc0154ab42 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:click | unverified |
| PLUGIN-ACTION-d69115ba5e80 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:stop | unverified |
| PLUGIN-ACTION-e3359bed6fb3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:extract | unverified |
| PLUGIN-ACTION-f582ad6e1989 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:tabSwitch | unverified |
| PLUGIN-ACTION-f83e0ae7c1a3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:keypress | unverified |
| PLUGIN-ACTION-ff4fb76b822d | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:8 | ACTIONS:tabList | unverified |
| PLUGIN-ACTION-0ed9bbab42f9 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:count | unverified |
| PLUGIN-ACTION-1aabfd110802 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:click | unverified |
| PLUGIN-ACTION-35af45cf0cd3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:getAttribute | unverified |
| PLUGIN-ACTION-47b316324e17 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:press | unverified |
| PLUGIN-ACTION-61ede6c149e0 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:isEnabled | unverified |
| PLUGIN-ACTION-84a43bd52bdd | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:selectOption | unverified |
| PLUGIN-ACTION-9569d23aefa9 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:isVisible | unverified |
| PLUGIN-ACTION-a8004630a92a | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:innerText | unverified |
| PLUGIN-ACTION-abaaa7ed5daf | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:pressSequentially | unverified |
| PLUGIN-ACTION-b54fde91750b | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:setChecked | unverified |
| PLUGIN-ACTION-ba35730fee3d | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:dblclick | unverified |
| PLUGIN-ACTION-bea91127616d | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:fill | unverified |
| PLUGIN-ACTION-cc8fad91632b | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:textContent | unverified |
| PLUGIN-ACTION-e8a1da552df3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:16 | PLAYWRIGHT_OPERATIONS:domSnapshot | unverified |
| PLUGIN-ACTION-0b1b327d6fe4 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:domSnapshot | unverified |
| PLUGIN-ACTION-343bbb9b1737 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:isEnabled | unverified |
| PLUGIN-ACTION-505cdc6af542 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:count | unverified |
| PLUGIN-ACTION-6672a6eeebe5 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:innerText | unverified |
| PLUGIN-ACTION-768b327bd4a2 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:getAttribute | unverified |
| PLUGIN-ACTION-b00dd6d90707 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:textContent | unverified |
| PLUGIN-ACTION-bcf86ecd6d22 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:21 | PLAYWRIGHT_READ_OPERATIONS:isVisible | unverified |
| PLUGIN-ACTION-1ea765955ea8 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:mediaFrame | unverified |
| PLUGIN-ACTION-36f39de27888 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:network | unverified |
| PLUGIN-ACTION-3b5241181997 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:screenshot | unverified |
| PLUGIN-ACTION-41115c152be7 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:playwright | unverified |
| PLUGIN-ACTION-4c885e282546 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:console | unverified |
| PLUGIN-ACTION-8b1d0c9b9249 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:observe | unverified |
| PLUGIN-ACTION-8b77de7864cc | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:extract | unverified |
| PLUGIN-ACTION-d405318abc97 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:dialog | unverified |
| PLUGIN-ACTION-e270a937611d | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:inspect | unverified |
| PLUGIN-ACTION-fcf00c799300 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:31 | UNTRUSTED_ACTIONS:mediaInfo | unverified |
| PLUGIN-ACTION-11974c8e1b89 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:select | unverified |
| PLUGIN-ACTION-3e12d4dcf36f | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:reload | unverified |
| PLUGIN-ACTION-4599bf363b0d | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:type | unverified |
| PLUGIN-ACTION-4acd5428c400 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:upload | unverified |
| PLUGIN-ACTION-5256e427e3ab | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:keypress | unverified |
| PLUGIN-ACTION-5c02b757b3dc | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:navigate | unverified |
| PLUGIN-ACTION-5c20c2671feb | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:tabOpen | unverified |
| PLUGIN-ACTION-676df42bf68b | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:tabClose | unverified |
| PLUGIN-ACTION-74c35cca6fcf | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:tabSwitch | unverified |
| PLUGIN-ACTION-a7e7c73f42bb | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:forward | unverified |
| PLUGIN-ACTION-a80100347128 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:mediaFrame | unverified |
| PLUGIN-ACTION-b87ecd4822f3 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:hover | unverified |
| PLUGIN-ACTION-c5636354bac7 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:download | unverified |
| PLUGIN-ACTION-c901f9d5218b | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:dialog | unverified |
| PLUGIN-ACTION-d913f4062d1c | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:click | unverified |
| PLUGIN-ACTION-e7ad39e0c663 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:playwright | unverified |
| PLUGIN-ACTION-e98d62cb50f4 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:back | unverified |
| PLUGIN-ACTION-eddde4ca1658 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:32 | MUTATING_ACTIONS:scroll | unverified |
| PLUGIN-TOOL-OR-CONFIG-428302d1dd06 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:254 | codex-parity-entry-aliases | unverified |
| PLUGIN-TOOL-OR-CONFIG-b6fbf29eeb48 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:259 | browser_playwright | unverified |
| PLUGIN-TOOL-OR-CONFIG-9e1b6a49eb63 | browser-control/domain-assigned | plugins/dsh-desktop-browser-tools/lib/index.js:296 | browser_control | unverified |
| MENU-KEYBOARD-aecb76b0d2d0 | browser-control/domain-assigned | plugins/dsh-desktop-computer-use/lib/client.js:122 | status | unverified |
| MENU-KEYBOARD-bb0fa337002a | browser-control/domain-assigned | plugins/dsh-desktop-computer-use/lib/client.js:124 | alert | unverified |
| PLUGIN-TOOL-OR-CONFIG-4ed8da15a266 | browser-control/domain-assigned | plugins/dsh-desktop-computer-use/lib/desktop-control.js:28 | desktop_control | unverified |
| PLUGIN-TOOL-OR-CONFIG-74af16b732ac | browser-control/domain-assigned | plugins/dsh-desktop-computer-use/lib/index.js:36 | tool:desktop-computer-use | unverified |
| PLUGIN-TOOL-OR-CONFIG-a742333be272 | browser-control/domain-assigned | plugins/dsh-desktop-computer-use/lib/index.js:41 | computer_use | unverified |
| UI-CONTROL-69593af3fff1 | browser-control/domain-assigned | renderer/index.html:39 | button:browserQuickButton 切换右侧工作区 | unverified |
| UI-CONTROL-b9cf3463c0cd | browser-control/domain-assigned | renderer/index.html:55 | button:browserWideMode 宽屏验收模式 | unverified |
| UI-CONTROL-92d3abb2e4ac | browser-control/domain-assigned | renderer/index.html:56 | button:browserHistoryButton 浏览历史 | unverified |
| UI-CONTROL-058289e3c84d | browser-control/domain-assigned | renderer/index.html:57 | button:browserDownloadsButton 下载状态 | unverified |
| UI-CONTROL-7fb6438e8913 | browser-control/domain-assigned | renderer/index.html:58 | button:browserProfileButton Profile 与登录数据 | unverified |
| UI-CONTROL-0ad62aaf7873 | browser-control/domain-assigned | renderer/index.html:63 | button:browserNewTab 新建标签页 | unverified |
| UI-CONTROL-244834592e62 | browser-control/domain-assigned | renderer/index.html:66 | button:browserBack 后退 | unverified |
| UI-CONTROL-b5090120258a | browser-control/domain-assigned | renderer/index.html:67 | button:browserForward 前进 | unverified |
| UI-CONTROL-7c9494ae1533 | browser-control/domain-assigned | renderer/index.html:68 | button:browserReload 刷新 | unverified |
| UI-CONTROL-990ad464e297 | browser-control/domain-assigned | renderer/index.html:69 | input:browserAddress 网址或搜索内容 | unverified |
| UI-CONTROL-59dcfc7c33d4 | browser-control/domain-assigned | renderer/index.html:70 | button:browserGo | unverified |
| UI-CONTROL-d0767f89af88 | browser-control/domain-assigned | renderer/index.html:74 | input:browserHistorySearch 搜索标题或网址 | unverified |
| UI-CONTROL-66e54f548c93 | browser-control/domain-assigned | renderer/index.html:76 | button:browserHistoryClear | unverified |
| UI-CONTROL-ea39b166ae2f | browser-control/domain-assigned | renderer/index.html:76 | input:browserHistoryClearConfirm | unverified |
| UI-CONTROL-f2e08185aeb7 | browser-control/domain-assigned | renderer/index.html:89 | input:browserClearSiteConfirm | unverified |
| UI-CONTROL-5a926f1d1c32 | browser-control/domain-assigned | renderer/index.html:90 | button:browserClearSite | unverified |
| UI-CONTROL-2c63ae3d7a5e | browser-control/domain-assigned | renderer/index.html:92 | input:browserClearAllConfirm | unverified |
| UI-CONTROL-30b7605837e7 | browser-control/domain-assigned | renderer/index.html:93 | button:browserClearAll | unverified |
| UI-CONTROL-e9f7d47518fa | browser-control/domain-assigned | renderer/index.html:96 | button:browserStop | unverified |
| MENU-LABEL-0406616ae325 | interaction/domain-assigned | electron/desktop-tray.cjs:11 | 打开 Harness Desktop | unverified |
| MENU-LABEL-5cf014d3c803 | interaction/domain-assigned | electron/desktop-tray.cjs:12 | 隐藏主窗口 | unverified |
| MENU-LABEL-bf24b4eb9e6a | interaction/domain-assigned | electron/desktop-tray.cjs:14 | 数据与隐私 | unverified |
| MENU-LABEL-6af171da2eb3 | interaction/domain-assigned | electron/desktop-tray.cjs:16 | 本地记忆… | unverified |
| MENU-LABEL-094af50fc971 | interaction/domain-assigned | electron/desktop-tray.cjs:17 | 存储与缓存… | unverified |
| MENU-LABEL-a0689f92a209 | interaction/domain-assigned | electron/desktop-tray.cjs:21 | 退出 | unverified |
| IPC-98f93fff27ba | interaction/domain-assigned | electron/guest-preload.cjs:98 | agentTeams:authorizeAutopilotSettings | unverified |
| IPC-9616391c1209 | interaction/domain-assigned | electron/guest-preload.cjs:129 | sessionMenu:sync | unverified |
| IPC-98cb84489039 | interaction/domain-assigned | electron/guest-preload.cjs:135 | sessionMenu:setFlag | unverified |
| IPC-d1a8b8f31844 | interaction/domain-assigned | electron/guest-preload.cjs:161 | desktopDevice:action | unverified |
| IPC-b326c1b11e8c | interaction/domain-assigned | electron/guest-preload.cjs:200 | appearance:wallpaper-lifecycle:get | unverified |
| IPC-6917d425ab3d | interaction/domain-assigned | electron/guest-preload.cjs:216 | appearance:wallpaper-lifecycle | unverified |
| IPC-f66ea1873c8f | interaction/domain-assigned | electron/guest-preload.cjs:225 | workspace:chooseDirectory | unverified |
| IPC-740e2a4e3ea7 | interaction/domain-assigned | electron/guest-preload.cjs:280 | window:moveDrag | unverified |
| IPC-e16fe3838335 | interaction/domain-assigned | electron/guest-preload.cjs:299 | window:endDrag | unverified |
| IPC-89e1b113a62c | interaction/domain-assigned | electron/guest-preload.cjs:319 | window:beginDrag | unverified |
| MENU-LABEL-7729bfbd52bf | interaction/domain-assigned | electron/main.cjs:203 | 整个电脑桌面 | unverified |
| MENU-LABEL-0d3ed8c034ba | interaction/domain-assigned | electron/main.cjs:2402 | Harness Desktop | unverified |
| MENU-LABEL-8984e42d9023 | interaction/domain-assigned | electron/main.cjs:5581 | 在右侧工作区预览 | unverified |
| MENU-LABEL-cadcfb313f47 | interaction/domain-assigned | electron/main.cjs:5582 | 使用系统应用打开 | unverified |
| MENU-LABEL-e255a667e1b0 | interaction/domain-assigned | electron/main.cjs:5583 | 在文件夹中显示安全副本 | unverified |
| MENU-LABEL-cb631fc06a1d | interaction/domain-assigned | electron/main.cjs:5584 | 复制文件引用 | unverified |
| MENU-LABEL-87e2882a7141 | interaction/domain-assigned | electron/main.cjs:5589 | 在内置浏览器打开 | unverified |
| MENU-LABEL-3f5f1a269db8 | interaction/domain-assigned | electron/main.cjs:5590 | 用系统浏览器打开 | unverified |
| MENU-LABEL-7fed7ae46729 | interaction/domain-assigned | electron/main.cjs:5591 | 复制链接地址 | unverified |
| MENU-LABEL-cfc162118d8e | interaction/domain-assigned | electron/main.cjs:5606 | 撤销 | unverified |
| MENU-LABEL-639ef122664b | interaction/domain-assigned | electron/main.cjs:5607 | 重做 | unverified |
| MENU-LABEL-fd2e8e7a4292 | interaction/domain-assigned | electron/main.cjs:5609 | 剪切 | unverified |
| MENU-LABEL-8801e3075a9a | interaction/domain-assigned | electron/main.cjs:5610 | 复制 | unverified |
| MENU-LABEL-e071e2306139 | interaction/domain-assigned | electron/main.cjs:5611 | 粘贴 | unverified |
| MENU-LABEL-c54e5bc1514b | interaction/domain-assigned | electron/main.cjs:5612 | 粘贴为纯文本 | unverified |
| MENU-LABEL-357ba4c16b13 | interaction/domain-assigned | electron/main.cjs:5613 | 全选 | unverified |
| MENU-LABEL-363e12bdf8b2 | interaction/domain-assigned | electron/main.cjs:5618 | 取消选择 | unverified |
| IPC-604523732fc9 | interaction/domain-assigned | electron/main.cjs:5872 | updates:preferences | unverified |
| IPC-12470a0b613d | interaction/domain-assigned | electron/main.cjs:5873 | session:openWindow | unverified |
| IPC-a39cc7ce02ba | interaction/domain-assigned | electron/main.cjs:5874 | updates:setPreferences | unverified |
| IPC-f467ed7e8db3 | interaction/domain-assigned | electron/main.cjs:5875 | updates:check | unverified |
| IPC-3a9f178fb7bf | interaction/domain-assigned | electron/main.cjs:5876 | updates:install | unverified |
| IPC-492022ae23c0 | interaction/domain-assigned | electron/main.cjs:5877 | updates:launchReady | unverified |
| IPC-ecdc6868744d | interaction/domain-assigned | electron/main.cjs:5878 | unifiedUpdates:getState | unverified |
| IPC-b99e425bbb67 | interaction/domain-assigned | electron/main.cjs:5879 | unifiedUpdates:check | unverified |
| IPC-0de3bfd42803 | interaction/domain-assigned | electron/main.cjs:5880 | unifiedUpdates:action | unverified |
| IPC-38a1e74c0bf0 | interaction/domain-assigned | electron/main.cjs:5881 | componentUpdates:getState | unverified |
| IPC-d2490e384bea | interaction/domain-assigned | electron/main.cjs:5882 | componentUpdates:check | unverified |
| IPC-4c96a76e1fff | interaction/domain-assigned | electron/main.cjs:5883 | componentUpdates:stage | unverified |
| IPC-2bdc03c448c8 | interaction/domain-assigned | electron/main.cjs:5884 | componentUpdates:apply | unverified |
| IPC-0df28c4e736e | interaction/domain-assigned | electron/main.cjs:5885 | prPreviewUpdates:getState | unverified |
| IPC-896ab62862d5 | interaction/domain-assigned | electron/main.cjs:5886 | prPreviewUpdates:setEnabled | unverified |
| IPC-48f5feab987e | interaction/domain-assigned | electron/main.cjs:5887 | prPreviewUpdates:check | unverified |
| IPC-084cc412d94d | interaction/domain-assigned | electron/main.cjs:5888 | prPreviewUpdates:apply | unverified |
| IPC-2f3139ccc81d | interaction/domain-assigned | electron/main.cjs:5889 | prPreviewUpdates:exit | unverified |
| IPC-a6f8b35e66db | interaction/domain-assigned | electron/main.cjs:5890 | gitRuntime:status | unverified |
| IPC-95885a554d89 | interaction/domain-assigned | electron/main.cjs:5894 | gitRuntime:refresh | unverified |
| IPC-27e487c7b229 | interaction/domain-assigned | electron/main.cjs:5898 | gitRuntime:prepare | unverified |
| IPC-ed580b69ee22 | interaction/domain-assigned | electron/main.cjs:5902 | gitRuntime:authenticate | unverified |
| IPC-bc0fbf82bf85 | interaction/domain-assigned | electron/main.cjs:5908 | distribution:get | unverified |
| IPC-a7bfd2372b7e | interaction/domain-assigned | electron/main.cjs:5909 | appearance:get | unverified |
| IPC-50bc70e1cb99 | interaction/domain-assigned | electron/main.cjs:5910 | appearance:assets | unverified |
| IPC-dd1cb2c4dbaf | interaction/domain-assigned | electron/main.cjs:5911 | appearance:setTheme | unverified |
| IPC-676e357eba97 | interaction/domain-assigned | electron/main.cjs:5916 | appearance:setUiPreferences | unverified |
| IPC-1bee40727aad | interaction/domain-assigned | electron/main.cjs:5920 | appearance:saveCustom | unverified |
| IPC-f223ebf6449d | interaction/domain-assigned | electron/main.cjs:5924 | appearance:chooseBackground | unverified |
| IPC-407dc0b602c0 | interaction/domain-assigned | electron/main.cjs:5925 | appearance:chooseWallpaperEngine | unverified |
| IPC-4bf2eb429b1c | interaction/domain-assigned | electron/main.cjs:5926 | appearance:importCurrentWallpaperEngine | unverified |
| IPC-45d63f92e5a3 | interaction/domain-assigned | electron/main.cjs:5927 | appearance:listWallpaperEngineProjects | unverified |
| IPC-1f98a9f01002 | interaction/domain-assigned | electron/main.cjs:5928 | appearance:applyWallpaperEngineProject | unverified |
| IPC-d4d2ba35395c | interaction/domain-assigned | electron/main.cjs:5929 | appearance:applyWallpaper | unverified |
| IPC-7f91f32e0d16 | interaction/domain-assigned | electron/main.cjs:5930 | appearance:deleteWallpaper | unverified |
| IPC-ae1ceac72c61 | interaction/domain-assigned | electron/main.cjs:5931 | appearance:syncWallpaperEngine | unverified |
| IPC-060204053efd | interaction/domain-assigned | electron/main.cjs:5932 | appearance:clearBackground | unverified |
| IPC-3832c5b0102f | interaction/domain-assigned | electron/main.cjs:5933 | pet:getState | unverified |
| IPC-79f2cfc84841 | interaction/domain-assigned | electron/main.cjs:5934 | pet:setPreferences | unverified |
| IPC-360e933943a7 | interaction/domain-assigned | electron/main.cjs:5935 | pet:feed | unverified |
| IPC-e07669a6a225 | interaction/domain-assigned | electron/main.cjs:5939 | pet:interact | unverified |
| IPC-f51fc63f30ab | interaction/domain-assigned | electron/main.cjs:5940 | pet:focusMain | unverified |
| IPC-c478e9c67227 | interaction/domain-assigned | electron/main.cjs:5944 | pet:getEnvironment | unverified |
| IPC-c4e33df76b1b | interaction/domain-assigned | electron/main.cjs:5945 | pet:moveTo | unverified |
| IPC-a96d6cf34287 | interaction/domain-assigned | electron/main.cjs:5946 | pet:setInteractive | unverified |
| IPC-9b5370da548e | interaction/domain-assigned | electron/main.cjs:5947 | pet:setHitProfile | unverified |
| IPC-304700b8bd73 | interaction/domain-assigned | electron/main.cjs:5948 | settings:openDocument | unverified |
| IPC-ddccd1885b4d | interaction/domain-assigned | electron/main.cjs:5973 | storage:scan | unverified |
| IPC-13ff329555c8 | interaction/domain-assigned | electron/main.cjs:5977 | storage:cleanupPreview | unverified |
| IPC-e7bc1df45329 | interaction/domain-assigned | electron/main.cjs:5981 | storage:cleanupApply | unverified |
| IPC-83a6c21affd6 | interaction/domain-assigned | electron/main.cjs:5985 | storage:status | unverified |
| IPC-a188c3e44ffc | interaction/domain-assigned | electron/main.cjs:6034 | rightWorkspace:resource | unverified |
| IPC-add51cf9f79c | interaction/domain-assigned | electron/main.cjs:6044 | rightWorkspace:openFile | unverified |
| IPC-dd21ca30c70d | interaction/domain-assigned | electron/main.cjs:6048 | rightWorkspace:previewLocal | unverified |
| IPC-b20fd2d977b6 | interaction/domain-assigned | electron/main.cjs:6186 | computerUse:state | unverified |
| IPC-010db01572cc | interaction/domain-assigned | electron/main.cjs:6187 | computerUse:setEnabled | unverified |
| IPC-d804c226c50c | interaction/domain-assigned | electron/main.cjs:6192 | computerUse:requestAuthorization | unverified |
| IPC-fc00a58cab02 | interaction/domain-assigned | electron/main.cjs:6193 | computerUse:authorize | unverified |
| IPC-e8038a63e819 | interaction/domain-assigned | electron/main.cjs:6194 | computerUse:decline | unverified |
| IPC-1342988e4edf | interaction/domain-assigned | electron/main.cjs:6195 | computerUse:revokePermanent | unverified |
| IPC-1b344447d804 | interaction/domain-assigned | electron/main.cjs:6196 | computerUse:policy | unverified |
| IPC-8cc885367365 | interaction/domain-assigned | electron/main.cjs:6197 | computerUse:setDefaultAccess | unverified |
| IPC-3252ab297a03 | interaction/domain-assigned | electron/main.cjs:6198 | computerUse:setAppOverride | unverified |
| IPC-85621430c365 | interaction/domain-assigned | electron/main.cjs:6199 | computerUse:revokeAppOverride | unverified |
| IPC-fd67440aa41f | interaction/domain-assigned | electron/main.cjs:6216 | shell:copyText | unverified |
| IPC-8d452f69453d | interaction/domain-assigned | electron/main.cjs:6220 | runtime:start | unverified |
| IPC-5b650e2e9b1d | interaction/domain-assigned | electron/main.cjs:6221 | runtime:state | unverified |
| IPC-dafc1e181f57 | interaction/domain-assigned | electron/main.cjs:6222 | window:beginDrag | unverified |
| IPC-922c434d7cf4 | interaction/domain-assigned | electron/main.cjs:6227 | window:moveDrag | unverified |
| IPC-0a095a34aed3 | interaction/domain-assigned | electron/main.cjs:6232 | window:endDrag | unverified |
| IPC-6c9b48c43ccf | interaction/domain-assigned | electron/main.cjs:6236 | appearance:wallpaper-lifecycle:get | unverified |
| IPC-cdd6a92ea544 | interaction/domain-assigned | electron/main.cjs:6240 | shell:openLink | unverified |
| IPC-cd620cebbcc4 | interaction/domain-assigned | electron/main.cjs:6248 | shell:openExternal | unverified |
| IPC-9f34f06598d6 | interaction/domain-assigned | electron/main.cjs:6252 | shell:openLocal | unverified |
| IPC-87cb1a8729fc | interaction/domain-assigned | electron/main.cjs:6253 | sessionMenu:sync | unverified |
| IPC-b00d561e3ea8 | interaction/domain-assigned | electron/main.cjs:6257 | sessionMenu:setFlag | unverified |
| IPC-6fd8657514f4 | interaction/domain-assigned | electron/main.cjs:6261 | agentTeams:authorizeAutopilotSettings | unverified |
| IPC-12754c2f009c | interaction/domain-assigned | electron/main.cjs:6262 | workspace:chooseDirectory | unverified |
| IPC-58bcf5e661a8 | interaction/domain-assigned | electron/main.cjs:6266 | desktopDevice:action | unverified |
| IPC-2491382074b1 | interaction/domain-assigned | electron/main.cjs:6294 | desktopAndroid:action | unverified |
| IPC-496f2cc20e18 | interaction/read-only-owner | electron/pet/pet-preload.cjs:4 | pet:getState | unverified |
| IPC-2c275e6386e4 | interaction/read-only-owner | electron/pet/pet-preload.cjs:5 | pet:feed | unverified |
| IPC-06e0184256c8 | interaction/read-only-owner | electron/pet/pet-preload.cjs:6 | pet:interact | unverified |
| IPC-f6aef9ccaa2f | interaction/read-only-owner | electron/pet/pet-preload.cjs:7 | pet:setPreferences | unverified |
| IPC-d4457a13ced9 | interaction/read-only-owner | electron/pet/pet-preload.cjs:8 | pet:focusMain | unverified |
| IPC-dedc7b68ad9e | interaction/read-only-owner | electron/pet/pet-preload.cjs:9 | pet:getEnvironment | unverified |
| IPC-71a80e3093d2 | interaction/read-only-owner | electron/pet/pet-preload.cjs:10 | pet:moveTo | unverified |
| IPC-bb55c7ba00a5 | interaction/read-only-owner | electron/pet/pet-preload.cjs:11 | pet:setInteractive | unverified |
| IPC-48436c52f36e | interaction/read-only-owner | electron/pet/pet-preload.cjs:12 | pet:setHitProfile | unverified |
| IPC-06e2e7c66d24 | interaction/read-only-owner | electron/pet/pet-preload.cjs:15 | pet:state | unverified |
| IPC-52ad8a7f420e | interaction/domain-assigned | electron/preload.cjs:10 | runtime:start | unverified |
| IPC-cfd40039e8dd | interaction/domain-assigned | electron/preload.cjs:11 | runtime:state | unverified |
| IPC-86e79907d09d | interaction/domain-assigned | electron/preload.cjs:12 | updates:preferences | unverified |
| IPC-7febfd50e677 | interaction/domain-assigned | electron/preload.cjs:13 | updates:setPreferences | unverified |
| IPC-a87836e0e29d | interaction/domain-assigned | electron/preload.cjs:14 | updates:check | unverified |
| IPC-312cd96178e5 | interaction/domain-assigned | electron/preload.cjs:15 | updates:install | unverified |
| IPC-97c11e6ac241 | interaction/domain-assigned | electron/preload.cjs:16 | updates:launchReady | unverified |
| IPC-6f1ece2d3b2d | interaction/domain-assigned | electron/preload.cjs:17 | unifiedUpdates:getState | unverified |
| IPC-fe5896395a4c | interaction/domain-assigned | electron/preload.cjs:18 | unifiedUpdates:check | unverified |
| IPC-bbc1f60dfc34 | interaction/domain-assigned | electron/preload.cjs:19 | unifiedUpdates:action | unverified |
| IPC-816c29cf6254 | interaction/domain-assigned | electron/preload.cjs:20 | componentUpdates:getState | unverified |
| IPC-d79196bc052d | interaction/domain-assigned | electron/preload.cjs:21 | componentUpdates:check | unverified |
| IPC-8601a219e43e | interaction/domain-assigned | electron/preload.cjs:22 | componentUpdates:stage | unverified |
| IPC-519144a9bf1b | interaction/domain-assigned | electron/preload.cjs:23 | componentUpdates:apply | unverified |
| IPC-c6284e869046 | interaction/domain-assigned | electron/preload.cjs:24 | prPreviewUpdates:getState | unverified |
| IPC-842848210786 | interaction/domain-assigned | electron/preload.cjs:25 | prPreviewUpdates:setEnabled | unverified |
| IPC-bba16dec7655 | interaction/domain-assigned | electron/preload.cjs:26 | prPreviewUpdates:check | unverified |
| IPC-c2219ade4e8c | interaction/domain-assigned | electron/preload.cjs:27 | prPreviewUpdates:apply | unverified |
| IPC-d880404f66f0 | interaction/domain-assigned | electron/preload.cjs:28 | prPreviewUpdates:exit | unverified |
| IPC-465237709a19 | interaction/domain-assigned | electron/preload.cjs:29 | gitRuntime:status | unverified |
| IPC-773414244278 | interaction/domain-assigned | electron/preload.cjs:30 | gitRuntime:refresh | unverified |
| IPC-91f55094212b | interaction/domain-assigned | electron/preload.cjs:31 | gitRuntime:prepare | unverified |
| IPC-367535af12f7 | interaction/domain-assigned | electron/preload.cjs:32 | gitRuntime:authenticate | unverified |
| IPC-4a1bcbb82fa6 | interaction/domain-assigned | electron/preload.cjs:33 | distribution:get | unverified |
| IPC-d9813977a0ca | interaction/domain-assigned | electron/preload.cjs:34 | appearance:get | unverified |
| IPC-edeb8410b51f | interaction/domain-assigned | electron/preload.cjs:35 | appearance:setTheme | unverified |
| IPC-f8409fa8bd61 | interaction/domain-assigned | electron/preload.cjs:36 | appearance:setUiPreferences | unverified |
| IPC-ec31d658f0fd | interaction/domain-assigned | electron/preload.cjs:37 | appearance:assets | unverified |
| IPC-295bcbba7380 | interaction/domain-assigned | electron/preload.cjs:38 | appearance:saveCustom | unverified |
| IPC-8f61dc1fd6ca | interaction/domain-assigned | electron/preload.cjs:39 | appearance:chooseBackground | unverified |
| IPC-9d339b4f86cc | interaction/domain-assigned | electron/preload.cjs:40 | appearance:chooseWallpaperEngine | unverified |
| IPC-1cdce60b6ff4 | interaction/domain-assigned | electron/preload.cjs:41 | appearance:importCurrentWallpaperEngine | unverified |
| IPC-6b80c1e8c37e | interaction/domain-assigned | electron/preload.cjs:42 | appearance:listWallpaperEngineProjects | unverified |
| IPC-734e5345b112 | interaction/domain-assigned | electron/preload.cjs:43 | appearance:applyWallpaperEngineProject | unverified |
| IPC-01b28265ddee | interaction/domain-assigned | electron/preload.cjs:44 | appearance:applyWallpaper | unverified |
| IPC-7fd9dda464a5 | interaction/domain-assigned | electron/preload.cjs:45 | appearance:deleteWallpaper | unverified |
| IPC-27adc2eb6d4a | interaction/domain-assigned | electron/preload.cjs:46 | appearance:syncWallpaperEngine | unverified |
| IPC-87ada8d9de89 | interaction/domain-assigned | electron/preload.cjs:47 | appearance:clearBackground | unverified |
| IPC-65b5e89c12c8 | interaction/domain-assigned | electron/preload.cjs:48 | pet:getState | unverified |
| IPC-3e2a6251f0ef | interaction/domain-assigned | electron/preload.cjs:49 | pet:setPreferences | unverified |
| IPC-24cf6f8a612c | interaction/domain-assigned | electron/preload.cjs:50 | pet:feed | unverified |
| IPC-f5b0df9c26ee | interaction/domain-assigned | electron/preload.cjs:51 | pet:focusMain | unverified |
| IPC-01af2e1f2383 | interaction/domain-assigned | electron/preload.cjs:52 | settings:openDocument | unverified |
| IPC-ec35757a93bd | interaction/domain-assigned | electron/preload.cjs:64 | storage:scan | unverified |
| IPC-6870560cf202 | interaction/domain-assigned | electron/preload.cjs:65 | storage:cleanupPreview | unverified |
| IPC-4456c86fac2e | interaction/domain-assigned | electron/preload.cjs:66 | storage:cleanupApply | unverified |
| IPC-bffc0236fc9a | interaction/domain-assigned | electron/preload.cjs:67 | storage:status | unverified |
| IPC-2fb5d05d6def | interaction/domain-assigned | electron/preload.cjs:78 | rightWorkspace:resource | unverified |
| IPC-229e2b83c8fa | interaction/domain-assigned | electron/preload.cjs:79 | rightWorkspace:openFile | unverified |
| IPC-7df91f40131b | interaction/domain-assigned | electron/preload.cjs:80 | rightWorkspace:previewLocal | unverified |
| IPC-16e3fd39d35f | interaction/domain-assigned | electron/preload.cjs:87 | session:openWindow | unverified |
| IPC-901f1c10373b | interaction/domain-assigned | electron/preload.cjs:107 | computerUse:state | unverified |
| IPC-497f7aca539b | interaction/domain-assigned | electron/preload.cjs:108 | computerUse:setEnabled | unverified |
| IPC-081a38e25914 | interaction/domain-assigned | electron/preload.cjs:109 | computerUse:requestAuthorization | unverified |
| IPC-7b175c25305c | interaction/domain-assigned | electron/preload.cjs:110 | computerUse:authorize | unverified |
| IPC-4624df6df2f9 | interaction/domain-assigned | electron/preload.cjs:111 | computerUse:decline | unverified |
| IPC-f5576d64716b | interaction/domain-assigned | electron/preload.cjs:112 | computerUse:revokePermanent | unverified |
| IPC-7474c6951f32 | interaction/domain-assigned | electron/preload.cjs:113 | computerUse:policy | unverified |
| IPC-3d851924e157 | interaction/domain-assigned | electron/preload.cjs:114 | computerUse:setDefaultAccess | unverified |
| IPC-333290155295 | interaction/domain-assigned | electron/preload.cjs:115 | computerUse:setAppOverride | unverified |
| IPC-831debc67e01 | interaction/domain-assigned | electron/preload.cjs:116 | computerUse:revokeAppOverride | unverified |
| IPC-31e787a33cbc | interaction/domain-assigned | electron/preload.cjs:117 | desktopDevice:action | unverified |
| IPC-10ca9cb64dbb | interaction/domain-assigned | electron/preload.cjs:118 | desktopAndroid:action | unverified |
| IPC-fbb5c17559d1 | interaction/domain-assigned | electron/preload.cjs:134 | shell:copyText | unverified |
| IPC-4003c2b0b8d5 | interaction/domain-assigned | electron/preload.cjs:135 | shell:openLink | unverified |
| IPC-06cb6ebbc8c2 | interaction/domain-assigned | electron/preload.cjs:136 | shell:openExternal | unverified |
| IPC-15c40544508b | interaction/domain-assigned | electron/preload.cjs:137 | shell:openLocal | unverified |
| IPC-3c503c7fc84f | interaction/domain-assigned | electron/session-menu-preload.cjs:38 | agentTeams:authorizeAutopilotSettings | unverified |
| IPC-563ee27d4ab1 | interaction/domain-assigned | electron/session-menu-preload.cjs:67 | sessionMenu:sync | unverified |
| IPC-6e3fad11fd02 | interaction/domain-assigned | electron/session-menu-preload.cjs:73 | sessionMenu:setFlag | unverified |
| UI-CONTROL-232ee255f2fe | interaction/domain-assigned | renderer/app.js:509 | button:${current ? '正在使用' : '使用此壁纸'} | unverified |
| UI-CONTROL-271ae7ae5e2b | interaction/domain-assigned | renderer/app.js:510 | button:${item.available ? '移除' : '移除失效记录'} | unverified |
| UI-CONTROL-80fdf5d690e5 | interaction/domain-assigned | renderer/app.js:544 | button:anonymous@544 | unverified |
| UI-CONTROL-4d82c0316df4 | interaction/domain-assigned | renderer/app.js:562 | button:来源 | unverified |
| UI-CONTROL-0c88195a6e97 | interaction/domain-assigned | renderer/app.js:784 | button:选择并使用 ${escapeHtml(project.title)} 选择并使用 ${escapeHtml(project.title)} | unverified |
| UI-CONTROL-ce7b79667c4d | interaction/domain-assigned | renderer/app.js:1150 | button:解除配对 | unverified |
| UI-CONTROL-2e31a422aafc | interaction/domain-assigned | renderer/app.js:1169 | button:停止 | unverified |
| UI-CONTROL-e4e41a54af66 | interaction/domain-assigned | renderer/app.js:2076 | button:关闭更新中心 关闭更新中心 | unverified |
| UI-CONTROL-11dbbd99cfed | interaction/domain-assigned | renderer/app.js:2077 | button:立即检查 | unverified |
| UI-CONTROL-eaddd428cb35 | interaction/domain-assigned | renderer/app.js:2077 | button:退出当前预览 | unverified |
| UI-CONTROL-b922cab94ee8 | interaction/domain-assigned | renderer/app.js:2142 | button:显示 Git 详情 显示 Git 详情 | unverified |
| UI-CONTROL-071cef199b89 | interaction/domain-assigned | renderer/app.js:2155 | button:连接 GitHub | unverified |
| UI-CONTROL-7e7c745d3311 | interaction/domain-assigned | renderer/app.js:2155 | button:刷新状态 | unverified |
| UI-CONTROL-7a6cb12d7dd7 | interaction/domain-assigned | renderer/app.js:2214 | select:集成终端 Shell 集成终端 Shell | unverified |
| UI-CONTROL-cb04faa2fa7d | interaction/domain-assigned | renderer/index.html:22 | button:petQuickButton 女仆鲸 | unverified |
| UI-CONTROL-cbe6502c0d9d | interaction/domain-assigned | renderer/index.html:27 | button:skinQuickButton 快速切换外观皮肤 | unverified |
| UI-CONTROL-48799554f843 | interaction/domain-assigned | renderer/index.html:31 | button:storageQuickButton 存储与缓存 | unverified |
| UI-CONTROL-d5c980972009 | interaction/domain-assigned | renderer/index.html:46 | button:rightWorkspaceBack 返回上一个面板 | unverified |
| UI-CONTROL-2084cc475d4f | interaction/domain-assigned | renderer/index.html:49 | button:rightWorkspaceBrowserButton | unverified |
| UI-CONTROL-9423269a8bee | interaction/domain-assigned | renderer/index.html:50 | button:rightWorkspaceFilesButton | unverified |
| UI-CONTROL-eaec80045d12 | interaction/domain-assigned | renderer/index.html:51 | button:rightWorkspaceSchedulesButton | unverified |
| UI-CONTROL-8ffe4abb9f2a | interaction/domain-assigned | renderer/index.html:52 | button:rightWorkspaceDevicesButton | unverified |
| UI-CONTROL-c246b862122c | interaction/domain-assigned | renderer/index.html:59 | button:closeBrowserSidebar 关闭右侧工作区 | unverified |
| UI-CONTROL-797e588a1a4a | interaction/domain-assigned | renderer/index.html:73 | button:closeBrowserHistory 关闭浏览历史 | unverified |
| UI-CONTROL-0652f8fb1d54 | interaction/domain-assigned | renderer/index.html:74 | button:搜索 | unverified |
| UI-CONTROL-5681675bc782 | interaction/domain-assigned | renderer/index.html:79 | button:closeBrowserDownloads 关闭下载状态 | unverified |
| UI-CONTROL-8127eea98afe | interaction/domain-assigned | renderer/index.html:94 | button:closeBrowserProfile | unverified |
| UI-CONTROL-7cd7f490afe1 | interaction/domain-assigned | renderer/index.html:102 | button:closePetPanel 关闭 | unverified |
| UI-CONTROL-ca9f94ca19fc | interaction/domain-assigned | renderer/index.html:119 | button:petAwakeToggle | unverified |
| UI-CONTROL-1b237a72f3c5 | interaction/domain-assigned | renderer/index.html:120 | button:petFeedButton | unverified |
| UI-CONTROL-46ad4a0b5d27 | interaction/domain-assigned | renderer/index.html:122 | input:petAutoFeed | unverified |
| UI-CONTROL-05d4a1fc4c8d | interaction/domain-assigned | renderer/index.html:123 | input:petAlwaysOnTop | unverified |
| UI-CONTROL-4fe59e50d52a | interaction/domain-assigned | renderer/index.html:124 | input:petProactive | unverified |
| UI-CONTROL-5bbc093292f2 | interaction/domain-assigned | renderer/index.html:125 | select:petCompanionStyle | unverified |
| UI-CONTROL-c5934d22caae | interaction/domain-assigned | renderer/index.html:135 | button:closeMobileSync 关闭 | unverified |
| UI-CONTROL-1037d01e03ad | interaction/domain-assigned | renderer/index.html:182 | button:stopMobileControl | unverified |
| UI-CONTROL-57d1ea06710f | interaction/domain-assigned | renderer/index.html:187 | button:refreshMobilePairing | unverified |
| UI-CONTROL-e74dacce5ccf | interaction/domain-assigned | renderer/index.html:199 | button:copyMobileSyncUrl | unverified |
| UI-CONTROL-32fdb18b21f4 | interaction/domain-assigned | renderer/index.html:217 | button:closeStorage 关闭 | unverified |
| UI-CONTROL-3ce8bee71f79 | interaction/domain-assigned | renderer/index.html:222 | button:refreshStorage | unverified |
| UI-CONTROL-361440526f53 | interaction/domain-assigned | renderer/index.html:228 | input:storageOldRuntimes | unverified |
| UI-CONTROL-10f5db783b56 | interaction/domain-assigned | renderer/index.html:229 | input:storageCaches | unverified |
| UI-CONTROL-3876c9034c24 | interaction/domain-assigned | renderer/index.html:230 | input:storageOldTemp | unverified |
| UI-CONTROL-c6eb94545e12 | interaction/domain-assigned | renderer/index.html:230 | select:storageTempDays | unverified |
| UI-CONTROL-6f53c940936b | interaction/domain-assigned | renderer/index.html:232 | button:previewStorageCleanup | unverified |
| UI-CONTROL-ebf36fd9f6aa | interaction/domain-assigned | renderer/index.html:237 | input:storageConfirm | unverified |
| UI-CONTROL-8591e1c87c08 | interaction/domain-assigned | renderer/index.html:238 | button:applyStorageCleanup | unverified |
| UI-CONTROL-ee74ada48e57 | interaction/domain-assigned | renderer/index.html:249 | button:closeMemory 关闭 | unverified |
| UI-CONTROL-d2552f62ee4a | interaction/domain-assigned | renderer/index.html:336 | button:computerUseAuthorizationClose 关闭并拒绝授权 | unverified |
| UI-CONTROL-4253a702fa47 | interaction/domain-assigned | renderer/index.html:345 | button:computerUseAuthorizationSession | unverified |
| UI-CONTROL-d2ba7d1a9285 | interaction/domain-assigned | renderer/index.html:346 | button:computerUseAuthorizationForever | unverified |
| UI-CONTROL-816a2868a90e | interaction/domain-assigned | renderer/index.html:347 | button:computerUseAuthorizationDecline | unverified |
| UI-CONTROL-47da24550262 | interaction/domain-assigned | renderer/index.html:355 | button:retryRuntime | unverified |
| UI-CONTROL-6259ff51fa38 | interaction/domain-assigned | renderer/index.html:361 | button:closeSkinPicker 关闭 | unverified |
| UI-CONTROL-db4eb4193b7d | interaction/domain-assigned | renderer/index.html:361 | button:restoreOfficialTheme | unverified |
| UI-CONTROL-bcd6ef5af084 | interaction/domain-assigned | renderer/index.html:364 | button:skinThemeTab | unverified |
| UI-CONTROL-78497d8d8a1a | interaction/domain-assigned | renderer/index.html:365 | button:skinWallpaperTab | unverified |
| UI-CONTROL-88aaf2aabdb3 | interaction/domain-assigned | renderer/index.html:366 | button:skinModeTab | unverified |
| UI-CONTROL-bad7bb687978 | interaction/domain-assigned | renderer/index.html:375 | select:skinCustomMode | unverified |
| UI-CONTROL-5d7aa30bb1bc | interaction/domain-assigned | renderer/index.html:376 | input:skinCustomAccent | unverified |
| UI-CONTROL-07c9fb7b4502 | interaction/domain-assigned | renderer/index.html:377 | input:skinCustomSurface | unverified |
| UI-CONTROL-15d3aec918e6 | interaction/domain-assigned | renderer/index.html:378 | input:skinCustomText | unverified |
| UI-CONTROL-ac44c2391623 | interaction/domain-assigned | renderer/index.html:381 | button:skinApplyCustom | unverified |
| UI-CONTROL-72abd3bc5d34 | interaction/domain-assigned | renderer/index.html:390 | button:skinChooseBackground | unverified |
| UI-CONTROL-c16575a49924 | interaction/domain-assigned | renderer/index.html:391 | button:skinChooseWallpaperEngine | unverified |
| UI-CONTROL-ae83a24fcc89 | interaction/domain-assigned | renderer/index.html:392 | button:skinBrowseWallpaperEngine | unverified |
| UI-CONTROL-5cccf5006f93 | interaction/domain-assigned | renderer/index.html:393 | button:skinWallpaperEngineSync | unverified |
| UI-CONTROL-8718782d6d62 | interaction/domain-assigned | renderer/index.html:394 | button:skinClearBackground | unverified |
| UI-CONTROL-f969f4941ef9 | interaction/domain-assigned | renderer/index.html:405 | input:skinWallpaperEngineSearch 搜索标题、类型或项目路径 | unverified |
| UI-CONTROL-2f0d1629d90e | interaction/domain-assigned | renderer/index.html:406 | button:skinWallpaperEngineSearchClear 清空搜索 | unverified |
| UI-CONTROL-e8f36fba7272 | interaction/domain-assigned | renderer/index.html:411 | button:skinWallpaperEngineRescan | unverified |
| UI-CONTROL-dba12eb06122 | interaction/domain-assigned | renderer/index.html:412 | button:skinWallpaperEngineManual | unverified |
| UI-CONTROL-b85c02aa2db1 | interaction/domain-assigned | renderer/index.html:413 | button:skinWallpaperEngineClose | unverified |
| UI-CONTROL-1b67ead6f0a1 | interaction/domain-assigned | renderer/index.html:418 | button:skinResetWallpaperAppearance | unverified |
| UI-CONTROL-3a3fc49cf712 | interaction/domain-assigned | renderer/index.html:420 | input:skinWallpaperBrightness | unverified |
| UI-CONTROL-808ab6bd095b | interaction/domain-assigned | renderer/index.html:421 | input:skinWallpaperBlur | unverified |
| UI-CONTROL-65b3ee37d46d | interaction/domain-assigned | renderer/index.html:422 | input:skinGlassTransparency | unverified |
| UI-CONTROL-9630ebbee126 | interaction/domain-assigned | renderer/index.html:423 | input:skinBorderStrength | unverified |
| UI-CONTROL-10e6158e2788 | interaction/domain-assigned | renderer/index.html:424 | input:skinReadabilityStrength | unverified |
| UI-CONTROL-a889ca48ab50 | interaction/domain-assigned | renderer/index.html:427 | button:skinApplyWallpaperAppearance | unverified |
| UI-CONTROL-e3d0bdf45c2e | interaction/domain-assigned | renderer/index.html:435 | input:skinReducedMotion | unverified |
| UI-CONTROL-5408265bef84 | interaction/domain-assigned | renderer/index.html:436 | input:skinLowPerformance | unverified |
| UI-CONTROL-ee026eff5f22 | interaction/domain-assigned | renderer/index.html:446 | button:closeModelRouting 关闭 | unverified |
| UI-CONTROL-4b78d7da67a5 | interaction/domain-assigned | renderer/index.html:491 | button:updateLaterButton | unverified |
| UI-CONTROL-384377bc1d66 | interaction/domain-assigned | renderer/index.html:492 | button:updateNowButton | unverified |
| UI-CONTROL-14e21e2057a3 | interaction/domain-assigned | renderer/index.html:504 | button:updateNoticeLater | unverified |
| UI-CONTROL-6a8feca73db3 | interaction/domain-assigned | renderer/index.html:505 | button:updateNoticeRelease | unverified |
| UI-CONTROL-b6c29d9b6358 | interaction/domain-assigned | renderer/index.html:506 | button:updateNoticeInstall | unverified |
| UI-CONTROL-f410451181ae | interaction/domain-assigned | renderer/pet/index.html:14 | button:character 可以抚摸、拖动和抛出女仆鲸 | unverified |
| UI-CONTROL-82d2453d2e64 | interaction/domain-assigned | renderer/pet/index.html:18 | button:focusButton | unverified |
| UI-CONTROL-5948fa5316da | interaction/domain-assigned | renderer/pet/index.html:19 | button:feedButton | unverified |
| UI-CONTROL-000b59159a92 | interaction/domain-assigned | renderer/pet/index.html:20 | button:tuckButton | unverified |
| UI-CONTROL-021e3536e189 | interaction/domain-assigned | renderer/theme-integration.js:742 | button:anonymous@742 | unverified |
| UI-CONTROL-dcfb7d47147f | interaction/domain-assigned | renderer/theme-integration.js:783 | button:来源 | unverified |
| UI-CONTROL-20af504f50a5 | interaction/domain-assigned | renderer/theme-integration.js:852 | button:恢复官方外观 | unverified |
| UI-CONTROL-aba242c44672 | interaction/domain-assigned | renderer/theme-integration.js:853 | button:皮肤 | unverified |
| UI-CONTROL-b62cf7036b5a | interaction/domain-assigned | renderer/theme-integration.js:853 | button:界面模式 | unverified |
| UI-CONTROL-145f89da52f1 | interaction/domain-assigned | renderer/theme-integration.js:860 | select:anonymous@860 | unverified |
| UI-CONTROL-56a7569e4bad | interaction/domain-assigned | renderer/theme-integration.js:861 | input:anonymous@861 | unverified |
| UI-CONTROL-71602d384336 | interaction/domain-assigned | renderer/theme-integration.js:862 | input:anonymous@862 | unverified |
| UI-CONTROL-ef07a001fd6a | interaction/domain-assigned | renderer/theme-integration.js:863 | input:anonymous@863 | unverified |
| UI-CONTROL-de7dd2b21528 | interaction/domain-assigned | renderer/theme-integration.js:866 | input:anonymous@866 | unverified |
| UI-CONTROL-e58e545d72f4 | interaction/domain-assigned | renderer/theme-integration.js:867 | input:anonymous@867 | unverified |
| UI-CONTROL-35cf672077a8 | interaction/domain-assigned | renderer/theme-integration.js:868 | input:anonymous@868 | unverified |
| UI-CONTROL-3dc31ee499b4 | interaction/domain-assigned | renderer/theme-integration.js:869 | input:anonymous@869 | unverified |
| UI-CONTROL-3eba7e715b4d | interaction/domain-assigned | renderer/theme-integration.js:870 | input:anonymous@870 | unverified |
| UI-CONTROL-0695fa368bd5 | interaction/domain-assigned | renderer/theme-integration.js:873 | button:选择图片或视频 | unverified |
| UI-CONTROL-36fb79c599cc | interaction/domain-assigned | renderer/theme-integration.js:873 | button:移除壁纸 | unverified |
| UI-CONTROL-ac390f099719 | interaction/domain-assigned | renderer/theme-integration.js:873 | button:应用并保存 | unverified |
| UI-CONTROL-f9614f126431 | interaction/domain-assigned | renderer/theme-integration.js:873 | button:导入 Wallpaper Engine | unverified |
| UI-CONTROL-59b235f15d2c | interaction/domain-assigned | renderer/theme-integration.js:880 | input:anonymous@880 | unverified |
| UI-CONTROL-fd0dde19fd47 | interaction/domain-assigned | renderer/theme-integration.js:881 | input:anonymous@881 | unverified |
| UI-CONTROL-e250edc4d364 | runtime-storage/read-only-owner | scripts/extract-pet-background.mjs:8 | input:anonymous@8 | unverified |
| MENU-LABEL-a8861603aaad | mobile/domain-assigned | electron/bridge/desktop-device-stream.cjs:152 | 完整 Windows 虚拟桌面 | unverified |
| MENU-KEYBOARD-b741e27472cd | mobile/domain-assigned | electron/bridge/mobile-relay-config.cjs:57 | desktop | unverified |
| MENU-KEYBOARD-8a7063d2bcba | mobile/domain-assigned | electron/bridge/sync-transports/wss-relay-adapter.cjs:110 | desktop | unverified |
| IPC-646bee19b490 | mobile/domain-assigned | electron/main.cjs:6200 | mobileSync:getState | unverified |
| IPC-52c718ca581e | mobile/domain-assigned | electron/main.cjs:6201 | mobileSync:setEnabled | unverified |
| IPC-a8aaac177284 | mobile/domain-assigned | electron/main.cjs:6202 | mobileSync:setRemoteEnabled | unverified |
| IPC-ebe3b6816372 | mobile/domain-assigned | electron/main.cjs:6203 | mobileSync:setTransportPreference | unverified |
| IPC-2965c78d1921 | mobile/domain-assigned | electron/main.cjs:6204 | mobileSync:getRelayConfig | unverified |
| IPC-91198759e2d5 | mobile/domain-assigned | electron/main.cjs:6205 | mobileSync:setRelayConfig | unverified |
| IPC-17a1438a0429 | mobile/domain-assigned | electron/main.cjs:6206 | mobileSync:clearRelayConfig | unverified |
| IPC-000b08786ccb | mobile/domain-assigned | electron/main.cjs:6207 | mobileSync:beginPairing | unverified |
| IPC-c0b1683c68e2 | mobile/domain-assigned | electron/main.cjs:6208 | mobileSync:revokeDevice | unverified |
| IPC-363543dc05c3 | mobile/domain-assigned | electron/main.cjs:6209 | mobileControl:send | unverified |
| IPC-200099e94477 | mobile/domain-assigned | electron/main.cjs:6210 | mobileControl:cancel | unverified |
| IPC-c8fd67799527 | mobile/domain-assigned | electron/main.cjs:6211 | mobileControl:stop | unverified |
| IPC-134d2349582a | mobile/domain-assigned | electron/main.cjs:6212 | mobileSync:copy | unverified |
| IPC-a233c72397ce | mobile/domain-assigned | electron/preload.cjs:119 | mobileSync:getState | unverified |
| IPC-710a2ea38c2b | mobile/domain-assigned | electron/preload.cjs:120 | mobileSync:setEnabled | unverified |
| IPC-82e20eddabd2 | mobile/domain-assigned | electron/preload.cjs:121 | mobileSync:setRemoteEnabled | unverified |
| IPC-d6cd6945891b | mobile/domain-assigned | electron/preload.cjs:122 | mobileSync:setTransportPreference | unverified |
| IPC-45eb4a8e955f | mobile/domain-assigned | electron/preload.cjs:123 | mobileSync:getRelayConfig | unverified |
| IPC-7eb4fbeb90fb | mobile/domain-assigned | electron/preload.cjs:124 | mobileSync:setRelayConfig | unverified |
| IPC-764b2e8d7f42 | mobile/domain-assigned | electron/preload.cjs:125 | mobileSync:clearRelayConfig | unverified |
| IPC-5b19549f7f55 | mobile/domain-assigned | electron/preload.cjs:128 | mobileSync:beginPairing | unverified |
| IPC-1f3e8d05ba7e | mobile/domain-assigned | electron/preload.cjs:129 | mobileSync:revokeDevice | unverified |
| IPC-a3680b86c1b8 | mobile/domain-assigned | electron/preload.cjs:130 | mobileControl:send | unverified |
| IPC-aef2190f4fd8 | mobile/domain-assigned | electron/preload.cjs:131 | mobileControl:cancel | unverified |
| IPC-5424e7fc06bc | mobile/domain-assigned | electron/preload.cjs:132 | mobileControl:stop | unverified |
| IPC-af9403bff43d | mobile/domain-assigned | electron/preload.cjs:133 | mobileSync:copy | unverified |
| MENU-LABEL-f8b295e1e712 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:637 | 对话 | unverified |
| MENU-LABEL-6091a2216610 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:638 | 代理团队 | unverified |
| MENU-LABEL-e08cefef4d78 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:639 | 定时任务 | unverified |
| MENU-LABEL-6dd3563533a0 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:640 | 我的 | unverified |
| MENU-LABEL-6dafef64abf5 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1031 | 当前工作台未提供此入口 | unverified |
| UI-CONTROL-61b7d505e0d3 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1264 | button:anonymous@1264 | unverified |
| UI-CONTROL-4749940d4756 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | input:搜索项目和对话 搜索项目和对话 | unverified |
| UI-CONTROL-8ba1504e5c4b | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:首页 首页 | unverified |
| UI-CONTROL-8f4ce26806af | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:搜索项目和对话 搜索项目和对话 | unverified |
| UI-CONTROL-93759aea34d8 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:关闭会话历史 关闭会话历史 | unverified |
| UI-CONTROL-998813fc8406 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:新建会话 新建会话 | unverified |
| UI-CONTROL-c5064ec9e2d1 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:项目详情 | unverified |
| UI-CONTROL-dbea54521bc3 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:anonymous@1265 | unverified |
| UI-CONTROL-e38eadd0f550 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:1265 | button:清除搜索 清除搜索 | unverified |
| UI-CONTROL-0630058d60c5 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2074 | button:关闭设置 关闭设置 | unverified |
| UI-CONTROL-45745de184e9 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2074 | button:返回设置分类 返回设置分类 | unverified |
| UI-CONTROL-3d510ad4c3ae | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2558 | button:harness-mobile-model-tab-effort | unverified |
| UI-CONTROL-66307736ae92 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2558 | button:harness-mobile-model-tab-model | unverified |
| UI-CONTROL-70cd0a241ab1 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2558 | button:关闭 关闭 | unverified |
| UI-CONTROL-73507b55afdb | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:2558 | button:关闭模型选择 关闭模型选择 | unverified |
| UI-CONTROL-728593c893a3 | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:3896 | button:选择其他项目或会话 | unverified |
| UI-CONTROL-2650a95871bd | mobile/domain-assigned | mobile/android/app/src/main/assets/mobile-runtime.js:3992 | button:管理 | unverified |
| NATIVE-ACTION-f97ae3db00b9 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:67 | start | unverified |
| NATIVE-ACTION-cdd8e3767b83 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:73 | stop | unverified |
| NATIVE-ACTION-3a10cc03e30b | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:83 | requestStatusRefresh | unverified |
| NATIVE-ACTION-3b4c8b79dd51 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:109 | onCreate | unverified |
| NATIVE-ACTION-11d5a30e6b29 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:143 | onTaskRemoved | unverified |
| NATIVE-ACTION-301bf9eaae20 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:150 | onDestroy | unverified |
| NATIVE-ACTION-bcf6ef81dd05 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:160 | startForegroundForDataSync | unverified |
| NATIVE-ACTION-3f69edaf37fb | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:166 | pollOnce | unverified |
| NATIVE-ACTION-bf685e4c3445 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:293 | openApp | unverified |
| NATIVE-ACTION-ce1fcff6ceb7 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:308 | openUri | unverified |
| NATIVE-ACTION-9795a0d2f71f | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:323 | openSettings | unverified |
| NATIVE-ACTION-08a8a15ebf41 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:341 | startScreenCapture | unverified |
| NATIVE-ACTION-158262f023ca | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:354 | startDocumentPicker | unverified |
| NATIVE-ACTION-3ade242a7d5f | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:490 | createNotificationChannel | unverified |
| NATIVE-ACTION-8d9bc2b08298 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java:512 | updateNotification | unverified |
| NATIVE-ACTION-e4e5c8c22a14 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlSettingsActivity.java:41 | onCreate | unverified |
| NATIVE-ACTION-bb56b3f4a939 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlSettingsActivity.java:76 | onResume | unverified |
| NATIVE-ACTION-ec7c7769f7a4 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlSettingsActivity.java:126 | requestNotificationPermission | unverified |
| NATIVE-ACTION-54ee7731434b | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlSettingsActivity.java:135 | stopNow | unverified |
| NATIVE-ACTION-b8cb2a1f6da8 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/DocumentPickerActivity.java:24 | onCreate | unverified |
| NATIVE-ACTION-d37232e95dfb | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/DocumentPickerActivity.java:53 | onActivityResult | unverified |
| NATIVE-ACTION-d083e43b3e82 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:22 | onReady | unverified |
| NATIVE-ACTION-891b5212104d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:23 | onError | unverified |
| NATIVE-ACTION-ff4d9e9c11ac | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:41 | start | unverified |
| NATIVE-ACTION-6e8204ceface | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:48 | startInternal | unverified |
| NATIVE-ACTION-5976665c7a95 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:201 | stopNative | unverified |
| NATIVE-ACTION-d9a3b49e43e9 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java:208 | stop | unverified |
| NATIVE-ACTION-9488c9e24899 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:43 | onCreate | unverified |
| NATIVE-ACTION-f0ff9efa10f1 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:60 | handleOnBackPressed | unverified |
| NATIVE-ACTION-227b7b8ceb7c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:70 | onResume | unverified |
| NATIVE-ACTION-f584912b2692 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:76 | onPause | unverified |
| NATIVE-ACTION-fce70576782c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:87 | requestCameraPermission | unverified |
| NATIVE-ACTION-466219ebb993 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:93 | showPermissionRecovery | unverified |
| NATIVE-ACTION-aa6bd3a8bf20 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:101 | startScanner | unverified |
| NATIVE-ACTION-9d353943cd68 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java:118 | openAppSettings | unverified |
| NATIVE-ACTION-d0e3bd33bdad | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:36 | onServiceConnected | unverified |
| NATIVE-ACTION-3448b98bdcf9 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:41 | onAccessibilityEvent | unverified |
| NATIVE-ACTION-63e694b3ce58 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:45 | onInterrupt | unverified |
| NATIVE-ACTION-ca62436afe27 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:49 | onDestroy | unverified |
| NATIVE-ACTION-453468aae380 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:109 | onCompleted | unverified |
| NATIVE-ACTION-a60ce1e70691 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:110 | onCancelled | unverified |
| NATIVE-ACTION-0d2be882f2a7 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:146 | confirmSensitive | unverified |
| NATIVE-ACTION-da96a677126e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java:205 | cancelConfirmation | unverified |
| NATIVE-ACTION-31b1e646c78d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:445 | forwardRequestBody | unverified |
| NATIVE-ACTION-e1f1e5cd9be0 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:451 | forwardSingleHttpResponse | unverified |
| NATIVE-ACTION-626f5ac04ca3 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:496 | copyExactly | unverified |
| NATIVE-ACTION-4ace1e297b38 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:507 | copyChunked | unverified |
| NATIVE-ACTION-d67ab158cafb | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:592 | copy | unverified |
| NATIVE-ACTION-b4b49c6d05d5 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java:620 | sendUnavailable | unverified |
| NATIVE-ACTION-e2d37d88d7c7 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:178 | onAvailable | unverified |
| NATIVE-ACTION-9c1a0ea8385e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:179 | onCapabilitiesChanged | unverified |
| NATIVE-ACTION-cc100abc4256 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:180 | onLost | unverified |
| NATIVE-ACTION-7d26d6b4e6fb | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:248 | requestSystemCamera | unverified |
| NATIVE-ACTION-31f591110f75 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:316 | completeSpeechRecognition | unverified |
| NATIVE-ACTION-dba6ea8819d8 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:353 | onCreate | unverified |
| NATIVE-ACTION-733db42cf34d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:387 | onStart | unverified |
| NATIVE-ACTION-5616b63519cc | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:398 | onStop | unverified |
| NATIVE-ACTION-10f65379b89d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:417 | onResume | unverified |
| NATIVE-ACTION-9325a44bc858 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:449 | downloadMobileAppUpdate | unverified |
| NATIVE-ACTION-1cba24d0fda2 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:543 | configureWebView | unverified |
| NATIVE-ACTION-1570f411f8dc | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:573 | onProgressChanged | unverified |
| UI-CONTROL-ec571bbac09a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:577 | input:/file input 的系统选择器桥： | unverified |
| NATIVE-ACTION-8e9c610e96ad | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:644 | onPageStarted | unverified |
| NATIVE-ACTION-f587bfd3c757 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:655 | onPageCommitVisible | unverified |
| NATIVE-ACTION-009afe3a073a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:660 | onPageFinished | unverified |
| NATIVE-ACTION-074efead22e6 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:686 | onReceivedError | unverified |
| NATIVE-ACTION-37d386a9b1a6 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:706 | onReceivedHttpError | unverified |
| NATIVE-ACTION-e872668001a9 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:737 | onReceivedSslError | unverified |
| NATIVE-ACTION-bd77be859c54 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:757 | configureActions | unverified |
| NATIVE-ACTION-de8a5fc98b5a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:764 | startScanner | unverified |
| NATIVE-ACTION-b904c35a2d9a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:774 | onScanResult | unverified |
| NATIVE-ACTION-06b278ada7ac | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:778 | connect | unverified |
| NATIVE-ACTION-54b68426ffff | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:801 | showPairingError | unverified |
| NATIVE-ACTION-6bab383eeaa6 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:815 | onNewIntent | unverified |
| NATIVE-ACTION-7dbd51753a29 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:841 | requestOfflineSync | unverified |
| NATIVE-ACTION-1197e8accb5f | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:937 | clearRevokedPairing | unverified |
| NATIVE-ACTION-e6ff4fdc196d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:971 | openWorkbench | unverified |
| NATIVE-ACTION-5e193eec1883 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1038 | registerNetworkMonitoring | unverified |
| NATIVE-ACTION-56c208cb9573 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1062 | scheduleNetworkChangedReconnect | unverified |
| NATIVE-ACTION-63490a9e58de | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1067 | reconnectAfterNetworkChange | unverified |
| NATIVE-ACTION-728ef7f7f983 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1118 | restartRemoteTransportsAfterNetworkSwitch | unverified |
| NATIVE-ACTION-0c4c4c15bff6 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1144 | unregisterNetworkMonitoring | unverified |
| NATIVE-ACTION-6c6dc135f38a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1156 | showPairing | unverified |
| NATIVE-ACTION-31b54d1b3452 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1170 | confirmDisconnect | unverified |
| NATIVE-ACTION-328eaee0721a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1186 | confirmForget | unverified |
| NATIVE-ACTION-961689a2bd19 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1195 | disconnect | unverified |
| NATIVE-ACTION-68057c72fefe | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1310 | openPendingWorkbenchOrRetry | unverified |
| NATIVE-ACTION-0d2f13f35a17 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1321 | startNativeP2p | unverified |
| NATIVE-ACTION-581018b41861 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1326 | onRelayReady | unverified |
| NATIVE-ACTION-620d2e3d60d1 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1338 | onDirectReady | unverified |
| NATIVE-ACTION-6de8d77d0419 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1354 | onDirectFailure | unverified |
| NATIVE-ACTION-d0d574cd3a2b | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1368 | onFailure | unverified |
| NATIVE-ACTION-9382729a1bff | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1385 | startWssRelay | unverified |
| NATIVE-ACTION-259aba3d15ae | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1389 | onReady | unverified |
| NATIVE-ACTION-31cb1257d2ab | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1423 | startEasyTier | unverified |
| NATIVE-ACTION-fe03af140477 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1439 | onError | unverified |
| NATIVE-ACTION-ffb469fe568d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1455 | hideSoftKeyboard | unverified |
| NATIVE-ACTION-878549787683 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1486 | hideLoadingIndicator | unverified |
| NATIVE-ACTION-9fa61442d58c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1492 | showConnectionOverlay | unverified |
| NATIVE-ACTION-b8eadc949348 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1504 | showTerminalMainFrameError | unverified |
| NATIVE-ACTION-9526b14d895f | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1550 | setConnectionStatus | unverified |
| NATIVE-ACTION-63117c575311 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1728 | configureBackNavigation | unverified |
| NATIVE-ACTION-b695ed1bc7c7 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1730 | handleOnBackPressed | unverified |
| NATIVE-ACTION-c41f79369c91 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1806 | updateRegistration | unverified |
| NATIVE-ACTION-694f6a8e9e88 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1862 | openSettings | unverified |
| NATIVE-ACTION-ab9215d2e439 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1866 | inputAction | unverified |
| NATIVE-ACTION-2cc36c0e4241 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1874 | openDocument | unverified |
| NATIVE-ACTION-6716a8faa356 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1880 | rememberSession | unverified |
| NATIVE-ACTION-cd093ae54ef4 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java:1905 | onDestroy | unverified |
| NATIVE-ACTION-4439bae5ab8f | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileAppUpdateChecker.java:79 | downloadAndVerify | unverified |
| NATIVE-ACTION-c3356f393df0 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileDocumentViewer.java:39 | open | unverified |
| NATIVE-ACTION-7e2d42526f2d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileDocumentViewer.java:126 | openDownloaded | unverified |
| NATIVE-ACTION-78cc06985f09 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:60 | onRelayReady | unverified |
| NATIVE-ACTION-840f89a98a54 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:61 | onDirectReady | unverified |
| NATIVE-ACTION-65938b163dd5 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:62 | onDirectFailure | unverified |
| NATIVE-ACTION-c4d4ec6e1950 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:63 | onFailure | unverified |
| NATIVE-ACTION-3dccb3a3f6fe | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:150 | start | unverified |
| NATIVE-ACTION-cc5a4ea52706 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:175 | onOpen | unverified |
| NATIVE-ACTION-cc0704327bcf | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:189 | onMessage | unverified |
| NATIVE-ACTION-80c0478b9618 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:198 | onClosed | unverified |
| NATIVE-ACTION-627b1ce7d77c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:204 | ensurePeerConnectionFactory | unverified |
| NATIVE-ACTION-bbb552d0bebe | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:218 | handleControl | unverified |
| NATIVE-ACTION-ccf31923c20a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:249 | configureDesktopMode | unverified |
| NATIVE-ACTION-7f5ec3a39c96 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:308 | onSetSuccess | unverified |
| NATIVE-ACTION-fd51aa54e38c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:309 | onSetFailure | unverified |
| NATIVE-ACTION-1453fab2d00b | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:336 | validateIceSession | unverified |
| NATIVE-ACTION-f071acf2a221 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:359 | ensurePeerConnection | unverified |
| NATIVE-ACTION-8a1af73089d8 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:373 | onSignalingChange | unverified |
| NATIVE-ACTION-942a94f47b3a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:374 | onIceConnectionChange | unverified |
| NATIVE-ACTION-507733b7fbbf | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:380 | onIceConnectionReceivingChange | unverified |
| NATIVE-ACTION-b647cc2774d5 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:381 | onIceGatheringChange | unverified |
| NATIVE-ACTION-66808b916b42 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:384 | onIceCandidate | unverified |
| NATIVE-ACTION-2bcafb98df5a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:385 | onIceCandidatesRemoved | unverified |
| NATIVE-ACTION-e0deeb27d4ed | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:386 | onAddStream | unverified |
| NATIVE-ACTION-e3aa64f5c711 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:387 | onRemoveStream | unverified |
| NATIVE-ACTION-8e477b5bc905 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:388 | onDataChannel | unverified |
| NATIVE-ACTION-ceca35e8a6ae | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:389 | onRenegotiationNeeded | unverified |
| NATIVE-ACTION-2ca4890943d0 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:390 | onAddTrack | unverified |
| NATIVE-ACTION-50a190fa051a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:395 | createAndSendAnswer | unverified |
| NATIVE-ACTION-1df516ddd73d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:399 | onCreateSuccess | unverified |
| NATIVE-ACTION-dbb0dbfd0ca7 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:416 | onCreateFailure | unverified |
| NATIVE-ACTION-4ed1024a8622 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:420 | sendIce | unverified |
| NATIVE-ACTION-ee3a9e7c3afa | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:432 | sendEndOfCandidates | unverified |
| NATIVE-ACTION-9cd3a8e350e5 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:453 | sendSignal | unverified |
| NATIVE-ACTION-d96ac39f0f49 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:477 | onBufferedAmountChange | unverified |
| NATIVE-ACTION-8f748f5e35cb | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:478 | onStateChange | unverified |
| NATIVE-ACTION-0d6e5c8afb85 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:502 | openSocksServer | unverified |
| NATIVE-ACTION-9e67d97782c2 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:683 | sendUnboundFrame | unverified |
| NATIVE-ACTION-0c807e643e62 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:688 | sendFrame | unverified |
| NATIVE-ACTION-2c48fa0a9a52 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:701 | sendPacket | unverified |
| NATIVE-ACTION-cb81153cb57e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:732 | stop | unverified |
| NATIVE-ACTION-df77ac34d209 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java:734 | stopTransport | unverified |
| NATIVE-ACTION-87af8a4845ff | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ScreenCaptureActivity.java:32 | onCreate | unverified |
| NATIVE-ACTION-3c83105a5ad1 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ScreenCaptureActivity.java:45 | onActivityResult | unverified |
| NATIVE-ACTION-7010d26fb162 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ScreenCaptureActivity.java:74 | onStop | unverified |
| NATIVE-ACTION-1211f65f43f2 | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:35 | onReady | unverified |
| NATIVE-ACTION-24e11724931a | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:36 | onFailure | unverified |
| NATIVE-ACTION-736d8306916c | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:85 | start | unverified |
| NATIVE-ACTION-d2c1f1e990ca | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:93 | onOpen | unverified |
| NATIVE-ACTION-6a5b0fdb088b | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:100 | onMessage | unverified |
| NATIVE-ACTION-d99909a7ac2e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:111 | onClosed | unverified |
| NATIVE-ACTION-bfc4b922949e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:115 | openSocksServer | unverified |
| NATIVE-ACTION-9cc5ffb8dc5e | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:210 | send | unverified |
| NATIVE-ACTION-8d986259d44d | mobile/domain-assigned | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java:225 | stop | unverified |
| NATIVE-ACTION-494849455aa2 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:29 | galleryBatchSelectionHasABoundedNativeLimit | unverified |
| NATIVE-ACTION-8d61791c0cd0 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:33 | nativeBackUsesTheFixedRuntimeProtocolAndDeclinesOnlyExplicitFalse | unverified |
| NATIVE-ACTION-f5054e7c8d61 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:41 | android13UsesPlatformBackOnceAndLegacyDispatcherOnlyBeforeApi33 | unverified |
| NATIVE-ACTION-b11571dcfc53 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:70 | platformBackRegistrationFollowsVisibleActivityLifecycle | unverified |
| NATIVE-ACTION-a9477eb9b95c | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:73 | onStart | unverified |
| NATIVE-ACTION-c4f2bc294269 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:74 | onStop | unverified |
| NATIVE-ACTION-ebe827a45adc | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:98 | mobileUiInjectionPolicyCoalescesNavigationCallbacksAfterReady | unverified |
| NATIVE-ACTION-d02ceb78def0 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:117 | mobileUiInjectionPolicyRetriesFailuresWithinAThreeBatchBound | unverified |
| NATIVE-ACTION-5f5fbaabf59e | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:151 | repeatedObserverReceiptsPersistOnlyRealSessionTransitions | unverified |
| NATIVE-ACTION-b0aee376c1eb | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:176 | acceptsOnlyPrivateLanPairingLinks | unverified |
| NATIVE-ACTION-6a975444dc3e | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:185 | rejectedOrExpiredPairingReturnsToNativePairing | unverified |
| NATIVE-ACTION-cf26dd51e972 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:192 | acceptsTheSameSetupQrForInAppPairing | unverified |
| NATIVE-ACTION-8d2b6dbe6466 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:229 | parsesPersistsAndActivatesOnlyExplicitNativeP2pDescription | unverified |
| NATIVE-ACTION-5535ce18d355 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:259 | rejectsUnsafeNativeP2pSignallingAndIceDescriptions | unverified |
| NATIVE-ACTION-763374731efb | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:303 | nativeP2pUsesVersionedRoleSeparatedSignallingContract | unverified |
| NATIVE-ACTION-580e4fcb19e5 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:366 | opensNodeGeneratedRelayVectorAndRejectsReplay | unverified |
| NATIVE-ACTION-9411caedab67 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:377 | reconnectPolicyDebouncesAndCommitsStableLogicalGenerations | unverified |
| NATIVE-ACTION-bc0c2150f97a | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:410 | stableNetworkSwitchRebindsRemoteTransportsWithoutClearingPairing | unverified |
| NATIVE-ACTION-962863c38571 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:430 | nativeSyncWaitsForThePairCookieAndClearsOnlyExplicitRevocation | unverified |
| NATIVE-ACTION-74996583f123 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:440 | connect | unverified |
| NATIVE-ACTION-3f9985868777 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:475 | routeScoringAndConnectionStateAreExplicitAndDeterministic | unverified |
| NATIVE-ACTION-50e554b35bce | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:550 | parsesOnlyVersionedFixedControlActions | unverified |
| NATIVE-ACTION-3921ca19bd49 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:586 | sensitiveControlActionsAlwaysRequireConfirmation | unverified |
| NATIVE-ACTION-0fc6fa3abcac | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:630 | nativeP2pV2MatchesCanonicalDesktopPacketVector | unverified |
| NATIVE-ACTION-e5bae7362394 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:648 | nativeP2pV2CodecBindsDirectionPeerAndSessionAndRejectsReplay | unverified |
| NATIVE-ACTION-dca705e6d646 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:682 | nativeP2pV2CodecUsesA4096PacketReplayWindowStartingAtSequenceZero | unverified |
| NATIVE-ACTION-aa176ccc4352 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:720 | nativeP2pV2WaitsOnlyForAnExplicitDesktopCapability | unverified |
| NATIVE-ACTION-e0fec6511713 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:728 | nativeP2pMobileIceAndEndSignalsCarryBothFreshNonces | unverified |
| NATIVE-ACTION-40edcbd8205d | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:743 | nativeP2pStreamsPinTheirOpenPathAndRejectRebinding | unverified |
| NATIVE-ACTION-0185e7aef07c | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java:754 | nativeP2pAnswerDoesNotDropRelayStreamsBeforeDirectValidation | unverified |
| NATIVE-ACTION-4485f36e4df0 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAppUpdateCheckerTest.java:13 | selectsOnlyNewerAndroidApk | unverified |
| NATIVE-ACTION-e1b4d972dd9a | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAppUpdateCheckerTest.java:34 | comparesNumericVersions | unverified |
| NATIVE-ACTION-8422c374b1d7 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:41 | emptyOrIncompleteFullResponsesCannotReplaceLastCompleteSnapshot | unverified |
| NATIVE-ACTION-101508a59a93 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:56 | partialIncrementMergesMonotonicallyAndOnlyTombstoneDeletes | unverified |
| NATIVE-ACTION-bb6f98762349 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:74 | desktopManifestEnvelopeRestoresThenAppliesOnlyChanges | unverified |
| NATIVE-ACTION-3cdaa49a4a69 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:97 | pairingIdentityAndEpochAreIsolated | unverified |
| NATIVE-ACTION-cd23b40d30fe | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:109 | corruptionTtlAndClockRollbackExpireSafely | unverified |
| NATIVE-ACTION-5e4c7c95244d | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java:130 | pairingCacheIdentityIsStableAndContainsNoPairingSecret | unverified |
| NATIVE-ACTION-7a16ce74dc71 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileCacheResilienceTest.java:94 | firstLaunchAndOfflineColdStartRestoreOnlyAValidatedCompleteSnapshot | unverified |
| NATIVE-ACTION-6a98062784b3 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileCacheResilienceTest.java:122 | normalIncrementUsesExplicitTombstonesAndRejectsDuplicateOrOutOfOrderEvents | unverified |
| NATIVE-ACTION-aa06c9623b02 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileCacheResilienceTest.java:204 | pairingIsolationRevocationAndNetworkSwitchesPreserveOnlyTheIntendedIdentity | unverified |
| NATIVE-ACTION-748a2f350cc1 | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileCacheResilienceTest.java:240 | desktopSyncEnvelopeConvergesAndDuplicateReplayIsIdempotent | unverified |
| NATIVE-ACTION-c706a402191a | mobile/domain-assigned | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileQualityTest.java:22 | dnsAndTimeoutRetryOnlyWhileANetworkExists | unverified |
| NATIVE-ACTION-35f0c1acc0fe | mobile/domain-assigned | mobile/ios/HarnessMobile/App/MobileSessionViewModel.swift:80 | dismissOptionalAppUpdate | unverified |
| NATIVE-ACTION-1890680b15b2 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/MobileSessionViewModel.swift:87 | connect | unverified |
| NATIVE-ACTION-db478a592f2e | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:11 | makeUIViewController | unverified |
| NATIVE-ACTION-ffd44a17c54d | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:18 | updateUIViewController | unverified |
| NATIVE-ACTION-7f1b8dd68cc9 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:109 | requestCameraAndStart | unverified |
| NATIVE-ACTION-9ab0fee08ee4 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:129 | configure | unverified |
| NATIVE-ACTION-be902717bc44 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:152 | showIssue | unverified |
| NATIVE-ACTION-76c4b13521b8 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:229 | openSettings | unverified |
| NATIVE-ACTION-e11e4374eb91 | mobile/domain-assigned | mobile/ios/HarnessMobile/App/QRScannerView.swift:249 | preferredFont | unverified |
| NATIVE-ACTION-251edd07633a | mobile/domain-assigned | mobile/ios/HarnessMobile/App/WorkbenchView.swift:284 | topViewController | unverified |
| NATIVE-ACTION-1ce2deba4454 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:7 | send | unverified |
| NATIVE-ACTION-e851b08c6f29 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:19 | start | unverified |
| NATIVE-ACTION-64d8f46b1447 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:83 | connect | unverified |
| NATIVE-ACTION-9044225dc63e | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:97 | connectLAN | unverified |
| MENU-LABEL-2a00967b2ef1 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:101 | io.harnessdesktop.mobile.lan-connect | unverified |
| MENU-LABEL-99d2aacdc3f4 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:128 | io.harnessdesktop.mobile.loopback-proxy | unverified |
| NATIVE-ACTION-9afdcc9c244a | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift:167 | stop | unverified |
| NATIVE-ACTION-cc3460217d86 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/MobileAppUpdateChecker.swift:62 | isNumericVersion | unverified |
| MENU-LABEL-e4d80665d788 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/NetworkMonitor.swift:11 | io.harnessdesktop.mobile.network-monitor | unverified |
| NATIVE-ACTION-1f789477a700 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/PairingProfile.swift:26 | stablePairURL | unverified |
| NATIVE-ACTION-f1326f869255 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift:23 | connect | unverified |
| NATIVE-ACTION-2e30f895d840 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift:43 | openStream | unverified |
| NATIVE-ACTION-a14c3d244099 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift:53 | send | unverified |
| NATIVE-ACTION-f4ee5f229887 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift:71 | disconnect | unverified |
| NATIVE-ACTION-57e3e3a24a65 | mobile/domain-assigned | mobile/ios/HarnessMobile/Core/RelayTunnelCodec.swift:38 | open | unverified |
| MENU-LABEL-3cfa14586234 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:637 | 对话 | unverified |
| MENU-LABEL-e5fb66b610fd | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:638 | 代理团队 | unverified |
| MENU-LABEL-c7879771a20d | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:639 | 定时任务 | unverified |
| MENU-LABEL-24cac960e871 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:640 | 我的 | unverified |
| MENU-LABEL-78c00e768776 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1031 | 当前工作台未提供此入口 | unverified |
| UI-CONTROL-0e0d963f1a33 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1264 | button:anonymous@1264 | unverified |
| UI-CONTROL-0daf3e56ae8f | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:搜索项目和对话 搜索项目和对话 | unverified |
| UI-CONTROL-12550223f02a | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:项目详情 | unverified |
| UI-CONTROL-27aefa0ca3db | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:首页 首页 | unverified |
| UI-CONTROL-3d14110bd0ae | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:anonymous@1265 | unverified |
| UI-CONTROL-5b93a87c3679 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:新建会话 新建会话 | unverified |
| UI-CONTROL-70a2e88e259b | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:清除搜索 清除搜索 | unverified |
| UI-CONTROL-76a8dc63de77 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | input:搜索项目和对话 搜索项目和对话 | unverified |
| UI-CONTROL-a13cccad3490 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:1265 | button:关闭会话历史 关闭会话历史 | unverified |
| UI-CONTROL-bb360c98a097 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2074 | button:返回设置分类 返回设置分类 | unverified |
| UI-CONTROL-d0bb954432ee | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2074 | button:关闭设置 关闭设置 | unverified |
| UI-CONTROL-29986e6a2be7 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2558 | button:harness-mobile-model-tab-effort | unverified |
| UI-CONTROL-50ea381928b0 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2558 | button:关闭模型选择 关闭模型选择 | unverified |
| UI-CONTROL-53b897b26433 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2558 | button:关闭 关闭 | unverified |
| UI-CONTROL-8686833cf7a3 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:2558 | button:harness-mobile-model-tab-model | unverified |
| UI-CONTROL-5f5ecb15ea16 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:3896 | button:选择其他项目或会话 | unverified |
| UI-CONTROL-df20d69c83e9 | mobile/domain-assigned | mobile/ios/HarnessMobile/Resources/mobile-runtime.js:3992 | button:管理 | unverified |
| NATIVE-ACTION-402c1b57552c | mobile/domain-assigned | mobile/ios/HarnessMobileCoreTests/MobileAppUpdateCheckerTests.swift:5 | testSelectsOnlyNewerAppStoreUpdate | unverified |
| NATIVE-ACTION-5ddd6d738ae4 | mobile/domain-assigned | mobile/ios/HarnessMobileCoreTests/MobileAppUpdateCheckerTests.swift:15 | testRejectsDirectIPAAndNonAppleStores | unverified |
| NATIVE-ACTION-e6ed573ec4c9 | mobile/domain-assigned | mobile/ios/HarnessMobileCoreTests/MobileAppUpdateCheckerTests.swift:22 | testComparesNumericVersions | unverified |
| NATIVE-ACTION-996208345558 | mobile/domain-assigned | mobile/ios/HarnessMobileCoreTests/PairingProfileTests.swift:28 | testRejectsPublicPairingTargetsAndRelayCredentials | unverified |
| NATIVE-ACTION-168707bdcfcb | mobile/domain-assigned | mobile/ios/HarnessMobileCoreTests/RelayTunnelCodecTests.swift:5 | testOpensNodeGeneratedAESGCMVectorAndRejectsReplay | unverified |
| PLUGIN-ACTION-1e55d119be6a | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:47 | ANDROID_DEVICE_ACTIONS:assistant | unverified |
| PLUGIN-ACTION-af8821d288db | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:47 | ANDROID_DEVICE_ACTIONS:lock | unverified |
| PLUGIN-ACTION-cb51b928df87 | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:47 | ANDROID_DEVICE_ACTIONS:notifications | unverified |
| PLUGIN-ACTION-d9d260a85e4c | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:47 | ANDROID_DEVICE_ACTIONS:quick-settings | unverified |
| PLUGIN-ACTION-e58ebe5bb193 | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:47 | ANDROID_DEVICE_ACTIONS:wake | unverified |
| DISPATCH-CASE-93733fdc817e | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:327 | notifications | unverified |
| DISPATCH-CASE-4f0e043fd7eb | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:330 | quick-settings | unverified |
| DISPATCH-CASE-ef7468878d34 | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:333 | lock | unverified |
| DISPATCH-CASE-3135397e8aec | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:336 | wake | unverified |
| DISPATCH-CASE-e0dcb2eca21b | mobile/domain-assigned | plugins/dsh-android/lib/android-host.js:342 | assistant | unverified |
| MENU-KEYBOARD-dc79ad0de808 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:280 | alert | unverified |
| PLUGIN-ACTION-2d107c814a5c | mobile/domain-assigned | plugins/dsh-android/lib/client.js:712 | ANDROID_DEVICE_ACTIONS:quick-settings | unverified |
| PLUGIN-ACTION-59f505f9bfc9 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:712 | ANDROID_DEVICE_ACTIONS:lock | unverified |
| PLUGIN-ACTION-756dd56f177a | mobile/domain-assigned | plugins/dsh-android/lib/client.js:712 | ANDROID_DEVICE_ACTIONS:assistant | unverified |
| PLUGIN-ACTION-92c01949e4de | mobile/domain-assigned | plugins/dsh-android/lib/client.js:712 | ANDROID_DEVICE_ACTIONS:wake | unverified |
| PLUGIN-ACTION-9ce8e0006705 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:712 | ANDROID_DEVICE_ACTIONS:notifications | unverified |
| MENU-KEYBOARD-24f3747f8e3b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:1507 | status | unverified |
| DISPATCH-CASE-ce8311ccb605 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2292 | fit | unverified |
| DISPATCH-CASE-f42f0ae5b152 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2293 | percent | unverified |
| DISPATCH-CASE-feac7b4d0272 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2297 | preset | unverified |
| DISPATCH-CASE-10b38b9c4146 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2325 | percent-100 | unverified |
| DISPATCH-CASE-1f4118e60a3c | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2329 | preset-S | unverified |
| DISPATCH-CASE-ccaba765c63e | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2333 | preset-M | unverified |
| UI-CONTROL-757daf29d94e | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2581 | select:`s (whose popup ignores the app theme). Modeled on dsh-crew's | unverified |
| MENU-KEYBOARD-ef55e4980b28 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2734 | listbox | unverified |
| MENU-KEYBOARD-59f08c279432 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2741 | group | unverified |
| MENU-KEYBOARD-1b5c7a3a23ed | mobile/domain-assigned | plugins/dsh-android/lib/client.js:2753 | option | unverified |
| DISPATCH-CASE-6787495109f2 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3207 | none | unverified |
| DISPATCH-CASE-f103697f00ad | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3208 | bezel | unverified |
| DISPATCH-CASE-27c0ecf64c40 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3209 | device | unverified |
| DISPATCH-CASE-e938c58d3d13 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3641 | notifications | unverified |
| DISPATCH-CASE-9fb0fb02e1af | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3642 | quick-settings | unverified |
| DISPATCH-CASE-b497e933744b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3643 | lock | unverified |
| DISPATCH-CASE-2d7361559ffd | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3644 | wake | unverified |
| DISPATCH-CASE-51b773f72011 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3645 | assistant | unverified |
| MENU-KEYBOARD-49ebbefd0ea1 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3764 | menu | unverified |
| MENU-KEYBOARD-79b93d2f0871 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3780 | menuitem | unverified |
| PLUGIN-ACTION-59aaa7f26ecc | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3855 | ANDROID_TOOLBAR_NAV_ACTIONS:home | unverified |
| PLUGIN-ACTION-5c6324ee66c4 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3855 | ANDROID_TOOLBAR_NAV_ACTIONS:back | unverified |
| PLUGIN-ACTION-84ac4b9b9f12 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3855 | ANDROID_TOOLBAR_NAV_ACTIONS:recents | unverified |
| DISPATCH-CASE-61bc7ca30afd | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3863 | back | unverified |
| DISPATCH-CASE-929cc93adbad | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3864 | home | unverified |
| DISPATCH-CASE-31c4e8c6047a | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3865 | recents | unverified |
| DISPATCH-CASE-eb6d3518831b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3866 | screenshot | unverified |
| DISPATCH-CASE-7e52ad5111dd | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3867 | rotate | unverified |
| DISPATCH-CASE-7d790697ace6 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:3868 | refresh | unverified |
| MENU-KEYBOARD-ea43298abc3f | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4015 | tooltip | unverified |
| MENU-KEYBOARD-929aa75a2659 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4407 | complementary | unverified |
| MENU-KEYBOARD-e42de51a8fde | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4471 | toolbar | unverified |
| DISPATCH-CASE-cb9c7777738b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4786 | result | unverified |
| DISPATCH-CASE-dcf12b06c05b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4801 | tick | unverified |
| DISPATCH-CASE-8c10922cebb4 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4805 | manual-pick | unverified |
| DISPATCH-CASE-77e86fb606db | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4812 | resume-follow | unverified |
| DISPATCH-CASE-19d6a0d3752b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4816 | switch-start | unverified |
| DISPATCH-CASE-cf04cc6b6147 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4820 | switch-settled | unverified |
| DISPATCH-CASE-77968dae89b5 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:4829 | consume | unverified |
| DISPATCH-CASE-30a1bd7f6b92 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:5451 | display | unverified |
| DISPATCH-CASE-d04a279f4a0b | mobile/domain-assigned | plugins/dsh-android/lib/client.js:5472 | manual-width | unverified |
| MENU-KEYBOARD-079950988167 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:5688 | presentation | unverified |
| MENU-KEYBOARD-9e249fa04561 | mobile/domain-assigned | plugins/dsh-android/lib/client.js:5698 | dialog | unverified |
| MENU-KEYBOARD-ff5201e75d9f | mobile/domain-assigned | plugins/dsh-android/lib/client.js:5716 | separator | unverified |
| DISPATCH-CASE-14d18219c988 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-frame-style.js:45 | none | unverified |
| DISPATCH-CASE-a67708d1d71f | mobile/domain-assigned | plugins/dsh-android/lib/client/android-frame-style.js:46 | bezel | unverified |
| DISPATCH-CASE-715c68e3c795 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-frame-style.js:47 | device | unverified |
| PLUGIN-ACTION-169c564521b4 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-meta-hydrate.js:49 | INTERACT_ACTIONS:button | unverified |
| PLUGIN-ACTION-5b816d16f38a | mobile/domain-assigned | plugins/dsh-android/lib/client/android-meta-hydrate.js:49 | INTERACT_ACTIONS:type | unverified |
| PLUGIN-ACTION-68fa6849307c | mobile/domain-assigned | plugins/dsh-android/lib/client/android-meta-hydrate.js:49 | INTERACT_ACTIONS:gesture | unverified |
| PLUGIN-ACTION-a1672940c362 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-meta-hydrate.js:49 | INTERACT_ACTIONS:tap | unverified |
| PLUGIN-ACTION-be7858c39f82 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-meta-hydrate.js:49 | INTERACT_ACTIONS:scroll | unverified |
| DISPATCH-CASE-4b26687eef30 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:107 | result | unverified |
| DISPATCH-CASE-16d9d4a3c611 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:129 | tick | unverified |
| DISPATCH-CASE-f9d8a62d782e | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:136 | manual-pick | unverified |
| DISPATCH-CASE-c0c0f1c5ae14 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:148 | resume-follow | unverified |
| DISPATCH-CASE-f94990994657 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:153 | switch-start | unverified |
| DISPATCH-CASE-f516e233a2f8 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:156 | switch-settled | unverified |
| DISPATCH-CASE-6bbe5f856784 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-follow.js:171 | consume | unverified |
| DISPATCH-CASE-5e8cff7040c0 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:124 | fit | unverified |
| DISPATCH-CASE-fe467279ee64 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:125 | percent | unverified |
| DISPATCH-CASE-cba03f08b587 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:129 | preset | unverified |
| DISPATCH-CASE-d222ae38f385 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:157 | percent-100 | unverified |
| DISPATCH-CASE-5ccd1e7321d6 | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:158 | preset-S | unverified |
| DISPATCH-CASE-733f58e9b3bd | mobile/domain-assigned | plugins/dsh-android/lib/client/android-panel-size.js:159 | preset-M | unverified |
| PLUGIN-ACTION-10f7618e869c | mobile/domain-assigned | plugins/dsh-android/lib/client/protocol.js:376 | ANDROID_DEVICE_ACTIONS:notifications | unverified |
| PLUGIN-ACTION-1343394aaf29 | mobile/domain-assigned | plugins/dsh-android/lib/client/protocol.js:376 | ANDROID_DEVICE_ACTIONS:quick-settings | unverified |
| PLUGIN-ACTION-4c3283fbdae6 | mobile/domain-assigned | plugins/dsh-android/lib/client/protocol.js:376 | ANDROID_DEVICE_ACTIONS:lock | unverified |
| PLUGIN-ACTION-5afef8188aa8 | mobile/domain-assigned | plugins/dsh-android/lib/client/protocol.js:376 | ANDROID_DEVICE_ACTIONS:assistant | unverified |
| PLUGIN-ACTION-7649c00e5730 | mobile/domain-assigned | plugins/dsh-android/lib/client/protocol.js:376 | ANDROID_DEVICE_ACTIONS:wake | unverified |
| DISPATCH-CASE-65e172993e1b | mobile/domain-assigned | plugins/dsh-android/lib/stream-routes.js:572 | tap | unverified |
| DISPATCH-CASE-bd2e0e77da10 | mobile/domain-assigned | plugins/dsh-android/lib/stream-routes.js:577 | drag | unverified |
| DISPATCH-CASE-1e9d3b65a3f2 | mobile/domain-assigned | plugins/dsh-android/lib/stream-routes.js:587 | button | unverified |
| DISPATCH-CASE-404937c79f31 | mobile/domain-assigned | plugins/dsh-android/lib/stream-routes.js:594 | type | unverified |
| DISPATCH-CASE-da35383b8f06 | mobile/domain-assigned | plugins/dsh-android/lib/stream-routes.js:601 | rotate | unverified |
| PLUGIN-TOOL-OR-CONFIG-c1a1d17a3c33 | mobile/domain-assigned | plugins/dsh-android/lib/tool-apps.js:20 | android_list_apps | unverified |
| PLUGIN-TOOL-OR-CONFIG-e39d2c651678 | mobile/domain-assigned | plugins/dsh-android/lib/tool-apps.js:102 | android_launch_app | unverified |
| PLUGIN-TOOL-OR-CONFIG-a95c708f6317 | mobile/domain-assigned | plugins/dsh-android/lib/tool-apps.js:208 | android_build_run | unverified |
| PLUGIN-TOOL-OR-CONFIG-c2fe47707d34 | mobile/domain-assigned | plugins/dsh-android/lib/tool-debug.js:111 | android_processes | unverified |
| PLUGIN-TOOL-OR-CONFIG-ab8788d6c7b8 | mobile/domain-assigned | plugins/dsh-android/lib/tool-debug.js:194 | android_backtrace | unverified |
| PLUGIN-TOOL-OR-CONFIG-32852596d6b4 | mobile/domain-assigned | plugins/dsh-android/lib/tool-debug.js:338 | android_meminfo | unverified |
| PLUGIN-TOOL-OR-CONFIG-ba6ee22458d9 | mobile/domain-assigned | plugins/dsh-android/lib/tool-debug.js:423 | android_app_info | unverified |
| PLUGIN-TOOL-OR-CONFIG-55dc1b2c2ad4 | mobile/domain-assigned | plugins/dsh-android/lib/tool-list-rows.js:122 | android_ui_rows | unverified |
| PLUGIN-TOOL-OR-CONFIG-09d4c9cb81c4 | mobile/domain-assigned | plugins/dsh-android/lib/tool-list-rows.js:193 | android_tap_row | unverified |
| PLUGIN-TOOL-OR-CONFIG-0e3331e97058 | mobile/domain-assigned | plugins/dsh-android/lib/tool-logs.js:333 | android_logs | unverified |
| PLUGIN-TOOL-OR-CONFIG-a120001ba5c4 | mobile/domain-assigned | plugins/dsh-android/lib/tool-ocr.js:126 | android_find_text | unverified |
| PLUGIN-TOOL-OR-CONFIG-c429cef41120 | mobile/domain-assigned | plugins/dsh-android/lib/tool-ocr.js:207 | android_wait_for | unverified |
| PLUGIN-TOOL-OR-CONFIG-3707ab36660f | mobile/domain-assigned | plugins/dsh-android/lib/tool-ocr.js:299 | android_tap_text | unverified |
| PLUGIN-ACTION-0b6863befac7 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:49 | INTERACT_ACTIONS:gesture | unverified |
| PLUGIN-ACTION-0da9beb37a6d | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:49 | INTERACT_ACTIONS:button | unverified |
| PLUGIN-ACTION-2e0d509aba77 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:49 | INTERACT_ACTIONS:tap | unverified |
| PLUGIN-ACTION-8876ca803f64 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:49 | INTERACT_ACTIONS:type | unverified |
| PLUGIN-ACTION-9597ec890c2e | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:49 | INTERACT_ACTIONS:scroll | unverified |
| DISPATCH-CASE-2e33d9118aad | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:443 | tap | unverified |
| DISPATCH-CASE-7bf5cb9fb464 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:455 | type | unverified |
| DISPATCH-CASE-059aa30c9fb2 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:462 | button | unverified |
| DISPATCH-CASE-0cffe0c24ef7 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:470 | gesture | unverified |
| DISPATCH-CASE-f6db95881357 | mobile/domain-assigned | plugins/dsh-android/lib/tool-support.js:474 | scroll | unverified |
| PLUGIN-TOOL-OR-CONFIG-6874f53454e0 | mobile/domain-assigned | plugins/dsh-android/lib/tool-uitree.js:375 | android_ui_tree | unverified |
| PLUGIN-TOOL-OR-CONFIG-b071009102ea | mobile/domain-assigned | plugins/dsh-android/lib/tool-uitree.js:442 | android_tap_element | unverified |
| PLUGIN-TOOL-OR-CONFIG-fadca4678bd3 | mobile/domain-assigned | plugins/dsh-android/lib/tools.js:65 | android_devices | unverified |
| PLUGIN-TOOL-OR-CONFIG-2fc7f0f012f5 | mobile/domain-assigned | plugins/dsh-android/lib/tools.js:164 | android_boot | unverified |
| PLUGIN-TOOL-OR-CONFIG-d44e08a55b45 | mobile/domain-assigned | plugins/dsh-android/lib/tools.js:236 | android_shutdown | unverified |
| PLUGIN-TOOL-OR-CONFIG-da40e91e00c4 | mobile/domain-assigned | plugins/dsh-android/lib/tools.js:292 | android_screenshot | unverified |
| PLUGIN-TOOL-OR-CONFIG-ab066d8f119f | mobile/domain-assigned | plugins/dsh-android/lib/tools.js:335 | android_interact | unverified |
| PLUGIN-TOOL-OR-CONFIG-84cefa81d38a | mobile/domain-assigned | plugins/dsh-android/lib/types/client/android-panel.d.ts:92 | back | unverified |
| UI-CONTROL-672a4c7d750a | mobile/domain-assigned | plugins/dsh-android/lib/types/client/android-select.d.ts:3 | select:`s (whose popup ignores the app theme). Modeled on dsh-crew's | unverified |
| PLUGIN-TOOL-OR-CONFIG-2927f65ccf28 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-panel-smoke.mjs:103 | sdk_gphone64_arm64 | unverified |
| PLUGIN-TOOL-OR-CONFIG-ecd7089953d5 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-panel-smoke.mjs:167 | android_boot | unverified |
| PLUGIN-TOOL-OR-CONFIG-c118a23caff2 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-panel-smoke.mjs:306 | back | unverified |
| PLUGIN-TOOL-OR-CONFIG-b936c60a3e06 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-tools-smoke.mjs:285 | back | unverified |
| PLUGIN-TOOL-OR-CONFIG-8954070085c8 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-tools-smoke.mjs:350 | demo | unverified |
| PLUGIN-TOOL-OR-CONFIG-05389cb38d17 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-tools-smoke.mjs:377 | example | unverified |
| PLUGIN-TOOL-OR-CONFIG-85b8cd467a14 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-tools-smoke.mjs:380 | zzznope | unverified |
| MENU-LABEL-811abaf4fd06 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:316 | Battery | unverified |
| MENU-LABEL-b502f054c2fd | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:318 | onnected devic | unverified |
| MENU-LABEL-4f4e884ef232 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:324 | Open profile | unverified |
| MENU-LABEL-368cb38e67de | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:330 | More options | unverified |
| MENU-LABEL-2404431750dd | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:342 | zzz-nope | unverified |
| MENU-LABEL-603cbbc970b6 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:348 | Submit | unverified |
| MENU-LABEL-042b684e730c | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:354 | Recycled | unverified |
| MENU-LABEL-bbe4ca6cdd12 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:370 | e | unverified |
| MENU-LABEL-314573ece5b8 | mobile/domain-assigned | plugins/dsh-android/scripts/dev-uitree-smoke.mjs:586 | Storage | unverified |
| PLUGIN-ACTION-47dd2179ccab | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:50 | ANDROID_DEVICE_ACTIONS:notifications | unverified |
| PLUGIN-ACTION-5e8b8caa662c | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:50 | ANDROID_DEVICE_ACTIONS:assistant | unverified |
| PLUGIN-ACTION-981b20a3d8bf | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:50 | ANDROID_DEVICE_ACTIONS:wake | unverified |
| PLUGIN-ACTION-c13449d7d53c | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:50 | ANDROID_DEVICE_ACTIONS:lock | unverified |
| PLUGIN-ACTION-d33695ea85e6 | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:50 | ANDROID_DEVICE_ACTIONS:quick-settings | unverified |
| DISPATCH-CASE-ef7017b286f1 | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:393 | notifications | unverified |
| DISPATCH-CASE-904eaa77ffeb | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:396 | quick-settings | unverified |
| DISPATCH-CASE-248304c271cd | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:399 | lock | unverified |
| DISPATCH-CASE-7238396dbd6e | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:402 | wake | unverified |
| DISPATCH-CASE-c3401f1f8f87 | mobile/domain-assigned | plugins/dsh-android/src/android-host.ts:408 | assistant | unverified |
| UI-CONTROL-96cffdc8aa26 | mobile/domain-assigned | plugins/dsh-android/src/client/android-build-run-card.tsx:111 | button:{ openFile(buildMeta.apkPath ?? '') }}> | unverified |
| DISPATCH-CASE-75ad02dd966f | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:31 | notifications | unverified |
| DISPATCH-CASE-d2440bc6e137 | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:32 | quick-settings | unverified |
| DISPATCH-CASE-e4b291650e7e | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:33 | lock | unverified |
| DISPATCH-CASE-1dc2a5dcb402 | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:34 | wake | unverified |
| DISPATCH-CASE-f320de4d518e | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:35 | assistant | unverified |
| UI-CONTROL-4a760f32ea6b | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:140 | button:anonymous@140 | unverified |
| UI-CONTROL-118b0f2a6224 | mobile/domain-assigned | plugins/dsh-android/src/client/android-device-menu.tsx:164 | button:anonymous@164 | unverified |
| DISPATCH-CASE-4233675f831b | mobile/domain-assigned | plugins/dsh-android/src/client/android-frame-style.ts:60 | none | unverified |
| DISPATCH-CASE-66969ed22551 | mobile/domain-assigned | plugins/dsh-android/src/client/android-frame-style.ts:61 | bezel | unverified |
| DISPATCH-CASE-b8406735856f | mobile/domain-assigned | plugins/dsh-android/src/client/android-frame-style.ts:62 | device | unverified |
| UI-CONTROL-4c9043aa9676 | mobile/domain-assigned | plugins/dsh-android/src/client/android-live-frame.tsx:144 | button:{copy.retry} | unverified |
| PLUGIN-ACTION-173a9bcb4d2d | mobile/domain-assigned | plugins/dsh-android/src/client/android-meta-hydrate.ts:70 | INTERACT_ACTIONS:button | unverified |
| PLUGIN-ACTION-6da657412afe | mobile/domain-assigned | plugins/dsh-android/src/client/android-meta-hydrate.ts:70 | INTERACT_ACTIONS:gesture | unverified |
| PLUGIN-ACTION-97503ba524a6 | mobile/domain-assigned | plugins/dsh-android/src/client/android-meta-hydrate.ts:70 | INTERACT_ACTIONS:type | unverified |
| PLUGIN-ACTION-a48b594c8222 | mobile/domain-assigned | plugins/dsh-android/src/client/android-meta-hydrate.ts:70 | INTERACT_ACTIONS:tap | unverified |
| PLUGIN-ACTION-dc4802bd456b | mobile/domain-assigned | plugins/dsh-android/src/client/android-meta-hydrate.ts:70 | INTERACT_ACTIONS:scroll | unverified |
| PLUGIN-TOOL-OR-CONFIG-10a0d570fed3 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-connected.tsx:392 | back | unverified |
| DISPATCH-CASE-e3a530c55127 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:182 | result | unverified |
| DISPATCH-CASE-9e4ba9c2fdab | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:202 | tick | unverified |
| DISPATCH-CASE-00068ec02303 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:207 | manual-pick | unverified |
| DISPATCH-CASE-003a18efaf5a | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:219 | resume-follow | unverified |
| DISPATCH-CASE-35568ae975f6 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:224 | switch-start | unverified |
| DISPATCH-CASE-c4bdac66b5a9 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:227 | switch-settled | unverified |
| DISPATCH-CASE-af008e0a19db | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-follow.ts:242 | consume | unverified |
| DISPATCH-CASE-de9ffbfaf1fc | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-host.tsx:314 | display | unverified |
| DISPATCH-CASE-4f1d39ab5ef9 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-host.tsx:335 | manual-width | unverified |
| DISPATCH-CASE-8b428407b915 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:177 | fit | unverified |
| DISPATCH-CASE-f07a2e2b9987 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:178 | percent | unverified |
| DISPATCH-CASE-23a0f541cf6d | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:182 | preset | unverified |
| DISPATCH-CASE-8e5fb19c399e | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:223 | percent-100 | unverified |
| DISPATCH-CASE-302b4e3a3f72 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:224 | preset-S | unverified |
| DISPATCH-CASE-c3a851d5bb1e | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel-size.ts:225 | preset-M | unverified |
| UI-CONTROL-8bfe258b142f | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:339 | button:anonymous@339 | unverified |
| DISPATCH-CASE-cfe6f99c5371 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:360 | fit | unverified |
| DISPATCH-CASE-56fcb480ff64 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:361 | percent-100 | unverified |
| DISPATCH-CASE-2c0c2dabfe1a | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:362 | preset-S | unverified |
| DISPATCH-CASE-a47a4ad22c96 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:363 | preset-M | unverified |
| PLUGIN-TOOL-OR-CONFIG-969f368b80c1 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:395 | back | unverified |
| UI-CONTROL-8e30590ff245 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:480 | button:anonymous@480 | unverified |
| UI-CONTROL-3f4622844a70 | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:499 | button:anonymous@499 | unverified |
| UI-CONTROL-0c639a413b1e | mobile/domain-assigned | plugins/dsh-android/src/client/android-panel.tsx:643 | button:{copy.retry} | unverified |
| UI-CONTROL-fc00e3a8acbc | mobile/domain-assigned | plugins/dsh-android/src/client/android-screenshot-card.tsx:137 | button:{ openFile(screenshotMeta.path) }}> | unverified |
| UI-CONTROL-58a3238ad8fb | mobile/domain-assigned | plugins/dsh-android/src/client/android-select.tsx:3 | select:`s (whose popup ignores the app theme). Modeled on dsh-crew's | unverified |
| UI-CONTROL-b3147d36c43a | mobile/domain-assigned | plugins/dsh-android/src/client/android-select.tsx:321 | button:anonymous@321 | unverified |
| UI-CONTROL-14352d2ff1d4 | mobile/domain-assigned | plugins/dsh-android/src/client/android-status-capsule.tsx:260 | button:anonymous@260 | unverified |
| DISPATCH-CASE-b5c3585c83d8 | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:63 | back | unverified |
| DISPATCH-CASE-3ce2453191b9 | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:64 | home | unverified |
| DISPATCH-CASE-60ee8654f0de | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:65 | recents | unverified |
| DISPATCH-CASE-9788635cdf50 | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:66 | screenshot | unverified |
| DISPATCH-CASE-fd1a55e6ab6d | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:67 | rotate | unverified |
| DISPATCH-CASE-55ee7226a4ef | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:68 | refresh | unverified |
| UI-CONTROL-8bbfe30d957f | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:295 | button:anonymous@295 | unverified |
| UI-CONTROL-d86218593fbd | mobile/domain-assigned | plugins/dsh-android/src/client/android-toolbar.tsx:345 | button:anonymous@345 | unverified |
| PLUGIN-ACTION-0895a0309931 | mobile/domain-assigned | plugins/dsh-android/src/client/protocol.ts:559 | ANDROID_DEVICE_ACTIONS:lock | unverified |
| PLUGIN-ACTION-550eee68636a | mobile/domain-assigned | plugins/dsh-android/src/client/protocol.ts:559 | ANDROID_DEVICE_ACTIONS:quick-settings | unverified |
| PLUGIN-ACTION-a92ce5f764d4 | mobile/domain-assigned | plugins/dsh-android/src/client/protocol.ts:559 | ANDROID_DEVICE_ACTIONS:notifications | unverified |
| PLUGIN-ACTION-aac2dbc30ac9 | mobile/domain-assigned | plugins/dsh-android/src/client/protocol.ts:559 | ANDROID_DEVICE_ACTIONS:assistant | unverified |
| PLUGIN-ACTION-df10156c5aa6 | mobile/domain-assigned | plugins/dsh-android/src/client/protocol.ts:559 | ANDROID_DEVICE_ACTIONS:wake | unverified |
| DISPATCH-CASE-1182741d5696 | mobile/domain-assigned | plugins/dsh-android/src/stream-routes.ts:564 | tap | unverified |
| DISPATCH-CASE-1d444b042456 | mobile/domain-assigned | plugins/dsh-android/src/stream-routes.ts:569 | drag | unverified |
| DISPATCH-CASE-165d15d4e027 | mobile/domain-assigned | plugins/dsh-android/src/stream-routes.ts:579 | button | unverified |
| DISPATCH-CASE-ac8d7ee5a99a | mobile/domain-assigned | plugins/dsh-android/src/stream-routes.ts:586 | type | unverified |
| DISPATCH-CASE-70c948367430 | mobile/domain-assigned | plugins/dsh-android/src/stream-routes.ts:593 | rotate | unverified |
| PLUGIN-TOOL-OR-CONFIG-fcc71239a705 | mobile/domain-assigned | plugins/dsh-android/src/tool-apps.ts:74 | android_list_apps | unverified |
| PLUGIN-TOOL-OR-CONFIG-9dad09dc8a83 | mobile/domain-assigned | plugins/dsh-android/src/tool-apps.ts:156 | android_launch_app | unverified |
| PLUGIN-TOOL-OR-CONFIG-04876a3e4ccb | mobile/domain-assigned | plugins/dsh-android/src/tool-apps.ts:262 | android_build_run | unverified |
| PLUGIN-TOOL-OR-CONFIG-76e87b055088 | mobile/domain-assigned | plugins/dsh-android/src/tool-debug.ts:240 | android_processes | unverified |
| PLUGIN-TOOL-OR-CONFIG-83e481fcb19b | mobile/domain-assigned | plugins/dsh-android/src/tool-debug.ts:322 | android_backtrace | unverified |
| PLUGIN-TOOL-OR-CONFIG-cfe6833aa295 | mobile/domain-assigned | plugins/dsh-android/src/tool-debug.ts:467 | android_meminfo | unverified |
| PLUGIN-TOOL-OR-CONFIG-f8e405d56c3b | mobile/domain-assigned | plugins/dsh-android/src/tool-debug.ts:556 | android_app_info | unverified |
| PLUGIN-TOOL-OR-CONFIG-6814b80c72af | mobile/domain-assigned | plugins/dsh-android/src/tool-list-rows.ts:218 | android_ui_rows | unverified |
| PLUGIN-TOOL-OR-CONFIG-7ddfefa6f47a | mobile/domain-assigned | plugins/dsh-android/src/tool-list-rows.ts:289 | android_tap_row | unverified |
| PLUGIN-TOOL-OR-CONFIG-e5fd275a83cb | mobile/domain-assigned | plugins/dsh-android/src/tool-logs.ts:423 | android_logs | unverified |
| PLUGIN-TOOL-OR-CONFIG-36b6c2fc0ce2 | mobile/domain-assigned | plugins/dsh-android/src/tool-ocr.ts:245 | android_find_text | unverified |
| PLUGIN-TOOL-OR-CONFIG-9712b4027689 | mobile/domain-assigned | plugins/dsh-android/src/tool-ocr.ts:327 | android_wait_for | unverified |
| PLUGIN-TOOL-OR-CONFIG-1525f673efac | mobile/domain-assigned | plugins/dsh-android/src/tool-ocr.ts:437 | android_tap_text | unverified |
| PLUGIN-ACTION-18d1635baecb | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:106 | INTERACT_ACTIONS:gesture | unverified |
| PLUGIN-ACTION-2eddb5ddcc7b | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:106 | INTERACT_ACTIONS:type | unverified |
| PLUGIN-ACTION-5058ece68f48 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:106 | INTERACT_ACTIONS:scroll | unverified |
| PLUGIN-ACTION-bf7dcbcc45f3 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:106 | INTERACT_ACTIONS:tap | unverified |
| PLUGIN-ACTION-e838e43dbf63 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:106 | INTERACT_ACTIONS:button | unverified |
| DISPATCH-CASE-13b1597def69 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:392 | tap | unverified |
| DISPATCH-CASE-4cdd592e4b4f | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:404 | type | unverified |
| DISPATCH-CASE-914ee177a820 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:411 | button | unverified |
| DISPATCH-CASE-d44e9ee68906 | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:421 | gesture | unverified |
| DISPATCH-CASE-f37a63c8157a | mobile/domain-assigned | plugins/dsh-android/src/tool-support.ts:425 | scroll | unverified |
| PLUGIN-TOOL-OR-CONFIG-69c3fd958d87 | mobile/domain-assigned | plugins/dsh-android/src/tool-uitree.ts:589 | android_ui_tree | unverified |
| PLUGIN-TOOL-OR-CONFIG-ea575e04da64 | mobile/domain-assigned | plugins/dsh-android/src/tool-uitree.ts:656 | android_tap_element | unverified |
| PLUGIN-TOOL-OR-CONFIG-d086af620f5b | mobile/domain-assigned | plugins/dsh-android/src/tools.ts:145 | android_devices | unverified |
| PLUGIN-TOOL-OR-CONFIG-eb787238ba71 | mobile/domain-assigned | plugins/dsh-android/src/tools.ts:244 | android_boot | unverified |
| PLUGIN-TOOL-OR-CONFIG-790cd003cddb | mobile/domain-assigned | plugins/dsh-android/src/tools.ts:319 | android_shutdown | unverified |
| PLUGIN-TOOL-OR-CONFIG-53f89ef8943f | mobile/domain-assigned | plugins/dsh-android/src/tools.ts:375 | android_screenshot | unverified |
| PLUGIN-TOOL-OR-CONFIG-11f9678c70a3 | mobile/domain-assigned | plugins/dsh-android/src/tools.ts:419 | android_interact | unverified |
| PLUGIN-TOOL-OR-CONFIG-f5fac61deb38 | mobile/domain-assigned | plugins/dsh-mobile-control/lib/index.js:72 | android_control | unverified |
| UI-CONTROL-7e7a01f0794d | mobile/domain-assigned | renderer/index.html:143 | button:mobileSyncToggle | unverified |
| UI-CONTROL-14a699baf016 | mobile/domain-assigned | renderer/index.html:154 | input:mobileRelayUrl 例如 relay.example.com 或 203.0.113.10 | unverified |
| UI-CONTROL-688a7d38a973 | mobile/domain-assigned | renderer/index.html:155 | button:mobileRelaySave | unverified |
| UI-CONTROL-4df56e24ec84 | mobile/domain-assigned | renderer/index.html:156 | button:mobileRelayClear | unverified |
| UI-CONTROL-768dab98faaf | mobile/domain-assigned | renderer/index.html:167 | input:mobileRemoteToggle | unverified |
| UI-CONTROL-55a9f6427bea | mobile/domain-assigned | renderer/index.html:169 | select:mobileTransportPreference | unverified |
| UI-CONTROL-225351213473 | mobile/domain-assigned | renderer/index.html:198 | input:mobileSyncUrl | unverified |
| MENU-KEYBOARD-c2ee49f17d2e | mobile/domain-assigned | renderer/native-p2p.js:263 | desktop | unverified |
| MENU-KEYBOARD-daaa594ab19e | mobile/domain-assigned | services/wss-relay/server.cjs:244 | mobile | unverified |
| MENU-LABEL-10e22bda17de | models-plugins/domain-assigned | electron/bridge/provider-meter-adapters/codex-rate-limits.cjs:203 | 查看官方 Codex | unverified |
| MENU-LABEL-c3921745c2aa | models-plugins/domain-assigned | electron/bridge/provider-meter-adapters/deepseek-balance.cjs:24 | 账户余额 | unverified |
| MENU-LABEL-c61de0e8014c | models-plugins/domain-assigned | electron/bridge/provider-meter-adapters/opencode-go-plan.cjs:9 | 查看官方用量 | unverified |
| IPC-b718a1871f44 | models-plugins/domain-assigned | electron/main.cjs:5949 | models:routing:get | unverified |
| IPC-8c1b757781f4 | models-plugins/domain-assigned | electron/main.cjs:5950 | models:routing:save | unverified |
| IPC-120460d6f834 | models-plugins/domain-assigned | electron/main.cjs:5951 | models:meters:get | unverified |
| IPC-b142d8467890 | models-plugins/domain-assigned | electron/main.cjs:5989 | memory:status | unverified |
| IPC-c6755ffd5df9 | models-plugins/domain-assigned | electron/main.cjs:5993 | memory:setEnabled | unverified |
| IPC-3c8569860471 | models-plugins/domain-assigned | electron/main.cjs:5997 | memory:setPreferences | unverified |
| IPC-0ba136b3637c | models-plugins/domain-assigned | electron/main.cjs:6001 | memory:list | unverified |
| IPC-a70287f2f05d | models-plugins/domain-assigned | electron/main.cjs:6005 | memory:search | unverified |
| IPC-998e40436b0c | models-plugins/domain-assigned | electron/main.cjs:6009 | memory:add | unverified |
| IPC-f43955539845 | models-plugins/domain-assigned | electron/main.cjs:6013 | memory:update | unverified |
| IPC-fdc5748caf60 | models-plugins/domain-assigned | electron/main.cjs:6017 | memory:delete | unverified |
| IPC-6a5d2fa89b5c | models-plugins/domain-assigned | electron/main.cjs:6021 | memory:deleteAll | unverified |
| IPC-36697367e39a | models-plugins/domain-assigned | electron/main.cjs:6029 | memory:export | unverified |
| IPC-89b4c2138ba3 | models-plugins/domain-assigned | electron/main.cjs:6052 | rightWorkspace:modelPreviewReceipt | unverified |
| IPC-e2a79ade01ec | models-plugins/domain-assigned | electron/preload.cjs:53 | models:routing:get | unverified |
| IPC-42ec50e15702 | models-plugins/domain-assigned | electron/preload.cjs:54 | models:routing:save | unverified |
| IPC-b28ede5da70e | models-plugins/domain-assigned | electron/preload.cjs:55 | models:meters:get | unverified |
| IPC-c1469357109a | models-plugins/domain-assigned | electron/preload.cjs:68 | memory:status | unverified |
| IPC-0dff56806db8 | models-plugins/domain-assigned | electron/preload.cjs:69 | memory:setEnabled | unverified |
| IPC-84ef8c699ec0 | models-plugins/domain-assigned | electron/preload.cjs:70 | memory:setPreferences | unverified |
| IPC-e70571ae204c | models-plugins/domain-assigned | electron/preload.cjs:71 | memory:list | unverified |
| IPC-795b76b1c2c9 | models-plugins/domain-assigned | electron/preload.cjs:72 | memory:search | unverified |
| IPC-c6fc88612629 | models-plugins/domain-assigned | electron/preload.cjs:73 | memory:add | unverified |
| IPC-5ce405846c2c | models-plugins/domain-assigned | electron/preload.cjs:74 | memory:update | unverified |
| IPC-4866407c3a19 | models-plugins/domain-assigned | electron/preload.cjs:75 | memory:delete | unverified |
| IPC-7b0f47d2e0a8 | models-plugins/domain-assigned | electron/preload.cjs:76 | memory:deleteAll | unverified |
| IPC-9c417b79c2f8 | models-plugins/domain-assigned | electron/preload.cjs:77 | memory:export | unverified |
| IPC-3b5cee66c90e | models-plugins/domain-assigned | electron/preload.cjs:83 | rightWorkspace:modelPreviewReceipt | unverified |
| PLUGIN-TOOL-OR-CONFIG-9c46b4dd66c8 | models-plugins/domain-assigned | plugins/dsh-codex-image-bridge/src/index.js:48 | tool:image_gen | unverified |
| PLUGIN-TOOL-OR-CONFIG-139fd9cc6979 | models-plugins/domain-assigned | plugins/dsh-codex-image-bridge/src/index.js:52 | image_gen | unverified |
| MENU-LABEL-cb46c24bdf3d | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:14 | 显示名称 | unverified |
| MENU-LABEL-6199eeeb19e0 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:27 | Display name | unverified |
| PLUGIN-TOOL-OR-CONFIG-47b48ba672d4 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:222 | mcp | unverified |
| PLUGIN-TOOL-OR-CONFIG-776f1c705649 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:225 | refresh | unverified |
| MENU-KEYBOARD-fbb33694b8ce | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:227 | note | unverified |
| PLUGIN-TOOL-OR-CONFIG-14cbea960187 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:228 | shield | unverified |
| PLUGIN-TOOL-OR-CONFIG-dfe816472416 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:234 | plus | unverified |
| MENU-KEYBOARD-74386cd0c19d | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:254 | switch | unverified |
| MENU-KEYBOARD-f3425fd23ca8 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:260 | alert | unverified |
| PLUGIN-TOOL-OR-CONFIG-f71bde11c117 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:264 | server | unverified |
| MENU-KEYBOARD-5dc38d062255 | models-plugins/domain-assigned | plugins/dsh-desktop-mcp-manager/lib/client.js:267 | status | unverified |
| PLUGIN-TOOL-OR-CONFIG-5b51fd8ac084 | models-plugins/domain-assigned | plugins/dsh-desktop-memory-tools/lib/index.js:56 | tool:desktop-local-memory | unverified |
| PLUGIN-TOOL-OR-CONFIG-8772e51c6658 | models-plugins/domain-assigned | plugins/dsh-desktop-memory-tools/lib/index.js:61 | local_memory | unverified |
| PLUGIN-TOOL-OR-CONFIG-17ee17f9d316 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:441 | calendar | unverified |
| PLUGIN-TOOL-OR-CONFIG-2f8bfa911461 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:449 | refresh | unverified |
| PLUGIN-TOOL-OR-CONFIG-3a52f350eac6 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:450 | plus | unverified |
| PLUGIN-TOOL-OR-CONFIG-578a6ef41035 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:461 | notice | unverified |
| PLUGIN-TOOL-OR-CONFIG-66c99e12b9d6 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:463 | clock | unverified |
| MENU-KEYBOARD-54131ef2a6dc | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:465 | note | unverified |
| MENU-KEYBOARD-60da7aa1189e | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:493 | status | unverified |
| MENU-KEYBOARD-2d44b63c5c07 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:495 | alert | unverified |
| PLUGIN-TOOL-OR-CONFIG-f779c4576389 | models-plugins/domain-assigned | plugins/dsh-desktop-schedules/lib/client.js:523 | trash | unverified |
| UI-CONTROL-b5295ff7f12f | models-plugins/domain-assigned | renderer/index.html:35 | button:memoryQuickButton 本地记忆 | unverified |
| UI-CONTROL-c5b96352fe3c | models-plugins/domain-assigned | renderer/index.html:254 | button:memoryEnableToggle | unverified |
| UI-CONTROL-bd50e14d8121 | models-plugins/domain-assigned | renderer/index.html:258 | select:memorySensitivity | unverified |
| UI-CONTROL-127c18433854 | models-plugins/domain-assigned | renderer/index.html:259 | input:memoryAutoRecall | unverified |
| UI-CONTROL-04fb24305ddd | models-plugins/domain-assigned | renderer/index.html:260 | input:memoryAutoCapture | unverified |
| UI-CONTROL-e6f545047d39 | models-plugins/domain-assigned | renderer/index.html:265 | input:memoryTitleInput 标题（可选） | unverified |
| UI-CONTROL-4ba42a360473 | models-plugins/domain-assigned | renderer/index.html:266 | textarea:memoryContentInput 只保存你希望以后复用的偏好或事实 | unverified |
| UI-CONTROL-58d826d17b96 | models-plugins/domain-assigned | renderer/index.html:267 | button:memoryAdd | unverified |
| UI-CONTROL-bc4e6fa38850 | models-plugins/domain-assigned | renderer/index.html:267 | input:memoryTagsInput 标签，用逗号分隔 | unverified |
| UI-CONTROL-fda1fc9a5ef5 | models-plugins/domain-assigned | renderer/index.html:273 | select:memoryStateFilter | unverified |
| UI-CONTROL-b796754a1f2e | models-plugins/domain-assigned | renderer/index.html:284 | select:memoryScopeFilter | unverified |
| UI-CONTROL-bd92d683cccb | models-plugins/domain-assigned | renderer/index.html:289 | button:memorySearch | unverified |
| UI-CONTROL-cf8688f694a0 | models-plugins/domain-assigned | renderer/index.html:289 | button:memoryRefresh | unverified |
| UI-CONTROL-db608aa15121 | models-plugins/domain-assigned | renderer/index.html:289 | input:memorySearchInput 搜索本地记忆 | unverified |
| UI-CONTROL-1f64b4ae842f | models-plugins/domain-assigned | renderer/index.html:293 | button:memoryExport | unverified |
| UI-CONTROL-446e5c384dff | models-plugins/domain-assigned | renderer/index.html:294 | input:memoryDeleteAllConfirm | unverified |
| UI-CONTROL-3a8c4f85b3e8 | models-plugins/domain-assigned | renderer/index.html:295 | input:memoryDeleteExports | unverified |
| UI-CONTROL-2be94bd96af6 | models-plugins/domain-assigned | renderer/index.html:296 | button:memoryDeleteAll | unverified |
| UI-CONTROL-ee8ae6910734 | models-plugins/domain-assigned | renderer/index.html:452 | select:modelRoutingMainProvider | unverified |
| UI-CONTROL-912e6847ffa3 | models-plugins/domain-assigned | renderer/index.html:453 | select:modelRoutingMainModel | unverified |
| UI-CONTROL-2f1af533b2f3 | models-plugins/domain-assigned | renderer/index.html:458 | button:modelRoutingSubInherit | unverified |
| UI-CONTROL-ab0eb7616d45 | models-plugins/domain-assigned | renderer/index.html:459 | button:modelRoutingSubIndependent | unverified |
| UI-CONTROL-403e26c82a08 | models-plugins/domain-assigned | renderer/index.html:463 | select:modelRoutingSubProvider | unverified |
| UI-CONTROL-8195d6d37894 | models-plugins/domain-assigned | renderer/index.html:464 | select:modelRoutingSubModel | unverified |
| UI-CONTROL-d26d5654d01d | models-plugins/domain-assigned | renderer/index.html:471 | button:modelRoutingRefreshMeters | unverified |
| UI-CONTROL-fcaa723588bb | models-plugins/domain-assigned | renderer/index.html:477 | button:modelRoutingSave | unverified |
| UI-CONTROL-9e98f2f7a59d | models-plugins/domain-assigned | renderer/model-routing-integration.js:247 | select:anonymous@247 | unverified |
| UI-CONTROL-888e57c30386 | models-plugins/domain-assigned | renderer/model-routing-integration.js:248 | select:anonymous@248 | unverified |
| UI-CONTROL-29e334bbc83a | models-plugins/domain-assigned | renderer/model-routing-integration.js:252 | button:跟随主模型 | unverified |
| UI-CONTROL-c34fcab53157 | models-plugins/domain-assigned | renderer/model-routing-integration.js:252 | button:单独指定 | unverified |
| UI-CONTROL-14ca9a00580a | models-plugins/domain-assigned | renderer/model-routing-integration.js:255 | select:anonymous@255 | unverified |
| UI-CONTROL-bbf76bf14511 | models-plugins/domain-assigned | renderer/model-routing-integration.js:256 | select:anonymous@256 | unverified |
| UI-CONTROL-518ec1420336 | models-plugins/domain-assigned | renderer/model-routing-integration.js:260 | button:保存模型路由 | unverified |
| UI-CONTROL-6684ac13ce47 | models-plugins/domain-assigned | renderer/model-routing-integration.js:263 | button:刷新额度 | unverified |
| UI-CONTROL-5671d1329312 | models-plugins/domain-assigned | renderer/model-routing-integration.js:312 | button:模型路由 | unverified |
| UI-CONTROL-710d6f9db87d | models-plugins/domain-assigned | renderer/model-routing-integration.js:312 | button:服务商与 API 密钥 | unverified |
| MENU-LABEL-8973ae946ab6 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:96 | override credential reference helper | unverified |
| MENU-LABEL-33df582263ac | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:111 | credential mode state | unverified |
| MENU-LABEL-e6b3e1959785 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:122 | effective credential reference | unverified |
| MENU-LABEL-be50a7c033ea | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:132 | credential describe gate | unverified |
| MENU-LABEL-f0660ba0f548 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:162 | override profile selection | unverified |
| MENU-LABEL-6e94c9e84a06 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:179 | credential-only reference write | unverified |
| MENU-LABEL-b52cdae8a26c | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:193 | credential mutation revision tracking | unverified |
| MENU-LABEL-2d31c545de38 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:220 | credential store plan | unverified |
| MENU-LABEL-647bcfffb601 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:255 | credential mode controls | unverified |
| MENU-LABEL-c79b28695c69 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:287 | credential placeholder | unverified |
| MENU-LABEL-fae724131d2b | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:292 | credential label and input semantics | unverified |
| MENU-LABEL-807b2f25733e | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:320 | credential input lock | unverified |
| MENU-LABEL-0472c03110d1 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:334 | credential action rendering | unverified |
| MENU-LABEL-b2ce08bf65fb | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:347 | override submit guard | unverified |
| MENU-LABEL-dedcee0f16bc | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:352 | provider deletion override cleanup | unverified |
| MENU-LABEL-975a7841c3eb | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:358 | provider delete touch target | unverified |
| MENU-LABEL-3a24ed980c44 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:368 | provider delete confirm touch target | unverified |
| MENU-LABEL-d5d874e098a8 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:378 | English credential override copy | unverified |
| MENU-LABEL-ab52b2a72be2 | models-plugins/domain-assigned | scripts/model-settings-key-override-patch.mjs:395 | Chinese credential override copy | unverified |
| DEPENDENCY-8733f24998fc | models-plugins/read-only-owner | package.json:50 | @deepseek-ai/cordis-plugin-group@1.0.1 | unverified |
| DEPENDENCY-d26e4c516a9c | runtime-storage/read-only-owner | package.json:51 | @deepseek-ai/dsh@0.1.2-alpha.5 | unverified |
| DEPENDENCY-c361104dbb58 | runtime-storage/read-only-owner | package.json:52 | @deepseek-ai/dsh-anonymous-user-id@0.1.2-alpha.5 | unverified |
| DEPENDENCY-cd7213328bcf | runtime-storage/read-only-owner | package.json:53 | @deepseek-ai/dsh-atomic-write@0.1.2-alpha.5 | unverified |
| DEPENDENCY-34f7f1ccb769 | runtime-storage/read-only-owner | package.json:54 | @deepseek-ai/dsh-bash-local@0.1.2-alpha.5 | unverified |
| DEPENDENCY-7f43c7d255ee | runtime-storage/read-only-owner | package.json:55 | @deepseek-ai/dsh-code-runtime@0.1.2-alpha.5 | unverified |
| DEPENDENCY-f5c5e6050087 | session-files/read-only-owner | package.json:56 | @deepseek-ai/dsh-compaction@0.1.2-alpha.5 | unverified |
| DEPENDENCY-354f0a1e87bf | session-files/read-only-owner | package.json:57 | @deepseek-ai/dsh-compaction-basic@0.1.2-alpha.5 | unverified |
| DEPENDENCY-78da80eb2b8a | session-files/read-only-owner | package.json:58 | @deepseek-ai/dsh-fs@0.1.2-alpha.5 | unverified |
| DEPENDENCY-c1d23efa9c90 | runtime-storage/read-only-owner | package.json:59 | @deepseek-ai/dsh-invariants@0.1.2-alpha.5 | unverified |
| DEPENDENCY-b4ce7ef15894 | session-files/read-only-owner | package.json:60 | @deepseek-ai/dsh-output-retention@0.1.2-alpha.5 | unverified |
| DEPENDENCY-d78cc276979c | runtime-storage/read-only-owner | package.json:61 | @deepseek-ai/dsh-sandbox@0.1.2-alpha.5 | unverified |
| DEPENDENCY-db4b96ea757a | session-files/read-only-owner | package.json:62 | @deepseek-ai/dsh-scope@0.1.2-alpha.5 | unverified |
| DEPENDENCY-6a5786ef2f05 | session-files/read-only-owner | package.json:63 | @deepseek-ai/dsh-session-telemetry@0.1.2-alpha.5 | unverified |
| DEPENDENCY-95b36b7cb0af | session-files/read-only-owner | package.json:64 | @deepseek-ai/dsh-session-title-llm@0.1.2-alpha.5 | unverified |
| DEPENDENCY-78e440ec1d85 | runtime-storage/read-only-owner | package.json:65 | @deepseek-ai/dsh-shell@0.1.2-alpha.5 | unverified |
| DEPENDENCY-0889f8a7d728 | session-files/read-only-owner | package.json:66 | @deepseek-ai/dsh-spill@0.1.2-alpha.5 | unverified |
| DEPENDENCY-48f6241f3fcf | teams-legacy/read-only-owner | package.json:67 | @deepseek-ai/dsh-subagent-in-process-driver@0.1.2-alpha.5 | unverified |
| DEPENDENCY-5cdb162685f6 | runtime-storage/read-only-owner | package.json:68 | @deepseek-ai/dsh-subprocess@0.1.2-alpha.5 | unverified |
| DEPENDENCY-86a059e0648d | runtime-storage/read-only-owner | package.json:69 | @deepseek-ai/dsh-timeout@0.1.2-alpha.5 | unverified |
| DEPENDENCY-b940f410a9ee | teams-legacy/read-only-owner | package.json:70 | @deepseek-ai/dsh-workflow@0.1.2-alpha.5 | unverified |
| DEPENDENCY-989571ece298 | session-files/read-only-owner | package.json:259 | @deepseek-ai/dsh-attachment@0.1.2-alpha.5 | unverified |
| DEPENDENCY-39848ecf025c | runtime-storage/read-only-owner | package.json:260 | @deepseek-ai/dsh-jobs@0.1.2-alpha.5 | unverified |
| DEPENDENCY-915ff7ced03b | session-files/read-only-owner | package.json:261 | @deepseek-ai/dsh-session-persistence@0.1.2-alpha.5 | unverified |
| DEPENDENCY-20c8f802f878 | session-files/read-only-owner | package.json:262 | @deepseek-ai/dsh-session-query@0.1.2-alpha.5 | unverified |
| DEPENDENCY-9cb8f9ac27b7 | models-plugins/read-only-owner | package.json:263 | @deepseek-ai/dsh-settings@0.1.2-alpha.5 | unverified |
| DEPENDENCY-ecba0e8e44b6 | runtime-storage/read-only-owner | package.json:264 | @deepseek-ai/dsh-util-time@0.1.2-alpha.5 | unverified |
| NPM-COMMAND-546bdc7d8c6d | runtime-storage/read-only-owner | package.json:14 | dev → electron . | unverified |
| NPM-COMMAND-bb5205985f63 | runtime-storage/read-only-owner | package.json:15 | start → electron . | unverified |
| NPM-COMMAND-f577561be286 | runtime-storage/read-only-owner | package.json:16 | upstream:status → node scripts/upstream-status.mjs | unverified |
| NPM-COMMAND-f2b6e9a966f9 | runtime-storage/read-only-owner | package.json:17 | pack → node scripts/prepare-bundled-git.mjs && electron-builder --dir | blocked |
| NPM-COMMAND-da61693ec38d | runtime-storage/read-only-owner | package.json:18 | dist → node scripts/build-release.mjs | blocked |
| NPM-COMMAND-6a36b7c4aa81 | runtime-storage/read-only-owner | package.json:19 | dist:mac → node scripts/build-release.mjs | blocked |
| NPM-COMMAND-029a1d37a842 | runtime-storage/read-only-owner | package.json:20 | verify → node scripts/verify-static.mjs && npm run test:smoke | unverified |
| NPM-COMMAND-b462f3c502e3 | runtime-storage/read-only-owner | package.json:21 | test:smoke → node scripts/run-smoke-tests.mjs | unverified |
| NPM-COMMAND-00a23943264b | runtime-storage/read-only-owner | package.json:22 | test:performance → npm run test:performance:synthetic && npm run test:performance:product | unverified |
| NPM-COMMAND-9ed05ce053bb | runtime-storage/read-only-owner | package.json:23 | test:performance:synthetic → node --test tests/session-switch-performance-budget.test.cjs | unverified |
| NPM-COMMAND-ed2b223a87ae | runtime-storage/read-only-owner | package.json:24 | test:performance:product → node --test tests/session-list-metadata-performance.test.cjs tests/session-persistence-performance.test.cjs tests/conversation-work-tree.test.cjs tests/plugin-client-lifecycle-performance.test.cjs tests/renderer-observer-performance.test.cjs tests/right-workspace-ui.test.cjs | unverified |
| NPM-COMMAND-437cf2c94f9e | runtime-storage/read-only-owner | package.json:25 | benchmark:session → node scripts/session-switch-performance-benchmark.mjs | unverified |
| NPM-COMMAND-709479101dee | runtime-storage/read-only-owner | package.json:26 | benchmark:session:quick → node scripts/session-switch-performance-benchmark.mjs --quick | unverified |
| NPM-COMMAND-7015e9f73e2c | runtime-storage/read-only-owner | package.json:27 | test:browser-electron → electron tests/fixtures/browser-navigation-guard-electron.cjs | unverified |
| NPM-COMMAND-795946333cf0 | runtime-storage/read-only-owner | package.json:28 | test:runtime-auth-electron → node scripts/test-runtime-session-auth-electron.cjs | unverified |
| NPM-COMMAND-7f08e146f246 | runtime-storage/read-only-owner | package.json:29 | test:mobile-entry-electron → electron tests/fixtures/mobile-sync-entry-portal-electron.cjs | unverified |
| NPM-COMMAND-81b8cba43631 | runtime-storage/read-only-owner | package.json:30 | test:timeline-electron → node scripts/test-session-timeline-electron.cjs | unverified |
| NPM-COMMAND-5117efb62e44 | runtime-storage/read-only-owner | package.json:31 | test:right-workspace-electron → node scripts/test-right-workspace-electron.cjs | unverified |
| NPM-COMMAND-fa116e7f4622 | runtime-storage/read-only-owner | package.json:32 | postinstall → node scripts/patch-official-runtime.mjs && electron-builder install-app-deps | blocked |
| NPM-COMMAND-c6ac817de8e4 | runtime-storage/read-only-owner | package.json:33 | prepare:git → node scripts/prepare-bundled-git.mjs | unverified |
| NPM-COMMAND-623652c80995 | runtime-storage/read-only-owner | package.json:34 | verify:release → node scripts/release-audit.mjs | unverified |
| NPM-COMMAND-417b0818c8a2 | runtime-storage/read-only-owner | package.json:35 | verify:artifact → node scripts/artifact-audit.mjs dist | unverified |
| NPM-COMMAND-cdcad02b73f9 | runtime-storage/read-only-owner | package.json:36 | verify:packaged → node scripts/packaged-selftest-contract.mjs | unverified |
| NPM-COMMAND-d17459a56aa1 | runtime-storage/read-only-owner | package.json:37 | release:mirror-manifest → node scripts/build-mirror-manifest.mjs | blocked |
| NPM-COMMAND-c8a83ac347b8 | runtime-storage/read-only-owner | package.json:38 | release:components → node scripts/build-component-update.mjs | blocked |
| NPM-COMMAND-437368c2dd47 | runtime-storage/read-only-owner | package.json:39 | release:components:production → node scripts/prepare-production-components.mjs | blocked |
| NPM-COMMAND-3dc22102b76a | runtime-storage/read-only-owner | package.json:40 | release:orchestrate → node scripts/release-orchestrator.mjs | blocked |
| NPM-COMMAND-3e4bbcd156e1 | runtime-storage/read-only-owner | package.json:41 | release:publish → node scripts/release-publish.mjs | blocked |
| NPM-COMMAND-219187a5d56a | runtime-storage/read-only-owner | package.json:42 | test:component-local → node scripts/local-component-update-test.mjs | unverified |
| NPM-COMMAND-886724406d94 | runtime-storage/read-only-owner | package.json:43 | release:cnb-cloud → powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-cnb-cloud-mirror.ps1 | blocked |
| NPM-COMMAND-3400b1c733e4 | runtime-storage/read-only-owner | package.json:44 | release:cnb-mobile-cloud → powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/publish-cnb-mobile-cloud-mirror.ps1 | blocked |
| NPM-COMMAND-8d88d507febb | runtime-storage/read-only-owner | package.json:45 | store:assets → npx --yes --package @microsoft/winappcli@0.5.0 winapp manifest update-assets store/branding/harness-desktop-store.svg --manifest store/Package.appxmanifest.template | blocked |
| NPM-COMMAND-c945f587d67a | runtime-storage/read-only-owner | package.json:46 | store:check → node scripts/store-readiness.mjs | unverified |
| NPM-COMMAND-997d557433b6 | runtime-storage/read-only-owner | package.json:47 | store:msix → node scripts/build-store-msix.mjs | blocked |
| DEPENDENCY-0052041c4157 | runtime-storage/read-only-owner | package.json:71 | @earendil-works/pi-ai@0.82.1 | unverified |
| DEPENDENCY-0993cbcd0c33 | runtime-storage/read-only-owner | package.json:72 | @peculiar/x509@2.0.0 | unverified |
| DEPENDENCY-9d55b46bdd21 | runtime-storage/read-only-owner | package.json:73 | @xterm/addon-fit@0.11.0 | unverified |
| DEPENDENCY-35a64866f997 | runtime-storage/read-only-owner | package.json:74 | @xterm/xterm@6.0.0 | unverified |
| DEPENDENCY-d34ddb77d8c9 | runtime-storage/read-only-owner | package.json:75 | adm-zip@^0.6.0 | unverified |
| DEPENDENCY-ad77a948e94e | runtime-storage/read-only-owner | package.json:76 | cross-spawn@7.0.6 | unverified |
| DEPENDENCY-c74c1e37e25f | runtime-storage/read-only-owner | package.json:77 | dsh-plugin-marketplace@https://codeload.github.com/bradeGithub/DSH-Plugins-Marketplace/tar.gz/dfe32cb8620658b55441787725f7f03e0491d15e | unverified |
| DEPENDENCY-6352448e6108 | runtime-storage/read-only-owner | package.json:78 | http-proxy@1.18.1 | unverified |
| DEPENDENCY-650e1c187922 | runtime-storage/read-only-owner | package.json:79 | qrcode@1.5.4 | unverified |
| DEPENDENCY-49a00ff931d4 | runtime-storage/read-only-owner | package.json:80 | reflect-metadata@0.2.2 | unverified |
| DEPENDENCY-cff0267457d9 | runtime-storage/read-only-owner | package.json:81 | ws@^8.21.3 | unverified |
| DEPENDENCY-ec171e6c7199 | runtime-storage/read-only-owner | package.json:82 | yaml@2.9.0 | unverified |
| DEPENDENCY-2b0173d3a2a9 | runtime-storage/read-only-owner | package.json:85 | electron@43.2.0 | unverified |
| DEPENDENCY-050672a94229 | runtime-storage/read-only-owner | package.json:86 | electron-builder@26.15.7 | unverified |
| DEPENDENCY-915bfd276aea | runtime-storage/read-only-owner | package.json:265 | node-pty@1.2.0-beta.15 | unverified |
| MENU-KEYBOARD-cb82e1510061 | runtime-storage/read-only-owner | scripts/benchmark-agent-teams.mjs:34 | root lead and coordinator | unverified |
| MENU-KEYBOARD-379e8f2ca281 | runtime-storage/read-only-owner | scripts/composer-queue-performance-patch.mjs:165 | status | unverified |
| MENU-LABEL-236eb2759cb1 | runtime-storage/read-only-owner | scripts/hermetic-tree-digest.mjs:82 | Frozen manifest path | unverified |
| DISPATCH-CASE-c91ce707e8be | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:596 | http: | unverified |
| DISPATCH-CASE-376628053bfa | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:597 | https: | unverified |
| DISPATCH-CASE-c8e1a2be8f23 | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:598 | mailto: | unverified |
| MENU-KEYBOARD-88bde5d9692c | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:1106 | tablist | unverified |
| MENU-KEYBOARD-e0e6e926856c | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:1109 | tab | unverified |
| MENU-KEYBOARD-2a830c3e2950 | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:1140 | menu | unverified |
| MENU-KEYBOARD-39b052fb04b3 | runtime-storage/read-only-owner | scripts/patch-official-runtime.mjs:1140 | menuitem | unverified |
| IPC-5cd738c315e0 | runtime-storage/read-only-owner | scripts/release-audit.mjs:92 | shell:openLocal | unverified |
| IPC-468260c8d61c | runtime-storage/read-only-owner | scripts/release-audit.mjs:95 | updates:launchReady | unverified |
| IPC-d3e62f8531df | runtime-storage/read-only-owner | scripts/release-audit.mjs:95 | updates:install | unverified |
| MENU-LABEL-6c9cfdae5997 | runtime-storage/read-only-owner | scripts/release-oneoff-v1.0.58-windows-ui-validation.cjs:223 | v1.0.58 one-off Windows installer | unverified |
| MENU-LABEL-f8ed75f8bdb5 | runtime-storage/read-only-owner | scripts/release-oneoff-v1.0.58-windows-ui-validation.cjs:391 | v1.0.58 one-off Windows uninstaller | unverified |
| DISPATCH-CASE-579d06a6730d | runtime-storage/read-only-owner | scripts/tool-recoverable-error-patch.mjs:42 | retry | unverified |
| MENU-KEYBOARD-dc41fdb6f94e | runtime-storage/read-only-owner | scripts/verify-agent-teams-installed-smoke.mjs:37 | root lead and coordinator | unverified |
| IPC-995a176f2dcb | runtime-storage/read-only-owner | scripts/verify-static.mjs:243 | window:moveDrag | unverified |
| IPC-d0f693137c5f | runtime-storage/read-only-owner | scripts/verify-static.mjs:243 | window:beginDrag | unverified |
| IPC-b9521d4c4082 | runtime-storage/read-only-owner | scripts/verify-static.mjs:246 | attachments:inspect | unverified |
| IPC-96bbed8594d1 | runtime-storage/read-only-owner | scripts/verify-static.mjs:497 | unifiedUpdates:action | unverified |
| IPC-af4b0d3ff012 | runtime-storage/read-only-owner | scripts/verify-static.mjs:497 | prPreviewUpdates:apply | unverified |
| IPC-abb0b724c358 | runtime-storage/read-only-owner | scripts/verify-static.mjs:797 | desktopAndroid:action | unverified |
| IPC-bf6ce5688979 | runtime-storage/read-only-owner | scripts/verify-static.mjs:797 | desktopDevice:action | unverified |
| IPC-7f52fc95fa62 | runtime-storage/read-only-owner | scripts/verify-static.mjs:1020 | componentUpdates:apply | unverified |
| DISPATCH-CASE-0e954467a5a3 | runtime-storage/read-only-owner | scripts/verify-static.mjs:1057 | retry | unverified |
| MENU-KEYBOARD-27e5f991c4de | runtime-storage/read-only-owner | scripts/workspace-session-menu-patch.mjs:168 | menuitem | unverified |
| MENU-KEYBOARD-310c871555f4 | runtime-storage/read-only-owner | scripts/workspace-session-menu-patch.mjs:218 | menu | unverified |
| MENU-KEYBOARD-ebecbae6f0a1 | runtime-storage/read-only-owner | scripts/workspace-session-menu-patch.mjs:226 | separator | unverified |
| MENU-KEYBOARD-f6187d639ed6 | runtime-storage/read-only-owner | scripts/workspace-session-menu-patch.mjs:261 | treeitem | unverified |
| MENU-LABEL-a5c6f4e4b0d0 | session-files/domain-assigned | electron/bridge/terminal-service.cjs:81 | PowerShell | unverified |
| MENU-LABEL-5150f574dcda | session-files/domain-assigned | electron/bridge/terminal-service.cjs:82 | Command Prompt | unverified |
| MENU-LABEL-ca2005241b4c | session-files/domain-assigned | electron/bridge/terminal-service.cjs:83 | Git Bash | unverified |
| MENU-LABEL-3816ab853fa0 | session-files/domain-assigned | electron/bridge/terminal-service.cjs:84 | WSL | unverified |
| IPC-223399c06c06 | session-files/domain-assigned | electron/guest-preload.cjs:173 | right-workspace:command | unverified |
| IPC-90f4bd584f81 | session-files/domain-assigned | electron/main.cjs:5952 | terminal:preferences | unverified |
| IPC-b7cd4ba97bf2 | session-files/domain-assigned | electron/main.cjs:5956 | terminal:setPreferences | unverified |
| IPC-e4933e0ef0b4 | session-files/domain-assigned | electron/main.cjs:5960 | terminal:start | unverified |
| IPC-870297a08f54 | session-files/domain-assigned | electron/main.cjs:5968 | terminal:write | unverified |
| IPC-1c0f712641ba | session-files/domain-assigned | electron/main.cjs:5969 | terminal:resize | unverified |
| IPC-4457828bc541 | session-files/domain-assigned | electron/main.cjs:5970 | terminal:stop | unverified |
| IPC-6a590c08aeb0 | session-files/domain-assigned | electron/main.cjs:5971 | terminal:list | unverified |
| IPC-52495486fe38 | session-files/domain-assigned | electron/main.cjs:5972 | terminal:capabilities | unverified |
| IPC-54e5d83d0917 | session-files/domain-assigned | electron/preload.cjs:56 | terminal:preferences | unverified |
| IPC-478126432661 | session-files/domain-assigned | electron/preload.cjs:57 | terminal:setPreferences | unverified |
| IPC-ca367775ab5e | session-files/domain-assigned | electron/preload.cjs:58 | terminal:start | unverified |
| IPC-eebe8a257409 | session-files/domain-assigned | electron/preload.cjs:59 | terminal:write | unverified |
| IPC-a099b0248216 | session-files/domain-assigned | electron/preload.cjs:60 | terminal:resize | unverified |
| IPC-0e063e1f7240 | session-files/domain-assigned | electron/preload.cjs:61 | terminal:stop | unverified |
| IPC-b6ebf72e599b | session-files/domain-assigned | electron/preload.cjs:62 | terminal:list | unverified |
| IPC-993e41d9f102 | session-files/domain-assigned | electron/preload.cjs:63 | terminal:capabilities | unverified |
| PLUGIN-TOOL-OR-CONFIG-b6474602df2c | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:398 | file | unverified |
| PLUGIN-TOOL-OR-CONFIG-0b0a6cbfe1ef | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:405 | refresh | unverified |
| MENU-KEYBOARD-e774139a7e5f | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:407 | note | unverified |
| PLUGIN-TOOL-OR-CONFIG-626260d1053d | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:408 | notice | unverified |
| PLUGIN-TOOL-OR-CONFIG-4cd3e96b47ad | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:414 | upload | unverified |
| MENU-KEYBOARD-ad60614b724e | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:422 | button | unverified |
| PLUGIN-TOOL-OR-CONFIG-cb2bee950f26 | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:446 | edit | unverified |
| PLUGIN-TOOL-OR-CONFIG-cfaf47a2f369 | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:455 | download | unverified |
| MENU-KEYBOARD-fcc3a087f3eb | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:460 | status | unverified |
| PLUGIN-TOOL-OR-CONFIG-0b34454a3d4d | session-files/domain-assigned | plugins/dsh-desktop-files/lib/client.js:463 | folder | unverified |
| PLUGIN-TOOL-OR-CONFIG-dfd6f84f79e2 | session-files/domain-assigned | plugins/dsh-desktop-files/lib/index.js:498 | workspace_preview | unverified |
| PLUGIN-TOOL-OR-CONFIG-a1f4c3be5826 | session-files/domain-assigned | plugins/dsh-desktop-progress/lib/index.js:7 | agent:adaptive-progress | unverified |
| PLUGIN-TOOL-OR-CONFIG-f8e10d15fdd0 | session-files/domain-assigned | plugins/dsh-session-experience/lib/client.js:815 | timeline | unverified |
| MENU-KEYBOARD-848655b91cdd | session-files/domain-assigned | plugins/dsh-session-experience/lib/client.js:1100 | status | unverified |
| MENU-KEYBOARD-d1898ab18fd5 | session-files/domain-assigned | plugins/dsh-session-experience/lib/client.js:1276 | region | unverified |
| MENU-KEYBOARD-9024bcc91cb0 | session-files/domain-assigned | plugins/dsh-session-experience/lib/client.js:1428 | presentation | unverified |
| MENU-KEYBOARD-b0bbcf6a724a | session-files/domain-assigned | plugins/dsh-session-experience/lib/client.js:1429 | alertdialog | unverified |
| UI-CONTROL-35507c0b6e0b | session-files/domain-assigned | renderer/index.html:313 | button:terminalStart 新建终端 | unverified |
| UI-CONTROL-3af30ffb2e77 | session-files/domain-assigned | renderer/index.html:314 | button:terminalInterrupt 向当前终端发送 Ctrl+C | unverified |
| UI-CONTROL-3c1029b1b841 | session-files/domain-assigned | renderer/index.html:315 | button:terminalStop 停止当前终端 | unverified |
| UI-CONTROL-abe16e0c6ef1 | session-files/domain-assigned | renderer/index.html:316 | button:terminalClear 清空显示 | unverified |
| UI-CONTROL-b00e916339e3 | session-files/domain-assigned | renderer/index.html:317 | button:terminalClose 收起集成终端 | unverified |
| MENU-LABEL-6f4171a5f501 | session-files/domain-assigned | renderer/right-workspace-integration.js:109 | 文件 | unverified |
| MENU-LABEL-ff7edbb57fc5 | session-files/domain-assigned | renderer/right-workspace-integration.js:110 | 浏览器 | unverified |
| MENU-LABEL-074e60a5f458 | session-files/domain-assigned | renderer/right-workspace-integration.js:111 | 已安排 | unverified |
| MENU-LABEL-c92aa85ddcc2 | session-files/domain-assigned | renderer/right-workspace-integration.js:112 | 设备 | unverified |
| IPC-013977c2a987 | runtime-storage/read-only-owner | scripts/release-audit.mjs:122 | terminal:start | unverified |
| IPC-06682c7df893 | runtime-storage/read-only-owner | scripts/release-audit.mjs:122 | terminal:resize | unverified |
| IPC-83e3421b3146 | runtime-storage/read-only-owner | scripts/release-audit.mjs:122 | terminal:write | unverified |
| IPC-f12e9b2b4588 | runtime-storage/read-only-owner | scripts/release-audit.mjs:122 | terminal:stop | unverified |
| MENU-KEYBOARD-e5c5b7eb3d8d | session-files/domain-assigned | services/wss-relay/server.cjs:229 | desktop | unverified |
| MENU-KEYBOARD-6b8ad41b924a | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1367 | region | unverified |
| MENU-KEYBOARD-07e1fe2eabea | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1368 | status | unverified |
| MENU-KEYBOARD-91446ec673cf | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1372 | note | unverified |
| MENU-KEYBOARD-35da4dc96e40 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1516 | alert | unverified |
| MENU-KEYBOARD-09f97c37d1ec | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1552 | switch | unverified |
| MENU-KEYBOARD-bdd2456cfa98 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:1558 | group | unverified |
| MENU-KEYBOARD-1a9bc8de7cb3 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:2395 | listitem | unverified |
| MENU-KEYBOARD-373feff3bf43 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:2395 | list | unverified |
| MENU-KEYBOARD-ba3ef7c92a39 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/client.js:3288 | alertdialog | unverified |
| MENU-LABEL-9c6b3bc48588 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:3136 | team member drain | unverified |
| MENU-KEYBOARD-cf6279cad6ff | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:7565 | root lead and coordinator | unverified |
| MENU-LABEL-53e36b8f7262 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:8781 | failed member retry | unverified |
| MENU-LABEL-bc99e7240315 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:8851 | replacement member start | unverified |
| MENU-LABEL-ad0f88f999c6 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:8912 | replacement member followup | unverified |
| MENU-LABEL-e6767dcd89b0 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10011 | graceful member retirement | unverified |
| PLUGIN-TOOL-OR-CONFIG-85c9c6aa5124 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10796 | project_workspace_open | unverified |
| PLUGIN-TOOL-OR-CONFIG-b2923f590e19 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10800 | project_workspace_close | unverified |
| PLUGIN-TOOL-OR-CONFIG-3b60e17c087c | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10804 | project_resource_claim | unverified |
| PLUGIN-TOOL-OR-CONFIG-be2996e1209a | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10808 | project_changeset_publish | unverified |
| PLUGIN-TOOL-OR-CONFIG-d2ca622e4417 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10812 | project_merge_run | unverified |
| PLUGIN-TOOL-OR-CONFIG-1f077b96762b | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10816 | project_quality_submit | unverified |
| PLUGIN-TOOL-OR-CONFIG-efd975b4788c | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:10829 | project_defect_action | unverified |
| PLUGIN-TOOL-OR-CONFIG-4cd3fa865733 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11394 | tool:project-collaboration | unverified |
| PLUGIN-TOOL-OR-CONFIG-b39588911a78 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11396 | project_collaboration | unverified |
| PLUGIN-TOOL-OR-CONFIG-b220e66fee97 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11456 | project_task | unverified |
| PLUGIN-TOOL-OR-CONFIG-0320c6b6bc94 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11540 | tool:project-session-launch | unverified |
| PLUGIN-TOOL-OR-CONFIG-724b3c31fe9a | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11549 | project_session_launch | unverified |
| PLUGIN-TOOL-OR-CONFIG-9bf6175c7d58 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11591 | tool:agent-teams | unverified |
| PLUGIN-TOOL-OR-CONFIG-d9a4e546a696 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11603 | team_route_goal | unverified |
| PLUGIN-TOOL-OR-CONFIG-69d79df854f3 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11621 | team_start | unverified |
| PLUGIN-TOOL-OR-CONFIG-4d12b62ac342 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11654 | team_plan_commit | unverified |
| PLUGIN-TOOL-OR-CONFIG-17e02e6354d6 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11675 | team_bootstrap | unverified |
| PLUGIN-TOOL-OR-CONFIG-bff460779713 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11728 | team_spawn | unverified |
| PLUGIN-TOOL-OR-CONFIG-315ccb3feb09 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11741 | team_member_recover | unverified |
| PLUGIN-TOOL-OR-CONFIG-76a1b1e76137 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11754 | team_member_reconcile | unverified |
| PLUGIN-TOOL-OR-CONFIG-43e614262aa8 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11761 | team_status | unverified |
| PLUGIN-TOOL-OR-CONFIG-3a0a9ebbbeb1 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11778 | team_message | unverified |
| PLUGIN-TOOL-OR-CONFIG-7b1a61e5062a | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11784 | team_expansion_request | unverified |
| PLUGIN-TOOL-OR-CONFIG-2cf244ea0936 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11813 | team_memory_pack | unverified |
| PLUGIN-TOOL-OR-CONFIG-ea8669161966 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11830 | team_task_create | unverified |
| PLUGIN-TOOL-OR-CONFIG-623e76d57032 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11842 | team_task_list | unverified |
| PLUGIN-TOOL-OR-CONFIG-7b5009e63ab4 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11851 | team_task_update | unverified |
| PLUGIN-TOOL-OR-CONFIG-428da3081d47 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11857 | team_task_checkpoint | unverified |
| PLUGIN-TOOL-OR-CONFIG-eadca697843e | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11863 | team_task_external_effect | unverified |
| PLUGIN-TOOL-OR-CONFIG-1e1e30b156bf | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11876 | team_recover | unverified |
| PLUGIN-TOOL-OR-CONFIG-ad21df83a2d6 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11882 | team_handoff | unverified |
| PLUGIN-TOOL-OR-CONFIG-b794815ca3a8 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11888 | team_adopt | unverified |
| PLUGIN-TOOL-OR-CONFIG-1fc12bc82e39 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11894 | team_resume | unverified |
| PLUGIN-TOOL-OR-CONFIG-55ae7f9a35dd | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11907 | collaboration_discover | unverified |
| PLUGIN-TOOL-OR-CONFIG-589f873e929b | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11922 | collaboration_intent | unverified |
| PLUGIN-TOOL-OR-CONFIG-c075cb6b8bc5 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11947 | collaboration_inbox | unverified |
| PLUGIN-TOOL-OR-CONFIG-8920747e741a | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:11965 | team_shutdown | unverified |
| DISPATCH-CASE-9c15be5ff87f | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12598 | create-project | unverified |
| DISPATCH-CASE-ef8dc5e31820 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12599 | create-invite | unverified |
| DISPATCH-CASE-5141ff9c4079 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12600 | redeem-invite | unverified |
| DISPATCH-CASE-a432182d667d | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12601 | prepare-join | unverified |
| DISPATCH-CASE-cd56f7073555 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12602 | approve-join | unverified |
| DISPATCH-CASE-c3de3ffad111 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12603 | complete-join | unverified |
| DISPATCH-CASE-c18d05a2a236 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12604 | set-relay | unverified |
| DISPATCH-CASE-40d7217eb2fa | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12605 | connect-remote | unverified |
| DISPATCH-CASE-4befd4194ae0 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12606 | disconnect-remote | unverified |
| DISPATCH-CASE-165cf6cc4dd8 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12607 | lan-status | unverified |
| DISPATCH-CASE-e97ba058cf83 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12608 | start-lan | unverified |
| DISPATCH-CASE-9fdde5cf7dd5 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12609 | connect-lan | unverified |
| DISPATCH-CASE-e97d773dbb1e | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/index.js:12610 | stop-lan | unverified |
| MENU-KEYBOARD-7d90297b7d74 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/official-core-ports.js:183 | primary | unverified |
| MENU-KEYBOARD-d01fc569a7d9 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/project-entry-service.js:427 | owner | unverified |
| PLUGIN-ACTION-568812a6e4e2 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/project-task-store.js:21 | COLLABORATION_REQUEST_ACTIONS:accept | unverified |
| PLUGIN-ACTION-bd9db9b2c6b2 | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/project-task-store.js:21 | COLLABORATION_REQUEST_ACTIONS:release | unverified |
| PLUGIN-ACTION-d3e1a13d579e | teams-legacy/domain-assigned | plugins/dsh-agent-teams/lib/project-task-store.js:21 | COLLABORATION_REQUEST_ACTIONS:reject | unverified |
| DOCUMENTED-FEATURE-b462e45b6a85 | runtime-storage/read-only-owner | README.md:56 | 官方 Harness 工作台 | unverified |
| DOCUMENTED-FEATURE-616a97661f09 | interaction/read-only-owner | README.md:57 | 女仆鲸桌宠 | unverified |
| DOCUMENTED-FEATURE-ca1490166189 | interaction/read-only-owner | README.md:58 | 外观皮肤 | unverified |
| DOCUMENTED-FEATURE-e3f2ba563050 | models-plugins/read-only-owner | README.md:59 | DSH 插件与 Skills | unverified |
| DOCUMENTED-FEATURE-9e618349c0a1 | models-plugins/read-only-owner | README.md:60 | 主模型与子代理 | unverified |
| DOCUMENTED-FEATURE-15a222ae6d48 | teams-legacy/read-only-owner | README.md:61 | 协作团队（实验） | unverified |
| DOCUMENTED-FEATURE-453b604aa7bd | browser-control/read-only-owner | README.md:62 | 内置浏览器 | unverified |
| DOCUMENTED-FEATURE-132b56392f45 | runtime-storage/read-only-owner | README.md:63 | 桌面更新 | unverified |
| DOCUMENTED-FEATURE-1618ea9357c3 | runtime-storage/read-only-owner | README.md:64 | 用户配置保护 | unverified |
| DOCUMENTED-FEATURE-9a2c8af5e140 | models-plugins/read-only-owner | README.md:65 | MCP 连接 | unverified |
| DOCUMENTED-FEATURE-084e51c7501a | models-plugins/read-only-owner | README.md:66 | 可观察定时任务 | unverified |
| DOCUMENTED-FEATURE-a249369cbfe2 | session-files/read-only-owner | README.md:67 | 文件上传、下载和编辑 | unverified |
| DOCUMENTED-FEATURE-f4ff235a6110 | session-files/read-only-owner | README.md:68 | 右侧工作区与会话附件 | unverified |
| DOCUMENTED-FEATURE-cca5f7c13337 | mobile/read-only-owner | README.md:69 | 设备工作区 | unverified |
| DOCUMENTED-FEATURE-5e0429c41a03 | session-files/read-only-owner | README.md:70 | 集成终端 | unverified |
| DOCUMENTED-FEATURE-afd7d1363ba2 | session-files/read-only-owner | README.md:71 | 自适应进度 | unverified |
| DOCUMENTED-FEATURE-464e5c30b465 | models-plugins/read-only-owner | README.md:72 | 自动本地记忆与缓存 | unverified |
| DOCUMENTED-FEATURE-cac2305e6bef | mobile/read-only-owner | README.md:73 | Android / iOS 移动工作台 | unverified |
| DOCUMENTED-FEATURE-096a219f75b8 | mobile/read-only-owner | README.md:74 | 个人 WSS 中转 | unverified |
| DOCUMENTED-FEATURE-1b46bd8d70eb | browser-control/read-only-owner | README.md:75 | Computer Use | unverified |
| DOCUMENTED-FEATURE-fb3cc9a750aa | runtime-storage/read-only-owner | README.md:76 | 签名组件增量更新 | unverified |

## 模块查漏来源

以下仅是源码模块索引，不作为用户功能分母。

| owner | 文件 |
|---|---|
| browser-control | electron/bridge/browser-action-gate.cjs |
| browser-control | electron/bridge/browser-audit.cjs |
| browser-control | electron/bridge/browser-codex-api.cjs |
| browser-control | electron/bridge/browser-control-server.cjs |
| browser-control | electron/bridge/browser-diagnostics.cjs |
| browser-control | electron/bridge/browser-history-store.cjs |
| browser-control | electron/bridge/browser-link-router.cjs |
| browser-control | electron/bridge/browser-navigation-guard.cjs |
| browser-control | electron/bridge/browser-offscreen-surface.cjs |
| browser-control | electron/bridge/browser-open-intent.cjs |
| browser-control | electron/bridge/browser-operation-coordinator.cjs |
| browser-control | electron/bridge/browser-safe-port.cjs |
| browser-control | electron/bridge/browser-security-policy.cjs |
| browser-control | electron/bridge/browser-session-policy.cjs |
| browser-control | electron/bridge/browser-site-authz.cjs |
| browser-control | electron/bridge/browser-url-policy.cjs |
| browser-control | electron/bridge/computer-use-app-policy.cjs |
| browser-control | electron/bridge/computer-use-confirmation-store.cjs |
| browser-control | electron/bridge/computer-use-coordinate-space.cjs |
| browser-control | electron/bridge/computer-use-indicator.cjs |
| browser-control | electron/bridge/computer-use-screenshot-store.cjs |
| browser-control | electron/bridge/desktop-browser-tools-plugin-service.cjs |
| browser-control | electron/bridge/desktop-computer-use-plugin-service.cjs |
| browser-control | electron/bridge/windows-computer-use.cjs |
| browser-control | electron/bridge/windows-desktop-ui.cjs |
| browser-control | electron/bridge/windows-ui-automation-source.cjs |
| browser-control | electron/browser-provenance-preload.cjs |
| browser-control | plugins/dsh-desktop-browser-tools/lib/client.js |
| browser-control | plugins/dsh-desktop-browser-tools/lib/index.js |
| browser-control | plugins/dsh-desktop-browser-tools/package.json |
| browser-control | plugins/dsh-desktop-browser-tools/skills/default-templates/templates/landing-page.html |
| browser-control | plugins/dsh-desktop-browser-tools/skills/default-templates/templates/project-kickoff.html |
| browser-control | plugins/dsh-desktop-browser-tools/skills/default-templates/templates/slide-deck.html |
| browser-control | plugins/dsh-desktop-computer-use/lib/client.js |
| browser-control | plugins/dsh-desktop-computer-use/lib/desktop-control.js |
| browser-control | plugins/dsh-desktop-computer-use/lib/index.js |
| browser-control | plugins/dsh-desktop-computer-use/package.json |
| browser-control | renderer/browser-sidebar.js |
| runtime-storage | scripts/test-browser-codex-api-electron.cjs |
| runtime-storage | scripts/verify-browser-sidebar-runtime.mjs |
| runtime-storage | scripts/verify-browser-tools-runtime.mjs |
| runtime-storage | scripts/verify-computer-use-runtime.mjs |
| interaction | electron/bridge/titlebar-appearance.cjs |
| interaction | electron/bridge/wallpaper-library.cjs |
| interaction | electron/bridge/wallpaper-service.cjs |
| interaction | electron/bridge/window-drag-service.cjs |
| interaction | electron/desktop-tray.cjs |
| interaction | electron/guest-preload.cjs |
| interaction | electron/main.cjs |
| interaction | electron/pet/pet-companion-engine.cjs |
| interaction | electron/pet/pet-domain-service.cjs |
| interaction | electron/pet/pet-event-adapter.cjs |
| interaction | electron/pet/pet-preload.cjs |
| interaction | electron/pet/pet-state-store.cjs |
| interaction | electron/pet/pet-window.cjs |
| interaction | electron/preload.cjs |
| interaction | electron/session-menu-preload.cjs |
| interaction | renderer/app.js |
| interaction | renderer/index.html |
| interaction | renderer/modal-focus.js |
| interaction | renderer/pet/index.html |
| interaction | renderer/pet/pet-behavior-engine.js |
| interaction | renderer/pet/pet-glb-rig.js |
| interaction | renderer/pet/pet-interaction-engine.js |
| interaction | renderer/pet/pet-rig-motion.js |
| interaction | renderer/pet/pet-rig.js |
| interaction | renderer/pet/pet-sprite-rig.js |
| interaction | renderer/pet/pet.css |
| interaction | renderer/pet/pet.js |
| interaction | renderer/pets/maid-whale/atlas/maid-whale.atlas.json |
| interaction | renderer/pets/maid-whale/pet.json |
| interaction | renderer/pets/maid-whale/rig/parts-manifest.json |
| interaction | renderer/styles.css |
| interaction | renderer/theme-catalog.js |
| interaction | renderer/theme-integration.js |
| runtime-storage | scripts/build-pet-frame-timelines.cjs |
| runtime-storage | scripts/build-pet-rig-assets.mjs |
| runtime-storage | scripts/extract-pet-background.mjs |
| runtime-storage | scripts/inspect-pet-cdp.cjs |
| runtime-storage | scripts/inspect-pet-sprite-cdp.cjs |
| runtime-storage | scripts/verify-pet-user-flow-cdp.cjs |
| runtime-storage | .github/workflows/android-mobile-release.yml |
| mobile | electron/bridge/desktop-android-plugin-service.cjs |
| mobile | electron/bridge/desktop-device-stream.cjs |
| mobile | electron/bridge/mobile-control-broker.cjs |
| mobile | electron/bridge/mobile-control-plugin-service.cjs |
| mobile | electron/bridge/mobile-relay-config.cjs |
| mobile | electron/bridge/mobile-sync-service.cjs |
| mobile | electron/bridge/native-p2p-host.cjs |
| mobile | electron/bridge/relay-tunnel-codec.cjs |
| mobile | electron/bridge/sync-transport-manager.cjs |
| mobile | electron/bridge/sync-transports/easytier-adapter.cjs |
| mobile | electron/bridge/sync-transports/native-p2p-adapter.cjs |
| mobile | electron/bridge/sync-transports/process-adapter.cjs |
| mobile | electron/bridge/sync-transports/tailscale-adapter.cjs |
| mobile | electron/bridge/sync-transports/wss-relay-adapter.cjs |
| mobile | electron/store/mobile-sync-store.cjs |
| mobile | mobile/android/app/build.gradle.kts |
| mobile | mobile/android/app/src/main/AndroidManifest.xml |
| mobile | mobile/android/app/src/main/assets/mobile-compat.css |
| mobile | mobile/android/app/src/main/assets/mobile-runtime.js |
| mobile | mobile/android/app/src/main/java/com/easytier/jni/EasyTierJNI.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlCommand.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlForegroundService.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlPreferences.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlResult.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ControlSettingsActivity.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/DocumentPickerActivity.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/EasyTierClient.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessCaptureActivity.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessControlAccessibilityService.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/HarnessWebProxy.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MainActivity.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileAppUpdateChecker.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileAssetCache.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileDocumentViewer.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileInputFileProvider.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/MobileUiAdapter.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NativeP2pClient.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/NetworkReconnectPolicy.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/PairingLinkValidator.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/PairingProfile.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/PairingProfileStore.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/RelayTunnelCodec.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/ScreenCaptureActivity.java |
| mobile | mobile/android/app/src/main/java/io/harnessdesktop/mobile/WssRelayClient.java |
| mobile | mobile/android/app/src/main/res/drawable/deepseek_app_icon_foreground.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_button_secondary.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_control_card.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_field_background.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_launch_screen.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_mobile_icon.xml |
| mobile | mobile/android/app/src/main/res/drawable/harness_wordmark_badge.xml |
| mobile | mobile/android/app/src/main/res/drawable/ic_refresh.xml |
| mobile | mobile/android/app/src/main/res/layout/activity_control_settings.xml |
| mobile | mobile/android/app/src/main/res/layout/activity_main.xml |
| mobile | mobile/android/app/src/main/res/layout/activity_scanner.xml |
| mobile | mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml |
| mobile | mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml |
| mobile | mobile/android/app/src/main/res/mipmap/ic_launcher_round.xml |
| mobile | mobile/android/app/src/main/res/mipmap/ic_launcher.xml |
| mobile | mobile/android/app/src/main/res/values-night/colors.xml |
| mobile | mobile/android/app/src/main/res/values-night/styles.xml |
| mobile | mobile/android/app/src/main/res/values-v31/styles.xml |
| mobile | mobile/android/app/src/main/res/values/colors.xml |
| mobile | mobile/android/app/src/main/res/values/dimens.xml |
| mobile | mobile/android/app/src/main/res/values/strings.xml |
| mobile | mobile/android/app/src/main/res/values/styles.xml |
| mobile | mobile/android/app/src/main/res/xml/harness_control_accessibility.xml |
| mobile | mobile/android/app/src/main/res/xml/mobile_file_paths.xml |
| mobile | mobile/android/app/src/main/res/xml/mobile_update_paths.xml |
| mobile | mobile/android/app/src/main/res/xml/network_security_config.xml |
| mobile | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MainActivityTest.java |
| mobile | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAppUpdateCheckerTest.java |
| mobile | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileAssetCacheTest.java |
| mobile | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileCacheResilienceTest.java |
| mobile | mobile/android/app/src/test/java/io/harnessdesktop/mobile/MobileQualityTest.java |
| mobile | mobile/android/build.gradle.kts |
| mobile | mobile/android/settings.gradle.kts |
| mobile | mobile/ios/HarnessMobile/App/ContentView.swift |
| mobile | mobile/ios/HarnessMobile/App/HarnessMobileApp.swift |
| mobile | mobile/ios/HarnessMobile/App/MobileSessionViewModel.swift |
| mobile | mobile/ios/HarnessMobile/App/PairingView.swift |
| mobile | mobile/ios/HarnessMobile/App/QRScannerView.swift |
| mobile | mobile/ios/HarnessMobile/App/StatusBannerView.swift |
| mobile | mobile/ios/HarnessMobile/App/WorkbenchView.swift |
| mobile | mobile/ios/HarnessMobile/Core/LoopbackProxy.swift |
| mobile | mobile/ios/HarnessMobile/Core/MobileAppUpdateChecker.swift |
| mobile | mobile/ios/HarnessMobile/Core/NetworkMonitor.swift |
| mobile | mobile/ios/HarnessMobile/Core/PairingProfile.swift |
| mobile | mobile/ios/HarnessMobile/Core/PairingStore.swift |
| mobile | mobile/ios/HarnessMobile/Core/RelayTunnelClient.swift |
| mobile | mobile/ios/HarnessMobile/Core/RelayTunnelCodec.swift |
| mobile | mobile/ios/HarnessMobile/Resources/mobile-compat.css |
| mobile | mobile/ios/HarnessMobile/Resources/mobile-runtime.js |
| mobile | mobile/ios/HarnessMobileCoreTests/MobileAppUpdateCheckerTests.swift |
| mobile | mobile/ios/HarnessMobileCoreTests/PairingProfileTests.swift |
| mobile | mobile/ios/HarnessMobileCoreTests/RelayTunnelCodecTests.swift |
| mobile | mobile/ios/project.yml |
| mobile | mobile/mobile-app-update.example.json |
| mobile | mobile/mobile-app-update.json |
| mobile | plugins/dsh-android/assets/ocr.swift |
| mobile | plugins/dsh-android/cordis.patch.yml |
| mobile | plugins/dsh-android/lib/adb.d.ts |
| mobile | plugins/dsh-android/lib/adb.js |
| mobile | plugins/dsh-android/lib/android-host.d.ts |
| mobile | plugins/dsh-android/lib/android-host.js |
| mobile | plugins/dsh-android/lib/app-list.d.ts |
| mobile | plugins/dsh-android/lib/app-list.js |
| mobile | plugins/dsh-android/lib/build-run.d.ts |
| mobile | plugins/dsh-android/lib/build-run.js |
| mobile | plugins/dsh-android/lib/client.js |
| mobile | plugins/dsh-android/lib/client/android-frame-style.d.ts |
| mobile | plugins/dsh-android/lib/client/android-frame-style.js |
| mobile | plugins/dsh-android/lib/client/android-meta-hydrate.d.ts |
| mobile | plugins/dsh-android/lib/client/android-meta-hydrate.js |
| mobile | plugins/dsh-android/lib/client/android-panel-auto-open.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-auto-open.js |
| mobile | plugins/dsh-android/lib/client/android-panel-capture.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-capture.js |
| mobile | plugins/dsh-android/lib/client/android-panel-dock.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-dock.js |
| mobile | plugins/dsh-android/lib/client/android-panel-follow.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-follow.js |
| mobile | plugins/dsh-android/lib/client/android-panel-size.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-size.js |
| mobile | plugins/dsh-android/lib/client/android-panel-trigger.d.ts |
| mobile | plugins/dsh-android/lib/client/android-panel-trigger.js |
| mobile | plugins/dsh-android/lib/client/android-result.d.ts |
| mobile | plugins/dsh-android/lib/client/android-result.js |
| mobile | plugins/dsh-android/lib/client/android-screenshot-session.d.ts |
| mobile | plugins/dsh-android/lib/client/android-screenshot-session.js |
| mobile | plugins/dsh-android/lib/client/android-stream-session.d.ts |
| mobile | plugins/dsh-android/lib/client/android-stream-session.js |
| mobile | plugins/dsh-android/lib/client/card-styles.d.ts |
| mobile | plugins/dsh-android/lib/client/card-styles.js |
| mobile | plugins/dsh-android/lib/client/copy.d.ts |
| mobile | plugins/dsh-android/lib/client/copy.js |
| mobile | plugins/dsh-android/lib/client/details-compat.d.ts |
| mobile | plugins/dsh-android/lib/client/details-compat.js |
| mobile | plugins/dsh-android/lib/client/protocol.d.ts |
| mobile | plugins/dsh-android/lib/client/protocol.js |
| mobile | plugins/dsh-android/lib/debug-parse.d.ts |
| mobile | plugins/dsh-android/lib/debug-parse.js |
| mobile | plugins/dsh-android/lib/frame-source.d.ts |
| mobile | plugins/dsh-android/lib/frame-source.js |
| mobile | plugins/dsh-android/lib/index.d.ts |
| mobile | plugins/dsh-android/lib/index.js |
| mobile | plugins/dsh-android/lib/list-rows.d.ts |
| mobile | plugins/dsh-android/lib/list-rows.js |
| mobile | plugins/dsh-android/lib/ocr-backend.d.ts |
| mobile | plugins/dsh-android/lib/ocr-backend.js |
| mobile | plugins/dsh-android/lib/skill.d.ts |
| mobile | plugins/dsh-android/lib/skill.js |
| mobile | plugins/dsh-android/lib/stream-access.d.ts |
| mobile | plugins/dsh-android/lib/stream-access.js |
| mobile | plugins/dsh-android/lib/stream-routes.d.ts |
| mobile | plugins/dsh-android/lib/stream-routes.js |
| mobile | plugins/dsh-android/lib/tool-apps.d.ts |
| mobile | plugins/dsh-android/lib/tool-apps.js |
| mobile | plugins/dsh-android/lib/tool-debug.d.ts |
| mobile | plugins/dsh-android/lib/tool-debug.js |
| mobile | plugins/dsh-android/lib/tool-list-rows.d.ts |
| mobile | plugins/dsh-android/lib/tool-list-rows.js |
| mobile | plugins/dsh-android/lib/tool-logs.d.ts |
| mobile | plugins/dsh-android/lib/tool-logs.js |
| mobile | plugins/dsh-android/lib/tool-ocr.d.ts |
| mobile | plugins/dsh-android/lib/tool-ocr.js |
| mobile | plugins/dsh-android/lib/tool-support.d.ts |
| mobile | plugins/dsh-android/lib/tool-support.js |
| mobile | plugins/dsh-android/lib/tool-uitree.d.ts |
| mobile | plugins/dsh-android/lib/tool-uitree.js |
| mobile | plugins/dsh-android/lib/tools.d.ts |
| mobile | plugins/dsh-android/lib/tools.js |
| mobile | plugins/dsh-android/lib/types/client/android-build-run-card.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-device-menu.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-device-picker.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-frame-style.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-live-frame.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-meta-hydrate.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-auto-open.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-capture.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-connected.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-dock.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-follow.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-frame.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-host.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-size.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel-trigger.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-panel.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-result.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-screenshot-card.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-screenshot-session.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-select.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-status-capsule.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-stream-card.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-stream-session.d.ts |
| mobile | plugins/dsh-android/lib/types/client/android-toolbar.d.ts |
| mobile | plugins/dsh-android/lib/types/client/card-boundary.d.ts |
| mobile | plugins/dsh-android/lib/types/client/card-styles.d.ts |
| mobile | plugins/dsh-android/lib/types/client/copy.d.ts |
| mobile | plugins/dsh-android/lib/types/client/details-compat.d.ts |
| mobile | plugins/dsh-android/lib/types/client/index.d.ts |
| mobile | plugins/dsh-android/lib/types/client/protocol.d.ts |
| mobile | plugins/dsh-android/lib/uitree.d.ts |
| mobile | plugins/dsh-android/lib/uitree.js |
| mobile | plugins/dsh-android/lib/vision.d.ts |
| mobile | plugins/dsh-android/lib/vision.js |
| mobile | plugins/dsh-android/package.json |
| mobile | plugins/dsh-android/scripts/_smoke-harness.mjs |
| mobile | plugins/dsh-android/scripts/build-client.mjs |
| mobile | plugins/dsh-android/scripts/dev-adb-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-emulator-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-logs-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-panel-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-routes-static-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-tools-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-uitree-smoke.mjs |
| mobile | plugins/dsh-android/scripts/dev-vision-smoke.mjs |
| mobile | plugins/dsh-android/scripts/run-tool.mjs |
| mobile | plugins/dsh-android/src/adb.ts |
| mobile | plugins/dsh-android/src/android-host.ts |
| mobile | plugins/dsh-android/src/app-list.ts |
| mobile | plugins/dsh-android/src/build-run.ts |
| mobile | plugins/dsh-android/src/client/android-build-run-card.tsx |
| mobile | plugins/dsh-android/src/client/android-device-menu.tsx |
| mobile | plugins/dsh-android/src/client/android-device-picker.tsx |
| mobile | plugins/dsh-android/src/client/android-frame-style.ts |
| mobile | plugins/dsh-android/src/client/android-live-frame.tsx |
| mobile | plugins/dsh-android/src/client/android-meta-hydrate.ts |
| mobile | plugins/dsh-android/src/client/android-panel-auto-open.ts |
| mobile | plugins/dsh-android/src/client/android-panel-capture.ts |
| mobile | plugins/dsh-android/src/client/android-panel-connected.tsx |
| mobile | plugins/dsh-android/src/client/android-panel-dock.ts |
| mobile | plugins/dsh-android/src/client/android-panel-follow.ts |
| mobile | plugins/dsh-android/src/client/android-panel-frame.tsx |
| mobile | plugins/dsh-android/src/client/android-panel-host.tsx |
| mobile | plugins/dsh-android/src/client/android-panel-size.ts |
| mobile | plugins/dsh-android/src/client/android-panel-trigger.ts |
| mobile | plugins/dsh-android/src/client/android-panel.tsx |
| mobile | plugins/dsh-android/src/client/android-result.ts |
| mobile | plugins/dsh-android/src/client/android-screenshot-card.tsx |
| mobile | plugins/dsh-android/src/client/android-screenshot-session.ts |
| mobile | plugins/dsh-android/src/client/android-select.tsx |
| mobile | plugins/dsh-android/src/client/android-status-capsule.tsx |
| mobile | plugins/dsh-android/src/client/android-stream-card.tsx |
| mobile | plugins/dsh-android/src/client/android-stream-session.ts |
| mobile | plugins/dsh-android/src/client/android-toolbar.tsx |
| mobile | plugins/dsh-android/src/client/card-boundary.tsx |
| mobile | plugins/dsh-android/src/client/card-styles.ts |
| mobile | plugins/dsh-android/src/client/copy.ts |
| mobile | plugins/dsh-android/src/client/details-compat.ts |
| mobile | plugins/dsh-android/src/client/index.tsx |
| mobile | plugins/dsh-android/src/client/protocol.ts |
| mobile | plugins/dsh-android/src/client/react-dom-compat.d.ts |
| mobile | plugins/dsh-android/src/debug-parse.ts |
| mobile | plugins/dsh-android/src/frame-source.ts |
| mobile | plugins/dsh-android/src/index.ts |
| mobile | plugins/dsh-android/src/list-rows.ts |
| mobile | plugins/dsh-android/src/ocr-backend.ts |
| mobile | plugins/dsh-android/src/skill.ts |
| mobile | plugins/dsh-android/src/stream-access.ts |
| mobile | plugins/dsh-android/src/stream-routes.ts |
| mobile | plugins/dsh-android/src/tool-apps.ts |
| mobile | plugins/dsh-android/src/tool-debug.ts |
| mobile | plugins/dsh-android/src/tool-list-rows.ts |
| mobile | plugins/dsh-android/src/tool-logs.ts |
| mobile | plugins/dsh-android/src/tool-ocr.ts |
| mobile | plugins/dsh-android/src/tool-support.ts |
| mobile | plugins/dsh-android/src/tool-uitree.ts |
| mobile | plugins/dsh-android/src/tools.ts |
| mobile | plugins/dsh-android/src/uitree.ts |
| mobile | plugins/dsh-android/src/vision.ts |
| mobile | plugins/dsh-mobile-control/lib/index.js |
| mobile | plugins/dsh-mobile-control/package.json |
| mobile | renderer/native-p2p.html |
| mobile | renderer/native-p2p.js |
| runtime-storage | scripts/create-android-release-keystore.ps1 |
| runtime-storage | scripts/mobile-release-version.cjs |
| runtime-storage | scripts/mobile-sync-e2e-host.cjs |
| runtime-storage | scripts/pair-android-remote-test.cjs |
| runtime-storage | scripts/publish-cnb-mobile-cloud-mirror.ps1 |
| runtime-storage | scripts/release-publish-android.mjs |
| runtime-storage | scripts/verify-mobile-sync-remote-cdp.cjs |
| runtime-storage | scripts/verify-mobile-sync-ui-cdp.cjs |
| models-plugins | electron/bridge/desktop-mcp-manager-plugin-service.cjs |
| models-plugins | electron/bridge/desktop-memory-tools-plugin-service.cjs |
| models-plugins | electron/bridge/desktop-schedules-plugin-service.cjs |
| models-plugins | electron/bridge/desktop-web-search-plugin-service.cjs |
| models-plugins | electron/bridge/memory-censor.cjs |
| models-plugins | electron/bridge/memory-service.cjs |
| models-plugins | electron/bridge/model-admission-plugin-service.cjs |
| models-plugins | electron/bridge/model-routing-service.cjs |
| models-plugins | electron/bridge/plugin-marketplace-service.cjs |
| models-plugins | electron/bridge/provider-meter-adapters/codex-rate-limits.cjs |
| models-plugins | electron/bridge/provider-meter-adapters/deepseek-balance.cjs |
| models-plugins | electron/bridge/provider-meter-adapters/opencode-go-plan.cjs |
| models-plugins | electron/bridge/provider-meter-service.cjs |
| models-plugins | plugins/dsh-codex-image-bridge/package.json |
| models-plugins | plugins/dsh-codex-image-bridge/src/core.js |
| models-plugins | plugins/dsh-codex-image-bridge/src/index.js |
| models-plugins | plugins/dsh-desktop-mcp-manager/lib/client.js |
| models-plugins | plugins/dsh-desktop-mcp-manager/lib/index.js |
| models-plugins | plugins/dsh-desktop-mcp-manager/package.json |
| models-plugins | plugins/dsh-desktop-memory-tools/lib/index.js |
| models-plugins | plugins/dsh-desktop-memory-tools/package.json |
| models-plugins | plugins/dsh-desktop-schedules/lib/client.js |
| models-plugins | plugins/dsh-desktop-schedules/lib/index.js |
| models-plugins | plugins/dsh-desktop-schedules/package.json |
| models-plugins | plugins/dsh-desktop-web-search/lib/index.js |
| models-plugins | plugins/dsh-desktop-web-search/package.json |
| models-plugins | plugins/dsh-model-admission/lib/index.js |
| models-plugins | plugins/dsh-model-admission/package.json |
| models-plugins | renderer/memory-manager.js |
| models-plugins | renderer/model-routing-integration.js |
| models-plugins | scripts/deepseek-model-discovery-patch.mjs |
| models-plugins | scripts/model-settings-credential-validation-patch.mjs |
| models-plugins | scripts/model-settings-key-override-patch.mjs |
| models-plugins | scripts/provider-auth-isolation-patch.mjs |
| runtime-storage | scripts/verify-memory-tools-runtime.mjs |
| runtime-storage | .github/dependabot.yml |
| runtime-storage | .github/ISSUE_TEMPLATE/ai-content-report.yml |
| runtime-storage | .github/ISSUE_TEMPLATE/bug_report.yml |
| runtime-storage | .github/ISSUE_TEMPLATE/config.yml |
| runtime-storage | .github/ISSUE_TEMPLATE/feature_request.yml |
| runtime-storage | .github/workflows/apple-virtual-tests.yml |
| runtime-storage | .github/workflows/ci.yml |
| runtime-storage | .github/workflows/diagnose-unix-smoke.yml |
| runtime-storage | .github/workflows/pr-preview-build.yml |
| runtime-storage | .github/workflows/pr-preview-promote.yml |
| runtime-storage | .github/workflows/pr-preview-sign.yml |
| runtime-storage | .github/workflows/publish-production-components.yml |
| runtime-storage | .github/workflows/recover-release-from-actions.yml |
| runtime-storage | .github/workflows/release.yml |
| runtime-storage | .github/workflows/upstream-watch.yml |
| runtime-storage | .github/workflows/verify-component-signing-secret.yml |
| runtime-storage | electron/bootstrap.cjs |
| runtime-storage | electron/bridge/agent-teams-authorization-service.cjs |
| runtime-storage | electron/bridge/agent-teams-plugin-service.cjs |
| runtime-storage | electron/bridge/agent-teams-secret-service.cjs |
| runtime-storage | electron/bridge/agent-teams-session-launch-service.cjs |
| runtime-storage | electron/bridge/capability-broker.cjs |
| runtime-storage | electron/bridge/component-runtime-resolver.cjs |
| runtime-storage | electron/bridge/component-update-archive.cjs |
| runtime-storage | electron/bridge/component-update-builder.cjs |
| runtime-storage | electron/bridge/component-update-config.cjs |
| runtime-storage | electron/bridge/component-update-contract.cjs |
| runtime-storage | electron/bridge/component-update-health.cjs |
| runtime-storage | electron/bridge/component-update-helper.cjs |
| runtime-storage | electron/bridge/component-update-launcher.cjs |
| runtime-storage | electron/bridge/component-update-service.cjs |
| runtime-storage | electron/bridge/component-update-store.cjs |
| runtime-storage | electron/bridge/desktop-release-contract.cjs |
| runtime-storage | electron/bridge/dsh-generated-profile-recovery.cjs |
| runtime-storage | electron/bridge/dsh-home.cjs |
| runtime-storage | electron/bridge/dsh-resolver.cjs |
| runtime-storage | electron/bridge/local-ipc-endpoint.cjs |
| runtime-storage | electron/bridge/local-target-service.cjs |
| runtime-storage | electron/bridge/network-component-service.cjs |
| runtime-storage | electron/bridge/pr-preview-activation-store.cjs |
| runtime-storage | electron/bridge/pr-preview-update-config.cjs |
| runtime-storage | electron/bridge/pr-preview-update-contract.cjs |
| runtime-storage | electron/bridge/pr-preview-update-service.cjs |
| runtime-storage | electron/bridge/process-spawn.cjs |
| runtime-storage | electron/bridge/process-tree.cjs |
| runtime-storage | electron/bridge/runtime-bundle-service.cjs |
| runtime-storage | electron/bridge/runtime-proxy.cjs |
| runtime-storage | electron/bridge/runtime-session-auth.cjs |
| runtime-storage | electron/bridge/runtime-web-url.cjs |
| runtime-storage | electron/bridge/self-test-service.cjs |
| runtime-storage | electron/bridge/storage-cleanup-service.cjs |
| runtime-storage | electron/bridge/storage-management-service.cjs |
| runtime-storage | electron/bridge/storage-scan-service.cjs |
| runtime-storage | electron/bridge/tcp-connect-bridge.cjs |
| runtime-storage | electron/bridge/update-download-service.cjs |
| runtime-storage | electron/bridge/update-feed-config.cjs |
| runtime-storage | electron/bridge/update-launcher.cjs |
| runtime-storage | electron/bridge/update-service.cjs |
| runtime-storage | electron/bridge/update-summary.cjs |
| runtime-storage | electron/bridge/user-data-override.cjs |
| runtime-storage | electron/bridge/workspace-preview-bridge.cjs |
| runtime-storage | electron/distribution.cjs |
| runtime-storage | electron/store/app-state-store.cjs |
| runtime-storage | scripts/afterAllArtifactBuild.cjs |
| runtime-storage | scripts/artifact-audit.mjs |
| runtime-storage | scripts/artifact-size-budget.mjs |
| runtime-storage | scripts/assistant-copy-patch.mjs |
| runtime-storage | scripts/attachment-input-patch.mjs |
| runtime-storage | scripts/benchmark-agent-teams.mjs |
| runtime-storage | scripts/bootstrap-github.ps1 |
| runtime-storage | scripts/bootstrap-github.sh |
| runtime-storage | scripts/build-component-update.mjs |
| runtime-storage | scripts/build-maid-whale-atlases.mjs |
| runtime-storage | scripts/build-mirror-manifest.mjs |
| runtime-storage | scripts/build-release.mjs |
| runtime-storage | scripts/build-store-msix.mjs |
| runtime-storage | scripts/chat-stop-follow.mjs |
| runtime-storage | scripts/codex-parity-runtime-patch.mjs |
| runtime-storage | scripts/component-update-helper.cjs |
| runtime-storage | scripts/composer-queue-performance-patch.mjs |
| runtime-storage | scripts/configure-component-signing-backup.ps1 |
| runtime-storage | scripts/conversation-work-tree-patch.mjs |
| runtime-storage | scripts/create-component-signing-key.mjs |
| runtime-storage | scripts/diagnose-text-selection-runtime.mjs |
| runtime-storage | scripts/electron-builder-traversal.cjs |
| runtime-storage | scripts/extract-release-notes.mjs |
| runtime-storage | scripts/goal-tool-recovery-patch.mjs |
| runtime-storage | scripts/hermetic-tree-digest.mjs |
| runtime-storage | scripts/http-connect-bridge-host.cjs |
| runtime-storage | scripts/image-preview-performance-patch.mjs |
| runtime-storage | scripts/local-component-update-test.mjs |
| runtime-storage | scripts/mirror-manifest-lib.mjs |
| runtime-storage | scripts/packaged-selftest-contract.mjs |
| runtime-storage | scripts/patch-official-runtime.mjs |
| runtime-storage | scripts/pr-preview-build.mjs |
| runtime-storage | scripts/pr-preview-cnb-request.mjs |
| runtime-storage | scripts/pr-preview-local-gate.mjs |
| runtime-storage | scripts/pr-preview-promote-verify.mjs |
| runtime-storage | scripts/pr-preview-sign.mjs |
| runtime-storage | scripts/pr-preview-verify-feed.mjs |
| runtime-storage | scripts/prepare-bundled-git.mjs |
| runtime-storage | scripts/prepare-production-components.mjs |
| runtime-storage | scripts/publish-cnb-cloud-mirror.ps1 |
| runtime-storage | scripts/reasoning-effort-slider-patch.mjs |
| runtime-storage | scripts/refresh-release-manifest.mjs |
| runtime-storage | scripts/release-audit.mjs |
| runtime-storage | scripts/release-local-formal-windows-validation.cjs |
| runtime-storage | scripts/release-oneoff-v1.0.58-windows-ui-validation.cjs |
| runtime-storage | scripts/release-orchestrator.mjs |
| runtime-storage | scripts/release-publish-selection.cjs |
| runtime-storage | scripts/release-publish.mjs |
| runtime-storage | scripts/run-smoke-tests.mjs |
| runtime-storage | scripts/session-list-metadata-performance-patch.mjs |
| runtime-storage | scripts/session-persistence-performance-patch.mjs |
| runtime-storage | scripts/session-switch-performance-benchmark.mjs |
| runtime-storage | scripts/store-msix-lib.mjs |
| runtime-storage | scripts/store-readiness.mjs |
| runtime-storage | scripts/test-agent-teams-host-electron.cjs |
| runtime-storage | scripts/test-runtime-session-auth-electron.cjs |
| runtime-storage | scripts/test-session-timeline-electron.cjs |
| runtime-storage | scripts/timeline-reference-patch.mjs |
| runtime-storage | scripts/tool-recoverable-error-patch.mjs |
| runtime-storage | scripts/tool-result-image-patch.mjs |
| runtime-storage | scripts/upstream-status.mjs |
| runtime-storage | scripts/verify-agent-teams-installed-smoke.mjs |
| runtime-storage | scripts/verify-component-signing-key.mjs |
| runtime-storage | scripts/verify-formal-windows-release-identity.mjs |
| runtime-storage | scripts/verify-production-component-staging.mjs |
| runtime-storage | scripts/verify-static.mjs |
| runtime-storage | scripts/verify-workspace-picker-runtime.mjs |
| runtime-storage | scripts/workspace-session-menu-patch.mjs |
| session-files | electron/bridge/desktop-compaction-plugin-service.cjs |
| session-files | electron/bridge/desktop-directory-picker-plugin-service.cjs |
| session-files | electron/bridge/desktop-files-plugin-service.cjs |
| session-files | electron/bridge/desktop-progress-plugin-service.cjs |
| session-files | electron/bridge/git-runtime-service.cjs |
| session-files | electron/bridge/right-workspace-service.cjs |
| session-files | electron/bridge/session-experience-plugin-service.cjs |
| session-files | electron/bridge/terminal-service.cjs |
| session-files | guest-bridge/bridge.cjs |
| session-files | guest-bridge/errors.cjs |
| session-files | guest-bridge/index.cjs |
| session-files | guest-bridge/platforms.cjs |
| session-files | guest-bridge/protocol.cjs |
| session-files | plugins/dsh-desktop-compaction/lib/index.js |
| session-files | plugins/dsh-desktop-compaction/package.json |
| session-files | plugins/dsh-desktop-directory-picker/lib/client.js |
| session-files | plugins/dsh-desktop-directory-picker/lib/index.js |
| session-files | plugins/dsh-desktop-directory-picker/package.json |
| session-files | plugins/dsh-desktop-files/lib/client.js |
| session-files | plugins/dsh-desktop-files/lib/index.js |
| session-files | plugins/dsh-desktop-files/package.json |
| session-files | plugins/dsh-desktop-progress/lib/index.js |
| session-files | plugins/dsh-desktop-progress/package.json |
| session-files | plugins/dsh-session-experience/lib/client.js |
| session-files | plugins/dsh-session-experience/lib/index.js |
| session-files | plugins/dsh-session-experience/package.json |
| session-files | renderer/right-workspace-integration.js |
| session-files | renderer/right-workspace.css |
| session-files | renderer/right-workspace.js |
| session-files | renderer/workspace-links-integration.js |
| runtime-storage | scripts/test-right-workspace-electron.cjs |
| session-files | services/wss-relay/package-lock.json |
| session-files | services/wss-relay/package.json |
| session-files | services/wss-relay/server.cjs |
| teams-legacy | plugins/dsh-agent-teams/lib/artifact-cas.js |
| teams-legacy | plugins/dsh-agent-teams/lib/client.js |
| teams-legacy | plugins/dsh-agent-teams/lib/collaboration-broker.js |
| teams-legacy | plugins/dsh-agent-teams/lib/collaboration-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/defect-lifecycle-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/defect-lifecycle.js |
| teams-legacy | plugins/dsh-agent-teams/lib/desktop-authorization-capability.js |
| teams-legacy | plugins/dsh-agent-teams/lib/desktop-git-capability.js |
| teams-legacy | plugins/dsh-agent-teams/lib/desktop-secret-capability.js |
| teams-legacy | plugins/dsh-agent-teams/lib/external-defect-connectors.js |
| teams-legacy | plugins/dsh-agent-teams/lib/external-defect-outbox.js |
| teams-legacy | plugins/dsh-agent-teams/lib/git-workspace-adapter.js |
| teams-legacy | plugins/dsh-agent-teams/lib/index.js |
| teams-legacy | plugins/dsh-agent-teams/lib/official-core-ports.js |
| teams-legacy | plugins/dsh-agent-teams/lib/professional-capabilities.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-authority-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-automation-domain.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-automation-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-automation-store.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-automation-web.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-business-sync-domain.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-business-sync-runtime.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-business-sync-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-business-sync-store.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-collaboration.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-entry-registry.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-entry-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-foundations-runtime.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-lan-credentials.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-lan-transport.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-secure-channel.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-session-launch.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-state-store.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-actor.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-crypto.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-domain.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-store.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-task-web.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-team-board.js |
| teams-legacy | plugins/dsh-agent-teams/lib/project-wss-relay-transport.js |
| teams-legacy | plugins/dsh-agent-teams/lib/quality-evidence.js |
| teams-legacy | plugins/dsh-agent-teams/lib/team-deliverables.js |
| teams-legacy | plugins/dsh-agent-teams/lib/test-orchestrator-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/test-orchestrator.js |
| teams-legacy | plugins/dsh-agent-teams/lib/workspace-authority-service.js |
| teams-legacy | plugins/dsh-agent-teams/lib/workspace-authority.js |
| teams-legacy | plugins/dsh-agent-teams/package.json |
| mobile | renderer/device-workspace.js |
| runtime-storage | renderer/pr-preview-update-integration.js |
| runtime-storage | renderer/pr-preview-update.css |
| runtime-storage | renderer/storage-manager.js |

## 官方依赖功能映射（只读安装观察，非启用/通过证明）

| 包/版本 | owner | manifest职责 | 字面工具 | Desktop静态引用数 |
|---|---|---|---|---:|
| @deepseek-ai/cordis@4.0.2 | runtime-storage | Meta-Framework for Modern JavaScript Applications |  | 0 |
| @deepseek-ai/cordis-plugin-group@1.0.1 | models-plugins | Nested plugin group for cordis |  | 1 |
| @deepseek-ai/cordis-plugin-hmr@1.0.17 | runtime-storage | Hot Module Replacement Plugin for Cordis |  | 0 |
| @deepseek-ai/cordis-plugin-include@1.0.7 | runtime-storage | Include files in cordis configurations |  | 0 |
| @deepseek-ai/cordis-plugin-loader@1.0.3 | runtime-storage | Plugin loader for cordis |  | 0 |
| @deepseek-ai/cordis-plugin-timer@1.1.4 | runtime-storage | Timer service for cordis |  | 0 |
| @deepseek-ai/cosmokit@1.8.3 | runtime-storage | A collection of common utilities |  | 0 |
| @deepseek-ai/dsh@0.1.2-alpha.5 | runtime-storage | dsh CLI: profile boot, plugin management, and the browser UI alias |  | 6 |
| @deepseek-ai/dsh-acp@0.1.2-alpha.5 | runtime-storage | Automation-only Agent Client Protocol server for driving DeepSeek Harness agents over JSON-RPC stdio |  | 0 |
| @deepseek-ai/dsh-acp-app@0.1.2-alpha.5 | runtime-storage | The dsh ACP profile bundle: automation-only JSON-RPC stdio and process lifecycle over dsh-base |  | 0 |
| @deepseek-ai/dsh-agent@0.1.2-alpha.5 | runtime-storage | Agent interface, registry, initiator scope, and event vocabulary for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-agent-default-model@0.1.2-alpha.5 | models-plugins | Default model selection shared by Agent entry points |  | 0 |
| @deepseek-ai/dsh-agent-instructions@0.1.2-alpha.5 | runtime-storage | Workspace context loader for AGENTS.md/CLAUDE.md instruction files |  | 0 |
| @deepseek-ai/dsh-agent-loop@0.1.2-alpha.5 | runtime-storage | The concrete agent loop plugin for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-agent-presets@0.1.2-alpha.5 | runtime-storage | Per-session agent composition from preset cordis.yml files for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-agent-tool-presentation@0.1.2-alpha.5 | runtime-storage | Agent-plane presentation selector: composes one agent's tools as PTC mode, native, or both |  | 0 |
| @deepseek-ai/dsh-anonymous-user-id@0.1.2-alpha.5 | runtime-storage | Shared anonymous user identity for DeepSeek Harness telemetry and feedback correlation |  | 1 |
| @deepseek-ai/dsh-api-gateway@0.1.2-alpha.5 | runtime-storage | Typert Remote Host dispatcher and Client API endpoint |  | 1 |
| @deepseek-ai/dsh-api-remotes@0.1.2-alpha.5 | runtime-storage | Remote BFF assembly for application-selected Host capabilities |  | 1 |
| @deepseek-ai/dsh-api-session-controller@0.1.2-alpha.5 | runtime-storage | Session Remote commands, cold reads, and live control transport |  | 1 |
| @deepseek-ai/dsh-api-settings-controller@0.1.2-alpha.5 | models-plugins | Remote owner for the configuration surfaces over the settings-domain seams |  | 0 |
| @deepseek-ai/dsh-api-workspace-controller@0.1.2-alpha.5 | runtime-storage | Workspace Remote commands and reconnect-safe state transport |  | 0 |
| @deepseek-ai/dsh-atomic-write@0.1.2-alpha.5 | runtime-storage | Zero-dependency atomic file replacement: exclusive-create random-suffix temp + rename carrying the caller-stated permissions (writeFileAtomic) |  | 1 |
| @deepseek-ai/dsh-attachment@0.1.2-alpha.5 | session-files | Durable immutable attachment storage seam for the DeepSeek Harness |  | 3 |
| @deepseek-ai/dsh-attachment-local@0.1.2-alpha.5 | session-files | Private content-addressed DSH_HOME attachment storage |  | 1 |
| @deepseek-ai/dsh-authorization@0.1.2-alpha.5 | runtime-storage | Authorization seam (ctx.authorization): plugin-owned flows that obtain a credential through a conversation with the human |  | 0 |
| @deepseek-ai/dsh-base@0.1.2-alpha.5 | runtime-storage | The shared dsh core as a profile bundle: the first patch layer of base-backed profiles, inserting core rows over the empty profile root |  | 0 |
| @deepseek-ai/dsh-bash-local@0.1.2-alpha.5 | runtime-storage | Local-subprocess implementation of the DeepSeek Harness bash executor seam |  | 1 |
| @deepseek-ai/dsh-bash-sandbox@0.1.2-alpha.5 | runtime-storage | Sandbox-consuming implementation of the DeepSeek Harness bash executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |  | 0 |
| @deepseek-ai/dsh-brand@0.1.2-alpha.5 | runtime-storage | Stateless branded primitive types for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-client-connection@0.1.2-alpha.5 | runtime-storage | Authenticated RPC transport, generation lifecycle, and browser fixture |  | 1 |
| @deepseek-ai/dsh-client-hmr@0.1.2-alpha.5 | runtime-storage | Dev-only hot-reload driver for script-loaded client entries: SSE rebuilt frames → invalidate/prefetch → fiber swap through the vendored Loader entry |  | 0 |
| @deepseek-ai/dsh-client-locale@0.1.2-alpha.5 | runtime-storage | Locale plugin: Host-backed preference, extensible language catalog, browser fallback, and typed built-in dictionaries |  | 0 |
| @deepseek-ai/dsh-client-modules@0.1.2-alpha.5 | runtime-storage | Client module system, dual-face: node half composes the __DSH_BOOT__ entry graph (incremental dsh.client scan, bundle route, index tap, webPlugins service); browser half is the lazy-CJS module table the vendored cordis Loader consumes as its internal seam |  | 0 |
| @deepseek-ai/dsh-client-ui-agent-preset@0.1.2-alpha.5 | runtime-storage | Agent-preset surfaces: the default for later sessions, this session's seat, and the composition editor |  | 0 |
| @deepseek-ai/dsh-client-ui-approval@0.1.2-alpha.5 | runtime-storage | Approval composer takeover over the scoped Remote Event waterfall |  | 0 |
| @deepseek-ai/dsh-client-ui-attachment@0.1.2-alpha.5 | session-files | Dynamic attachment presentation plugin for conversation input, message-image, and trajectory image slots |  | 1 |
| @deepseek-ai/dsh-client-ui-brand-official@0.1.2-alpha.5 | runtime-storage | Official DeepSeek Harness brand occupants for the Web client's sidebar slots |  | 0 |
| @deepseek-ai/dsh-client-ui-chat@0.1.2-alpha.5 | runtime-storage | Chat Conversation target, node definitions, renderers, and details surface |  | 2 |
| @deepseek-ai/dsh-client-ui-commands@0.1.2-alpha.5 | runtime-storage | Client command surface: global directory cache, '/' source, three command UI kinds, popupSelect registry |  | 0 |
| @deepseek-ai/dsh-client-ui-conversation@0.1.2-alpha.5 | runtime-storage | Target-neutral Conversation assembly, shell, composer, queue, and view navigation |  | 3 |
| @deepseek-ai/dsh-client-ui-cordis@0.1.2-alpha.5 | runtime-storage | Cordis dynamic-plugin definition card: the keyed cordis_define tool row with its run/stop switch |  | 0 |
| @deepseek-ai/dsh-client-ui-deliverables@0.1.2-alpha.5 | runtime-storage | Produced-files turn tail and clickable final-response file references for Web |  | 0 |
| @deepseek-ai/dsh-client-ui-directory-picker-browse@0.1.2-alpha.5 | runtime-storage | In-app directory browsing surface: the workspace directory-flow owner rendering the host's listing and creation primitives |  | 0 |
| @deepseek-ai/dsh-client-ui-directory-picker-native@0.1.2-alpha.5 | runtime-storage | Native directory-picker surface: the renderless workspace directory-flow occupant driving the host's OS chooser |  | 0 |
| @deepseek-ai/dsh-client-ui-goal@0.1.2-alpha.5 | runtime-storage | Session goal surface: GoalBar docked above the composer, read from the goal session projection |  | 0 |
| @deepseek-ai/dsh-client-ui-input-trigger@0.1.2-alpha.5 | runtime-storage | Input trigger pipeline: '/' and '@' detection, candidate menu, pick routing to registered sources |  | 0 |
| @deepseek-ai/dsh-client-ui-jobs@0.1.2-alpha.5 | runtime-storage | Session-header background-job list: live registry state mirrored from session/jobs frames |  | 0 |
| @deepseek-ai/dsh-client-ui-layout@0.1.2-alpha.5 | runtime-storage | Shell plugin: three-column AppFrame with drag handles, ctx.layout viewing-state service (navigation + panels) |  | 0 |
| @deepseek-ai/dsh-client-ui-message-feedback@0.1.2-alpha.5 | runtime-storage | Per-message feedback controls contributed to the assistant-message action strip, backed by the messageFeedback Host Remote |  | 0 |
| @deepseek-ai/dsh-client-ui-model-selection@0.1.2-alpha.5 | models-plugins | Model selection over the shared model catalog, Session projection, and session.selectModel |  | 2 |
| @deepseek-ai/dsh-client-ui-permission-presets@0.1.2-alpha.5 | runtime-storage | Permission surfaces: a new-session default in General settings and a current-session /permission popup over the permissions projection |  | 0 |
| @deepseek-ai/dsh-client-ui-plan@0.1.2-alpha.5 | runtime-storage | Plan-mode composer control: the conversation.input.plan seat over the plan projection and the /plan command channel |  | 0 |
| @deepseek-ai/dsh-client-ui-reference@0.1.2-alpha.5 | runtime-storage | Unified Web @file and @session reference source |  | 0 |
| @deepseek-ai/dsh-client-ui-renderer@0.1.2-alpha.5 | runtime-storage | Browser UI renderer: React slot bindings, ctx.uiRenderer, and the assembled application root |  | 0 |
| @deepseek-ai/dsh-client-ui-schedule@0.1.2-alpha.5 | runtime-storage | Read-only active Schedule catalog in the Web Session header |  | 1 |
| @deepseek-ai/dsh-client-ui-session@0.1.2-alpha.5 | runtime-storage | Session Controller adapter for React and session-scoped slots |  | 0 |
| @deepseek-ai/dsh-client-ui-settings@0.1.2-alpha.5 | models-plugins | Settings domain base plugin: the settings-namespace scope service and the canonical settings slot-type contract |  | 0 |
| @deepseek-ai/dsh-client-ui-settings-general@0.1.2-alpha.5 | models-plugins | Settings ownerless-copy and product onboarding plugin: the General section, shell trigger/header chrome content, settings dictionaries, and the versioned welcome notice |  | 0 |
| @deepseek-ai/dsh-client-ui-settings-models@0.1.2-alpha.5 | models-plugins | Models settings and shared product-onboarding dialogs over existing settings and credential joins |  | 1 |
| @deepseek-ai/dsh-client-ui-settings-plugin-inventory@0.1.2-alpha.5 | models-plugins | Read-only Cordis Loader inventory tab in Web Plugins settings |  | 0 |
| @deepseek-ai/dsh-client-ui-settings-plugins@0.1.2-alpha.5 | models-plugins | Plugins settings section with feature-owned tabs and configurable host-plane plugin cards |  | 0 |
| @deepseek-ai/dsh-client-ui-sidebar@0.1.2-alpha.5 | runtime-storage | Sidebar plugin: session multi-level tree, search, grouping, state dots |  | 0 |
| @deepseek-ai/dsh-client-ui-skill@0.1.2-alpha.5 | models-plugins | Web skill references and the dedicated skill tool row |  | 0 |
| @deepseek-ai/dsh-client-ui-subagent@0.1.2-alpha.5 | teams-legacy | Subagent conversation catalog, continuation routing UI, and '@' reference source |  | 1 |
| @deepseek-ai/dsh-client-ui-theme@0.1.2-alpha.5 | runtime-storage | Theme plugin: Host bootstrap for the pre-plugin palette; DOM-free ThemeRuntime for light/dark/system state; --dsw-* token styles and Appearance settings row |  | 0 |
| @deepseek-ai/dsh-client-ui-tool@0.1.2-alpha.5 | runtime-storage | Client Tool call-tree renderer and keyed per-tool presentation slot |  | 1 |
| @deepseek-ai/dsh-client-ui-trajectory@0.1.2-alpha.5 | runtime-storage | Trajectory event ledger with an interactive timing overview: pure-consumer plugin registering into the conversation ViewMap (no service) |  | 0 |
| @deepseek-ai/dsh-client-ui-user-questions@0.1.2-alpha.5 | runtime-storage | Web ask_user_question composer takeover and plan-review presentation UI |  | 0 |
| @deepseek-ai/dsh-client-ui-workflow-run@0.1.2-alpha.5 | teams-legacy | Durable workflow-run Conversation Node and nested member disclosure for dsh web |  | 0 |
| @deepseek-ai/dsh-client-ui-workspace@0.1.2-alpha.5 | runtime-storage | Workspace picker plugin: one WorkspacePicker registered into the sidebar and empty-state workspace slots |  | 2 |
| @deepseek-ai/dsh-cmdline@0.1.2-alpha.5 | runtime-storage | Immutable command-line handoff from a dsh launcher to any app plugin that injects cmdlineArgs |  | 0 |
| @deepseek-ai/dsh-code-runtime@0.1.2-alpha.5 | runtime-storage | Abstract code-execution seam (ctx.codeRuntime) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-code-runtime-worker-thread@0.1.2-alpha.5 | runtime-storage | Worker-thread implementation of the DeepSeek Harness code-execution seam |  | 0 |
| @deepseek-ai/dsh-command-compact@0.1.2-alpha.5 | runtime-storage | Human-facing slash command for explicit session compaction |  | 0 |
| @deepseek-ai/dsh-command-feedback@0.1.2-alpha.5 | runtime-storage | Log-only session feedback producer and human-facing slash command |  | 0 |
| @deepseek-ai/dsh-command-goal@0.1.2-alpha.5 | runtime-storage | Human-facing slash command for persisted same-session goals |  | 0 |
| @deepseek-ai/dsh-commands@0.1.2-alpha.5 | runtime-storage | Plugin-owned human command registry for DeepSeek Harness UIs |  | 0 |
| @deepseek-ai/dsh-compaction@0.1.2-alpha.5 | session-files | Abstract compaction service seam (ctx.compaction) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-compaction-basic@0.1.2-alpha.5 | session-files | Token-meter-driven compaction policy and LLM summarization backend for the DeepSeek Harness |  | 3 |
| @deepseek-ai/dsh-compaction-tool-result-pruner@0.1.2-alpha.5 | session-files | Replay-safe model-free head/middle/tail pruning for tool-result surface nodes |  | 0 |
| @deepseek-ai/dsh-cordis-client-runner@0.1.2-alpha.5 | runtime-storage | Browser half of dynamic dual-half plugin packages: event subscription, closure evaluation, guard facade, and loader entries |  | 0 |
| @deepseek-ai/dsh-cordis-host-runner@0.1.2-alpha.5 | runtime-storage | Dynamic package definition registry, host-half sandbox lifecycle, and invoke handler table for model-mounted dual-half packages |  | 0 |
| @deepseek-ai/dsh-credentials@0.1.2-alpha.5 | models-plugins | Abstract credential seam (ctx.credentials): settings carry references to secrets, providers own the values |  | 0 |
| @deepseek-ai/dsh-credentials-local@0.1.2-alpha.5 | models-plugins | File-backed credentials provider ($DSH_HOME/.env under the live process environment) for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-deepseek-llm-api-extensions@0.1.2-alpha.5 | models-plugins | Additive request-field registry for the official DeepSeek LLM API adapter |  | 0 |
| @deepseek-ai/dsh-deque@0.1.2-alpha.5 | runtime-storage | Zero-dependency circular deque with amortized constant-time end operations and bounded vacant storage |  | 0 |
| @deepseek-ai/dsh-file-reference@0.1.2-alpha.5 | runtime-storage | File-reference discovery contract and shared @file grammar |  | 0 |
| @deepseek-ai/dsh-file-reference-local@0.1.2-alpha.5 | runtime-storage | Local-filesystem ctx.fileReferences provider with bounded fuzzy indexes |  | 0 |
| @deepseek-ai/dsh-fs@0.1.2-alpha.5 | runtime-storage | Abstract filesystem capability seam (ctx.fs) for the DeepSeek Harness — vocabulary types, the FileSystem service (text IO + optional version-guarded atomic mutations), and the fs/* policy event vocabulary |  | 1 |
| @deepseek-ai/dsh-fs-local@0.1.2-alpha.5 | session-files | Local-filesystem implementation of the DeepSeek Harness filesystem seam (ctx.fs) |  | 0 |
| @deepseek-ai/dsh-fs-observation-policy@0.1.2-alpha.5 | session-files | File-context policy plugin for the DeepSeek Harness — observed-state, read-before-edit, and version-guarded write/edit added over the ctx.fs provider seam through the fs/* event gate (no service API) |  | 0 |
| @deepseek-ai/dsh-fs-sandbox@0.1.2-alpha.5 | runtime-storage | Sandbox-enforcing implementation of the DeepSeek Harness filesystem seam: fences write/edit by the per-call sandbox mode (read-only denies mutation, workspace-write contains it to the workspace + temp roots) while reads pass through |  | 0 |
| @deepseek-ai/dsh-goal@0.1.2-alpha.5 | runtime-storage | Event-sourced same-session goal state and lifecycle service for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-goal-round-driver@0.1.2-alpha.5 | runtime-storage | Race-fenced same-session goal-round driver |  | 0 |
| @deepseek-ai/dsh-headless@0.1.2-alpha.5 | runtime-storage | The dsh one-shot bundle: a direct core Agent/Session runner over dsh-base with no Host, HTTP, or browser layer |  | 0 |
| @deepseek-ai/dsh-home-paths@0.1.2-alpha.5 | runtime-storage | Shared filesystem path helpers for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-hook-protocol@0.1.2-alpha.5 | runtime-storage | Shared Claude Code / Codex hook wire protocol: matcher engine, stdin/exit-code/stdout codec, multi-hook merge, and hook/* session events |  | 0 |
| @deepseek-ai/dsh-hooks-claude-code@0.1.2-alpha.5 | runtime-storage | Bridge plugin: run a Claude Code hooks.json / settings hook config on the DeepSeek Harness interception seams |  | 0 |
| @deepseek-ai/dsh-hooks-codex@0.1.2-alpha.5 | runtime-storage | Bridge plugin: run a Codex hooks.json hook config on the DeepSeek Harness interception seams |  | 0 |
| @deepseek-ai/dsh-host-directory-picker@0.1.2-alpha.5 | runtime-storage | Abstract workspace-directory picking seam (ctx.directoryPicker) for the DeepSeek Harness web GUI host |  | 0 |
| @deepseek-ai/dsh-host-directory-picker-auto@0.1.2-alpha.5 | runtime-storage | Adaptive chooser of the directory-picker seam: resolves the host situation at boot and mounts the native or browse backend for the DeepSeek Harness web GUI host |  | 0 |
| @deepseek-ai/dsh-host-directory-picker-browse@0.1.2-alpha.5 | runtime-storage | In-app browsing backend of the directory-picker seam (listing/creation primitives over the host filesystem) |  | 0 |
| @deepseek-ai/dsh-host-directory-picker-native@0.1.2-alpha.5 | runtime-storage | Native-OS-chooser backend of the directory-picker seam for the DeepSeek Harness web GUI host |  | 0 |
| @deepseek-ai/dsh-host-frontend-static@0.1.2-alpha.5 | runtime-storage | SPA dist server for the Web shell: owns the webserver fallback seat, serving explicit index entries and static assets with traversal rejection and 404 misses |  | 0 |
| @deepseek-ai/dsh-host-plugin-inventory@0.1.2-alpha.5 | runtime-storage | Read-only Remote projection of current Cordis Loader plugin state |  | 0 |
| @deepseek-ai/dsh-host-webserver@0.1.2-alpha.5 | runtime-storage | Web route-registration plugin: HTTP and upgrade routes, index transform taps, and static dist fallback; knows no harness concepts |  | 0 |
| @deepseek-ai/dsh-invariants@0.1.2-alpha.5 | runtime-storage | Registry service for package-owned DeepSeek Harness runtime invariants |  | 1 |
| @deepseek-ai/dsh-jobs@0.1.2-alpha.5 | runtime-storage | Background job registry (ctx.jobs) for the DeepSeek Harness — shared ids, owner isolation, polling, cancellation, and completion listeners for long-running tool work |  | 3 |
| @deepseek-ai/dsh-jobs-local@0.1.2-alpha.5 | runtime-storage | Process-local implementation of the DeepSeek Harness background job registry seam |  | 0 |
| @deepseek-ai/dsh-launch-environment@0.1.2-alpha.5 | runtime-storage | Immutable DeepSeek Harness launch environment that records which layer supplied each value |  | 0 |
| @deepseek-ai/dsh-llm@0.1.2-alpha.5 | models-plugins | Provider-neutral LLM service interface for the DeepSeek Harness |  | 2 |
| @deepseek-ai/dsh-llm-deepseek@0.1.2-alpha.5 | models-plugins | DeepSeek chat-completions adapter for the DeepSeek Harness LLM seam |  | 0 |
| @deepseek-ai/dsh-llm-pi-ai@0.1.2-alpha.5 | models-plugins | pi-ai-backed DeepSeek adapter for the DeepSeek Harness LLM seam (design-verification twin of dsh-llm-deepseek) |  | 1 |
| @deepseek-ai/dsh-llm-retry@0.1.2-alpha.5 | models-plugins | Provider-routed LLM request retry policy for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-mcp-client@0.1.2-alpha.5 | models-plugins | MCP client bridge: connects to MCP servers and registers their tools on ctx.tools |  | 2 |
| @deepseek-ai/dsh-message-feedback@0.1.2-alpha.5 | runtime-storage | Lifecycle-bound per-message rating and note sidecar for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-native-command@0.1.2-alpha.5 | runtime-storage | Host-native command and path-opening utilities with shell-free execution, cancellation, desktop detection, and WSL handoff |  | 0 |
| @deepseek-ai/dsh-output-retention@0.1.2-alpha.5 | session-files | Zero-dependency bounded-retention primitive: ItemRetainer/TextRetainer + neutral notice helpers (what did we keep, what did we omit) |  | 1 |
| @deepseek-ai/dsh-permission-presets@0.1.2-alpha.5 | runtime-storage | User-facing permission presets (ctx.permissionPresets) for the DeepSeek Harness: one product-level Permissions select bundling the sandbox-mode and approval-policy knobs, written through to their own session events |  | 0 |
| @deepseek-ai/dsh-persona@0.1.2-alpha.5 | runtime-storage | Composition-authored deployment persona section for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-plan-mode@0.1.2-alpha.5 | runtime-storage | Logged per-agent plan mode with deployment guidance, a direct slash command, and a user-reviewed exit |  | 0 |
| @deepseek-ai/dsh-plugin-package-inventory-deepseek@0.1.2-alpha.5 | runtime-storage | Active Loader-backed plugin package inventory for official DeepSeek LLM API requests |  | 0 |
| @deepseek-ai/dsh-pwsh-local@0.1.2-alpha.5 | runtime-storage | Local PowerShell implementation of the DeepSeek Harness bash executor seam |  | 0 |
| @deepseek-ai/dsh-pwsh-sandbox@0.1.2-alpha.5 | runtime-storage | Sandbox-consuming implementation of the DeepSeek Harness PowerShell executor seam (confines every command via ctx.sandbox, reports denial/enforcement result facts) |  | 0 |
| @deepseek-ai/dsh-repeat-tool-reminder@0.1.2-alpha.5 | runtime-storage | Repeat-tool-call guard plugin: advisory reminders when an agent loops on identical tool calls |  | 0 |
| @deepseek-ai/dsh-sandbox@0.1.2-alpha.5 | runtime-storage | Abstract process-sandbox seam (ctx.sandbox) for the DeepSeek Harness: same-world confinement vocabulary and the SandboxProvider contract |  | 1 |
| @deepseek-ai/dsh-sandbox-local@0.1.2-alpha.5 | runtime-storage | Local process-sandbox backends for the DeepSeek Harness sandbox seam: bwrap, the npm-distributed landlock-run launcher, macOS Seatbelt, or the Windows ACL restricted-token runner — functionally probed, fail-closed |  | 0 |
| @deepseek-ai/dsh-sandbox-policy@0.1.2-alpha.5 | runtime-storage | Per-call sandbox policy resolver and current model context: deployment fallbacks plus each session's mode and workspace root, shared by every enforcing capability family |  | 0 |
| @deepseek-ai/dsh-sandbox-windows-acl@0.1.2-alpha.5 | runtime-storage | Windows ACL write-restriction sandbox backend (restricted-token spawn with capability-SID write allowlist) for the DeepSeek Harness sandbox seam |  | 0 |
| @deepseek-ai/dsh-schedule@0.1.2-alpha.5 | runtime-storage | Agent-scoped durable after, at, and fixed-rate reminders over the session event log | schedule_create, schedule_list, schedule_delete | 2 |
| @deepseek-ai/dsh-scope@0.1.2-alpha.5 | session-files | Scoped-context registration primitive (scope tags, scope-filtered event dispatch) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-sdk-app@0.1.2-alpha.5 | runtime-storage | The dsh SDK profile bundle: stdio JSON-RPC serving and process lifecycle over dsh-base |  | 0 |
| @deepseek-ai/dsh-sdk-jsonrpc-server@0.1.2-alpha.5 | runtime-storage | Stdio JSON-RPC server plugin for out-of-process DeepSeek Harness SDK clients |  | 0 |
| @deepseek-ai/dsh-sdk-minimal@0.1.2-alpha.5 | runtime-storage | The standalone minimal SDK profile bundle: JSON-RPC, one DeepSeek adapter, persistent shell, editor, and JSONL sessions |  | 0 |
| @deepseek-ai/dsh-sdk-protocol@0.1.2-alpha.5 | runtime-storage | Shared wire protocol for the DeepSeek Harness SDK runtime: the newline-delimited JSON-RPC stdio transport and the named request, result, and notification types spoken between the runtime server and SDK clients |  | 0 |
| @deepseek-ai/dsh-session@0.1.2-alpha.5 | runtime-storage | Event-sourced session store for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-session-checkpoint-policy@0.1.2-alpha.5 | runtime-storage | Semantic session durability checkpoints before model requests and tool side effects |  | 0 |
| @deepseek-ai/dsh-session-log-deepseek@0.1.2-alpha.5 | runtime-storage | Incremental lossless session-log request extension for the official DeepSeek LLM API |  | 0 |
| @deepseek-ai/dsh-session-log-export@0.1.2-alpha.5 | runtime-storage | Web Session-log export command and shared download dialog |  | 0 |
| @deepseek-ai/dsh-session-persistence@0.1.2-alpha.5 | session-files | Abstract durable session persistence seam (ctx.sessionPersistence) for the DeepSeek Harness |  | 3 |
| @deepseek-ai/dsh-session-persistence-jsonl@0.1.2-alpha.5 | session-files | JSONL durable session persistence backend for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-session-projection@0.1.2-alpha.5 | runtime-storage | Session-projection seam: the merge-extensible projection type table, the provider contract, and the ctx.sessionProjections registry serving whole current values of log-derived per-session state |  | 0 |
| @deepseek-ai/dsh-session-projection-cache@0.1.2-alpha.5 | runtime-storage | Persisted projection cache (ctx.sessionProjectionCache): durable per-session checkpoint records on the session_projcache storage domain (per-record layout), throttled write-behind, and the cached listing read |  | 1 |
| @deepseek-ai/dsh-session-query@0.1.2-alpha.5 | session-files | Combined session query service contract with concrete reads, traces, and filters |  | 3 |
| @deepseek-ai/dsh-session-query-sqlite@0.1.2-alpha.5 | session-files | Concrete ctx.sessionQuery backend with SQLite FTS5 search |  | 0 |
| @deepseek-ai/dsh-session-reference@0.1.2-alpha.5 | runtime-storage | Cross-session snapshot references and durable untrusted model context (ctx.sessionReferenceResolver) |  | 0 |
| @deepseek-ai/dsh-session-stats@0.1.2-alpha.5 | runtime-storage | Whole-log conversation counts and wall times projection (sessionStats) for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-session-telemetry@0.1.2-alpha.5 | session-files | SessionTelemetryBackend seam for the DeepSeek Harness: session-event capture, projection, redaction, and handoff to a reporting backend |  | 1 |
| @deepseek-ai/dsh-session-telemetry-otel@0.1.2-alpha.5 | session-files | OpenTelemetry backend for the DeepSeek Harness telemetry seam: hands captured session records to the OTel JS SDK's log pipeline |  | 0 |
| @deepseek-ai/dsh-session-title@0.1.2-alpha.5 | session-files | Log-backed session title service and provider registry for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-session-title-first-prompt-llm@0.1.2-alpha.5 | session-files | First-message LLM provider plugin for DeepSeek Harness session titles |  | 0 |
| @deepseek-ai/dsh-session-title-llm@0.1.2-alpha.5 | session-files | Shared LLM generation policy for DeepSeek Harness session-title providers |  | 1 |
| @deepseek-ai/dsh-session-turn-outline@0.1.2-alpha.5 | runtime-storage | Whole-log turn outline projection (turnOutline) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-settings@0.1.2-alpha.5 | models-plugins | Abstract user-settings seam (ctx.settings) for the DeepSeek Harness |  | 3 |
| @deepseek-ai/dsh-settings-file@0.1.2-alpha.5 | models-plugins | File-backed settings provider (settings.yaml) for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-shell@0.1.2-alpha.5 | runtime-storage | Abstract bash executor seam (ctx.shell) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-shell-env@0.1.2-alpha.5 | runtime-storage | Tool-independent managed DSH_* shell environment registry |  | 0 |
| @deepseek-ai/dsh-skill@0.1.2-alpha.5 | models-plugins | Agent skill provider registry for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-skill-badge@0.1.2-alpha.5 | models-plugins | Bundled dsh badge skill provider for DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-skill-filesystem@0.1.2-alpha.5 | models-plugins | Local filesystem skill provider for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-spill@0.1.2-alpha.5 | session-files | Abstract spill storage seam (ctx.spillStore) for the DeepSeek Harness — save oversized tool text and return a retrieval locator |  | 1 |
| @deepseek-ai/dsh-spill-local@0.1.2-alpha.5 | session-files | Local-filesystem implementation of the DeepSeek Harness spill storage seam (private session-scoped files) |  | 0 |
| @deepseek-ai/dsh-spill-policy@0.1.2-alpha.5 | session-files | Tool-result spill policy for the DeepSeek Harness — replaces oversized plain-text tool results with a retained preview plus a spill-file path (no service API) |  | 0 |
| @deepseek-ai/dsh-storage@0.1.2-alpha.5 | runtime-storage | Storage hub (ctx.storage): named backend registry plus mounted data-form facilities for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-storage-domain@0.1.2-alpha.5 | runtime-storage | Domain data form (ctx.storage.domain): schema-validated, event-emitting KV domains over storage backends for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-storage-json@0.1.2-alpha.5 | runtime-storage | JSON file KV storage backend for the DeepSeek Harness storage hub |  | 1 |
| @deepseek-ai/dsh-subagent@0.1.2-alpha.5 | teams-legacy | Abstract subagent seam (ctx.subagents): named-provider registry for delegating to child agents |  | 2 |
| @deepseek-ai/dsh-subagent-fork-in-process@0.1.2-alpha.5 | teams-legacy | In-process fork subagent backend: runs a child agent seeded with a prefix of the parent's log |  | 0 |
| @deepseek-ai/dsh-subagent-in-process-driver@0.1.2-alpha.5 | teams-legacy | Shared in-process subagent run driver: drives a child agent on ctx.agents (used by the spawn and fork backends) |  | 1 |
| @deepseek-ai/dsh-subagent-spawn-in-process@0.1.2-alpha.5 | teams-legacy | In-process spawn subagent backend: runs a fresh child agent on ctx.agents |  | 0 |
| @deepseek-ai/dsh-subprocess@0.1.2-alpha.5 | runtime-storage | Subprocess seam (ctx.subprocess) for the DeepSeek Harness — managed process groups, bounded spill-backed output, and escalated kills behind one abstract service |  | 1 |
| @deepseek-ai/dsh-subprocess-local@0.1.2-alpha.5 | runtime-storage | Local-subprocess implementation of the DeepSeek Harness subprocess seam |  | 0 |
| @deepseek-ai/dsh-system-prompt@0.1.2-alpha.5 | runtime-storage | System prompt assembly registry for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-terminal@0.1.2-alpha.5 | runtime-storage | Persistent PTY session seam for the DeepSeek Harness — owner-scoped ids, backend registry, interactive sends, reads, signals, and awaited cleanup |  | 0 |
| @deepseek-ai/dsh-terminal-bash@0.1.2-alpha.5 | runtime-storage | Persistent shell PTY backend over the DeepSeek Harness subprocess terminal primitive |  | 0 |
| @deepseek-ai/dsh-time-context@0.1.2-alpha.5 | runtime-storage | Opt-in durable per-step context with the current time and elapsed time |  | 0 |
| @deepseek-ai/dsh-timeout@0.1.2-alpha.5 | runtime-storage | Zero-dependency timeout/deadline primitive: clampTimeout, deadline, timeoutOf, TimeoutReason (timing + classification only, no termination) |  | 1 |
| @deepseek-ai/dsh-tmux-context@0.1.2-alpha.5 | runtime-storage | Opt-in durable per-step context with this agent's tmux pane and window location |  | 0 |
| @deepseek-ai/dsh-token-meter@0.1.2-alpha.5 | runtime-storage | Replay-aware token measurement service (ctx.tokenMeter) for the DeepSeek Harness |  | 1 |
| @deepseek-ai/dsh-tool-ask-user@0.1.2-alpha.5 | runtime-storage | Model-facing ask_user_question tool over the ctx.userQuestions seam | ask_user_question | 0 |
| @deepseek-ai/dsh-tool-bash@0.1.2-alpha.5 | runtime-storage | Model-facing bash tool with optional generic background-job and sandbox-escalation support | bash | 0 |
| @deepseek-ai/dsh-tool-bash-persistent@0.1.2-alpha.5 | runtime-storage | Model-facing owner-scoped persistent Bash tool backed by the Harness PTY service | bash | 0 |
| @deepseek-ai/dsh-tool-call-timeout-policy@0.1.2-alpha.5 | runtime-storage | Tool-call timeout policy: a tools/execute wrapper that arms a per-tool deadline on exec.signal and returns TOOL_TIMEOUT when it wins |  | 0 |
| @deepseek-ai/dsh-tool-cordis@0.1.2-alpha.5 | runtime-storage | Self-referential cordis toolset: inspect the live runtime, mount and dispose model-written plugins | cordis_inspect_list, cordis_inspect_query, cordis_inspect_self, cordis_define, cordis_run, cordis_stop, cordis_undefine | 0 |
| @deepseek-ai/dsh-tool-fs@0.1.2-alpha.5 | session-files | Model-facing filesystem tools (read, write, edit) over the DeepSeek Harness filesystem seam (ctx.fs) | read, write, edit, read_image | 0 |
| @deepseek-ai/dsh-tool-fs-search@0.1.2-alpha.5 | session-files | Model-facing filesystem discovery tools (glob, grep) backed by the packaged ripgrep binary (@vscode/ripgrep) | glob, grep | 0 |
| @deepseek-ai/dsh-tool-goal@0.1.2-alpha.5 | runtime-storage | Model-facing same-session goal tools with execution-time authority checks | get_goal, create_goal, update_goal | 1 |
| @deepseek-ai/dsh-tool-jobs@0.1.2-alpha.5 | runtime-storage | Model-facing background job control tools (job_output, job_list, job_kill) over the ctx.jobs registry | job_output, job_list, job_kill | 0 |
| @deepseek-ai/dsh-tool-pwsh@0.1.2-alpha.5 | runtime-storage | Model-facing pwsh tool over the bash executor seam | pwsh | 0 |
| @deepseek-ai/dsh-tool-pwsh-persistent@0.1.2-alpha.5 | runtime-storage | Model-facing owner-scoped persistent PowerShell tool backed by the Harness PTY service | pwsh | 0 |
| @deepseek-ai/dsh-tool-ralph@0.1.2-alpha.5 | runtime-storage | Model-facing fresh-agent Ralph loop over the workflow and subagent seams | ralph | 0 |
| @deepseek-ai/dsh-tool-skill@0.1.2-alpha.5 | models-plugins | Model-facing skill loading tool for the DeepSeek Harness | skill | 0 |
| @deepseek-ai/dsh-tool-str-replace-editor@0.1.2-alpha.5 | runtime-storage | Model-facing view, create, literal replace, and line insert tool over the Harness filesystem service | str_replace_editor | 0 |
| @deepseek-ai/dsh-tool-subagent@0.1.2-alpha.5 | teams-legacy | Model-facing subagent delegation tool over the ctx.subagents seam | list_subagent_models | 1 |
| @deepseek-ai/dsh-tool-subagent-control@0.1.2-alpha.5 | teams-legacy | Globally named send_message, interrupt_agent, and list_agents tools over ctx.subagents continuations | send_message, interrupt_agent | 0 |
| @deepseek-ai/dsh-tool-todo@0.1.2-alpha.5 | runtime-storage | Model-facing todo_write tool over the DeepSeek Harness event-sourced session log | todo_write | 0 |
| @deepseek-ai/dsh-tool-web@0.1.2-alpha.5 | runtime-storage | Model-facing web tools (web_search, web_fetch) over the DeepSeek Harness web capability seam (ctx.web) | web_search, web_fetch | 0 |
| @deepseek-ai/dsh-tool-workflow@0.1.2-alpha.5 | teams-legacy | Model-facing workflow tool: run a JavaScript orchestration script over ctx.workflowEngine |  | 0 |
| @deepseek-ai/dsh-tools@0.1.2-alpha.5 | runtime-storage | Tool registry and execution pipeline for the DeepSeek Harness |  | 14 |
| @deepseek-ai/dsh-typert-loader@0.1.2-alpha.5 | runtime-storage | Loader integration for generated Typert package contributions |  | 0 |
| @deepseek-ai/dsh-typert-protocol@0.1.2-alpha.5 | runtime-storage | Compiler-independent Remote metadata and Typert provider protocols |  | 0 |
| @deepseek-ai/dsh-typert-registry@0.1.2-alpha.5 | runtime-storage | Runtime registry for generated package reflection and Zod schemas |  | 0 |
| @deepseek-ai/dsh-user-approval@0.1.2-alpha.5 | runtime-storage | User-approval seam (ctx.approval) for the DeepSeek Harness: one-shot permission decisions dispatched to composed answerers over the approval/request waterfall, fail-closed by default |  | 0 |
| @deepseek-ai/dsh-user-questions@0.1.2-alpha.5 | runtime-storage | Abstract user-questions seam (ctx.userQuestions) for asking the human during agent runs |  | 0 |
| @deepseek-ai/dsh-util-crypto@0.1.2-alpha.5 | runtime-storage | Zero-dependency browser-safe UUID and byte-encoding helpers |  | 0 |
| @deepseek-ai/dsh-util-time@0.1.2-alpha.5 | runtime-storage | Zero-dependency time vocabulary shared by wire boundaries: canonicalClientTimeZone (IANA zone validation and canonicalization only, no formatting) |  | 3 |
| @deepseek-ai/dsh-util-values@0.1.2-alpha.5 | runtime-storage | Duplicate-install-safe value primitives for the DeepSeek Harness |  | 0 |
| @deepseek-ai/dsh-util-workspace-path@0.1.2-alpha.5 | runtime-storage | Browser-safe Workspace path and display helpers |  | 0 |
| @deepseek-ai/dsh-web@0.1.2-alpha.5 | runtime-storage | Abstract web access capability seam (ctx.web) for the DeepSeek Harness — search/fetch provider registry, registration-order-independent selection, request/result vocabulary, and the WebError taxonomy |  | 1 |
| @deepseek-ai/dsh-web-app@0.1.2-alpha.5 | runtime-storage | The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin (frontend dist serving, web-surface prompt, bash runtime variables, URL line) |  | 0 |
| @deepseek-ai/dsh-web-fetch-http@0.1.2-alpha.5 | runtime-storage | Anonymous public HTTP(S) fetch provider for the DeepSeek Harness web capability seam (ctx.web) |  | 0 |
| @deepseek-ai/dsh-web-frontend@0.1.2-alpha.5 | runtime-storage | Web application entry: vite build over the @deepseek-ai/dsh-client-web shell library; dist/ served by apps/cli's dsh web |  | 0 |
| @deepseek-ai/dsh-web-search-deepseek@0.1.2-alpha.5 | runtime-storage | DeepSeek-backed search provider (native web_search via the Anthropic-compatible API) for the DeepSeek Harness web capability seam (ctx.web) |  | 0 |
| @deepseek-ai/dsh-webhook@0.1.2-alpha.5 | runtime-storage | Fire-and-forget webhook rule runtime that creates Workspace-backed DeepSeek Harness Sessions |  | 0 |
| @deepseek-ai/dsh-webhook-github@0.1.2-alpha.5 | runtime-storage | Signed GitHub HTTP webhook adapter for the DeepSeek Harness webhook runtime |  | 0 |
| @deepseek-ai/dsh-win32-process@0.1.2-alpha.5 | runtime-storage | Low-level Win32 process, stdio, and Job Object primitives for the DeepSeek Harness Windows sandbox |  | 0 |
| @deepseek-ai/dsh-workflow@0.1.2-alpha.5 | teams-legacy | Workflow capability seam: ctx.workflowEngine service, run vocabulary, and workflow/* events |  | 1 |
| @deepseek-ai/dsh-workflow-worker-thread@0.1.2-alpha.5 | teams-legacy | worker-thread workflow engine: executes model-written orchestration scripts off the host event loop, bridging agent() calls back to ctx.subagents |  | 0 |
| @deepseek-ai/dsh-workspace@0.1.2-alpha.5 | runtime-storage | Workspace entity registry (ctx.workspaceRegistry): durable workspace records with validated session attachment over the domain data form for the DeepSeek Harness |  | 0 |
| @deepseek-ai/node-addon-landlock-run@0.1.1 | runtime-storage | Landlock self-restrict-then-exec launcher for sandboxing subprocesses on Linux: per-platform prebuilt static binaries plus the JS seam that resolves, probes, and speaks their CLI contract |  | 0 |
| @deepseek-ai/schemastery@3.18.2 | runtime-storage | Type driven schema validator |  | 5 |
