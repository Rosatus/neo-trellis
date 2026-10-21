# neo-trellis 技术参考

安装和产品介绍见 [README](../README.md)。本文说明路由、知识维护、迁移与恢复的详细规则。

初始化只创建知识骨架，不凭空生成项目事实。重新开启宿主后，让 agent 正常工作，例如：“先基于实际入口和目录建立项目地图，再处理支付模块的问题。”内部 skill 要求逐步建图、按范围读取，而不是扫描整个仓库。

```text
AGENTS.md                         通用路由，不含项目专有地图
CLAUDE.md                         Claude 的同源通用路由（选择 Claude 时）
.neo-trellis/
  map.md                          项目职责导航、少量全局约束
  routes.json                     代码路径前缀到知识的机器可读映射
  modules/                        模块职责、关键路径、局部规则与易错点
  spec/                           跨模块契约
  research/                       可选的证据、实验、决策理由
  legacy.md                       迁移后指向新目录中的知识副本与范围地图
  runtime/session.mjs             自包含的短入口 hook
  manifest.json                   安装平台与受管理文件指纹
```

`map.md` 用于解释结构，`routes.json` 是路径匹配的权威来源。路由更新时同步地图的职责导航，不在 AGENTS.md 复制它们。

```json
{
  "version": 1,
  "routes": [
    {
      "paths": ["src/payments/", "test/payments/"],
      "knowledge": [
        ".neo-trellis/modules/payments.md",
        ".neo-trellis/spec/monetary-values.md"
      ]
    }
  ]
}
```

路径相对项目根目录，使用文件路径或带 `/` 的目录前缀；不使用 glob。全部匹配规则取并集，子模块不会遮蔽父范围约束。知识正文按需读取，不通过 hook 批量注入。

## 知识如何维护

同一份内部 skill 安装到三个平台各自的 skill 目录。它在以下时机工作：进入新代码范围、用户给出明确纠正、验证暴露反直觉边界，以及一轮逻辑修改结束。

- **事实跟随实现：** 路径、职责、依赖变化时更新相关文档。
- **契约约束实现：** 代码与兼容承诺、外部约定冲突时，不能静默改规范迎合代码。
- **教训需要证据：** 记录常见误判、正确行为、适用条件、用户纠正或验证依据。临时命令失败、拼写错误和未经确认的推断不升级成规则。
- **修改后回读：** 核对真实文件与链接，不用“计划更新”或日志代替更新成功。
- **历史不是当前事实：** 研究材料说明当时发生了什么；使用前核对当前适用性。替代旧规则时在旧记录注明已替代及新规则路径。

CLI 不自动运行模型，也不监视每一次文件写入。语义维护由 agent 执行，以下命令提供可核对的辅助信息：

```sh
neo-trellis route src/payments/service.ts
neo-trellis status
neo-trellis doctor
```

`status` 汇总 Git 暂存、未暂存与未跟踪路径并匹配知识。它不是知识新鲜度证明：已提交的变化不在当前 diff 中，路径匹配也不能判定语义是否失效。`doctor` 检查文档链接、路由、安装文件及配置，不能证明知识内容正确。

`doctor`、`route`、`status` 会向上寻找最近的 neo-trellis 项目；`route` 的路径参数始终相对项目根目录。`init` 和 `migrate` 精确使用当前目录或 `--cwd`，不会擅自选择父项目。

## 平台集成

| 平台 | 安装内容 | 行为 |
|---|---|---|
| Codex | `.agents/skills/neo-trellis/`、`.codex/hooks.json` | SessionStart 短导航；遵循宿主的 hook 信任和开关 |
| Claude Code | `.claude/skills/neo-trellis/`、`.claude/settings.json`、CLAUDE.md | SessionStart 短导航 |
| Pi | `.pi/skills/neo-trellis/`、`.pi/extensions/neo-trellis.ts` | `before_agent_start` 提供有界、不会累加的短导航 |

启动时只给出知识入口；compact/resume 提醒重新读取当前相关知识；clear 不恢复旧任务。Pi 通过其扩展事件提供入口，不假装拥有 Claude/Codex 的同名压缩事件。

Codex 可能需要在用户配置启用 hooks、信任项目并在 `/hooks` 批准 hook。CLI 不改用户级配置。`doctor` 仅检查静态配置，不能确认真实宿主已加载或批准。自动加载方式也受宿主版本影响。

任务执行状态、工具结果、会话恢复由 harness 负责；必要的工作交接可以使用宿主持久任务或单独短文档，不能塞进长期 spec。

## PRD skill

三平台均安装 `neo-trellis-prd`，AGENTS.md 的通用路由也指向
`.neo-trellis/skills/prd.md`。收到用户 PRD、产品功能需求，或继续对应 PRD 时使用；普通小修复不强制走此流程。

1. **先 grill：** 自行查证项目事实，按决策依赖分轮询问关键问题，提供建议，等待用户回答。复用已确认的信息，不反复询问。
2. **用户确认：** 展示完整 PRD，包含范围、非目标、行为、约束、可验证的验收标准和未决项。确认之前不把草稿当作开发依据。
3. **正式落盘与开发：** 确认后保存 `.neo-trellis/prds/active/<id>/prd.md`；已有开发授权就继续，仅要求写 PRD 则交付文件后结束。实质需求变更再次澄清确认。
4. **验收后归档：** 逐项记录验收证据，全部满足后将整个目录移动至 `.neo-trellis/prds/archive/<id>/`，保留附件并核对链接。待用户验收或尚未验证时保持 active；取消与替代不冒充完成。

长讨论可选用 `prds/drafts/<id>/prd.md` 保存明确标记的草稿；目录按需创建。
PRD 是需求约定及交付记录，长期规则仍进入 modules/spec。没有独立索引或任务状态机，也不使用 stop hook 猜测需求是否完成。
自动触发依靠宿主 skill 选择及 AGENTS/CLAUDE 路由，实际提问、确认和归档由 agent 执行，不能视为程序强制的审批门禁。

访谈方法参考 [Matt Pocock 的 grill-me](https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me)
及其目前调用的 [grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling)：依赖有序的决策轮次、建议答案、自行查证事实、最终确认。
本实现独立编写并保持自包含，不需要安装上游 skill；不采用其强制子代理或整轮列出所有可问问题的要求。

## 从 Trellis 迁移

仅支持原版 Trellis，不支持 mini-trellis。先查看计划：

```sh
neo-trellis migrate --codex --claude --pi --dry-run
neo-trellis migrate --codex --claude --pi --yes
neo-trellis doctor
```

不传 `--yes` 时 `migrate` 也只预览。迁移会：

1. 在 `.neo-trellis-backups/<唯一标识>/trellis.zip` 完整归档原始 `.trellis/`，验证 ZIP 内容与逐文件 SHA-256，保存 `trellis-manifest.json`。另外备份被替换或移除的宿主配置，保存 `manifest.json`；备份目录自动加入 .gitignore。
2. 将 backend/frontend 及已声明 package 的范围规范复制到 `modules/<范围>/`，其余 spec 复制到 `spec/`，research 复制到 `research/`，workspace 复制到 `history/workspace/`（均在 `.neo-trellis/` 下）。原件进入 ZIP 备份，新副本是后续维护入口。上游 Trellis 通用 thinking guides 与未填写的 spec 模板按内容标记识别，进入 `history/trellis-guides/` 和 `history/trellis-spec-templates/`，不成为现行契约或路由。
3. 停用支持平台上的明确 Trellis hooks、skills、agents、命令和 Pi extension，保留其他用户配置。
4. 安装 neo-trellis 的入口和集成，验证写入、归档与源目录未变。静态依赖检查通过后整体删除 `.trellis/`；有阻碍则保留完整原目录并报告原因。`--keep-trellis` 可跳过归档和删除。不会提前逐项删除源目录中的旧执行文件。

PRD 导入包含 `.trellis/tasks/<任务>/prd.md` 和 `tasks/archive/YYYY-MM/<任务>/prd.md`：

- `planning`、`in_progress`、`review` 导入 `prds/active/`；`completed`、`done`、`complete` 或无冲突的历史归档导入 `prds/archive/`。`cancelled`、`canceled`、`superseded` 也归档，但不视为完成。导入账本记录原状态及规范化状态，原 task.json 不伪造验收结论。
- 非归档任务缺少状态、状态与归档位置冲突、`task.json` 损坏、没有 PRD 或不支持的归档目录布局，会在预览中说明；资料完整复制到 `history/tasks/`，不丢弃、不强行分类成 PRD。
- 不按大小过滤日志和二进制附件。常规 Markdown 相对链接指向对应新副本；现行知识（modules/spec/research）中指向已复制资料的字面 `.trellis/…` 路径同步改写；PRD 和 history 中的历史正文保持原样，只修正 Markdown 链接。Trellis 归档前常用的 `.trellis/tasks/<任务>/…` 会解析到对应 PRD 副本；无法确认的任务路径保持原样报告，不猜测目标。代码示例中的相对链接、复杂链接、绝对路径和非文档文件内容不保证自动改写，需要核对报告及外部引用。
- `prds/trellis-imports.json` 记录来源、初始目标、原状态和内容指纹。它是一次性导入账本，不是当前任务状态表；归档后初始目标可能不再是现址。重复迁移不覆盖已导入内容、不恢复已移动或删除的副本，旧源发生变化时提示手工核对。目标冲突时停止。
- 历史确认和验收均标记为未经迁移验证。迁移不重新 grill、不补造验收、不自动继续旧工作；实际恢复开发时才澄清相关缺口。

**PRD 与 task 不等义。** neo-trellis 只维护 PRD 这一条持久需求与交付记录；执行步骤交给宿主计划/待办，必要的跨会话进度写在 PRD 中。旧 `task.json`、执行上下文作为历史材料保留，不恢复独立 task 系统；没有 PRD 的 task 不强制转成 PRD。长期契约仍放在 modules/spec。

自定义旧脚本也会进入备份；如果其他工具引用这些脚本，应先检查预览并调整调用。仅承诺处理 Codex、Claude、Pi，其他宿主的旧集成需单独处理。清理前验证路径，不跟随符号链接。

应用中的普通文件错误会尝试回滚；断电或进程被强杀无法保证自动回滚，备份仍可用于恢复。恢复时依据备份 `manifest.json`：`existing` 是有原件备份的路径，`paths` 中其余路径是本次新增项。先停止宿主并核对这些路径，避免覆盖迁移后新工作。

恢复源目录时将 `trellis.zip` 解压到一个独立目录，按 `trellis-manifest.json` 核对文件和哈希，再将其中 `.trellis/` 放回项目；恢复旧工作流还需核对独立备份的宿主配置。部分删除失败时程序尝试补回缺失文件，保留已存在内容。旧版迁移曾提前移除部分脚本，因此已有旧备份也必须保留。标准 ZIP 当前不支持 ZIP64，超限会停止而不删除源目录。

`migration/trellis-knowledge.json` 是知识副本的逐文件来源账本；原件变化不覆盖新副本。0.1.0 导入的 PRD 若仍与当时输出完全一致，可自动升级旧链接；已修改、移动或删除的副本保留现状。

`map.md` 列出规范入口，routes.json 增量合并路径映射。优先识别 config.yaml 的普通 block-style `packages/<name>/path` 声明；否则从 index.md 和 directory-structure.md 提取实际存在的路径，明确标记为文档引用、范围待核对。不会仅根据 backend/frontend 名字推断目录。没有证据的规范只列入导航，不伪造路由。已有用户地图、路由及导入地图不会整体重建覆盖；重复迁移只为本次新复制的规范入口追加导航，不会恢复用户已改名或删除的地图条目。已记录的语义审核状态和下一步不会被重置。

旧 workflow、delegation、validation 等执行方法不迁移为现行规则。`migration/trellis-report.json` 记录复制映射、范围依据、缺失副本、残余旧路径、归档位置和实际删除结果。退役检查另外扫描项目代码及配置的字面引用。Git 仓库中只扫描已跟踪和未忽略的文件，以及即使被忽略也会被宿主加载的 AGENTS/CLAUDE 与 .agents/.claude/.codex/.pi 等配置；Git 忽略的构建/证据输出和嵌套仓库（含子模块）不阻止退役。嵌套仓库需在各自仓库内单独迁移。该检查不能证明动态路径或项目外部工具没有依赖；存在这类依赖时使用 `--keep-trellis`。历史记录中的旧路径不是执行依赖。

默认 CLI 输出面向人阅读；自动化脚本应增加 `--json`，读取单个结果对象。`--verbose` 展开文件及提示清单。重定向、`NO_COLOR` 和 `TERM=dumb` 不输出颜色；`TERM=dumb` 或 `NEO_TRELLIS_ASCII=1` 使用纯 ASCII 符号。输出按 PLAN/MIGRATION/PROGRESS/RESULT 分节。

## 更新与验证

重复运行 `init` 可补装平台、刷新未被修改的受管理集成；已有地图和知识不覆盖。受管理文件被本地修改时停止并报告冲突，不提供静默强制覆盖。JSON 配置保留其他字段，AGENTS/CLAUDE 仅替换 neo-trellis 管理块。

```sh
neo-trellis init --codex --dry-run
neo-trellis init --codex
npm test
npm pack --dry-run
```

测试覆盖 CLI 初始化/迁移端到端、配置保留、备份、路由和路径边界，以及真实子进程中的 hook 协议。宿主应用内的交付仍需在实际 Codex、Claude Code、Pi 会话中验证。

## 设计来源与许可

借鉴 Trellis 的持久规范、范围上下文和保留用户配置实践，以及 mini-trellis 的短入口、按需知识、事实/推断区分和写入回读原则。删除阶段状态机、固定代理链、自动日志提交和私人会话解析；实现独立的 Node 运行链。采用 AGPL-3.0-only，见 LICENSE 和 NOTICE。

迁移后的语义整理使用 neo-trellis-migrate skill：CLI 生成正式目录和 map.md 初始入口，skill 核对模块命名、全局契约、旧工作流说明及引用。不建立来源品牌子目录；migration/ 仅保存账本与审核记录。CLI 完成不等于语义审核完成。
