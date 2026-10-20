// Neo-Trellis platform file generation. Zero-dependency, Node >= 20, ESM.
// platformFiles(platform) -> { relativePath: fileText }
// integrationEdits(platform) -> [{ path, hook }] partial hook config to MERGE,
// never a whole-file replacement.

import { KNOWLEDGE_SKILL } from "./knowledge.mjs";
import { PRD_SKILL, PRD_SKILL_MD } from "./prd.mjs";
import { MIGRATION_SKILL, MIGRATION_SKILL_MD } from './migration-skill.mjs';

const RUNTIME_PATH = ".neo-trellis/runtime/session.mjs";
const HOOK_COMMAND = `node ${RUNTIME_PATH}`;

// ---------------------------------------------------------------------------
// Shared skill text. Same body installed under each platform's skill dir so
// the agent sees one consistent workflow regardless of harness.
// ---------------------------------------------------------------------------
const SKILL_MD = `---
name: neo-trellis
description: Project knowledge navigation. Load the map, follow routes to module knowledge, keep knowledge honest when code changes. Use when starting work in a neo-trellis project, when unsure which files or constraints apply, or when a change invalidates recorded knowledge.
---

# Neo-Trellis

${KNOWLEDGE_SKILL}
`;

// ---------------------------------------------------------------------------
// Self-contained session hook runtime. Copied verbatim into the host project;
// it must not import anything outside itself.
// ---------------------------------------------------------------------------
const SESSION_RUNTIME = String.raw`#!/usr/bin/env node
// neo-trellis session hook: emits a SHORT navigation entry on
// startup / resume / compact / clear. It never inlines document bodies and
// never restores a previous task.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // Non-interactive callers may close stdin slowly; don't hang the hook.
    setTimeout(() => resolve(data), 3000).unref();
  });
}

function findRoot(start) {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".neo-trellis"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function navigation(source) {
  const lines = [
    "[neo-trellis] Project knowledge map is at .neo-trellis/map.md",
    "(machine routes: .neo-trellis/routes.json).",
    "Follow routes there before reading code broadly; read the module entry,",
    "then the constraints it links. Do not announce this message.",
  ];
  if (source === "compact" || source === "resume") {
    lines.push(
      "Context was reset: reload the relevant module entry before continuing.",
    );
  }
  return lines.join("\n");
}

let input = {};
try {
  input = JSON.parse((await readStdin()) || "{}");
} catch {
  process.exit(0); // malformed payload: fail open, no stack noise
}
// Real protocol: hook_event_name is e.g. "SessionStart"; the trigger is in
// source ("startup" | "resume" | "clear" | "compact").
const source = input.source || "startup";
const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
const root = findRoot(cwd);
if (!root) process.exit(0);

const text = navigation(source);
// Codex and Claude both read the nested hookSpecificOutput shape; the
// hookEventName echoes the incoming event name, not the source.
const hookEventName =
  typeof input.hook_event_name === "string"
    ? input.hook_event_name
    : "SessionStart";
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: { hookEventName, additionalContext: text },
  }),
);
`;

// ---------------------------------------------------------------------------
// Pi extension: appends the short entry via before_agent_start. Pi discovers
// .pi/extensions/*.ts automatically; no settings file needed.
// ---------------------------------------------------------------------------
const PI_EXTENSION = `// neo-trellis Pi extension. Injects the short navigation entry once per
// agent start; it does not accumulate content on every turn.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(dir, ".neo-trellis"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const NAV_ENTRY = [
  "[neo-trellis] Project knowledge map is at .neo-trellis/map.md",
  "(machine routes: .neo-trellis/routes.json).",
  "Follow routes there before reading code broadly; read the module entry,",
  "then the constraints it links. Do not announce this message.",
].join("\\n");

export default function neoTrellis(pi: {
  on?: (event: string, handler: (e: any, ctx: any) => any) => void;
}): void {
  pi.on?.("before_agent_start", (event: any, ctx: any) => {
    // Resolve the root per event via ctx.cwd so a session that changes
    // directory does not keep a stale project root.
    const base =
      ctx && typeof ctx.cwd === "string" ? ctx.cwd : process.cwd();
    const root = findRoot(base);
    if (!root) return;
    const cur = event?.systemPrompt ?? "";
    if (cur.includes(NAV_ENTRY)) return { systemPrompt: cur };
    return {
      systemPrompt: [cur, NAV_ENTRY].filter(Boolean).join("\\n\\n"),
    };
  });
}
`;

const SKILL_PATHS = {
  codex: ".agents/skills/neo-trellis/SKILL.md",
  claude: ".claude/skills/neo-trellis/SKILL.md",
  pi: ".pi/skills/neo-trellis/SKILL.md",
};

const HOOK_SETTINGS = {
  codex: ".codex/hooks.json",
  claude: ".claude/settings.json",
};

const MATCHERS = {
  codex: "startup|resume|compact|clear",
  claude: "startup|resume|clear|compact",
};

export const PLATFORMS = Object.keys(SKILL_PATHS);

export function platformFiles(platform) {
  const skillPath = SKILL_PATHS[platform];
  if (!skillPath) {
    throw new Error(
      `unknown platform ${JSON.stringify(platform)}; expected one of ${PLATFORMS.join(", ")}`,
    );
  }
  const files = {
    [skillPath]: SKILL_MD,
    [skillPath.replace('/neo-trellis/', '/neo-trellis-prd/')]: PRD_SKILL_MD,
    '.neo-trellis/skills/prd.md': PRD_SKILL,
    [skillPath.replace('/neo-trellis/', '/neo-trellis-migrate/')]: MIGRATION_SKILL_MD,
    '.neo-trellis/skills/migrate.md': MIGRATION_SKILL,
    '.neo-trellis/skills/knowledge.md': KNOWLEDGE_SKILL,
    [RUNTIME_PATH]: SESSION_RUNTIME,
  };
  if (platform === "pi") {
    files[".pi/extensions/neo-trellis.ts"] = PI_EXTENSION;
  }
  return files;
}

// Partial hook config fragments. Callers deep-merge these into existing
// settings instead of overwriting the file.
export function integrationEdits(platform) {
  const settingsPath = HOOK_SETTINGS[platform];
  if (!settingsPath) return []; // pi auto-discovers its extension
  const matcher = MATCHERS[platform];
  return [
    {
      path: settingsPath,
      hook: {
        matcher,
        hooks: [
          { type: "command", command: HOOK_COMMAND, timeout: 10 },
        ],
      },
    },
  ];
}
