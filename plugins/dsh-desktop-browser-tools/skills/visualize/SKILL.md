---
name: visualize
description: "Use when the user wants charts, graphs, dashboards, or data visualizations from tabular or JSON data. Builds self-contained HTML with inline SVG/Canvas charts previewable in the right sidebar, or exports data-summary tables."
whenToUse: "User asks to visualize data, make a chart or dashboard, turn a CSV into a graph, or needs an explainable diagram from data."
---

# 数据可视化（Visualize）

把表格/JSON 数据变成自包含的 HTML 图表页（内联 SVG/Canvas，无外部依赖，右栏可预览），并附数据摘要表。图表数字严格来自数据，可解释、可复核。

## 触发条件

- 输出/目标是图表、可视化、仪表盘、趋势图、占比图、分布图。
- 需要把 CSV/JSON 数据转成直观图形，或把研究证据表画成图（配合 `deep-research` 的证据矩阵）。

## 工作流

### 1. 数据准备
- 用 `read`/`pwsh` 读取数据：CSV 用 `Import-Csv` 探查列与类型；JSON 用 `ConvertFrom-Json` 探查结构。
- 明确图表类型：时间趋势（折线/面积）、对比（柱状/横向条形）、占比（饼/环形）、分布（直方图/散点）。
- 数据清洗：缺失值、单位、重复行在 `pwsh` 里处理，保留清洗记录。

### 2. 构建图表页
- 用 `write` 生成 `output/chart-<name>.html`：内联 SVG 或 Canvas 自绘（刻度、轴线、标签、图例均由模型根据数据计算坐标，不使用随机布局）；数据以内联 JS 常量或相对路径 `data.json` 提供。
- 每个图表页配：标题、单位说明、数据更新时间、数据来源（若来自某文件）。图例清晰，异常点标注。
- 需要"示意/插画式"配图时用 `image_gen`，但其仅作装饰、不承载数据数值。

### 3. 仪表盘（多图聚合，可选）
- 多图合一页：`output/dashboard-<name>.html`，区块化布局，共享同一份数据源；交互（筛选）仅用原生 JS。

### 4. 验证
- 数据一致性：`pwsh` 复算摘要（总和、均值、最值）并与图表标注对比；对坐标轴刻度抽样核验。
- 预览：右栏打开 HTML 检查图表渲染、溢出、缺失标签；无控制台报错。
- 可访问性：图表旁提供 Markdown 表格摘要（数据权威形式），供无法看图/需要精确数值的场景。
- `grep` 检查页面无外部 CDN 引用与失效链接。

## 边界与失败处理

- 图表数字必须来源于数据：不凭空生成"看起来合理"的数值；数据不足时画"数据不足"占位并说明。
- 不依赖外部图表库/CDN：如需更强的交互图表且环境允许引入本地库，先征得用户同意再下载到 `assets/`。
- 敏感数据：可视化受众未知时默认脱敏（聚合、去标识），并提示用户确认。
- 超大数据集：先聚合/抽样再画图，避免页面卡死；说明聚合口径。