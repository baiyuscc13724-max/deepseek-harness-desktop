---
name: deep-research
description: 'Use when the user explicitly asks for deep research, multi-phase web research, an evidence review, a cited report, or says $deep-research. Do not use for ordinary single-answer questions that one search round can answer.'
whenToUse: "User asks to deep research a topic, compare evidence across sources, reconcile conflicting claims, or produce a cited research report."
---

# 深度研究（Deep Research）

多阶段联网研究：先界定问题，再并行搜集证据，做来源交叉核对，最后产出带引用链接的结论报告。

## 触发条件

- 用户明确要求"深度研究 / deep research"、"多来源调研"、"交叉验证某说法"、"出一份带引用报告"。
- 一般性提问（一次搜索即可回答）不要进入本技能。

## 工作流

### 1. 界定范围并拟定计划
- 明确：问题、受众、结论要支持的决策、时间/地域范围、需要的证据等级、交付格式。
- 用 `todo_write` 建立研究计划（发现 → 追证 → 综合 → 交付），研究中持续更新。

### 2. 分批并行检索
- 用 `web_search` 分批提出高信号查询（每次调用 1–4 条查询），优先主源、官方文档、一手数据。
- 为每个关键论断记录：主张、来源 URL、来源类型（官方/媒体/学术/社区）、置信度、矛盾点。

### 3. 追证与冲突处理
- 对关键主张至少找两个独立来源；发现冲突时再检索"哪一方更可信"并给出裁决理由。
- 用 `web_search` 校验链接可访问性与时效（标注发布日期）；对无法核实的内容明确写"未能核实"。

### 4. 记录证据矩阵
- 用 `write` 生成 `research-findings.csv`（列：claim, source_url, source_type, confidence, notes），
  或 Markdown 证据表；表格再交给 visualize/spreadsheets 技能可视化。
- 证据矩阵保留在工作区，作为报告的附录素材。

### 5. 撰写报告
- 交付 `report.md`（或用户要求的 HTML/CSV），包含：摘要、方法、分节结论（每节带 [来源](url) 引用）、冲突说明、局限性、参考文献列表。
- 引用必须使用真实检索到的 URL，禁止编造来源。

### 6. 验证
- 用 `read` 复查报告：每条结论都有引用、无空泛断言、局限性已说明。
- 抽查 3–5 个引用 URL：用 `browser_control`（或再次 `web_search`）确认可访问且内容与引用一致；失效链接删除或标注"待核实"。
- 用 `grep` 检查残留的"TODO/待补"标记。

## 边界与失败处理

- 预算与时间盒：默认不超过 6 轮检索/追问；用户需要更深入时再续。
- 不替用户伪造证据：找不到可靠来源的就明确说"找不到可靠证据"。
- 付费墙、需登录、非公开数据：说明获取途径，不绕过访问控制。
- 交付物格式由用户决定：默认 Markdown 报告；如需 PPT/表格/站点，转交 presentations/spreadsheets/sites 技能继续。
- 若 `web_search` 不可用或全部失败：先调用 `browser_control` 的 `status`；仅当右栏浏览器可用且已授权时，才用结构化导航/提取继续检索。两条通道都不可用时停止并如实告知，不凭记忆填写“看似合理”的引用。