# neo-trellis

为 Codex、Claude Code 和 Pi 提供可移植的项目知识。AGENTS.md 是通用路由，项目地图在外部；模型按范围读取知识，在正常开发中维护事实、契约和有证据的纠正。

不创建任务状态机，不强制规划文档，不读取私人对话，不自动提交，也不要求用户额外执行 remember / recall。

## 开始使用

需要 Node.js 20 或更高版本，无第三方运行依赖。当前版本 0.1.0 可通过 npm 从 GitHub 安装；npm registry 首次发布尚待完成。

```powershell
# 从 GitHub 的版本标签全局安装 CLI
npm install -g git+https://github.com/Rosatus/neo-trellis.git#v0.1.0

# 在目标项目中执行，按实际使用的平台选择
neo-trellis init --codex --claude --pi

# 或不安装，直接运行本地入口
node C:/code/neo-trellis/bin/neo-trellis.mjs init --codex --cwd C:/code/my-project
```

开发本项目时可用 `npm install -g .` 安装本地版本。首次发布到 npm registry 后，可改用 `npm install -g neo-trellis` 或 `npx neo-trellis init --codex`。

维护者发布：在 npm 账户完成登录（`npm login`）后，运行 `npm publish --access public`。
发布前自动运行检查和测试；`npm publish --dry-run` 可检查发布内容。
包内只包含 bin、src、README、LICENSE、NOTICE 和 package.json，不包含项目会话配置或备份。

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
  legacy.md                       迁移后指向保留的 Trellis 知识
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

1. 在 `.neo-trellis-backups/<唯一标识>/` 备份被替换或移除的文件及目录，保存备份清单；该目录自动加入 .gitignore。
2. 原样保留 `.trellis/spec/`、`research/`、`workspace/`、`tasks/`，通过 `legacy.md` 引用；另外将可识别的 PRD 资料复制到新 PRD 目录，规则见下文。
3. 停用支持平台上的明确 Trellis hooks、skills、agents、命令和 Pi extension，保留其他用户配置。
4. 移除旧 `workflow.md`、`.version` 和 `scripts/` 执行层，安装 neo-trellis 的入口和集成。

PRD 导入包含 `.trellis/tasks/<任务>/prd.md` 和 `tasks/archive/YYYY-MM/<任务>/prd.md`：

- `planning`、`in_progress`、`review` 导入 `prds/active/`；明确 `completed` 或无冲突的历史归档导入 `prds/archive/`。
- 非归档任务缺少状态、状态与归档位置冲突、`task.json` 损坏、没有 PRD 或不支持的归档目录布局，会在预览中说明并保留原位。
- 复制任务资料及二进制附件；常规 Markdown 外部相对链接调整为指向保留的原始资料。代码示例、复杂链接、HTML 和 JSON 中的路径不自动改写，预览提醒核对。
- `prds/trellis-imports.json` 记录来源、初始目标、原状态和内容指纹。它是一次性导入账本，不是当前任务状态表；归档后初始目标可能不再是现址。重复迁移不覆盖已导入内容、不恢复已移动或删除的副本，旧源发生变化时提示手工核对。目标冲突时停止。
- 历史确认和验收均标记为未经迁移验证。迁移不重新 grill、不补造验收、不自动继续旧工作；实际恢复开发时才澄清相关缺口。

**PRD 与 task 不等义。** neo-trellis 只维护 PRD 这一条持久需求与交付记录；执行步骤交给宿主计划/待办，必要的跨会话进度写在 PRD 中。旧 `task.json`、执行上下文作为历史材料保留，不恢复独立 task 系统；没有 PRD 的 task 不强制转成 PRD。长期契约仍放在 modules/spec。

自定义旧脚本也会进入备份；如果其他工具引用这些脚本，应先检查预览并调整调用。仅承诺处理 Codex、Claude、Pi，其他宿主的旧集成需单独处理。清理前验证路径，不跟随符号链接。

应用中的普通文件错误会尝试回滚；断电或进程被强杀无法保证自动回滚，备份仍可用于恢复。恢复时依据备份 `manifest.json`：`existing` 是有原件备份的路径，`paths` 中其余路径是本次新增项。先停止宿主并核对这些路径，避免覆盖迁移后新工作。

迁移保留旧知识原位是刻意选择：自动改写所有历史链接容易损坏依据。后续 agent 在实际接触模块时，将当前有用的契约整合到新模块入口，不需要一次性重写历史。

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
