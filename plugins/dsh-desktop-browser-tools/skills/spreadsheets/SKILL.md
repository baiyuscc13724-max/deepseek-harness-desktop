---
name: spreadsheets
description: "Use when the durable output is a spreadsheet, table, or workbook: CSV, TSV, or XLSX data analysis, budgets, trackers, comparisons, or formula calculations."
whenToUse: "User asks to create, edit, analyze, or visualize tabular data; needs a budget, tracker, comparison table, or calculations spreadsheet."
---

# 电子表格技能（Spreadsheets）

创建、编辑、分析带结构的数据表。默认产出 CSV/TSV（右栏 CSV 预览），环境具备 openpyxl 时导出 `.xlsx`（含公式）。全部基于 Harness 原生工具与开源库，不依赖任何专有工件 API。

## 触发条件

- 输出/目标是 spreadsheet / 表格 / workbook / CSV / 预算表 / 追踪表 / 对比表。
- 需要对已有表做筛选、聚合、公式计算或可视化。

## 工作流

### 1. 明确结构
- 确定列 schema、数据类型、公式需求、输出格式（CSV 或 XLSX）。
- 数据缺失时先用 `read`/`pwsh` 探查源文件（CSV、JSON、日志、剪贴板文本），不要臆造数据。

### 2. 创建/编辑
- CSV/TSV：用 `write` 编写（UTF-8，表头即第一行）；用 `edit` 增量修改。
- 公式与复杂表：用 `pwsh` 探测 `python -c "import openpyxl"`；可用则运行自制脚本构建 `.xlsx`
  （单元格、数字格式、公式如 `=SUM(B2:B10)`、条件样式基础列宽），脚本自实现。
- openpyxl 缺失时：用 CSV + 在交付说明里给出公式建议，不冒充生成 xlsx。

### 3. 分析
- 用 `pwsh` 的 `Import-Csv` 做聚合（`Group-Object`、`Measure-Object`）生成结论表；
  或脚本计算后回填。
- 保持可审计：公式/汇总逻辑写入表或随附说明，不隐藏计算过程。

### 4. 可视化（可选）
- 简单图表：交付含内联 SVG/Canvas 的 HTML 预览页（见 `visualize` 技能），右栏预览。
- 数据源与图表页同目录存放，路径在交付时说明。

### 5. 验证
- CSV：`pwsh` `Import-Csv <file>` 断言列数与表头一致、行可解析；检查引号/逗号转义。
- XLSX：`pwsh` 用 openpyxl（若可用）重开文件，断言 sheet 名、关键单元格值、公式无解析错误；或 `python -c "import openpyxl; wb=openpyxl.load_workbook(f); ..."`。
- 数值抽查：对求和/平均等结论手工复算 2–3 个样例，防止公式错位。

## 边界与失败处理

- 不依赖专有编写库：openpyxl 缺失即止，明确说明替代路径（CSV 交付、用户本地打开方式）。
- 大文件（>5 万行）：先询问是否全量处理，默认抽样分析与分块脚本。
- 敏感数据（财务、个人）只在用户授权范围内处理，输出前提醒脱敏。
- 二进制 `.xls`（旧格式）无法解析时：说明并请用户另存为 `.xlsx` 或 CSV。