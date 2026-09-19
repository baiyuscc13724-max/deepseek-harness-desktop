# 模型、插件、记忆与提醒全入口审计

状态：**自有源码及最终冻结市场候选BBA2417F通过24文件组244/244，零失败/跳过/取消；候选输出与关键源码哈希前后稳定。未改原安装依赖、未部署运行实例。**

## 范围与结论

本轮不是复验旧provider-v4/MCP案例。先创建十域入口清单，再逐域执行模型设置/目录/凭据、模型路线/准入/计量、MCP、市场/技能、记忆、提醒、搜索、图像桥审查。

- `coverage-models-plugins.json` schema 2：10域、174项operation、870个正常/失败/隔离/并发/恢复cell。每个cell引用已跑fixture或具体缺口原因，不用10个“unverified”总组代替。
- 当前矩阵有218个明确未验证cell、9个关联原安装源缺陷cell；固定候选的修复证据单列于`pinnedCandidate`。剩余包含通过、纯函数不适用及版本不支持，**不能将它们全部当通过率分母/分子**。这是入口证据账，不是174条用户需求完成声明。
- 最终24测试文件去重**冻结候选BBA2417F模式**：**244 tests / 244 pass / 0 fail / 0 skipped / 0 cancelled**。包含真实node:util.parseEnv往返、mixed quote后续普通更新/clear及三项独立事务恢复检查；旧4529/FE/1435/AE均仅为历史，不作最终验收。
- 原安装依赖默认模式仍保留红例：新文件**36 tests / 32 pass / 4 fail**；最终BBA候选同一文件**40/40**（额外4个候选事务/实际dotenv解析检查），属于244项全域回归子集。两模式不混淆，不把未部署说成已上线。其中提醒正式工具、市场正式handler、技能文件安装/移除均使用隔离夹具，无真实插件执行/付费调用。
- 修改六份自有生产源码；未改node_modules，未部署正在运行的1.0.62实例，未发布、提交或重置其他成员脏改动。
- 下述独立记忆隔离事故仍为**outcome unknown**。任何后续绿测不能覆盖或洗白它。

## 测试隔离事故 — outcome unknown，不能用后续通过掩盖

- 2026-09-12约11:49–11:50，首次新增8项测试（作业`pwsh-24`）。
- 精确测试：`memory project writes without workspace reject before capability read or network`。
- 唯一调用：插件`local_memory`，合成payload `{ action: 'remember', scope: 'project', content: 'Synthetic project fact' }`；合成根为`synthetic-root`，session无cwd。
- 原测试错误地期待缺工作区在入口拒绝，却未先替换fetch/清空继承的能力状态文件环境变量。原生产代码在无project作用域时回退personal，**有可能**沿继承能力文件/本地能力端点走到真实服务；源码审查确认该执行路径，未保留运行返回对象，不能确认实际存储结果。
- 观察仅为`assert.rejects`报告`Missing expected rejection`，即execute返回fulfilled。不证明stored成功，也不证明被autoCapture策略拒绝。持久化结果**unknown**，不得描述成“确认没写入”。
- remember仅一次。suggest因前一个assert失败而未执行。没有重试，没有读真实记忆数据库，没有打印能力文件、token、URL或用户记忆，没有擅自删除/修复可能写入。
- 已即时上报总审并单独保留事故。首次8项中第8项不是合格隔离证据；前7项是临时home/fake adapter的独立缺陷复现。
- 隔离整改后先单独通过fixture guard，再继续生产测试：子进程环境allowlist；新测试清除所有HARNESS/DSH变量；默认fetch硬拒绝；fs读写只允许登记的临时fixture根，源码只读限仓库且排除`.release-state`；市场VM使用合成process.env、禁execFile/spawnSync，cp仅在显式inert-skill测试中允许exact临时根。
- 现在缺workspace两种写入的测试明确断言：`readFile`计数增量=0、fake-fetch次数=0；不是“最后会抛错”这种不足的断言。正向记忆scope只使用临时能力JSON+fake-fetch。

## 自有源码修复及证据

| 编号 | 实际缺陷 / 修复 | 新增断言 |
|---|---|---|
| CFG-01 | meter以provider.id缓存/单飞导致跨home及换账号额度串用；改SHA256(home、adapter、provider快照、credential)键，无原始secret入key | 跨home、合成key轮换、并发换账号、同快照单飞 |
| CFG-02 | adapter同步throw发生在inFlight注册之前，清理后又被set造成永久粘住 | deferred Promise注册后执行；失败后能再调用 |
| CFG-03 | 时钟回退把未来meter缓存当新鲜；stale判断只看请求开始时间 | now>=cache.time，失败时重新判过期，auth-required不沿用旧额度；300快照缓存<=256 |
| CFG-04 | 路线写失败只回滚JSON不恢复managed preset，同home并发共享暂存目录/混合状态 | stage/backup/activate及独立回滚；per-home队列；settings/state写失败都恢复原preset字节；6同home+2独立home并发 |
| CFG-05 | 无绝对工作区的project remember/suggest悄然回退personal | 在能力文件读取/网络之前拒绝；个人/project正向scope精确传递；child及非直接人类写入拒绝 |
| CFG-06 | MCP close和pending credential/mount竞态导致迟到客户端在close后出现 | pending starts单飞追踪、closed fence、close await queue/start并dispose；关闭后变更拒绝 |
| CFG-07 | marketplace repositoryIdentity后缀regex接受evilgithub.com、路径/查询伪造 | URL authority精确github.com或严格git@github.com SCP；拒绝端口、密码、query/hash、错误username |
| CFG-08 | search非法numeric HTML entity令String.fromCodePoint抛RangeError | Unicode scalar验证，非法值替换U+FFFD |
| CFG-09 | search先response.text()再测2MiB，流输入可先无界buffer | reader分块计数、达到上限cancel，finally释放lock；不调用text |
| CFG-10 | search结果已截断但truncated恒false | 先完整parse，再slice，按实际数量报告 |
| CFG-11 | search传输异常保留原始cause，可能泄漏代理/认证信息 | 闭合安全错误，不带原始cause；保留WEB_ABORTED语义 |
| CFG-12 | 普通网页fetch委托直接透传原始transport error/cause（和search路径不同） | wrapper await/catch，只保留固定WebError码，不回raw message/cause；独立红例转绿，normal结果原样保留 |

这些修改保留原provider-v4精确凭据隔离、redirect:error、prepared route绑定及既有MCP持久化/cleanup-unknown行为，没有把旧修复计作本轮新交付。

### 已知实现限制

- 路线事务队列只在单进程生效；没有跨进程锁或崩溃恢复journal，外部直接写settings的竞争也没有统一锁。成功状态不能等价为强制kill过程中原子提交。
- meter cache identity包含传入credential/provider快照，但不能宣称间接`secret()`返回值、外部CLI账户变化等未显式进入快照的数据都被识别；profile-change专属变异fixture仍缺。
- MCP close等待正在挂起的mount；永久不settle的外部mount没有新加超时/取消策略。测试证明迟到mount可清理，不证明永不完成的mount能及时close。
- search非streaming兼容mock仍使用text()再测大小；真实标准Response流使用incremental路径。

## 上游市场深审与维护补丁交接

只读来源：`node_modules/dsh-plugin-marketplace/lib/index.js`，包版本**1.5.5**，SHA256：

`F9352630E7FBB6D38647FF2FCF988CEF071648F78166A9C09D65BA42E8AE7699`

未改该依赖文件。最初grep数18混入说明/重复；VM实际`apply`捕获的是**16个不同路由**：

`self-update`、`list`、`skills`、`backup`、`restore/diff`、`backup/webdav`、`restore/webdav`、`logs`、`feedback/pending`、`feedback`、`feedback/token`、`env-keys`、`check-update`、`env-edit`、`install`、`uninstall`。

### 隔离方法及已验证范围

新测试载入完整生产源，仅做import/export和import.meta模块语法适配，注入临时fs/fake fetch/合成process环境及硬拒绝子进程；禁用启动时registry/self-update/env/feedback预热，不修改路由或持久化函数体。正常空列表证据只证明handler投影，不证明外网目录获取。测试明确区分正式handler与fake依赖。

- 16路径PATCH全部405；protected读写拒绝不可信host/origin；敏感写拒绝伪装loopback Host但socket为LAN的请求，拒绝发生在bad JSON读取前。
- backup白名单不含安装绝对位置及未列入的synthetic secret字段；restore diff正确分missing/already；坏JSON/备份schema拒绝。
- env保留DSH_键禁止、换行不注入新.env键；读取只回configured布尔，不回值。反馈token设置/读取/清除只回hasToken；不存在反馈安全no-op。
- check-update拒绝非法repo及被篡改的npm包路径；self-update busy 409；不支持WebDAV scheme拒绝。
- inert临时SKILL.md通过真实`install` handler→文件落临时skills→backup有记录→`uninstall` handler→目录与记录移除，全程无第三方脚本或真实网络。

### 四项真实红例（原安装源仍红；固定维护候选已修复验证）

| 缺陷 | 源码位置 | 红例及影响 | 维护补丁要求 |
|---|---|---|---|
| MP-01 队列名义串行、实际并行 | appendPatchEntry约1424–1450 | async IIFE在queue.then前启动；两个调用同时read，max active=2；可能覆盖/共享.tmp rename冲突 | task改延迟函数并交queue.then(task)；排查saveEnvStore/saveFeedback/saveInstalled/removeInstalled/removePatchEntry同族；恢复/失败不毒化后续 |
| MP-02 WebDAV错误泄漏 | PUT catch约3201、GET catch约3235 | fake传输错误细节原样出现在error和log | 用闭合安全码/通用错误，不保留raw message/cause；GET/PUT都覆盖 |
| MP-03 清空credential没有清.env | applyEnvEdit约234–244，writeDotEnv约194–217 | 从envStore删key后只writeDotEnv(current)，旧.env行保留；UI可显示未配置但重启仍加载旧key | 显式删除目标KEY行；envs.json与.env同一串行事务、stage/backup/rollback；失败不发布新内存状态 |
| MP-04 copy失败丢旧skill | installRepo skill约4039–4040；preset约4066–4067同族 | 先rm已装目录，再cp；注入cp失败后旧SKILL.md为ENOENT | 先stage，备份rename后activate，成功再清备份；失败恢复旧目录；同名所有权冲突需明确拒绝/升级策略 |

精确测试名前缀`upstream marketplace regression`，位于`tests/deep-audit-models-plugins.test.cjs`。基础成员新增固定来源维护transform `scripts/deep-audit-marketplace-patch.mjs#patchMarketplace155Source`。本域以显式`DEEP_AUDIT_MARKETPLACE_CANDIDATE=pinned-maintenance`模式，把相同原生产源经该transform后送入同一VM夹具；不修改业务handler、不改node_modules。

**历史候选（非最终验收）**SHA256：`4529EE53077CD276410DB30FD6444E1DE76BC2BA1C1AC118A068E54D2098637A`。四个原红例全部转绿；相同handler正常/失败/隔离测试仍过。另独立追加三个candidate-only交易恢复检查：env第二文件activate失败恢复两文件原字节且retry成功；env rollback再次失败保留transaction marker并拒绝后续写；skill stage activate失败恢复旧树且retry成功。候选完整24文件**243/243**，输出hash在进程中打印并对每次fixture一致性断言。任何后续候选改变hash必须重跑，不把这份证据套用到另一输出。

**后续候选回归**：基础修复dotenv编码后输出变为`1435B7866E2F0D96DA835ECCBEB50D0F7AC894ABF22513F5AAC5C7629EF4361B`。新独立检查发现合成值同时含起始引号、其它引号和#时，render raw候选可被Node parseEnv还原，却被后续旧值scanner判未闭合，引起后续普通更新/clear恒500。当时244项中仅此失败，回交基础后已在最终BBA候选修复；历史失败仍保留，不用旧绿测覆盖新输出。

**最终独立验收（2026-09-12，作业pwsh-92）**：输出`BBA2417FC236501BADF532C76A85673410C5579A5E54D420565C02E963836BDE`，24文件组244/244、零失败/跳过/取消。mixed-quote自锁、Windows路径/反斜杠/引号/换行往返或无修改拒绝、后续edit/clear、4原始市场红例、3恢复检查均通过。每个fixture断言同输出hash；回归后重新计算输出一致且二次transform changed=false。

前后稳定的文件SHA256：维护helper `621E28486B854C7CF17D02BB537E495D6917D9BF64D70A6B67F4894709AD8242`；web-search `C3F719465F8DCF31CDCAED67323C94AB56077F5C6982C4D135BEFB06051F1B02`；原安装市场仍为上文F935，未修改。

默认模式继续读取原安装source，新文件36项仍有这四个失败，明确证明没有靠原地依赖修改消掉红例。候选证据不证明实际安装adapter/当前运行实例已经接入；该接入归基础成员和总审的最终整合验证。

MP-04同族preset分支属于源码观察，尚无独立preset红例，不把它说成额外已实测缺陷。MP-01其它队列同理，需要后续专属并发故障注入。

## 其它域的实证与诚实边界

### 模型/凭据/路线/准入/计量

- 原79项模型基线全过；保留v4的端点host/path/protocol/port/downgrade变化、custom header隔离、prepared identity、并发路由轮换与安全错误链。
- 模型路线现有15项涵盖catalog本地合并且不读key、官方main权威、继承子路线、首启/无变更/缺preset恢复、base更新及compaction fail-loud。
- 准入现有10项涵盖根身份/循环/长度、FIFO+round-robin、限制、abort/timeout、iterator所有出口release-once、24根burst。
- 实际meter适配器为DeepSeek、Codex、OpenCode Go。OpenAI budget/Anthropic usage是初始清单假设，经源码校正为版本不支持，不伪报通过。
- provider完整create/delete/UI模型编辑、外部OAuth续期、部分跨进程恢复维度仍在矩阵单独标缺口；不是所有设置都已逐按钮验收。

### MCP

- 自有MCP/marketplace服务35项回归全过，前批14个设置恢复案例亦保留。
- 支持stdio与streamable-http，不存在独立SSE创建能力；初始SSE项校正为UNSUPPORTED。
- 密钥接口是env/header reference与configured投影，而不是新增明文secret存储。原测试覆盖引用不泄露、origin/body限制、revision、原子config、committed-save与reload/cleanup失败区分。

### 记忆

- SQLite仅temporary dbPath，测试CRUD/候选审核/作用域/期限、FTS5与LIKE降级、SQL参数化、reject/redact、数量与pack限制、export限制、secure_delete及WAL、重启迁移。
- 新增真正生产tool execute的project/person scope与权限拒绝测试，零真实能力文件/网络。
- 主进程HTTP桥的完整授权和renderer真实审批操作属于跨域胶水，等待交互成员证据；本报告只声明本域service与tool证据。真实用户库明确不查。

### 提醒

- 不只验证Desktop投影：直接导入已装`@deepseek-ai/dsh-schedule`的`registerScheduleTools`，fake session/event log、fake flush、fixed Date.now。
- after、RFC3339 offset、local IANA zone（HH:mm:ss）、every四selector成功，invalid selector/unsafe number/interval/zone拒绝，exact agent与预abort拒绝；20并发create唯一ID。
- persistence preflight失败无append；postflight失败返回uncertain，恢复flush后list找到原id，不重复create。
- Desktop原测试验证full/delta、inherited-prefix/gap回退、ETag304、history与40样本性能。没有实际定时触发模型发送、休眠/唤醒或真实系统时钟回拨验收。

### 搜索与图像

- search四个新红例全部红转绿，现有free provider fallback/search-URL reroute及部署回归通过。
- 新增只读实际`@deepseek-ai/dsh-web-fetch-http`源VM，保持URL、DNS和redirect生产函数，仅替换最底层物理request并注入fake DNS。private literal、mixed DNS answer在transport之前拒绝；同origin redirect重新DNS并拒绝漂移到private；跨origin redirect拒绝并close。这些是实测，不再记为完全未验证；NAT64/IPv6全组合、超时和query批处理仍未在本域全面覆盖。
- 普通网页委托wrapper额外修复原始error/cause透传（CFG-12）；正常结果不变，固定blocked/abort/provider error码保留，敏感假marker不出错链。不能把这些测试扩展为所有web工具/所有网络环境的全覆盖声明。
- image bridge原9项fake-process测试覆盖schema、argv/stdin、terminate+wait、signature/count/dimensions、附件规范化及清理；新增escaped/symlink输入在readBytes前拒绝。未进行真实生成或视觉排版验收。

## 运行记录与重放

| 阶段 | 结果 | 说明 |
|---|---|---|
| 初始模型回归 | 79/79 | 修改前 |
| 首次新增 | 0/8 | 7有效fixture红例+1独立隔离事故 |
| 隔离修复后模型/记忆 | 9/9 | guard先单独通过 |
| MCP/marketplace自有 | 35/35 | 含关闭竞态及authority spoof |
| 搜索修改前 | 0/4 | 四项新缺陷 |
| 记忆/提醒/搜索/图像阶段 | 99/100 | 当时旧版本断言1.0.59!=1.0.60，非本成员修改 |
| 原安装源默认新增文件 | 32/36 | 4上游市场红例，未改node_modules |
| 原安装源历史24文件（HTTP补测前） | 233/237 | 仅上游4红例；旧版本断言已不再失败 |
| 历史4529候选24文件 | 243/243 | 不作最终候选证据 |
| 历史1435候选24文件（含dotenv补测） | 243/244 | 曾发现1项候选自锁缺陷 |
| 最终BBA冻结候选24文件 | 244/244 | 前后hash一致、transform幂等，0fail/skip/cancel |

安全启动方式（每次都使用，不沿用默认继承环境）：默认模式验证未修改安装源，应看到4个市场红例。候选模式在下面launcher的`const r=`之前增加`env.DEEP_AUDIT_MARKETPLACE_CANDIDATE='pinned-maintenance';`，仅固定helper有资格变换源码；终端打印的候选hash才是本次证据身份。

```powershell
node -e "const {spawnSync}=require('node:child_process');const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));const r=spawnSync(process.execPath,['--test','tests/deep-audit-models-plugins.test.cjs'],{env,stdio:'inherit'});process.exit(r.status??1)"
```

完整24个文件以`tests/`及`.test.cjs`补全：deep-audit-models-plugins、provider-meter-service、provider-meter-adapters、model-routing-service、model-admission-runtime、model-admission-plugin-service、audit-provider-isolation、provider-credential-isolation-runtime、model-settings-key-override-runtime、model-settings-key-override、model-settings-credential-validation-runtime、mcp-manager-domain、mcp-manager-runtime、mcp-manager-ui、desktop-mcp-manager-plugin-service、plugin-marketplace-service、audit-settings-recovery、memory-service、memory-censor、memory-ui、desktop-memory-tools-plugin-service、desktop-schedules、desktop-web-search、codex-image-bridge。

注意：早期组合命令末尾`git diff --check`或Get-FileHash可能覆盖子进程退出码，不能以作业exit0称测试通过。本报告读取node test摘要；完整作业均保留`exit $LASTEXITCODE`。原安装源历史回归以4项失败退出1；最终BBA候选244/244以exit0结束，两者来源不同。

## 文件与SHA256

| 自有源码 | 修改前 | 当前（2026-09-12） |
|---|---|---|
| electron/bridge/provider-meter-service.cjs | 63FFEFAF3CB116FD926D3D60C9C77D3A6BACEB39175510093372487C16096493 | C50BC108C2A26EFE9D03956B4B7B9385284BC9363B446F300DEB11418D47554A |
| electron/bridge/model-routing-service.cjs | 1D7198B64BA412ED4DBC35F420F16BA30D5B8F4A82FE27110381979CD1FFAB08 | 2F84FC84EC28DE2E0C539CCAE1F6D337C7AC07EEE0FC1EA00C30B0A5FB9FEE94 |
| plugins/dsh-desktop-memory-tools/lib/index.js | C67737EAC3DC6093600D7ECE69ED6B902D2CBC99C783F3C7BCCE7681BA36E582 | 6D9A5D01E35514DD782DA56F310EA06497C36601AA79651556EE7C7EBF440759 |
| plugins/dsh-desktop-mcp-manager/lib/index.js | B0BBABDD2E43677827A8AB5D45406935E3DE64A933947C991024C13DC8B37E46 | B92A46808F0E82DE235A78E503034948FC4545F8541BF5C792D98DFCE4C98A56 |
| electron/bridge/plugin-marketplace-service.cjs | BC90FB4DDAC09409D333731E51916F2CD93B6926E1CE5B1D8CC5B5F4275FCB23 | 7D68DC3854588D5D642C7F3D8FC923494924DB2D7B4136A7BEDF86CDBE22ABBA |
| plugins/dsh-desktop-web-search/lib/index.js | 86CBA5DF48D97821DF452BC4305141786C6A5C9B71E80A1F0361E29B7F524D4B | C3F719465F8DCF31CDCAED67323C94AB56077F5C6982C4D135BEFB06051F1B02 |

MCP和search修改前已有其他成员/前批脏修改，已保留。新建专属`tests/deep-audit-models-plugins.test.cjs`与这两份报告。矩阵JSON结构/每行五cell/引用有效性检查通过；本域`git diff --check`通过。报告为源码/fixture审计交付，不含运行实例已更新的承诺。
