# Trellis 迁移

观察于 2026-10-20：src/migrate.mjs 的 planMigration 只读取并返回计划，不调用 apply，不写备份，不删除文件。

- 只接受原版 Trellis；明确 mini-trellis 标记导致拒绝。
- .trellis/spec、research、workspace、tasks 原件保留；src/migrate-knowledge.mjs 将有用资料复制到新 spec/research/history，legacy.md 指向新副本。旧 workflow、delegation、validation 不承接为现行规则。
- src/migrate-prds.mjs 将已识别 PRD 资料复制到 prds/active 或 archive；兼容 done/complete→completed、canceled→cancelled，保留原值。状态冲突、缺失或元数据损坏的资料进入 history，不冒充 PRD。
- trellis-imports.json 是来源/初始目标/内容指纹的导入账本，不是当前 task 状态。重复迁移跳过已导入来源，保护修改、移动和删除的副本；旧源变化只提示核对。历史验收未经验证。
- PRD 是需求与验收记录，task 是执行单元；neo-trellis 不维护独立 task 系统。旧执行文件仅为历史资料，无 PRD 的任务保留原位。
- 大日志与二进制附件通过 Buffer 原样复制，不按大小过滤。常规 Markdown 链接及指向已复制资料的字面路径转到新副本，未识别引用报告待核对。符号链接拒绝跟随。
- migration/trellis-knowledge.json 记录逐文件来源指纹；新目标冲突时停止，重复迁移不覆盖改动。未改的 0.1.0 PRD 副本可升级链接，已编辑/移动副本保留。
- backend/frontend 和已声明 package 的旧范围规范进入 modules/<范围>/；其他规范直接进入 spec/，research/history 无来源中间层。CLI 保留原范围名称，语义重命名由迁移 skill 确认依据后完成。
- routes 优先读取简单 block-style packages/name/path 声明；其次使用 spec index/directory-structure 中确实存在的路径引用，标为 discovery 而非确证所有权。正式 map.md 直接列出所有入口，不建立 migration 专用地图。
- src/migration-skill.mjs 的 neo-trellis-migrate 在三平台安装，指导一次性语义整理、模块命名、跨模块契约及残余依赖审核；CLI 不把复制成功声明为语义审核完成。
- migration/trellis-report.json 审计迁移资料残余引用与缺失副本，不证明全项目可安全删除 .trellis。原“从不自动删除”行为已被下文 2026-10-21 完整归档方案取代。
- 停用旧 workflow/scripts 和支持平台的集成；其他宿主通过 notes 提示，不能声称完整迁移。
- JSON 解析失败必须阻止迁移，避免删掉 runtime 后旧 hook 仍执行。
- 不能因为 Trellis 使用了 Pi 通用配置，就删除用户 ./prompts、./skills 或 enableSkillCommands。
- 只删除明确属于 Trellis 的 TOML 键或代理段，保留用户键与注释。

验证：test/migrate.test.mjs 覆盖混合配置、命令识别、符号链接、无写入计划与 mini 拒绝；test/cli.test.mjs 覆盖备份应用。

2026-10-21 入口补充：迁移 skill 区分首次导入、导入后整理和只读审计。首次导入先用 CLI 预览，已授权应用则继续 --yes；地图与报告不是首次导入的前提。已有迁移痕迹但报告缺失时先核对账本，不盲目重复导入。只读审计不写整理记录。

2026-10-21 完整归档：用户确认将 .trellis 完整压缩到项目内 .neo-trellis-backups/ 后整体删除，取代旧版逐项移除 workflow/scripts 的方式。planMigration 记录源快照；applyPlan 在任何内容改写前生成 ZIP、清单和哈希并校验，再应用集成和知识写入。retirement.mjs 扫描现行代码/配置引用及知识残余依赖；存在阻碍则保留原目录。删除前重新检查源快照和归档，部分删除失败会从归档补回缺失文件。--keep-trellis 显式保留原目录。标准 ZIP 不支持 ZIP64，超限停止而不删除源。旧版迁移备份仍须保留。外部工具与动态路径无法由静态审计证明安全。

验证：test/archive.test.mjs 覆盖哈希/目录/Unicode/附件恢复、损坏拒绝、源变化阻止、写入回滚、删除失败恢复；test/cli.test.mjs 覆盖默认可读输出、JSON 和真实归档迁移。
