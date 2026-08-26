---
name: presentations
description: "Use when the deliverable is a presentation or slide deck: slides, deck, PPT, PPTX, or visual storytelling pages. Builds HTML slide decks previewable in the right sidebar, and exports PPTX when python-pptx is available."
whenToUse: "User asks to create, edit, or polish a slide deck, presentation, or pitch pages."
---

# 演示文稿技能（Presentations）

创建、编辑、校验演示文稿。默认产出单文件 HTML 幻灯片（右栏可预览、键盘翻页、无外部依赖）；环境具备 python-pptx 时导出 `.pptx`。不依赖任何专有演示后端。

## 触发条件

- 输出/目标是 deck / slides / presentation / PPT / PPTX。
- 需要把文档或研究结论转成演示结构。

## 工作流

### 1. 规划叙事
- 确认：受众、时长/页数、重点结论、是否要演讲备注。
- 先搭大纲（标题 → 3–5 个支撑章节 → 行动号召），用户确认后再展开。

### 2. 构建 HTML 幻灯片
- 用 `write` 生成 `output/<name>.html`：按 `default-templates/templates/slide-deck.html` 的范式，
  每个 `<section class="slide">` 一页；内联 CSS 管控布局与配色；图表可用内联 SVG。
- 每页一个核心信息，避免文字墙；用 `edit` 逐页迭代。

### 3. 可选：导出 PPTX
- `pwsh` 探测 `python -c "import pptx"`；可用则运行自制脚本按页面结构生成 `.pptx`
  （标题、项目符号、表格、配图占位），脚本自实现。
- python-pptx 缺失：如实告知并交付 HTML 版本。

### 4. 配图（可选）
- 需要演示配图/示意时用 `image_gen` 生成，存入 `output/assets/`，HTML 引用相对路径。
- 图表类数据严谨内容不交给 image_gen（其不保证数字准确），改用内联 SVG 或表格。

### 5. 验证
- 结构：`read` 检查页序、每页标题唯一、无空白页、无重复要点。
- 预览：右栏打开 HTML，检查溢出（超长文本/图片撑破版式）、字体层级、翻页脚本是否报错（控制台无异常）。
- 一致性：术语、数字、配色在全文一致；`grep` 残余占位符。
- PPTX（若导出）：用 python-pptx（或解包 zip 数 slide 数）断言页数与标题匹配。

## 边界与失败处理

- 不提供专有演示/渲染 API：缺 python-pptx 或 LibreOffice 时说明替代交付。
- 图表必须有数据依据，数字与来源一致；不确定的指标标注"待确认"。
- 演示内容所有权与最终导出格式由用户决定；幻灯片素材（图片）如来自 image_gen 应在页脚或交付说明中标明。