# neo-trellis 项目地图

无第三方运行依赖的 Node.js CLI，为 Codex、Claude Code 和 Pi 安装通用知识路由、外置项目地图、范围知识与内部维护 skill，并从原版 Trellis 迁移。

## 全局约束

- Node.js >= 20，ESM；使用 `npm test` 验证。
- AGENTS.md 只保留跨项目通用路由，项目事实放在本目录。
- 事实跟随实现，契约约束实现。旧任务设计不自动成为现行规则。
- 安装与迁移先构建计划，再备份并应用；预览不写盘。

## 模块导航

| 模块 | 职责 | 代码范围 | 知识入口 |
|---|---|---|---|
| CLI 与安装 | 参数、终端展示、配置合并、指纹保护、备份回滚 | bin/、src/cli.mjs、src/terminal.mjs、src/install.mjs、src/storage.mjs | [安装](modules/install.md) |
| 项目知识 | 通用路由、维护规则、地图骨架、路径匹配与校验 | src/knowledge.mjs | [知识](modules/knowledge.md) |
| 宿主集成 | Codex/Claude hook、三平台知识与 PRD skill、Pi extension | src/platforms.mjs、src/prd.mjs | [平台](modules/platforms.md) |
| 迁移 | Trellis 识别、旧配置停用、完整归档与依赖检查、知识与 PRD 导入、范围映射、语义整理 skill | src/migrate.mjs、src/migrate-prds.mjs、src/migrate-knowledge.mjs、src/migration-skill.mjs、src/archive.mjs、src/retirement.mjs | [迁移](modules/migration.md) |

路径匹配以 [routes.json](routes.json) 为准；共享约束见 [安全契约](spec/safety.md)。测试在 test/，按模块命名。
