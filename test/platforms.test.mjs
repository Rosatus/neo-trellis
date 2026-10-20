import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as moduleApi from 'node:module';

import { platformFiles, integrationEdits, PLATFORMS } from "../src/platforms.mjs";
import { KNOWLEDGE_SKILL } from "../src/knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// ---------------------------------------------------------------------------
// platformFiles
// ---------------------------------------------------------------------------
test("platformFiles returns expected skill paths per platform", () => {
  assert.ok(
    platformFiles("codex")[".agents/skills/neo-trellis/SKILL.md"],
  );
  assert.ok(
    platformFiles("claude")[".claude/skills/neo-trellis/SKILL.md"],
  );
  assert.ok(platformFiles("pi")[".pi/skills/neo-trellis/SKILL.md"]);
});

test("every platform gets the hook runtime", () => {
  for (const p of PLATFORMS) {
    const files = platformFiles(p);
    assert.ok(files[".neo-trellis/runtime/session.mjs"], p);
    assert.match(
      files[".neo-trellis/runtime/session.mjs"],
      /node\.js|node:fs/,
    );
  }
});

test("skill body embeds KNOWLEDGE_SKILL, not a stale copy", () => {
  for (const p of PLATFORMS) {
    const skill = Object.values(platformFiles(p)).find((t) =>
      t.startsWith("---\nname: neo-trellis"),
    );
    assert.ok(skill, p);
    assert.ok(skill.includes(KNOWLEDGE_SKILL));
  }
});

test("pi additionally installs the extension file; others do not", () => {
  assert.ok(platformFiles("pi")[".pi/extensions/neo-trellis.ts"]);
  assert.equal(
    platformFiles("codex")[".pi/extensions/neo-trellis.ts"],
    undefined,
  );
});

test("unknown platform throws", () => {
  assert.throws(() => platformFiles("opencode"), /unknown platform/);
});

// ---------------------------------------------------------------------------
// integrationEdits: partial fragments, never whole-file configs
// ---------------------------------------------------------------------------
test("claude edit targets settings.json with session matchers", () => {
  const [edit] = integrationEdits("claude");
  assert.equal(edit.path, ".claude/settings.json");
  assert.equal(edit.hook.matcher, "startup|resume|clear|compact");
  assert.equal(
    edit.hook.hooks[0].command,
    "node .neo-trellis/runtime/session.mjs",
  );
  assert.equal(edit.hook.hooks[0].timeout, 10);
});

test("codex edit targets hooks.json", () => {
  const [edit] = integrationEdits("codex");
  assert.equal(edit.path, ".codex/hooks.json");
  assert.match(edit.hook.matcher, /startup/);
  assert.match(edit.hook.matcher, /compact/);
});

test("pi needs no settings edit (auto-discovery)", () => {
  assert.deepEqual(integrationEdits("pi"), []);
});

test('Pi extension executes, deduplicates and resolves context cwd per event', { skip: !moduleApi.stripTypeScriptTypes }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'neo-pi-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, '.neo-trellis'), { recursive: true });
  const js = moduleApi.stripTypeScriptTypes(platformFiles('pi')['.pi/extensions/neo-trellis.ts']);
  const extension = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
  let callback;
  extension.default({ on(event, handler) { assert.equal(event, 'before_agent_start'); callback = handler; } });
  const first = callback({ systemPrompt: 'User prompt' }, { cwd: project });
  assert.match(first.systemPrompt, /map\.md/);
  assert.deepEqual(callback(first, { cwd: project }), first);
  assert.equal(callback({ systemPrompt: 'User prompt' }, { cwd: root }), undefined);
});

// ---------------------------------------------------------------------------
// Runtime hook: simulate hosts piping JSON on stdin
// ---------------------------------------------------------------------------
function fixture(routes = []) {
  const dir = mkdtempSync(join(tmpdir(), "neotrellis-"));
  mkdirSync(join(dir, ".neo-trellis"), { recursive: true });
  writeFileSync(
    join(dir, ".neo-trellis", "routes.json"),
    JSON.stringify({ version: 1, routes }),
  );
  writeFileSync(
    join(dir, ".neo-trellis", "map.md"),
    "# Project map\n",
  );
  return dir;
}

function runHook(root, execCwd, stdinText) {
  const files = platformFiles("claude");
  const runtime = join(root, ".neo-trellis", "runtime", "session.mjs");
  mkdirSync(dirname(runtime), { recursive: true });
  writeFileSync(runtime, files[".neo-trellis/runtime/session.mjs"]);
  const out = execFileSync("node", [runtime], {
    cwd: execCwd,
    input: stdinText,
    encoding: "utf8",
    timeout: 10000,
  });
  return out ? JSON.parse(out) : null;
}

test("SessionStart/startup emits short nav via nested output only", () => {
  const dir = fixture([
    {
      paths: ["src/payments/"],
      knowledge: [".neo-trellis/modules/payments.md"],
    },
  ]);
  const res = runHook(
    dir,
    dir,
    JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: dir,
    }),
  );
  // nested hookSpecificOutput only — no top-level additionalContext
  assert.equal(res.additionalContext, undefined);
  const out = res.hookSpecificOutput;
  assert.equal(out.hookEventName, "SessionStart");
  assert.match(out.additionalContext, /map\.md/);
  assert.match(out.additionalContext, /routes\.json/);
  // routes are NOT inlined — the hook is a pointer, not a reader
  assert.doesNotMatch(out.additionalContext, /src\/payments/);
  rmSync(dir, { recursive: true, force: true });
});

test("walks up from a nested cwd to find the project root", () => {
  const dir = fixture([{ paths: ["src/"], knowledge: ["x.md"] }]);
  const nested = join(dir, "src", "deep", "dir");
  mkdirSync(nested, { recursive: true });
  const res = runHook(
    dir,
    nested,
    JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: nested,
    }),
  );
  assert.match(res.hookSpecificOutput.additionalContext, /map\.md/);
  rmSync(dir, { recursive: true, force: true });
});

test("compact adds a reload hint; never restores a task", () => {
  const dir = fixture([]);
  const res = runHook(
    dir,
    dir,
    JSON.stringify({
      hook_event_name: "SessionStart",
      source: "compact",
      cwd: dir,
    }),
  );
  const ctx = res.hookSpecificOutput.additionalContext;
  assert.match(ctx, /reload the relevant module entry/);
  assert.doesNotMatch(ctx, /task|resume previous/i);
  rmSync(dir, { recursive: true, force: true });
});

test("malformed JSON fails open with no output or stack noise", () => {
  const dir = fixture([]);
  const res = runHook(dir, dir, "{not json");
  assert.equal(res, null);
  rmSync(dir, { recursive: true, force: true });
});

test("non-string cwd falls back to process.cwd()", () => {
  const dir = fixture([]);
  const res = runHook(
    dir,
    dir,
    JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: 42,
    }),
  );
  assert.match(res.hookSpecificOutput.additionalContext, /map\.md/);
  rmSync(dir, { recursive: true, force: true });
});

test("exits silently with no .neo-trellis root", () => {
  const dir = mkdtempSync(join(tmpdir(), "neotrellis-none-"));
  const files = platformFiles("claude");
  const runtime = join(dir, "runtime", "session.mjs");
  mkdirSync(dirname(runtime), { recursive: true });
  writeFileSync(runtime, files[".neo-trellis/runtime/session.mjs"]);
  const out = execFileSync("node", [runtime], {
    cwd: dir,
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: dir,
    }),
    encoding: "utf8",
  });
  assert.equal(out, "");
  rmSync(dir, { recursive: true, force: true });
});

test("clear emits entry without restoring prior work", () => {
  const dir = fixture([]);
  const res = runHook(
    dir,
    dir,
    JSON.stringify({
      hook_event_name: "SessionStart",
      source: "clear",
      cwd: dir,
    }),
  );
  const ctx = res.hookSpecificOutput.additionalContext;
  assert.match(ctx, /map\.md/);
  assert.doesNotMatch(ctx, /reload/);
  rmSync(dir, { recursive: true, force: true });
});
