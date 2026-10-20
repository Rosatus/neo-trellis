# 宿主集成

观察于 2026-10-20：src/platforms.mjs 生成自包含 Node SessionStart runtime、平台 skill 和 Pi TypeScript extension。安装后运行不依赖全局 CLI。

- Codex skill 在 .agents/skills/neo-trellis/；Claude 在 .claude/skills/neo-trellis/；Pi 在 .pi/skills/neo-trellis/。
- 三平台的同级 neo-trellis-prd/ 安装 PRD skill；正文源为 src/prd.mjs，通用路由回退入口为 .neo-trellis/skills/prd.md。先 grill、完整 PRD 确认，再正式落盘与执行；满足验收后归档。草稿可选，不等于开发授权。
- PRD 保存在 prds/drafts、active、archive 下，是用户内容，不纳入受管理文件指纹；初始化不覆盖它们。归档是 agent 的语义责任，没有新增 hook 或 CLI 状态机。
- hook 输入 source 才是 startup/compact/clear/resume；hook_event_name 是 SessionStart，不能混用。
- 输出 hookSpecificOutput.additionalContext，只提供入口，不内联知识正文。
- Pi 回调通过 ctx.cwd 找项目，不缓存初始目录，不累加相同入口。
- clear 不自动续接旧任务。compact 恢复项目入口，不等于恢复全部工作状态。

验证：test/platforms.test.mjs 用真实 Node 子进程模拟宿主输入。实际宿主加载、信任与批准状态仍需实际会话验证。
