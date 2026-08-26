# OpenAI skill source record

Harness Desktop adapts two Apache-2.0 skills from the public OpenAI Skills repository:

- Source repository: <https://github.com/openai/skills>
- Pinned source revision: `49f948faa9258a0c61caceaf225e179651397431`
- Source paths:
  - `skills/.system/imagegen/`
  - `skills/.system/openai-docs/`
- License copies:
  - `imagegen/LICENSE.txt`
  - `openai-docs/LICENSE.txt`

The Harness copies are modified. Their `SKILL.md` files contain prominent modification notices and replace Codex-only execution paths with native Harness tools and security boundaries. Selected reference files are retained as fallback guidance; live official documentation remains the source of truth for time-sensitive claims.

All other skills in this directory are clean-room Harness implementations. They do not copy OpenAI proprietary Browser, Computer Use, Visualize, templates, research, plugin-management, office-artifact, Template Creator, or Sites plugin payloads or service connectors.
