# Trellis 迁移

观察于 2026-10-20：src/migrate.mjs 的 planMigration 只读取并返回计划，不调用 apply，不写备份，不删除文件。

- 只接受原版 Trellis；明确 mini-trellis 标记导致拒绝。
- .trellis/spec、research、workspace、tasks 保留原位，通过 legacy.md 导航，避免破坏历史相对链接。
- src/migrate-prds.mjs 将已识别 PRD 资料额外复制到 prds/active 或 archive；读取 task.json 状态和 archive/YYYY-MM 布局。状态冲突、缺失或元数据损坏时报告并跳过，不猜测完成情况。
- trellis-imports.json 是来源/初始目标/内容指纹的导入账本，不是当前 task 状态。重复迁移跳过已导入来源，保护修改、移动和删除的副本；旧源变化只提示核对。历史验收未经验证。
- PRD 是需求与验收记录，task 是执行单元；neo-trellis 不维护独立 task 系统。旧执行文件仅为历史资料，无 PRD 的任务保留原位。
- 二进制附件通过 Buffer 计划原样复制；常规 Markdown 外部链接指向原始资料，复杂引用需手工核对。符号链接拒绝跟随。
- 停用旧 workflow/scripts 和支持平台的集成；其他宿主通过 notes 提示，不能声称完整迁移。
- JSON 解析失败必须阻止迁移，避免删掉 runtime 后旧 hook 仍执行。
- 不能因为 Trellis 使用了 Pi 通用配置，就删除用户 ./prompts、./skills 或 enableSkillCommands。
- 只删除明确属于 Trellis 的 TOML 键或代理段，保留用户键与注释。

验证：test/migrate.test.mjs 覆盖混合配置、命令识别、符号链接、无写入计划与 mini 拒绝；test/cli.test.mjs 覆盖备份应用。
