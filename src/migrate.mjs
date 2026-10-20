/**
 * Plan a migration from classic Trellis to neo-trellis.
 *
 * `planMigration(root)` inspects `root` and returns a pure plan:
 *   { writes: Map<string, string | Buffer>, removals: string[], notes: string[] }
 *
 * Nothing is written or deleted here — callers apply the plan (after their
 * own backup step if they want one).
 *
 * Policy:
 * - `.trellis/` knowledge (spec, research, workspace, tasks) is kept in
 *   place as legacy sources. A `.neo-trellis/legacy.md` index is generated
 *   linking to it. Recognized PRD bundles are additionally copied into prds/.
 * - Old execution wiring is disabled: `.trellis/workflow.md`,
 *   `.trellis/.version`, `.trellis/scripts/` (backed up and removed by
 *   the installer), managed `<!-- TRELLIS:* -->` blocks in
 *   AGENTS.md / CLAUDE.md, Trellis hook entries inside
 *   `.claude/settings.json` / `.claude/settings.local.json` /
 *   `.codex/hooks.json`, `.pi` Trellis extension/agent wiring,
 *   trellis-* skills/agents directories, and `[agents.trellis-*]`
 *   TOML sections.
 * - User content is preserved: hook groups keep their other entries,
 *   non-trellis JSON/TOML keys survive, text outside managed blocks is
 *   left byte-identical.
 * - Symlinks are never followed; encountering one in a scanned location
 *   aborts the plan with an error.
 * - Mini-trellis is not supported; plans refuse when only mini markers or
 *   no Trellis evidence exist.
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { planPrdImports } from './migrate-prds.mjs';

/** Hook script basenames emitted by classic Trellis per platform. */
const TRELLIS_HOOK_SCRIPTS = [
  "session-start.py",
  "inject-subagent-context.py",
  "inject-workflow-state.py",
  "inject-shell-session-context.py",
  "statusline.py",
];

const TRELLIS_MD_SENTINELS = [
  /managed by trellis/i,
  /trellis instructions/i,
];

const MINI_SENTINELS = [/mini[-_ ]?trellis/i];

const PI_TRELLIS_EXTENSION = "./extensions/trellis/index.ts";
const PI_SUBAGENTS_PACKAGE = "npm:pi-subagents";

/**
 * Other platform dirs that classic Trellis installs may have wired but this
 * migrator does not handle. Any trellis-* markers found inside are reported
 * in notes rather than silently claimed as migrated.
 */
const UNHANDLED_PLATFORM_DIRS = [
  ".cursor",
  ".gemini",
  ".opencode",
  ".codebuddy",
  ".qoder",
  ".droid",
  ".trae",
  ".zcode",
  ".snow",
  ".copilot",
  ".github",
  ".reasonix",
];

/**
 * Return lstat for `rel` under `root`, or null when missing.
 * Every path segment between `root` and the target is checked so that a
 * symlinked parent directory cannot be traversed silently. Throws when any
 * segment exists but is a symlink.
 */
function statNoSymlink(root, rel) {
  const segments = rel.split(/[\\/]+/).filter((s) => s.length > 0);
  let cursor = root;
  let walked = "";
  for (const seg of segments) {
    cursor = path.join(cursor, seg);
    walked = walked ? `${walked}/${seg}` : seg;
    let st;
    try {
      st = lstatSync(cursor);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`refusing to follow symlink: ${walked}`);
    }
    if (seg !== segments[segments.length - 1] && !st.isDirectory()) {
      return null; // intermediate segment is a file — path doesn't resolve
    }
    if (seg === segments[segments.length - 1]) return st;
  }
  return null;
}

function readText(root, rel) {
  const st = statNoSymlink(root, rel);
  if (!st || !st.isFile()) return null;
  return readFileSync(path.join(root, rel), "utf-8");
}

/** List entry names of a real directory (no symlink following). */
function listDir(root, rel) {
  const st = statNoSymlink(root, rel);
  if (!st || !st.isDirectory()) return null;
  return readdirSync(path.join(root, rel));
}

function hasFile(root, rel) {
  const st = statNoSymlink(root, rel);
  return Boolean(st && st.isFile());
}

function hasDir(root, rel) {
  const st = statNoSymlink(root, rel);
  return Boolean(st && st.isDirectory());
}

/** Names in `dir` matching `prefix`, regardless of entry type. */
function childrenWithPrefix(root, dir, prefix) {
  const names = listDir(root, dir) ?? [];
  return names.filter((n) => {
    if (!n.startsWith(prefix)) return false;
    // Any symlink entry in a managed directory aborts the scan.
    statNoSymlink(root, `${dir}/${n}`);
    return true;
  });
}

/**
 * Does a file contain a managed `<!-- TRELLIS:START -->` block?
 * Returns the raw block text when found.
 */
function trellisBlockOf(content) {
  if (content === null) return null;
  const re =
    /<!--\s*TRELLIS:START\s*-->[\s\S]*?<!--\s*TRELLIS:END\s*-->\r?\n?/i;
  const m = content.match(re);
  return m ? m[0] : null;
}

// ---------- detection ----------

function detectState(root) {
  const notes = [];
  const trellisEvidence = [];
  const miniEvidence = [];

  if (hasFile(root, ".trellis/workflow.md")) {
    trellisEvidence.push(".trellis/workflow.md");
  }
  if (hasFile(root, ".trellis/.version")) {
    trellisEvidence.push(".trellis/.version");
  }
  if (hasDir(root, ".trellis/tasks")) {
    trellisEvidence.push(".trellis/tasks/");
  }
  if (hasDir(root, ".trellis/scripts")) {
    trellisEvidence.push(".trellis/scripts/");
  }
  if (hasDir(root, ".trellis/agents")) {
    trellisEvidence.push(".trellis/agents/");
  }

  // Old hook configs referencing Trellis hook scripts count as Trellis
  // evidence on their own — this is what a partially-uninstalled project
  // looks like (runtime dirs already gone, wiring left behind).
  const hookConfigEvidence = [
    [".claude/settings.json", ".claude/hooks"],
    [".claude/settings.local.json", ".claude/hooks"],
    [".codex/hooks.json", ".codex/hooks"],
  ];
  for (const [rel, hookDir] of hookConfigEvidence) {
    const content = readText(root, rel);
    if (content === null) continue;
    try {
      const parsed = JSON.parse(content);
      if (jsonMentionsHookScript(parsed, hookDir)) {
        trellisEvidence.push(`${rel} (trellis hook commands)`);
      }
    } catch {
      // malformed JSON is not detection evidence; planMigration reports it
      // separately when it tries to scrub the file.
    }
  }

  for (const md of ["AGENTS.md", "CLAUDE.md"]) {
    const block = trellisBlockOf(readText(root, md));
    if (!block) continue;
    if (MINI_SENTINELS.some((re) => re.test(block))) {
      miniEvidence.push(`${md} (mini-trellis block)`);
    } else if (TRELLIS_MD_SENTINELS.some((re) => re.test(block))) {
      trellisEvidence.push(`${md} TRELLIS block`);
    } else {
      notes.push(`${md}: unmanaged TRELLIS block left untouched`);
    }
  }

  const platformMarkers = [
    [".claude/commands/trellis", true],
    [".claude/agents", false, "trellis-"],
    [".claude/skills", false, "trellis-"],
    [".agents/skills", false, "trellis-"],
    [".codex/agents", false, "trellis-"],
    [".pi/skills", false, "trellis-"],
    [".pi/extensions/trellis", true],
    [".pi/prompts", false, "trellis-"],
    [".pi/agents", false, "trellis-"],
  ];
  for (const [rel, isExact, prefix] of platformMarkers) {
    if (isExact) {
      if (hasDir(root, rel) || hasFile(root, rel)) trellisEvidence.push(rel);
    } else if (childrenWithPrefix(root, rel, prefix).length > 0) {
      trellisEvidence.push(`${rel}/${prefix}*`);
    }
  }

  // mini-trellis CLI markers inside .trellis content
  const trellisDir = statNoSymlink(root, ".trellis");
  if (trellisDir?.isDirectory()) {
    const memDir = childrenWithPrefix(root, ".trellis/scripts", "mem");
    if (memDir.length > 0) {
      miniEvidence.push(".trellis/scripts/mem* (mini-trellis)");
    }
  }

  // Mini-trellis CLI / asset markers anywhere we recognize them.
  const miniAssetMarkers = [
    [".claude/commands/mini-trellis", true],
    [".claude/skills", false, "mini-trellis"],
    [".agents/skills", false, "mini-trellis"],
    [".pi/skills", false, "mini-trellis"],
    [".pi/prompts", false, "mini-trellis"],
  ];
  for (const [rel, isExact, prefix] of miniAssetMarkers) {
    if (isExact) {
      if (hasDir(root, rel) || hasFile(root, rel)) {
        miniEvidence.push(rel);
      }
    } else if (childrenWithPrefix(root, rel, prefix).length > 0) {
      miniEvidence.push(`${rel}/${prefix}*`);
    }
  }

  return { trellisEvidence, miniEvidence, notes };
}

// ---------- scrubbers ----------

/**
 * Tokenize a shell-ish command line: whitespace splits tokens except inside
 * single/double quotes; backslash escapes the next character outside single
 * quotes. Returns the decoded argument list.
 */
function tokenizeShell(command) {
  const tokens = [];
  let cur = "";
  let has = false;
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && i + 1 < command.length) {
        const next = command[i + 1];
        if (next === '"' || next === "\\" || next === "$" || next === "`") {
          cur += next;
          i += 1;
        } else cur += ch;
      } else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      has = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      cur += command[i + 1];
      has = true;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (has || cur.length > 0) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
      continue;
    }
    cur += ch;
    has = true;
  }
  if (has || cur.length > 0) tokens.push(cur);
  return tokens;
}

const SHELL_OPERATORS = /^(?:&&|\|\||[|;&]|>>?|<|2>)$/;

const INTERPRETER_RE =
  /^(?:python(?:\d+(?:\.\d+)*)?(?:\.exe)?|py(?:\.exe)?|node(?:\.exe)?|bash|sh|pwsh|powershell(?:\.exe)?|uv|pipenv)$/i;

function isInterpreterToken(token) {
  const base = token.replace(/\\/g, "/").split("/").pop();
  return INTERPRETER_RE.test(base);
}

function isHookPathToken(token, hookDirPrefix) {
  const normalized = token.replace(/\\/g, "/");
  return TRELLIS_HOOK_SCRIPTS.some((s) => {
    const rel = `${hookDirPrefix}/${s}`;
    return normalized === rel || normalized.endsWith(`/${rel}`);
  });
}

/**
 * True when `command` actually invokes a Trellis hook script under
 * `hookDirPrefix`. The path must appear in script position: as the first
 * token of a command segment (direct execution) or immediately following
 * an interpreter (`python3`, `py`, `bash`, …). Trailing arguments after the
 * script (`--mode x`) still match; mentions elsewhere — `echo <path>`,
 * prose tokens, `&&` after — do not. Quoted paths containing spaces
 * survive because tokens are decoded before comparison.
 */
function commandIsTrellisHook(command, hookDirPrefix) {
  if (typeof command !== "string") return false;
  const tokens = tokenizeShell(command);
  let expectCommand = true; // start, or just after an operator
  let inInterpreterArgs = false; // interpreter seen, still reading its args
  for (const tok of tokens) {
    if (SHELL_OPERATORS.test(tok)) {
      expectCommand = true;
      inInterpreterArgs = false;
      continue;
    }
    if (
      (expectCommand || inInterpreterArgs) &&
      isHookPathToken(tok, hookDirPrefix)
    ) {
      return true;
    }
    if (expectCommand && isInterpreterToken(tok)) {
      inInterpreterArgs = true;
    }
    expectCommand = false;
  }
  return false;
}

function entryCommand(entry) {
  if (entry === null || typeof entry !== "object") return null;
  for (const k of ["command", "bash", "powershell"]) {
    if (typeof entry[k] === "string") return entry[k];
  }
  return null;
}

/**
 * Deep-scan a parsed settings/hooks JSON: true when any string field that
 * looks like a shell command invokes a Trellis hook script under
 * `hookDirPrefix`. Used only for detection — the actual scrubbing is done
 * by scrubHooksJson with proper structure awareness.
 */
function jsonMentionsHookScript(value, hookDirPrefix) {
  if (typeof value === "string") {
    return commandIsTrellisHook(value, hookDirPrefix);
  }
  if (Array.isArray(value)) {
    return value.some((v) => jsonMentionsHookScript(v, hookDirPrefix));
  }
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((v) =>
      jsonMentionsHookScript(v, hookDirPrefix),
    );
  }
  return false;
}

/**
 * Remove hook entries whose command targets a Trellis hook script under
 * `hookDirPrefix` (e.g. `.claude/hooks`). Nested (matcher-groups) and flat
 * event arrays are both handled. Other keys are preserved.
 * Returns null when nothing changed, undefined when the JSON is malformed
 * or has an unexpected top-level shape (callers abort the migration),
 * {content, empty} otherwise.
 */
function scrubHooksJson(content, hookDirPrefix) {
  let root;
  try {
    root = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return undefined;
  }
  let changed = false;

  if (
    hookDirPrefix === ".claude/hooks" &&
    root.statusLine !== null &&
    typeof root.statusLine === "object" &&
    !Array.isArray(root.statusLine) &&
    commandIsTrellisHook(entryCommand(root.statusLine), hookDirPrefix)
  ) {
    delete root.statusLine;
    changed = true;
  }

  const hooks = root.hooks;
  if (hooks !== null && typeof hooks === "object" && !Array.isArray(hooks)) {
    for (const eventName of Object.keys(hooks)) {
      const arr = hooks[eventName];
      if (!Array.isArray(arr)) continue;
      const kept = [];
      for (const entry of arr) {
        const inner = entry?.hooks;
        if (Array.isArray(inner)) {
          const keptInner = inner.filter(
            (sub) =>
              !commandIsTrellisHook(entryCommand(sub), hookDirPrefix),
          );
          if (keptInner.length !== inner.length) changed = true;
          if (keptInner.length > 0) {
            kept.push({ ...entry, hooks: keptInner });
          }
        } else {
          if (commandIsTrellisHook(entryCommand(entry), hookDirPrefix)) {
            changed = true;
            continue;
          }
          kept.push(entry);
        }
      }
      if (kept.length === 0) {
        if (arr.length > 0) {
          changed = true;
          delete hooks[eventName];
        }
      } else if (
        kept.length !== arr.length ||
        kept.some((entry, i) => entry !== arr[i])
      ) {
        hooks[eventName] = kept;
      }
    }
    if (Object.keys(hooks).length === 0) {
      delete root.hooks;
    }
  }

  if (!changed) return null;
  const out = JSON.stringify(root, null, 2) + "\n";
  return { content: out, empty: Object.keys(root).length === 0 };
}

/**
 * Scrub `.pi/settings.json`: remove only the exact Trellis extension entry.
 * `npm:pi-subagents` is kept — its ownership is ambiguous (Trellis may have
 * installed it, but the user may also depend on it); callers emit a note.
 * User-owned capabilities (`enableSkillCommands`, `./prompts`, `./skills`)
 * are likewise never touched.
 */
function scrubPiSettings(content) {
  let root;
  try {
    root = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return undefined;
  }
  let changed = false;

  const ext = root.extensions;
  if (Array.isArray(ext)) {
    const filtered = ext.filter((v) => v !== PI_TRELLIS_EXTENSION);
    if (filtered.length !== ext.length) {
      changed = true;
      if (filtered.length === 0) delete root.extensions;
      else root.extensions = filtered;
    }
  }

  if (!changed) return null;
  return {
    content: JSON.stringify(root, null, 2) + "\n",
    empty: Object.keys(root).length === 0,
  };
}

/** True when `.pi/settings.json` content references the pi-subagents pkg. */
function jsonHasPiSubagents(content) {
  try {
    const root = JSON.parse(content);
    const pkgs = root?.packages;
    if (!Array.isArray(pkgs)) return false;
    return pkgs.some((e) =>
      e !== null && typeof e === "object" && !Array.isArray(e)
        ? e.source === PI_SUBAGENTS_PACKAGE
        : e === PI_SUBAGENTS_PACKAGE,
    );
  } catch {
    return false;
  }
}

/**
 * Strong Trellis fingerprints in `.codex/config.toml`: only when at least
 * one is present do we treat `max_depth = 1` and the exact
 * `project_doc_fallback_filenames = ["AGENTS.md"]` assignment as
 * Trellis-owned. User comments and other keys are always preserved —
 * the scrubber never deletes comment lines.
 */
const CODEX_TRELLIS_MARKERS = [
  "Project-scoped Codex defaults for Trellis workflows.",
  "the #240/#241",
  "Trellis workflows",
];

function fileLooksTrellisOwned(content) {
  return CODEX_TRELLIS_MARKERS.some((m) => content.includes(m));
}

/**
 * Remove Trellis-owned content from `.codex/config.toml`:
 * - `[agents.trellis-*]` sections, always (they are ours by name).
 * - `project_doc_fallback_filenames` only when its value is exactly
 *   `["AGENTS.md"]` (the template default).
 * - `max_depth = 1` inside `[agents]` only when the file carries a strong
 *   Trellis marker; the `[agents]` header is dropped only when no user keys
 *   remain in the table.
 * Comment lines — template or user — are never removed.
 */
function scrubCodexConfigToml(content) {
  const trellisOwned = fileLooksTrellisOwned(content);
  const lines = content.split("\n");
  const out = [];
  let changed = false;
  const sectionRe = /^\s*\[agents\.trellis-[^\]]+\]\s*(?:#.*)?$/;
  const anySectionRe = /^\s*\[\[?[^\]]+\]\]?\s*/;

  // Pass 1: drop trellis-* agent sections and the exact template-owned
  // fallback-filenames assignment.
  let skipping = false;
  for (const line of lines) {
    if (sectionRe.test(line)) {
      skipping = true;
      changed = true;
      continue;
    }
    if (skipping && anySectionRe.test(line)) skipping = false;
    if (skipping) continue;
    if (
      /^\s*project_doc_fallback_filenames\s*=\s*\[\s*"AGENTS\.md"\s*\]\s*(?:#.*)?$/.test(
        line,
      )
    ) {
      changed = true;
      continue;
    }
    out.push(line);
  }

  // Pass 2: in a trellis-marked file, drop `max_depth = 1` inside [agents]
  // and the `[agents]` header itself when no user keys remain in it.
  let final = out;
  if (trellisOwned) {
    const next = [];
    for (let i = 0; i < out.length; i += 1) {
      const line = out[i];
      if (!/^\s*\[agents\]\s*$/.test(line)) {
        next.push(line);
        continue;
      }
      const body = [];
      let j = i + 1;
      while (j < out.length && !anySectionRe.test(out[j])) {
        if (/^\s*max_depth\s*=\s*1\s*$/.test(out[j])) {
          changed = true;
        } else {
          body.push(out[j]);
        }
        j += 1;
      }
      if (body.some((l) => l.trim() !== "")) {
        next.push(line, ...body);
      } else {
        changed = true;
        next.push(...body.filter((l) => l.trim() !== ""));
      }
      i = j - 1;
    }
    final = next;
  }

  if (!changed) return null;
  // collapse >1 consecutive blank lines left by removal, keep trailing \n
  const collapsed = [];
  let blank = false;
  for (const line of final) {
    const isBlank = line.trim() === "";
    if (isBlank && blank) continue;
    collapsed.push(line);
    blank = isBlank;
  }
  let result = collapsed.join("\n");
  if (!result.endsWith("\n") && result.length > 0) result += "\n";
  return { content: result, empty: result.trim().length === 0 };
}

/** Strip the managed TRELLIS block from a markdown file. */
function stripTrellisBlock(content) {
  const re =
    /<!--\s*TRELLIS:START\s*-->[\s\S]*?<!--\s*TRELLIS:END\s*-->\r?\n?/i;
  const out = content.replace(re, "");
  return out === content ? null : { content: out, empty: out.trim() === "" };
}

// ---------- plan ----------

export function planMigration(root) {
  const writes = new Map();
  const removals = [];
  const notes = [];

  const { trellisEvidence, miniEvidence, notes: detectNotes } =
    detectState(root);
  notes.push(...detectNotes);

  if (miniEvidence.length > 0) {
    throw new Error(
      `mini-trellis detected (${miniEvidence.join(", ")}); ` +
        "migration from mini-trellis is not supported",
    );
  }
  if (trellisEvidence.length === 0) {
    throw new Error("no Trellis installation evidence found");
  }

  const plan = { writes, removals, notes };
  const write = (rel, content) => writes.set(rel, content);
  const writeOrRemove = (rel, res) => {
    if (!res) return;
    if (res.empty) removals.push(rel);
    else write(rel, res.content);
  };

  // 1. Disable the old runtime, keep the knowledge tree.
  for (const rel of [".trellis/workflow.md", ".trellis/.version"]) {
    if (hasFile(root, rel)) removals.push(rel);
  }
  if (hasDir(root, ".trellis/scripts")) removals.push(".trellis/scripts");

  // 2. Managed markdown blocks.
  for (const md of ["AGENTS.md", "CLAUDE.md"]) {
    const content = readText(root, md);
    const block = trellisBlockOf(content);
    if (!block) continue;
    if (MINI_SENTINELS.some((re) => re.test(block))) continue; // not ours
    writeOrRemove(md, stripTrellisBlock(content));
  }

  // 3. Platform hook configs.
  for (const claudeCfg of [
    ".claude/settings.json",
    ".claude/settings.local.json",
  ]) {
    const claudeSettings = readText(root, claudeCfg);
    if (claudeSettings === null) continue;
    const res = scrubHooksJson(claudeSettings, ".claude/hooks");
    if (res === undefined) {
      throw new Error(
        `${claudeCfg} is malformed; aborting migration to avoid ` +
          "leaving old hooks pointing at removed scripts",
      );
    }
    writeOrRemove(claudeCfg, res);
  }
  const codexHooks = readText(root, ".codex/hooks.json");
  if (codexHooks !== null) {
    const res = scrubHooksJson(codexHooks, ".codex/hooks");
    if (res === undefined) {
      throw new Error(
        ".codex/hooks.json is malformed; aborting migration to avoid " +
          "leaving old hooks pointing at removed scripts",
      );
    }
    writeOrRemove(".codex/hooks.json", res);
  }

  // 4. Pi settings — only when this is actually a Trellis project.
  const piSettings = readText(root, ".pi/settings.json");
  if (piSettings !== null) {
    const res = scrubPiSettings(piSettings);
    if (res === undefined) {
      throw new Error(
        ".pi/settings.json is malformed; aborting migration to avoid " +
          "leaving stale Trellis extension wiring",
      );
    }
    writeOrRemove(".pi/settings.json", res);
    if (jsonHasPiSubagents(piSettings)) {
      notes.push(
        `.pi/settings.json: kept ${PI_SUBAGENTS_PACKAGE} — ownership is ` +
          "ambiguous (may be a user-installed package); remove manually if " +
          "it came from Trellis",
      );
    }
  }

  // 5. Managed directories / file groups.
  const managedDirs = [
    ".claude/commands/trellis",
    ".pi/extensions/trellis",
  ];
  for (const rel of managedDirs) {
    if (hasDir(root, rel)) removals.push(rel);
  }
  for (const [dir, prefix] of [
    [".claude/skills", "trellis-"],
    [".claude/agents", "trellis-"],
    [".agents/skills", "trellis-"],
    [".codex/agents", "trellis-"],
    [".pi/skills", "trellis-"],
    [".pi/prompts", "trellis-"],
    [".pi/agents", "trellis-"],
  ]) {
    for (const name of childrenWithPrefix(root, dir, prefix)) {
      removals.push(`${dir}/${name}`);
    }
  }

  // 6. TOML agent sections (codex config or any *.toml holding them).
  for (const tomlRel of [".codex/config.toml"]) {
    const content = readText(root, tomlRel);
    if (content === null) continue;
    writeOrRemove(tomlRel, scrubCodexConfigToml(content));
  }

  // 6b. Report platform integrations this migrator does not handle so the
  // caller does not claim a complete migration.
  const unhandled = [];
  for (const dir of UNHANDLED_PLATFORM_DIRS) {
    const names = listDir(root, dir);
    if (!names) continue;
    for (const name of names) {
      const rel = `${dir}/${name}`;
      const st = statNoSymlink(root, rel);
      if (!st) continue;
      if (/trellis/i.test(name)) {
        unhandled.push(`${dir}/${name}`);
        continue;
      }
      // One level deeper for nested config dirs like .cursor/hooks/.
      if (st.isDirectory()) {
        for (const sub of listDir(root, rel) ?? []) {
          if (/trellis/i.test(sub)) {
            statNoSymlink(root, `${rel}/${sub}`);
            unhandled.push(`${rel}/${sub}`);
          }
        }
      }
    }
  }
  if (unhandled.length > 0) {
    notes.push(
      `unhandled platform integrations left in place: ${unhandled.join(", ")}`,
    );
  }

  // 7. Legacy index into the preserved knowledge tree. Old spec remains
  // an active constraint source until superseded; tasks/research are
  // historical evidence. Links are real markdown links relative to
  // `.neo-trellis/legacy.md` so agents can navigate straight to the files.
  const legacySections = [];
  const legacyLinks = [
    [
      "spec",
      "package- and layer-scoped coding rules — still authoritative; " +
        "read the relevant spec before editing code in its scope. " +
        "Stays in force until a neo-trellis spec explicitly supersedes it.",
    ],
    [
      "research",
      "historical research notes and decision rationale — evidence, " +
        "not current contracts",
    ],
    [
      "workspace",
      "historical per-developer journals and session traces",
    ],
    [
      "tasks",
      "original tasks and archives; imported PRDs are indexed in .neo-trellis/prds/trellis-imports.json when present",
    ],
  ];
  for (const [d, desc] of legacyLinks) {
    if (hasDir(root, `.trellis/${d}`) || hasFile(root, `.trellis/${d}`)) {
      legacySections.push(`- [\`.trellis/${d}/\`](../.trellis/${d}/) — ${desc}`);
    }
  }
  if (hasDir(root, ".trellis/agents")) {
    legacySections.push(
      "- [`.trellis/agents/`](../.trellis/agents/) — archived sub-agent " +
        "prompts kept for reference",
    );
  }
  const legacyMd = [
    "# Legacy Trellis sources",
    "",
    "This project was migrated from classic Trellis to neo-trellis.",
    "The original `.trellis/` knowledge tree is preserved verbatim.",
    "",
    "**Old spec stays in force.** `.trellis/spec/` rules remain valid",
    "constraints and should be read before touching code in their scope,",
    "until a `.neo-trellis/` spec explicitly supersedes them. Tasks,",
    "workspace journals, and research are historical records — useful",
    "evidence, but not current contracts.",
    "",
    ...legacySections,
    "",
    "The old workflow engine (workflow.md, scripts, hooks, platform",
    "commands and trellis-* agents/skills) was backed up and removed",
    "during migration. New contracts and the project map live under",
    "`.neo-trellis/`.",
    "",
  ].join("\n");
  write(".neo-trellis/legacy.md", legacyMd);

  planPrdImports(root, plan);
  notes.push(
    `Trellis evidence: ${trellisEvidence.join(", ")}`,
    "knowledge tree kept in place under .trellis/ (see .neo-trellis/legacy.md)",
  );

  return plan;
}

export default planMigration;

/**
 * Lightweight guard for init: true when the root shows any Trellis or
 * mini-trellis evidence, meaning a legacy integration is (or was) present
 * and a plain init should not proceed without migration/confirmation.
 */
export function hasLegacyIntegration(root) {
  const { trellisEvidence, miniEvidence } = detectState(root);
  return trellisEvidence.length > 0 || miniEvidence.length > 0;
}
