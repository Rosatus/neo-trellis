# 项目知识

观察于 2026-10-20：src/knowledge.mjs 导出 ROUTER、KNOWLEDGE_SKILL、scaffoldKnowledge、inspectKnowledge 和 routeKnowledge。

- AGENTS.md 不能放项目地图；范围映射在 routes.json，职责说明在 map.md。
- 路由采用路径前缀，不是 glob；全部匹配规则取并集。
- 易错点：最长前缀独占会让子模块覆盖父模块契约。必须保留父级和全局规则。证据：test/knowledge.test.mjs 全局/嵌套路由用例。
- 用户纠正不得扩大适用范围；测试结果、用户确认、推断必须区分。
- 新鲜度需要语义复核，路径存在和 hash 相同不能证明契约仍适用。

骨架不能编造模块事实；agent 有界探索入口后逐步填写。公共 skill 与平台 skill 从同一源文本生成。
