<div align="center">

# neo-trellis

**让 AI agent 快速找到项目知识，把确认过的需求带到交付。**

面向 Codex、Claude Code 和 Pi 的轻量项目知识与 PRD 工作流。

[![npm](https://img.shields.io/npm/v/neo-trellis)](https://www.npmjs.com/package/neo-trellis)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)](https://nodejs.org/)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue)](https://github.com/Rosatus/neo-trellis/blob/main/LICENSE)

[快速开始](#快速开始) · [工作方式](#工作方式) · [PRD 工作流](#从想法到交付) · [从 Trellis 迁移](#从-trellis-迁移) · [详细参考](https://github.com/Rosatus/neo-trellis/blob/main/docs/reference.md)

</div>

## 为什么需要 neo-trellis

模型越来越擅长写代码，但项目里的约定、反直觉边界和用户已经确认的决定，仍需要一个可查证、可维护的存放位置。换一个会话，不应该意味着重新探索整个项目；改过一次的误解，也应该留下能帮助下次判断的依据。

neo-trellis 把这些信息放进项目里的 Markdown 和路径索引，让 agent 按当前工作范围读取、核对和维护。你继续用自然语言描述需求，知识和 PRD 与代码一起留在仓库中。

- **按范围读知识。** 从项目地图找到模块入口，再加载相关约束，减少无目的的全库阅读。
- **让知识跟上变化。** 代码事实变化时更新文档；契约与代码冲突时明确处理，而不是改写契约掩盖问题。
- **记住有依据的纠正。** 把用户纠正、测试发现和非直觉边界写入所属模块，不堆积日记。
- **把需求落实到验收。** 先澄清、确认 PRD，再开发；有验收证据后归档。
- **支持已有项目。** 增量初始化，保留用户配置，也能从原版 Trellis 导入知识和 PRD。

核心由 **两个日常 skill 和一个迁移 skill、轻量宿主入口和一个 CLI** 组成。执行计划、工具调用和会话管理继续由你使用的 agent 宿主负责。

## 快速开始

需要 **Node.js 20+**。无第三方运行依赖。

在目标项目目录执行，选择你使用的平台：

```sh
npx neo-trellis init --codex
```

也可以一次安装多个平台：

```sh
npx neo-trellis init --codex --claude --pi
```

如果经常使用 CLI，可以全局安装：

```sh
npm install -g neo-trellis
neo-trellis init --codex
```

初始化后重新开启 agent 会话，按宿主提示启用或批准集成，然后直接开始工作：

> 先基于实际入口和目录建立项目地图，再帮我修改支付模块的退款逻辑。

初始化创建知识骨架；项目事实由 agent 在实际工作中逐步确认。已有 Trellis 项目请使用下方的迁移命令。

## 工作方式

### 一张地图，按需展开

`AGENTS.md` 保存通用路由，项目地图放在 `.neo-trellis/map.md`，范围映射放在 `routes.json`。进入一个模块时，agent 先读取其知识入口，再查看相关代码。

```text
.neo-trellis/
├── map.md             项目地图：模块、职责与入口
├── routes.json        代码路径 → 知识文件
├── modules/           模块事实、局部约束和经验教训
├── spec/              跨模块契约与稳定规则
├── research/          调研、实验及决策依据
└── prds/              需求与交付记录，按需创建
    ├── drafts/        可选的澄清草稿
    ├── active/        已确认、尚未完成的 PRD
    └── archive/       已完成或明确终止的历史 PRD
```

地图是导航，代码是实现事实，spec 是应当遵守的契约。三者冲突时，agent 应核对并解决冲突；不能仅凭一份文档就认定实现正确。

### 两个日常 skill 和一个迁移 skill，各司其职

| Skill | 何时使用 | 负责什么 |
|---|---|---|
| `neo-trellis` | 进入项目或新代码范围、修改相关实现时 | 按范围加载知识，维护事实与契约，记录有证据的纠正 |
| `neo-trellis-migrate` | 迁移或导入后的整理 | 核对模块边界、全局契约、残余依赖与删除条件 |
| `neo-trellis-prd` | 接收产品需求、继续或完成某个 PRD 时 | grill 澄清、用户确认、正式落盘、验收归档 |

日常小修复不必创建 PRD，也不需要手动调用 remember 或 recall。

### 轻量入口，不批量注入文档

| 平台 | Skill 位置 | 会话入口 |
|---|---|---|
| Codex | `.agents/skills/` | SessionStart hook + AGENTS.md |
| Claude Code | `.claude/skills/` | SessionStart hook + CLAUDE.md |
| Pi | `.pi/skills/` | `before_agent_start` extension + AGENTS.md |

入口只提示知识的位置。Codex/Claude 的 compact、resume 会提醒重新加载相关知识；clear 不自动恢复旧任务。Pi 使用自身扩展事件提供入口。

宿主的信任设置、hook 开关和版本会影响实际加载。`doctor` 能检查静态安装状态，不能代替真实会话验证。

## 从想法到交付

直接把产品需求交给 agent：

> 我想给管理后台增加批量导入用户。请先 grill 澄清需求，确认 PRD 后再开发。

```text
需求 → grill 澄清 → 用户确认 → PRD 落盘 → 开发与验收 → 归档
```

1. **澄清关键决定。** agent 自行查证代码事实，按依赖关系分轮提问，给出建议，等待你的决定。
2. **确认完整 PRD。** 明确目标、范围、非目标、行为、约束和可验证的验收标准。长讨论可以保存草稿，但草稿不是开发依据。
3. **按约定开发。** 确认后写入 `prds/active/<id>/prd.md`。已授权开发就继续；只要求编写 PRD 则交付文件后结束。实质需求变更重新确认。
4. **凭证据归档。** 逐项记录验收结果，全部满足后归档。待验证、待用户验收的需求保持 active；取消与替代明确标记。

**PRD 记录需求和验收，task 记录执行步骤。** neo-trellis 维护前者，步骤和分工交给宿主计划；必要的跨会话进度简短写入 PRD，长期规则进入模块知识或 spec。

## 从 Trellis 迁移

支持**原版 Trellis**，暂不支持 mini-trellis。

先预览，再应用：

```sh
npx neo-trellis migrate --codex --claude --pi --dry-run
npx neo-trellis migrate --codex --claude --pi --yes
npx neo-trellis doctor
```

迁移先将完整 `.trellis/` 压缩到 `.neo-trellis-backups/<本次备份>/trellis.zip`，校验文件清单及逐文件 SHA-256，再导入知识、停用旧集成。导入验证与依赖检查通过后，整体删除 `.trellis/`；不再提前逐项删除其中的旧脚本。

| 旧项目内容 | 迁移结果 |
|---|---|
| spec、research、workspace | 复制到新知识与历史目录，原件存入完整 ZIP 备份 |
| 待实现、进行中或 review 的 PRD | 复制到 `prds/active/` |
| 明确完成或无状态冲突的历史归档 PRD | 复制到 `prds/archive/` |
| 缺少 PRD、元数据损坏或状态不明 | 资料完整复制到 `history/tasks/`，不猜测任务状态 |
| 旧 task 执行配置 | 作为历史资料保留，不恢复任务引擎 |

兼容 `done`、`complete` → `completed`，保留原状态；大日志与二进制附件完整迁移，不按大小过滤。重复迁移不会覆盖导入后修改的知识与 PRD。历史归档不代表重新通过验收，迁移也不会自动恢复旧工作。

原 backend/frontend 与已声明 package 的范围知识进入 `.neo-trellis/modules/<范围>/`，其他 spec 进入 `.neo-trellis/spec/`，research 进入 `research/`，workspace 进入 `history/workspace/`。迁移会生成规范导航和初始代码路由：优先读取旧 package 路径，其他范围根据规范入口及目录结构文档中实际存在的路径建立，并标记为待核对的引用关系。不凭 backend/frontend 名字猜代码目录。

可识别的文档链接和指向已复制资料的项目相对路径会改写到新位置。`.neo-trellis/migration/trellis-report.json` 记录来源映射、范围依据、仍引用旧文件的位置和未覆盖的来源变化。旧 workflow、委派与验证策略不迁移为现行规则。

发现现行知识、项目代码或配置仍引用 `.trellis`，或发现无法检查的符号链接、未处理的平台集成时，完成导入但保留源目录并列出阻碍项。备份后源目录发生变化也会阻止删除。依赖检查是静态检查，无法识别动态拼接路径或项目外部工具；这类项目请使用 `--keep-trellis` 保留原目录。

预览不创建备份或删除文件。ZIP 支持 UTF-8 文件名、隐藏文件及空目录，附带 `trellis-manifest.json`；目前使用标准 ZIP，超过 ZIP64 边界（单文件/归档约 4 GiB 或 65,535 项）会安全停止。较早版本迁移过的项目只能归档当前剩余内容，请同时保留此前的备份。

备份位于 `.neo-trellis-backups/`。自定义脚本引用、复杂跨目录链接和其他宿主的集成需要核对；详见[迁移与恢复参考](https://github.com/Rosatus/neo-trellis/blob/main/docs/reference.md#从-trellis-迁移)。

## CLI

| 命令 | 用途 |
|---|---|
| `init --codex --claude --pi` | 初始化或更新所选平台，至少选择一个 |
| `migrate --codex --dry-run` | 预览原版 Trellis 迁移 |
| `migrate --codex --yes` | 应用迁移 |
| `doctor` | 检查知识链接、路由和安装状态 |
| `route src/payments/service.ts` | 查询代码路径对应的知识 |
| `status` | 将 Git 工作区的变化匹配到知识范围 |

通用选项：`--cwd <目录>`、`--help`、`--version`。安装和迁移支持 `--dry-run`；迁移默认只预览，`--yes` 才应用。

默认输出终端友好的计划、阶段进度和结果摘要，突出备份路径及需要处理的问题；加 `--verbose` 查看完整文件清单。交互终端支持颜色，`NO_COLOR` 或重定向输出时不着色；`TERM=dumb` 或 `NEO_TRELLIS_ASCII=1` 时改用纯 ASCII 符号。脚本应使用 `--json`，成功输出单个 JSON 对象，失败输出含 `error` 的对象并返回非零退出码。

```text
  ◆ neo-trellis · migrate  [APPLY]
  C:\\projects\\my-app
  ────────────────────────────────────────────────────────

  PLAN
    Platforms     codex
    Write         42 files · 96.3 KiB
    Remove        3 old integration paths

  MIGRATION
    PRDs          3 active · 12 archived
    Old refs      0 current · 4 historical
    Source        archive, verify, then remove .trellis

  PROGRESS
  › 1  Archive   Compressing and verifying the complete .trellis source
  › 2  Backup    Saving replaced integrations and configuration
  › 3  Apply     Writing 42 files and retiring 3 old integrations
  › 4  Verify    Checking imported files, archive integrity and unchanged source
  › 5  Retire    Removing the verified .trellis directory

  RESULT
    Changed       46 paths
    Archive       .neo-trellis-backups/<run>/trellis.zip
    Old source    .trellis removed; verified ZIP retained

  ✓ Done.
```

更新 CLI 后，在项目中刷新集成：

```sh
npm install -g neo-trellis@latest
neo-trellis init --codex --claude --pi --dry-run
neo-trellis init --codex --claude --pi
```

已有项目知识会保留。若受管理的 skill 或 runtime 被手工修改，安装器会报告冲突，不静默覆盖。

## 设计边界

知识维护和 PRD 归档由 agent 执行，CLI 不监视每次文件写入，也不保证文档实时正确。技能的确认流程是行为约定，不是程序强制审批门禁。

`status` 用于定位受影响的知识，`doctor` 用于静态检查；它们都不能证明知识内容或验收结论正确。neo-trellis 不读取私人对话、不自动 Git commit、不代替宿主恢复完整会话状态。

## 开发与贡献

```sh
git clone https://github.com/Rosatus/neo-trellis.git
cd neo-trellis
npm ci
npm run check
npm pack --dry-run
```

实现使用 Node.js ESM。测试覆盖初始化、迁移、文件保留、备份回滚、范围路由和宿主 hook 协议。欢迎通过 [Issues](https://github.com/Rosatus/neo-trellis/issues) 提交可复现的问题和使用反馈。

## 致谢与许可

设计借鉴 Trellis 的持久规范与范围上下文、mini-trellis 的短入口与按需知识，以及 [Matt Pocock 的 grill-me / grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) 的需求澄清方法。

采用 **AGPL-3.0-only**。详见 [LICENSE](https://github.com/Rosatus/neo-trellis/blob/main/LICENSE) 和 [NOTICE](https://github.com/Rosatus/neo-trellis/blob/main/NOTICE)。
