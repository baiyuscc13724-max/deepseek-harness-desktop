---
name: template-creator
description: "Use when the user asks to make a reusable template from an existing file, link, or reference, or to update a previously created personal template. Creates a template skill under the user skill root with SKILL.md plus reference assets."
whenToUse: "User says: make this into a template, save this as a reusable template, or update my template for documents, reports, emails, budgets, pages, or decks."
---

# 模板创建（Template Creator）

从用户提供的参考文件（Markdown/HTML/CSV/图片/已有模板）创建可复用的个人模板技能，写入用户技能根目录，之后可用 `$` 候选直接调用。

## 触发条件

- 用户要求"把这个做成模板/存成模板"、"以后都要用这个样式"。
- 已有 `default-templates` 场景但需要的是**用户专属样式**。
- 更新既有个人模板。

## 工作流

### 1. 采集参考
- 用 `read` 读取参考文件（文档/CSV/HTML/图片路径），提取：结构、视觉系统（配色/层级）、必填槽位。
- 图片参考用 `read_image` 观察布局；没有"文件"只有文字描述时，与用户确认关键样式点。
- 明确可复用部分与一次性内容（如具体人名、数字），槽位用占位符标注。

### 2. 确定存放位置
- 目标根：`$DSH_HOME/skills`（默认 `~/.dsh/skills`）下的 `<kebab-name>/`。
- 命名规则：kebab-case、能表达用途（如 `weekly-report-template`、`invoice-template`）。

### 3. 生成模板技能
- 用 `write` 创建 `<root>/<name>/SKILL.md`：frontmatter（kebab-case `name`、清晰 `description`、`whenToUse`），正文写明"何时使用本模板 + 填写工作流 + 验证 + 边界"。
- 参考资产存到 `<root>/<name>/templates/`（模板本体）与可选 `references/`（样式说明），模板内槽位用 `<!-- 槽位说明 -->` 或 `[待填：...]` 标注。
- 参考为本技能自带的自制资产（或用户明确授权复用的个人文件），不引入任何第三方专有内容。

### 4. 验证
- 用 `read` 走查模板：所有槽位有说明、无用户私密数据残留。
- 干跑：用该模板在 `output/` 生成一份样例（填入示例内容），确认结构可用；`grep` 无残留占位符意外遗漏。
- 目录规范自查：路径为技能根单层 `<name>/SKILL.md`；frontmatter 前 20 行内闭合。
- 提示用户：重启会话或等待监视器刷新后，输入 `$` 可看到新技能；若未见，按 `plugin-management` 技能排障。

## 边界与失败处理

- 只创建个人技能目录：不修改插件包内技能、不写入只读位置（`$DSH_HOME` 缺失时提示设置）。
- 不自动发布/分享模板：分享需用户明确指示，且先检查模板内是否含敏感信息。
- 参考文件不可读（加密、损坏）：如实告知，不猜测内容重建。
- 若用户想修改的模板在我们的插件包内（如 default-templates），说明"个人模板"边界并建议复制为其个人模板后再改。