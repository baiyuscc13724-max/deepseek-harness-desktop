# 运行、存储、网络、升级与 Desktop 授权桥深审

日期：2026-09-12。状态：源码修复及隔离回归已完成，提交总审验收；**不是已安装 1.0.62 实例修复或正式发行通过证明**。

## 范围与保全

维护检出为 `release-v1.0.28-worktree`，先确认 pwd 并读取其 AGENTS。未修改旧队 `plugins/dsh-agent-teams`、用户配置、已安装运行时或 node_modules；未执行发布、签名、安装、真实清理、真实进程终止。测试只使用临时目录、synthetic 内容、随机本地 pipe、假对话框/加密器/网络，bootstrap 以 VM+fake Electron 运行。发行测试中的下载、启动也是显式替身，不运行真实安装器。

修改前已保存 TEMP 下 `dsh-base-audit-20260912-194551`：完整已有 tracked diff、status 与共享 patch 脚本副本。已有大量脏改未丢弃/提交/重置；其他成员原有未跟踪文件保持原位。共享脚本前置 SHA256 为 `856D57B3667985ED38B619BD51943A76BB6E4F2699AB2FA57C3F99A85018C3EE`。`28A785…0207` 是 provider **v4 输出产物** hash，不是脚本 hash；已更正初期台账误标。

结构并行评估发现存储、升级、网络三个独立域，首次扩展请求被容量门槛拒绝（需3空槽、可用1）；按总审要求保持原 scope 串行覆盖，不做隐藏委派。后补 scripts 只读入口归类，不将读边界当成全 scripts 写权限。

## 完整入口清单与证据分层

`coverage-runtime-storage.json` 列七域源码文件及36项稳定ID功能证据，分别标记pass/fixed/blocked/unverified与证据级别；包括正常/失败/并发/隔离/Windows路径检查及未知项。另外逐一归类当前全部 **100 个 scripts 文件**，专属测试验证无遗漏、无重复。

**入口有归类不等于每个函数每条分支已经动态覆盖。** 台账明确区别：真实源码执行的 fixture、源契约断言、只读入口归类、禁止实机操作。尤其资源制作脚本归其他成员专业域，live CDP/设备诊断脚本仅列入口，未冒称运行通过。

| 域 | 核对入口 | 验证与结果 |
|---|---|---|
| 启动/运行 | bootstrap、distribution、DSH目录/解析、生成profile恢复、runtime缓存/代理/URL/cookie、自检 | 路径/缺失依赖/并发缓存/认证隔离既有fixture；新增缓存发布竞争和版本输入；真实bootstrap VM证明坏组件记录仍可加载bundled入口 |
| 网络/进程 | local IPC、process tree/spawn、CONNECT、EasyTier、capability broker | 既有Windows pipe/Unicode路径/mock进程/双向TCP/队列TTL边界；新增IPv6端口/CRLF拒绝、缓存内容损坏重验 |
| 存储 | scanTree/scanHarnessData/scanCacheOnly、preview/plan/apply、maintenance、renderer入口 | 既有扫描预算、符号链接/规范路径身份漂移、受保护子树、旧runtime、过期/显式确认/新候选、shadow/rollback、大树延迟fixture通过 |
| 组件 | signed contract/ZIP/index、resolver、store所有状态变更、helper/health/service | 原hash/签名/来源与不可变版本门槛不变；新增跨实例写锁、崩溃中断恢复、首次升级回baseline、EACCES/坏JSON保留 |
| 桌面升级 | feed/manifest/download/fallback/launcher/summary | HTTPS/重定向、hash和长度、平台参数、幂等安装入口契约、版本比较通过；不启动真实安装器 |
| PR预览 | 配置、signed发现、队列、accept/defer、activation、统一更新UI | 默认关闭无网络、128项有界、过期/篡改拒绝、镜像fallback、显式接受、健康回退、source/opaque UI契约通过 |
| Desktop授权 | authorization/secret/session-launch/plugin-install服务 | 原token/绑定/TTL/epoch/replay/原子事务故障/跨实例/unknown恢复全保留；新关闭取消和半帧连接边界通过 |
| 发行/构建 | package scripts→release-publish/release-android→云阶段→镜像→stable，构建/密钥/preview辅助入口 | 已读 AGENTS、RELEASING、主发行/构建/组件helper入口；发行选择、阶段身份、18资产、Android scope等隔离契约通过；禁止真实CLI与副作用 |

## 新缺陷、红测与修复

### R1 授权关闭后仍接受晚到人工结果（高）

旧 `close()` 清token但没有取消正在等待的 native dialog；UI结果晚到仍更新 consumed 状态，能够在关闭后完成授权。新fixture在showMessageBox进入后close再返回response=0，旧实现revision由1变2（红）。

修复 `agent-teams-authorization-service.cjs`：排队执行前、获得状态锁后、人工结果后检查closed；关闭主动取消等待者；复用同一closePromise；等待授权队列收束；销毁已接入socket。绑定/epoch/直接人工授权策略未放宽。

### R2 半帧IPC使关闭无限等待

secret桥没有记录socket，已连接但不发newline会让server.close永不完成。初稿测试仅等setImmediate不可靠；改为**第二条完整请求获得响应**作为服务已处理连接的屏障后，旧secret测试在500ms上限失败。修复secret和authorization桥维护socket集合、关闭销毁和30s空闲期限。关闭是撤销而非人工同意。

### R3 组件CAS读写分离（高）

旧 `writeState` 的read/check和atomicWrite间可被另一store实例穿透。fixture将A写入卡在atomicWrite内，B仍能成功提交；两个请求均成功（红）。

修复 `component-update-store.cjs`：所有状态mutation（含pointer副作用）共享根目录wx锁；AsyncLocalStorage仅允许本次操作内部重入，锁包含read/check/pointer/state完整过程。5秒有界等待，不偷取疑似遗留锁。强化回归使用A=1.0.2/B=1.0.3，断言B的确切阶段冲突错误及最终pending仍属于A，不把任意权限错误算CAS成功。

### R4 pointer发布中断绕过健康确认；首次升级无旧组件时无法回退（高）

旧 `prepareComponentActivation` 对applying直接use-current。若pointer写入成功而state写入前崩溃，重启可能直接加载未确认candidate；fixture写出该窗口，旧值为use-current（红）。首次从bundled升级时lastKnownGood=null，原rollback直接抛“没有可用的上一健康版本”（红）。

修复health对applying/rollback-required优先完成回退；store允许null表示合法bundled baseline，移除current pointer并完成failed状态。正常升级/首轮健康确认/连续启动回退既有测试均保留通过。

### R5 磁盘错误或损坏JSON被当成“没有更新状态”

旧get对EACCES/坏JSON/未知schema都静默idle，pointer异常也静默null，可能在后续操作覆盖恢复证据。新fixture的EACCES未被拒绝（红）。修复仅ENOENT允许默认；其余保留原文件并报错，normalizeState不再用idle掩盖不合法记录。

总审要求避免因此让整个桌面无法启动：bootstrap现把最早state/pointer读取也纳入fallback；异常**只使用null pointer选择随应用安装的bundled shell**，不信任坏pointer，不在catch重新读坏store，不重写坏文件。whenReady发原生恢复提示，仍阻止不可信增量操作。真实bootstrap VM回归修复前app.exit=1（红），修复后exit=0、bundled入口加载1次、提示1次、坏state/pointer字节完全不变。这里只证明bootstrap控制流；没有声称点击真实设置面板已验收。

### R6 runtime缓存竞争删除另一进程产物

旧commit在readiness检查后`rm(cacheRoot, recursive)`，可删除刚被另一进程发布的缓存；VM假FS精确构造竞争窗口，旧实现确实删除winner（红）。修复只使用rename发布，不删除共享目的目录；已有非空坏缓存明确失败而不擅自清理。暂存使用UUID，发布前检查bin/marker，失败只清本次暂存。appVersion先拒绝路径形式，防止版本字符串改变缓存位置。

### R7 CONNECT IPv6端口与头注入边界

旧IPv6分支接受0/65536且不验证IP；targetHost直接进入CONNECT/Host头。无网络VM fixture复现。修复严格port 1..65535、IPv6验证、host字符限制、timeout上限及IPv6 authority加括号；拒绝CRLF和非法输入在创建server之前。既有双向TCP实loopback fixture通过。

### R8 EasyTier仅信版本元数据，不检查缓存字节

安装后将fake exe写为corrupt，旧installer仍返回此文件（红）。修复记录并复核每个已验证文件hash；旧无fileHashes记录需重新取得固定archive hash验证后重建。发布用唯一暂存、跨实例wx锁、文件rename替换和metadata最后atomic rename，不再先rm当前文件。这里只提供内容损坏检测；metadata并非新的签名信任根，未将本地可写hash表宣称抵御同权限恶意用户。

### R9 共享runtime安装writer直接截断目标

新 `deep-audit-runtime-patch.mjs` 提供：固定目标独占wx锁、regular-file检查、已读原字节复核、临时文件fsync、再次复核后rename、失败清自身临时文件、不删除其他writer锁。

已实际接入 `patch-official-runtime.mjs` **31个标准writer以及1个image/queue组合writer，共32处**。原入口对package身份、version、完整input/output hash与精确anchor的门槛保持不变；并非放宽后只测helper。少数旧alpha/复合分支仍保留原writer，未宣称全部分支事务化。跨文件是一文件一个原子提交，保持官方/完整产物重放；不是跨文件数据库事务，也不保证对不遵守锁的外部编辑器提供操作系统级CAS。

生产胶合fixture：只读当前v3原产物→复制temp包→调用真实`patchInstalledProviderAuthIsolation`→精确v4→二次changed=false→加入漂移后拒绝且不覆盖；原node_modules字节保持不变。

- v3合法旧输入：`2171F31250C0970D1CC9A9733A241364306D99146E5BAEC8D0775066D7AE3388`
- v4输出：`28A7850E44BC24CDD0E5E7222EB0FE655877D1433DB59F8FF435934528BA0207`
- official/v1/v2精确允许项仍保留；本轮新生产迁移回归只实际验证v3→v4，不能外推其他历史输入都被重测。

## 测试记录

专属新增文件：`tests/deep-audit-runtime-storage.test.cjs`。既有测试文件未由本成员修改。

1. 修改前33套服务回归：**249/249，0skip**，21.05s。
2. 新首批红测7项：3通过4失败；改进接收屏障/写入屏障后8项：4通过4失败，明确补获secret半帧和CAS/cache红证。
3. 首批修复相关：**55/55**。
4. 官方patch/组合+TCP+当时专属：**52通过/3旧alpha.2条件skip**，0失败。另有直接对真实node_modules调用installer的1个测试被命令过滤，未算运行通过。
5. 综合42文件矩阵（最终磁盘/bootstrap补充前）：**372项，369通过、3旧alpha.2条件skip、0失败**，29.43s。除上项真实installer，还过滤3个会执行发行/审计CLI的测试；未运行真实publisher，过滤项不算通过。
6. 磁盘/脚本清单红测：EACCES未拒绝失败，100脚本清单通过。bootstrap恢复红测：原app.exit1失败。
7. 最后相关6文件：`node --test --test-concurrency=2 tests/deep-audit-runtime-storage.test.cjs tests/component-update-contract.test.cjs tests/component-update-helper.test.cjs tests/component-update-service.test.cjs tests/pr-preview-update-service.test.cjs tests/network-component-service.test.cjs` → **53/53，0skip**，其中专属16项。
8. 已修改tracked源码 `git diff --check` → 退出0。未跟踪新增文件另靠实际Node测试和JSON解析验证，不把diff --check误当覆盖。

综合矩阵使用`--test-concurrency=2`。过滤表达式：`installed alpha.5 MCP client and Goal tool|one publisher command exposes|publisher fails closed unless the desktop manifest|the real release audit`。具体运行文件覆盖台账七域全部既有主服务测试，以及storage/component/preview UI契约、desktop-release-contract、release-publisher、official-runtime-patch及composition。

## 最终源码 SHA256

| 文件 | SHA256 |
|---|---|
| electron/bootstrap.cjs | 4406CA5310B37C3B9FEC17C6FB8CF031FDBEDCDE0CABBC38780C86E85A6132D3 |
| electron/bridge/agent-teams-authorization-service.cjs | 625CFC089FB171AB38D0935D89DB856728D7A60BB0530F1411B099E7D041D3E4 |
| electron/bridge/agent-teams-secret-service.cjs | 6F9471AD0F7B1FC05CB182364FAFB7CB92A2234C2B4E9DA6B2729E9448974CB3 |
| electron/bridge/component-update-health.cjs | 86C4B5888B79CA9EBAE24BE7477D8B3E45E4B898BF22DEF47A54217B511B8DF0 |
| electron/bridge/component-update-store.cjs | 666CBADAF50B5A79CCBA0D5FC2B905054DD332F1E6F8A89FC759E4C29C1000B1 |
| electron/bridge/runtime-bundle-service.cjs | 05359B90B359E553EF23546E8EF849C48BEBEE71DED30CFEFF9DDD87C83E3BDA |
| electron/bridge/tcp-connect-bridge.cjs | 6BDFFD2AFA40DE3D907941F595C4F3A407A02BC60A50BB0CF7473A9A334284E4 |
| electron/bridge/network-component-service.cjs | BA7586823599EFE5E646F72A7455C24A1E9889B07C491F8198A5556BB54EA327 |
| scripts/patch-official-runtime.mjs | C7538F7891886F11B2E45CB200C4CBD0B589952E549B994BCECD24367AB98123 |
| scripts/deep-audit-runtime-patch.mjs | A455DB7B33ACA7113E1580DBEADFC03DFD5C0C1FB5263F8678779F9D6ED9BA14 |
| tests/deep-audit-runtime-storage.test.cjs | D2145143093DA75005E441E17C13A232596B8934A4F128A65926EF097FE77144 |

## 明确限制/后续验收

- 存储apply当前**有意拒绝**：Node/Electron无可信跨平台exact-object递归删除原语。未为了“清理成功”解除保护，也未把零删除称为释放空间。
- stale wx锁不自动窃取；跨进程崩溃后需有证据的人工/专用恢复。真实断电、系统权限/杀毒占用、macOS/Linux原生语义尚需独立平台验证。
- 网络组件多文件替换不是目录级整体事务；运行中旧exe/driver的系统行为未模拟。缓存hash表只能检测内容不一致，不替代archive固定hash/签名和文件系统访问控制。
- runtime坏缓存不再自动删除重建：这是保护正在运行实例的明确取舍。后续可以设计独立版本repair目录及有证据的停机恢复，不能在本会话清理真实cache。
- 问答卡同意未被当direct-human、message admission timeout、selected-team wait返回attention的问题，不在Desktop桥里转换人工来源或改当前队状态。已向总审说明plugin/runtime版本边界，并由旧队恢复成员承接。当前未提供这些在线现象已修的证明。
- 本轮不测真Electron设置交互、不触真safeStorage钥、不接付费API、不跑真实更新/发布/签名/删除。源码断言和mock不能替代正式发行验收。
- 所有100 scripts均归类，但其中live诊断和资源制作入口仅归类；完整逐函数动态证据不具备，不能将清单计数当成全面验证率。
