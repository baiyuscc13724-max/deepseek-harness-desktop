---
name: default-templates
description: "Use when the user asks to start from a default template for a meeting note, report, budget table, project kickoff, landing page, or slide deck. Provides self-made editable Markdown, CSV, and HTML templates stored in this skill's templates directory."
whenToUse: "User asks for a template, a quick start file, a meeting note skeleton, a report outline, a budget CSV, a landing page, or a slide deck without providing their own reference."
---

# 默认模板（Default Templates）

本技能提供一组**自制、可自由编辑**的起步模板，全部位于本技能目录的 `templates/` 下。适合用户"给我一个模板"、"给我个开会纪要模板"、"给我个周报骨架"之类的请求。

## 模板清单（`templates/`）

| 文件 | 用途 | 格式 |
| --- | --- | --- |
| `meeting-notes.md` | 会议纪要（结论、待办、负责人） | Markdown |
| `report-outline.md` | 调研/周报/项目报告大纲 | Markdown |
| `budget-quarter.csv` | 季度预算与支出追踪表 | CSV |
| `project-kickoff.html` | 项目启动页（目标/里程碑/风险） | 单文件 HTML |
| `landing-page.html` | 产品/个人落地页（响应式、无外部依赖） | 单文件 HTML |
| `slide-deck.html` | 演示幻灯片（键盘翻页、无外部依赖） | 单文件 HTML |

## 标准工作流

1. 用 `read` 读取用户选定的模板文件（或询问用户偏好后再读）。
2. 用 `write` 把模板复制到当前工作区（如 `output/meeting-notes-2026-08.md`），**不要**在原模板上改写。
3. 结合用户提供的内容逐节填充：Markdown/CSV 直接用 `edit` 改；HTML 模板里用 `<!-- TODO -->` 标注的区块逐段替换。
4. 验证：
   - Markdown/HTML：用 `read` 复查填充结果，确认无遗留 `TODO`、无语法断层；HTML 可在右栏预览（把文件作为 Markdown/HTML 预览打开）。
   - CSV：用 `pwsh` 执行 `Import-Csv <file>` 确认行列结构正确、字段数与表头一致；无非法引号或多余逗号导致解析失败。
5. 交付：告知用户生成的文件路径；如用户需要其他格式（如把 CSV 转成真正的 XLSX），按对应技能（spreadsheets/documents/presentations）继续。

## 边界与失败处理

- 模板仅为起步骨架：布局、措辞、数据全部由用户内容决定；不要替用户编造会议结论或预算数字。
- 模板文件属于本技能自带资产：可以直接复制、改写、分发，无任何第三方许可限制。
- 若用户想要的是"复刻某个已有文件的样式"，这不是 default-templates 的职责，转交 `template-creator`。
- 若用户提供自己的模板文件，优先使用用户文件，不要用本技能模板覆盖。
- HTML 模板刻意不引用外部 CDN：保证离线可预览、可交付；需要更复杂交互时另建站点（见 `sites` 技能）。