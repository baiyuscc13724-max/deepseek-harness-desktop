---
name: plugin-management
description: "Use when the user asks to install, enable, disable, remove, list, or inspect DSH plugins and skills, manage skill directories, or fix a skill that is not showing up."
whenToUse: "User asks about plugins or skills management, why a skill is missing, where skills live, or how to enable a capability."
---

# 插件与技能管理（Plugin Management）

管理 DeepSeek Harness 的插件（client plugin）与技能（skill）目录：清单、安装、启停、校验与排障。Harness 的技能发现来自本地技能根目录与插件自带的 `skills/` 目录，不依赖任何云端连接器。

## 技能根目录（发现顺序）

| 等级 | 位置 | 说明 |
| --- | --- | --- |
| 项目 | `<项目根>/.dsh/skills` | 随项目仓库走 |
| 项目 | `<项目根>/.agents/skills` | 共享 agents 约定 |
| 用户 | `$DSH_HOME/skills`（默认 `~/.dsh/skills`） | 个人技能 |
| 用户 | `$AGENTS_HOME/skills`（默认 `~/.agents/skills`） | 个人 agents 约定 |
| 插件 | `plugins/<plugin>/skills/<name>/SKILL.md` | 插件自带技能 |

技能文件两种形式：目录束 `<name>/SKILL.md` 或平铺 `<name>.md`；frontmatter 必须含 kebab-case `name` 与 `description`。

## 工作流

### 1. 查看已安装技能
- 用 `glob` 枚举技能根：`**/SKILL.md`；用 `pwsh` 列出 `$env:DSH_HOME\skills`、`~\.dsh\skills`、`~\.agents\skills` 等目录。
- 用 `grep` 批量抽取各 SKILL.md 的 `name` 与 `description` 生成清单。

### 2. 定位某个技能为何不可见
- 检查目录命名是否为 kebab-case；`read` 该 `SKILL.md` 前 20 行，确认 frontmatter 合法（`---` 开头、`name` 与目录名一致、有 `description`、无非法布尔字段）。
- 检查目录层级：技能必须是 `根/<name>/SKILL.md` 单层结构，嵌套 `**/SKILL.md` 不会被发现。
- 检查 YAML 语法：描述里避免冒号+空格、未闭合引号。
- 修复后提示用户：本地技能根默认被监视（Chokidar），新文件通常立即可见；个别场景需重开会话或重启客户端。

### 3. 安装/卸载
- 安装本地技能：用 `write` 在目标技能根创建 `<name>/SKILL.md`（及配套 `references/`、`scripts/`、`assets/`）。
- 启用/禁用：编辑客户端插件配置（`package.json` 的 `dsh` 字段或宿主设置），或按用户操作 Settings → Plugins；本技能不直接改插件二进制。
- 移除：删除技能目录前先与用户确认；用 `pwsh` `Remove-Item` 前先 `Test-Path` 复核路径。

### 4. 校验
- 命令式批量校验（只读）：用 `pwsh` 遍历技能根，断言每个 `SKILL.md` 前 20 行内含 `---`、`name:` 与目录名一致、`description:` 非空；输出不合格清单。
- 输入入口验证：重启会话后输入 `$`，确认该技能出现在候选列表（client 插件通过 `connection.api.skills` 加载）。

## 边界与失败处理

- 只管理本地文件与本地客户端配置：不接触云端插件市场、不下载第三方负载、不绕过宿主安全策略。
- 修改插件本体（如 `plugins/dsh-desktop-browser-tools/lib/`）属于插件开发范畴，不在本技能内直接改，先说明影响面。
- 删除操作必须用户确认；目录不存在时报"未找到"，不要臆造路径。
- 若技能仍不可见且校验全通过：检查是否有同名冲突、路径大小写、以及宿主是否正在监视该根（可引导用户在设置中查看插件状态）。