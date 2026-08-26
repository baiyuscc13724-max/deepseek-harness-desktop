---
name: pdf
description: "Use when the task targets PDF files: read, create, inspect, extract, fill forms, or verify PDFs where layout fidelity matters. Uses Poppler rendering plus reportlab/pdfplumber/pypdf when available, and reports honestly when they are missing."
whenToUse: "User asks to create a PDF, extract text or tables from a PDF, review PDF layout, fill a PDF form, or convert content to PDF."
---

# PDF 技能（PDF）

创建、读取、提取、校验 PDF 文件。本技能为独立撰写实现，仅依赖开源工具链：Poppler（`pdftoppm`/`pdfinfo`）渲染、`reportlab` 生成、`pdfplumber`/`pypdf` 提取与表单；不依赖任何专有工件库。

## 触发条件

- 输出/目标是 `.pdf`，且视觉布局相关（报告、表单、票据、手册）。
- 需要从 PDF 提取文本、表格、元数据，或校验既有 PDF。

## 工作流

### 1. 环境探测（必须第一步）
用 `pwsh` 检测可用工具并如实记录：
```powershell
python -c "import reportlab, pdfplumber, pypdf; print('py-ok')"
Get-Command pdftoppm, pdfinfo -ErrorAction SilentlyContinue | Select-Object Name
```
缺失项决定后续路径，不可跳过探测直接声称"已渲染"。

### 2. 创建 PDF
- 首选：用 `write` 编写 Markdown/HTML 内容 → 用 `pwsh` 调用 LibreOffice（若安装）：
  `soffice --headless --convert-to pdf --outdir output input.html`
- 备选：用 `pwsh` 运行自制 Python 脚本（reportlab）按文本/表格结构排布生成 PDF。
- 兜底：无任何工具时，生成结构化 Markdown 交付并明确告知无法出 PDF。
- 输出路径固定写入 `output/`，文件名稳定。

### 3. 读取 / 提取
- 文本与表格：`pwsh` 运行 `pypdf`/`pdfplumber` 提取，表格导出为 CSV 供进一步分析。
- 元数据：`pdfinfo`（或 `pypdf` reader.metadata）获取页数、标题、作者、加密状态。
- 布局申诉：渲染可疑页面为 PNG 后用 `read_image` 检查。

### 4. 表单填充（若适用）
- 用 `pypdf` 枚举 `reader.get_fields()`；区分"外观流显示值"与"AcroForm 字段树真实值"，两者必须一致才算填好。
- 默认保持可交互；只有用户明确要求时才 `flatten`。
- 已签名 PDF 不做破坏性扁平化，先征得同意。

### 5. 验证
- 文件魔法头：`pwsh` 读取前 5 字节必须为 `%PDF-`。
- 页数与结构：`pdfinfo`/`pypdf` 统计页数、每页对象完整性；空白页标记并复核。
- 视觉：`pdftoppm -png -r 100 in.pdf out` 渲染全部或抽样页，用 `read_image` 人工/自查对齐、裁切、文字溢出。
- 提取回环：从生成结果重新提取文本，确认关键字段未丢失。

## 边界与失败处理

- 工具缺失：报出缺失项与安装途径（pip/包管理器），交付替代格式，不伪造成功。
- 加密/权限受限 PDF：若无法读取，如实说明，不尝试绕过口令。
- OCR 场景（扫描件无文本层）：若环境无 OCR 引擎，说明局限并建议用户提供文本层 PDF。
- 大文件：先 `pdfinfo` 查页数，超过合理范围先询问用户，不全量渲染。