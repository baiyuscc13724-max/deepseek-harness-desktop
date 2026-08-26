---
name: documents
description: "Use when the durable output is a document: doc, docs, memo, report, letter, meeting notes, Word file, or rich text deliverable. Creates and edits Markdown or HTML documents, exports DOCX when python-docx is available, and verifies via right-sidebar preview."
whenToUse: "User asks to draft, edit, redline, or polish a document, memo, report, or letter; or needs a Word-style deliverable."
---

# 文档技能（Documents）

创建、编辑、审校富文本文档。默认产出 Markdown 或单文件 HTML（右栏可直接预览）；环境具备 python-docx 时额外导出 `.docx`。全部使用 Harness 原生工具，无需任何第三方工件后端。

## 触发条件

- 输出目标是文档/报告/备忘录/信件/纪要/Word 文件。
- 已有 `.md`/`.html`/`.docx` 需要继续编辑、校验或重排版。

## 工作流

### 1. 明确需求
- 确认：文档类型、受众、语气、结构要求、长度、是否导出 DOCX。
- 若用户提到模板，先读 `default-templates` 技能里合适的模板（或用户自己提供的文件）。

### 2. 起草
- 用 `write` 生成 `output/<name>.md` 或 `output/<name>.html`。
- 结构：标题层级、段落、列表、表格；HTML 用内联 CSS 保证离线可预览。
- 内容基于用户提供的信息；不要编造事实、数字或引用。

### 3. 迭代编辑
- 用 `edit` 做定点修改；用 `read` 复查上下文。
- 校对：`grep` 检查错别字模式、残留占位符（`TODO`、`<!-- -->`）、不一致的标题层级。

### 4. 可选：导出 DOCX
- 用 `pwsh` 探测 python-docx：`python -c "import docx"`；可用则调用自制脚本按段落/表格结构生成 `.docx`（脚本读 Markdown 结构，自实现，不依赖任何第三方工件工具）。
- 若 python-docx 不可用，如实告知并交付 Markdown/HTML 版本。

### 5. 验证
- 预览：在右栏以 Markdown/HTML 预览打开生成文件，确认排版与结构。
- 结构校验：`read` 全文走查一遍标题顺序（无跳级）、表格列数一致、链接可访问。
- 一致性：`grep` 统计关键术语出现位置，确认全文术语统一。

## 边界与失败处理

- 不提供专有工件 API：若环境缺少所需库（python-docx、LibreOffice 渲染），明确说明缺失项与替代交付格式，不假装导出成功。
- 敏感内容（隐私、凭证、内部数据）不写入文档；需要脱敏时先咨询用户。
- 用户提供的 `.docx` 无法直接编辑时（无解析库），转成 Markdown 工作副本进行编辑，再说明格式差异。
- 文档的最终所有权与去向由用户决定；默认写入工作区 `output/` 并报告确切路径。