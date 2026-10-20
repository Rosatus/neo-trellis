# CLI 与安装

观察于 2026-10-20：入口为 bin/neo-trellis.mjs，调用 src/cli.mjs。planInstall 生成计划，applyPlan 执行。计划包含 writes Map、removals 数组、notes 数组。

- init 合并 AGENTS/CLAUDE 管理块、SessionStart hook，保留用户其他配置。
- map/modules/spec/research 归项目所有，重新初始化不能覆盖。
- skill/runtime 归安装器管理；manifest 保存哈希，升级遇到用户修改停止。
- migrate 默认预览，--yes 才应用；--dry-run 优先。
- 备份保存所有被替换或删除的原件；普通应用错误恢复原件，断电不保证自动恢复。
- writes 的值可以是字符串或 Buffer；预览与应用通过 contentMatches 按字节比较，防止 PRD 二进制附件损坏或重复写入。

易错点：迁移可能将只有旧管理块的 AGENTS.md 标记为移除。安装器必须把它视为空内容，不能重新读取原文件而复活旧工作流。

验证：test/install.test.mjs 覆盖幂等、配置保留、备份及失败回滚；test/cli.test.mjs 覆盖真实 CLI 初始化与迁移。
