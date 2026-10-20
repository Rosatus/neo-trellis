import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { planMigration, hasLegacyIntegration } from "../src/migrate.mjs";

const roots = [];
function tmp() {
  const dir = mkdtempSync(path.join(tmpdir(), "neo-migrate-"));
  roots.push(dir);
  return dir;
}
process.on("exit", () => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function put(root, rel, content) {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** Minimal but representative classic Trellis install. */
function makeTrellis(root) {
  put(root, ".trellis/workflow.md", "# workflow\n");
  put(root, ".trellis/.version", "0.6.14\n");
  put(root, ".trellis/scripts/x.py", "print(1)\n");
  put(root, ".trellis/spec/backend/index.md", "# backend spec\n");
  put(root, ".trellis/research/topic.md", "# notes\n");
  put(root, ".trellis/tasks/01-foo/prd.md", "# prd\n");
  put(
    root,
    "AGENTS.md",
    [
      "# My project",
      "",
      "<!-- TRELLIS:START -->",
      "# Trellis Instructions",
      "This project is managed by Trellis.",
      "Managed by Trellis. Edits outside this block are preserved.",
      "<!-- TRELLIS:END -->",
      "",
      "user content stays",
      "",
    ].join("\n"),
  );
  return root;
}

test("basic plan removes runtime, keeps knowledge, writes legacy index", () => {
  const root = makeTrellis(tmp());
  const { writes, removals, notes } = planMigration(root);

  assert.ok(removals.includes(".trellis/workflow.md"));
  assert.ok(removals.includes(".trellis/.version"));
  assert.ok(removals.includes(".trellis/scripts"));

  // knowledge preserved: no removals inside spec/research/workspace/tasks
  for (const r of removals) {
    assert.ok(
      !/^\.trellis\/(spec|research|workspace|tasks|agents)/.test(r),
      `unexpected removal ${r}`,
    );
  }

  const agents = writes.get("AGENTS.md");
  assert.ok(agents);
  assert.ok(!agents.includes("TRELLIS:START"));
  assert.ok(agents.includes("# My project"));
  assert.ok(agents.includes("user content stays"));

  const legacy = writes.get(".neo-trellis/legacy.md");
  // real relative links so agents can navigate to legacy sources
  assert.ok(legacy.includes("[`.trellis/spec/`](../.trellis/spec/)"));
  assert.ok(legacy.includes("[`.trellis/tasks/`](../.trellis/tasks/)"));
  // old spec stays authoritative until superseded — not demoted to history
  assert.ok(legacy.includes("still authoritative"));
  assert.ok(legacy.includes("supersedes"));
  assert.ok(notes.some((n) => n.includes("Trellis evidence")));
});

test("claude settings: only trellis hook entries removed, user hooks kept", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".claude/settings.json",
    JSON.stringify(
      {
        env: { FOO: "1" },
        hooks: {
          SessionStart: [
            {
              matcher: "startup",
              hooks: [
                {
                  type: "command",
                  command: "python3 .claude/hooks/session-start.py",
                },
                { type: "command", command: "python3 .claude/hooks/mine.py" },
              ],
            },
            {
              matcher: "compact",
              hooks: [
                {
                  type: "command",
                  command: "python3 .claude/hooks/session-start.py",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    ),
  );
  const { writes } = planMigration(root);
  const out = JSON.parse(writes.get(".claude/settings.json"));
  assert.equal(out.env.FOO, "1");
  const groups = out.hooks.SessionStart;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].matcher, "startup");
  assert.equal(groups[0].hooks.length, 1);
  assert.equal(groups[0].hooks[0].command, "python3 .claude/hooks/mine.py");
});

test("hook scrubbing does not match path mentioned inside a command arg", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".codex/hooks.json",
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'echo "docs at .codex/hooks/inject-workflow-state.py" && true',
              },
              {
                type: "command",
                command:
                  "python3 -X utf8 .codex/hooks/inject-workflow-state.py",
              },
            ],
          },
        ],
      },
    }),
  );
  const { writes } = planMigration(root);
  const out = JSON.parse(writes.get(".codex/hooks.json"));
  const cmds = out.hooks.UserPromptSubmit[0].hooks.map((h) => h.command);
  assert.deepEqual(cmds, [
    'echo "docs at .codex/hooks/inject-workflow-state.py" && true',
  ]);
});

test("pi settings: extension removed, ambiguous package kept with note", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".pi/settings.json",
    JSON.stringify({
      enableSkillCommands: true,
      extensions: ["./extensions/trellis/index.ts", "./extensions/mine.ts"],
      prompts: ["./prompts"],
      packages: [
        { source: "npm:pi-subagents" },
        { source: "npm:other-pkg" },
      ],
      theme: "dark",
    }),
  );
  mkdirSync(path.join(root, ".pi/extensions/trellis"), { recursive: true });
  put(root, ".pi/extensions/trellis/index.ts", "// trellis ext\n");

  const { writes, removals } = planMigration(root);
  const out = JSON.parse(writes.get(".pi/settings.json"));
  assert.deepEqual(out.extensions, ["./extensions/mine.ts"]);
  // npm:pi-subagents kept — ownership ambiguous, surfaced via notes
  assert.deepEqual(out.packages, [
    { source: "npm:pi-subagents" },
    { source: "npm:other-pkg" },
  ]);
  assert.equal(out.theme, "dark");
  // user-owned capabilities preserved even though trellis wrote them
  assert.equal(out.enableSkillCommands, true);
  assert.deepEqual(out.prompts, ["./prompts"]);
  assert.ok(removals.includes(".pi/extensions/trellis"));
});

test("claude settings.local.json is scrubbed the same way", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".claude/settings.local.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
              },
              { type: "command", command: "python3 ./my-hook.sh" },
            ],
          },
        ],
      },
    }),
  );
  const { writes } = planMigration(root);
  const out = JSON.parse(writes.get(".claude/settings.local.json"));
  const cmds = out.hooks.SessionStart[0].hooks.map((h) => h.command);
  assert.deepEqual(cmds, ["python3 ./my-hook.sh"]);
});

test("hook-only residue counts as trellis evidence (partial uninstall)", () => {
  const root = tmp();
  // no .trellis dir at all — only a stale hook config remains
  put(
    root,
    ".claude/settings.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command: "python3 .claude/hooks/session-start.py",
              },
            ],
          },
        ],
      },
    }),
  );
  const { writes, removals } = planMigration(root);
  // hook entry removed; file becomes empty → removal planned
  assert.ok(removals.includes(".claude/settings.json"));
  assert.ok(writes.has(".neo-trellis/legacy.md"));
});

test("hasLegacyIntegration reflects trellis and mini evidence", () => {
  const trellisRoot = makeTrellis(tmp());
  assert.equal(hasLegacyIntegration(trellisRoot), true);

  const miniRoot = tmp();
  put(
    miniRoot,
    "AGENTS.md",
    [
      "<!-- TRELLIS:START -->",
      "mini-trellis managed block",
      "<!-- TRELLIS:END -->",
    ].join("\n"),
  );
  assert.equal(hasLegacyIntegration(miniRoot), true);

  const cleanRoot = tmp();
  put(cleanRoot, "README.md", "# plain\n");
  assert.equal(hasLegacyIntegration(cleanRoot), false);
});

test("trellis-* managed dirs removed; unrelated skills preserved", () => {
  const root = makeTrellis(tmp());
  put(root, ".claude/commands/trellis/start.md", "x");
  put(root, ".claude/skills/trellis-check/SKILL.md", "x");
  put(root, ".claude/skills/my-own/SKILL.md", "x");
  put(root, ".claude/agents/trellis-research.md", "x");
  put(root, ".agents/skills/trellis-start/SKILL.md", "x");
  put(root, ".codex/agents/trellis-check.toml", "x");
  put(root, ".pi/prompts/trellis-start.md", "x");
  put(root, ".pi/agents/trellis-implement.md", "x");

  const { removals } = planMigration(root);
  for (const expected of [
    ".claude/commands/trellis",
    ".claude/skills/trellis-check",
    ".claude/agents/trellis-research.md",
    ".agents/skills/trellis-start",
    ".codex/agents/trellis-check.toml",
    ".pi/prompts/trellis-start.md",
    ".pi/agents/trellis-implement.md",
  ]) {
    assert.ok(removals.includes(expected), `missing ${expected}`);
  }
  assert.ok(!removals.some((r) => r.includes("my-own")));
});

test("TOML without trellis fingerprint: only [agents.trellis-*] removed", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".codex/config.toml",
    [
      'project_doc_fallback_filenames = ["AGENTS.md"]',
      "",
      "[agents]",
      "max_depth = 1",
      "",
      "[agents.trellis-check]",
      'description = "checker"',
      'model = "x"',
      "",
      "[agents.mine]",
      'description = "keep me"',
      "",
    ].join("\n"),
  );
  const { writes } = planMigration(root);
  const out = writes.get(".codex/config.toml");
  assert.ok(!out.includes("[agents.trellis-check]"));
  assert.ok(!out.includes('description = "checker"'));
  assert.ok(out.includes("[agents.mine]"));
  assert.ok(out.includes("[agents]"));
  assert.ok(out.includes("max_depth = 1"));
  // exact template-owned value is removed regardless of fingerprint
  assert.ok(!out.includes("project_doc_fallback_filenames"));
});

test("TOML with trellis fingerprint: strips owned keys, keeps comments", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".codex/config.toml",
    [
      "# Project-scoped Codex defaults for Trellis workflows.",
      "# Keep AGENTS.md as the primary project instruction file.",
      'project_doc_fallback_filenames = ["AGENTS.md"]',
      "",
      "# Pin the subagent recursion depth explicitly",
      "[agents]",
      "max_depth = 1",
      "",
      "[agents.mine]",
      'description = "keep me"',
      "# a user comment must survive",
      "",
    ].join("\n"),
  );
  const { writes } = planMigration(root);
  const out = writes.get(".codex/config.toml");
  // comments are never removed, even template ones
  assert.ok(out.includes("Project-scoped Codex"));
  assert.ok(out.includes("a user comment must survive"));
  assert.ok(!out.includes("project_doc_fallback_filenames"));
  assert.ok(!out.includes("max_depth"));
  assert.ok(!out.includes("[agents]"));
  assert.ok(out.includes("[agents.mine]"));
  assert.ok(out.includes('description = "keep me"'));
});

test("TOML: fallback key only removed for exact AGENTS.md value", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".codex/config.toml",
    'project_doc_fallback_filenames = ["AGENTS.md", "CLAUDE.md"]\n',
  );
  const { writes } = planMigration(root);
  assert.equal(writes.get(".codex/config.toml"), undefined);
});

test("malformed platform JSON aborts the migration", () => {
  const root = makeTrellis(tmp());
  put(root, ".claude/settings.json", "{ not json !!!");
  assert.throws(() => planMigration(root), /malformed/i);
});

test("malformed codex hooks.json aborts the migration", () => {
  const root = makeTrellis(tmp());
  put(root, ".codex/hooks.json", '{"hooks": [');
  assert.throws(() => planMigration(root), /malformed/i);
});

test("TOML trellis-owned [agents] keeps user keys added alongside", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".codex/config.toml",
    [
      "# Project-scoped Codex defaults for Trellis workflows.",
      'project_doc_fallback_filenames = ["AGENTS.md"]',
      "[agents]",
      "max_depth = 1",
      'custom_key = "user value"',
      "",
    ].join("\n"),
  );
  const { writes } = planMigration(root);
  const out = writes.get(".codex/config.toml");
  assert.ok(!out.includes("max_depth"));
  assert.ok(out.includes("[agents]"));
  assert.ok(out.includes('custom_key = "user value"'));
});

test("refuses mini-trellis-only projects", () => {
  const root = tmp();
  put(
    root,
    "AGENTS.md",
    [
      "<!-- TRELLIS:START -->",
      "# mini-trellis",
      "This project uses mini-trellis as a memory layer.",
      "Managed by mini-trellis.",
      "<!-- TRELLIS:END -->",
    ].join("\n"),
  );
  put(root, ".trellis/spec/index.md", "# spec\n");
  assert.throws(() => planMigration(root), /mini-trellis/i);
});

test("refuses when no trellis evidence exists", () => {
  const root = tmp();
  put(root, "README.md", "# nothing\n");
  assert.throws(() => planMigration(root), /no Trellis installation/i);
});

test("empty platform dirs and missing files are fine", () => {
  const root = tmp();
  put(root, ".trellis/workflow.md", "# w\n");
  const { writes, removals } = planMigration(root);
  assert.ok(removals.includes(".trellis/workflow.md"));
  assert.ok(writes.has(".neo-trellis/legacy.md"));
});

test("symlinks in scanned locations abort the plan", () => {
  const root = makeTrellis(tmp());
  mkdirSync(path.join(root, ".claude/skills"), { recursive: true });
  symlinkSync(
    path.join(root, "outside"),
    path.join(root, ".claude/skills/trellis-evil"),
    "junction",
  );
  assert.throws(() => planMigration(root), /symlink/i);
});

test("any mini marker rejects even with trellis evidence present", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    "AGENTS.md",
    [
      "<!-- TRELLIS:START -->",
      "mini-trellis managed block",
      "<!-- TRELLIS:END -->",
    ].join("\n"),
  );
  assert.throws(() => planMigration(root), /mini-trellis/i);
});

test("unhandled platform integrations are reported in notes", () => {
  const root = makeTrellis(tmp());
  put(root, ".cursor/hooks/trellis-hook.json", "{}");
  const { notes } = planMigration(root);
  assert.ok(
    notes.some((n) => n.includes("unhandled") && n.includes(".cursor")),
  );
});

test("quoted hook paths with spaces and trailing args still match", () => {
  const root = makeTrellis(tmp());
  put(
    root,
    ".claude/settings.json",
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                command:
                  'python3 ".claude/hooks/session-start.py" --source startup',
              },
              {
                type: "command",
                command: "echo .claude/hooks/session-start.py is neat",
              },
            ],
          },
        ],
      },
    }),
  );
  const { writes } = planMigration(root);
  const out = JSON.parse(writes.get(".claude/settings.json"));
  const cmds = out.hooks.SessionStart[0].hooks.map((h) => h.command);
  assert.deepEqual(cmds, ["echo .claude/hooks/session-start.py is neat"]);
});

test("plan is pure: no filesystem writes", () => {
  const root = makeTrellis(tmp());
  const before = readFileSync(path.join(root, ".trellis/workflow.md"), "utf8");
  planMigration(root);
  assert.equal(
    readFileSync(path.join(root, ".trellis/workflow.md"), "utf8"),
    before,
  );
  assert.ok(existsSync(path.join(root, ".trellis/scripts/x.py")));
  assert.ok(!existsSync(path.join(root, ".neo-trellis")));
});
