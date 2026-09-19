# 三项旧移动测试契约校准

## 范围与结果

最终独立全量中，这3文件再次实际执行：Android6、Swift源契约3、P2P13，共22/22，0skip/fail；它们是2929总测试的子集，不另加总。原始Node file/name/status事件存于`.artifacts/deep-audit-20260912/baseline-final-candidate-v1/ordinary-test-events.jsonl`，总审此前已正式接受该有界测试修改；Swift证据层仍不升级为原生执行。

只改获授权的3个测试文件，不改生产、旧发布或历史hash。原始字节及摘要存于`.artifacts/deep-audit-20260912/mobile-contracts-before/`。当前候选的作者回归为**26/26（3文件22项+隔离/台账4项），0skip/fail，before/after源码与测试0漂移**；不是独立自批或完整移动功能验收。未启动GUI/真机、未安装APK，也未访问账号或私有配置。

| 测试文件 | 原失败 | 新依据 | 证据层 |
|---|---|---|---|
| desktop-android-shell.test.cjs:10 | captureAndroid定义到preview:true不在220字符窗口内，过期短regex阻止安全代码扩展 | 执行实际captureAndroid、invokeAndroid、currentAndroid、tick/scheduleTick函数片段；preview:true、无设备/停用/销毁/其他来源零dispatch，旧generation/旧device/Stop/空回执/throw不更新帧 | unit，VM/fake API，不是Android原生 |
| mobile-ios-lifecycle.test.cjs:25 | 强制无generation的`defer { foregroundRecoveryTask=nil }`旧语法 | 检查generation捕获、guarded defer、profile/generation/cancel判据、每个start await后/成功/错误写回之前guard；forget/schedule先增代、取消任务再清状态 | **source-contract/static-review**，不代表Swift编译或actor运行 |
| native-p2p-desktop.test.cjs:358 | 只认嵌套await，不允许decode后检查socket/generation | 完整实际renderer脚本+Node真WebCrypto+fake WebSocket/ICE接口，执行实际onmessage→decryptSignal→handleSignal：两消息串行、nonce replay/错误session拒绝、close/Stop/替换时迟到decrypt不施加ICE，新代仍正常 | unit，真实JS/加密原语，无真实WebRTC/网络 |

保留原测试的payload/packet/nonce/replay/peer上限、target/session/crypto、STUN/信令能力以及Android release JNI收缩契约。没有为通过测试倒退生产边界或隐藏已有失败。

## 去除虚假性能证明

原Android测试人为固定`captures=0/children=1/writes=0`，循环1200个自建帧对象后称为“10分钟预览”。它没有调用生产preview循环，不能证明任何实际子进程、I/O、持续时间或帧内存。

替换为1200次实际生产tick调用：正常persistent stream不调用刷新/不设poll timer；legacy、断流与computer分支确实调用相应生产依赖并使用原调度值；inactive无调用。诊断明确这不是实耗10分钟、真实原生child数量或内存证明。

## 负面敏感性验证

在单次测试子进程的readFile结果上注入精确故障，**没有改动磁盘生产文件**，原离线守卫和干净环境仍在：

1. Android preview:true→false：新实际调用断言真实失败，显示preview:false≠true。`mutant-mobile-preview` 1fail是故障注入预期，不是候选产品失败。
2. 删除P2P post-decrypt socket/generation fence：实际socket close后迟到ICE被施加，新测试在close场景`1!==0`失败。保留decrypt内部generation防线仍能抓到这个独立socket-only窗口。`mutant-mobile-p2p-v2`同为预期红。
3. 初次P2P注入器未适配CRLF，未成功注入，仅报告匹配失败；不把该次当安全红证据。修注入器后才取得第2项有效行为红。

Swift仍只是源契约检查，不能用JS理想状态机或字符串断言声称iOS并发/取消已经执行。

## 可复查证据

运行目录均位于`.artifacts/deep-audit-20260912/`：

- `contracts-mobile-v1`：26pass，log SHA256 `b1ecea42c2254705a54a111f543ceb106ccc136eb98727e31e42954f22e7c9e7`。
- `mutant-mobile-preview`：预期行为红，log `f58b0e355209d6549f288000abcb39ebad45c14978eeb79024e6c1a85dfa0f09`。
- `mutant-mobile-p2p-v2`：预期行为红，log `0778f41ec0b5be30b2e9d8ae798afa7a7b6f2a7f96d77fe0ad5372c8c35228fb`。
- 每run含命令、before测试及生产摘要、结果/漂移列表。全局publisher/installed-writer排除策略在这些选中文件没有命中，实际0skip。

| 输出测试 | SHA256 |
|---|---|
| desktop-android-shell.test.cjs | 1d82e41d45f434fc4c8b5de317cf7d6bd18194c973d3ccfb76d8bf0b3e62b1f9 |
| mobile-ios-lifecycle.test.cjs | cc526763fe332020b354c062f4ebb15a768d10d5744b0660845e3d7d0a80ad1c |
| native-p2p-desktop.test.cjs | c0c50e6dff40d473b7501e33ae477e13258c73536386b2e31baeb9bbbd7f8109 |

实际Android/JVM生产候选由主验收另行独立运行；此3个旧测试校准不是其替代品。iOS真实工具链、设备/后台/弱网/可访问性及composer端到端/HOL仍未验证。本文只作结构复核，未打开运行GUI中的预览。
