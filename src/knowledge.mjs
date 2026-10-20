// neo-trellis knowledge layer: zero-dependency ESM, Node >= 20.
//
// Design: AGENTS.md is a universal router that tells the agent how to find
// project knowledge without embedding project content. Per-project knowledge
// lives under .neo-trellis/ and is loaded on demand by scope.

import fs from 'node:fs';
import path from 'node:path';
import { markdownLinks } from './markdown.mjs';

export const KNOWLEDGE_DIR = '.neo-trellis';
export const MAP_PATH = `${KNOWLEDGE_DIR}/map.md`;
export const ROUTES_PATH = `${KNOWLEDGE_DIR}/routes.json`;

// Universal routing text. It is deliberately free of project-specific facts;
// per-project content belongs to .neo-trellis/map.md and the files it links to.
export const ROUTER = `# Neo-Trellis

This project keeps durable knowledge in \`.neo-trellis/\`. Use it before
exploring code broadly; it exists to prevent context rot and repeated mistakes.

## How to navigate

1. Read \`.neo-trellis/map.md\` — the project map: modules, responsibilities,
   code ranges, and links to module knowledge files.
2. Load knowledge by scope: when working in a module, read its knowledge file
   (linked from the map, or resolved via \`.neo-trellis/routes.json\` which maps
   code path prefixes to knowledge files).
3. The map only tells you where to look. Verify against the actual code before
   changing behavior — the code is the current implementation truth.

## Maintaining knowledge

Follow the neo-trellis internal knowledge-maintenance skill
(\`.neo-trellis/skills/knowledge.md\` if installed as a file, otherwise the
skill shipped with the neo-trellis tooling) for how to update what you find:
keep facts and contracts distinct, record evidence-backed corrections where
they apply, and keep \`map.md\` and \`routes.json\` consistent — routes.json
is the machine authority for code-scope mapping, the map is the human/agent
navigation view over the same knowledge.

## Product requirements

When receiving a PRD or product feature brief, follow
\`.neo-trellis/skills/prd.md\` (the neo-trellis-prd skill): grill first,
present the complete PRD for user confirmation, then persist and implement
authorized work. Archive only after verifying its acceptance criteria.
PRDs live in \`.neo-trellis/prds/\`; load only the one relevant to the current
task. Ordinary small fixes do not require this process.

## Knowledge layers

For Trellis migration or post-import cleanup, follow the neo-trellis-migrate
skill at \`.neo-trellis/skills/migrate.md\`. Normal development uses map.md
directly; import reports are provenance, not an additional knowledge hierarchy.

- \`.neo-trellis/modules/\` — per-module: purpose, key entry points, code paths,
  local constraints, and counter-intuitive traps.
- \`.neo-trellis/spec/\` — cross-module contracts and stable rules.
- \`.neo-trellis/research/\` — evidence, experiments, and decision rationale.
`;

// Internal skill text: how the agent maintains project knowledge.
export const KNOWLEDGE_SKILL = `# Neo-Trellis Knowledge Maintenance

Follow this process whenever you work in this project. Do not expose it as
commands the user must invoke; it happens inside normal development.

## 1. Load by scope, not by habit

- On entering a code area you have not seen in this session, resolve which
  knowledge files apply: use the map's module table or
  \`.neo-trellis/routes.json\` prefix matching.
- Read only the module files for the scopes you will touch, plus linked
  specs that apply. Do not bulk-load all knowledge.
- Historical research is optional detail: open it when you need the *why*,
  not as routine reading.

## Initializing the map

When \`map.md\` is still a template or mostly empty, build it gradually:
explore top-level directories and entry points (manifests, main files,
index/exports) within a bounded pass — do not attempt a whole-repo read.
Record what you confirmed, mark gaps explicitly, and add rows to the module
table plus matching entries in \`routes.json\` as each module is identified.
Both must stay consistent: routes.json is the machine authority for
code-scope mapping; map.md is the navigation view over the same knowledge.
Optional helper CLIs (status/route commands) may exist but might not be
installed — never depend on them; read the files directly.

## 2. Facts vs contracts

- FACTS describe what the implementation currently is: entry points,
  data flow, dependencies. When code legitimately changes, update the facts.
- CONTRACTS state what the implementation must keep satisfying: compatibility
  promises, prohibited patterns, external agreements. If code drifts from a
  contract, treat it as a conflict — fix the code or escalate; never silently
  rewrite the contract to match the code.
- Keep each item's status visible: confirmed rule, observed fact, or
  unverified inference. Inferences never become contracts without evidence.

## 3. Recording corrections (the "mistake book")

Persist a lesson when:
- the user explicitly corrected your understanding or stated a requirement;
- a test or reproducible result exposed a non-obvious edge case;
- an approach was proven unsuitable for this project, with conditions.

Write it where it applies — the owning module's file or a spec — phrased as
"common misjudgment / correct behavior / evidence", not as a dated diary
entry. Check for an existing rule first and update it instead of duplicating.
Never persist typos, one-off tool failures, or your own unconfirmed guesses.
Record a correction at the scope the evidence actually covers — do not widen
a user correction into a broader rule than what was stated.

## Superseding old knowledge

When a new rule or fact replaces an old one, do not silently delete the old
record: mark it \`superseded\`, link it to the new rule, and keep its source
date and applicability range. Old dated research may stay untouched; what
must be marked is anything presented as *current* that is no longer true.

## 4. Updating after a change

- Near the end of a logical change, diff what you touched against the
  knowledge for that scope: update facts that shifted, keep contracts,
  flag any contract conflict you introduced.
- Verify every write: re-read the file you modified and confirm the content
  actually landed. A journal/log line is not proof of a knowledge update.
- Do not write a journal entry for every change. Only add a dated note when
  there is something worth handing off: blockers, partial progress, or
  evidence for a deferred verification.

## 5. Session boundaries

- startup: read map.md and the routes table; load scope knowledge lazily.
- compact/context loss: re-read map.md and the knowledge for scopes you were
  actively editing; the map is your recovery anchor.
- clear: load only the project knowledge entry points. Do NOT auto-resume a
  previous task; a clear may mean a fresh start. If a handoff note exists,
  mention it is available and let the user decide.
`;

const MAP_TEMPLATE = `# Project Map

> Built progressively from the actual code. Start with a bounded pass over
> top-level directories and entry points; record what is confirmed, mark
> unknowns explicitly, and extend as the codebase is explored.
> Keep the Code paths column aligned with \`routes.json\` — it is the
> machine authority for scope-to-knowledge mapping.

## Overview

<!-- One or two sentences: what this project is. -->

## Global constraints

<!-- A short list of rules that apply everywhere. Keep it short. -->

## Module map

| Module | Responsibility | Code paths | Knowledge |
|---|---|---|---|
<!-- | example | what it does | src/example/ | modules/example.md | -->

## Conventions

- This map is for navigation; verify behavior against actual code.
- When you modify a module, check whether its knowledge file is still accurate.
`;

const MODULES_INDEX = `# Modules

One file per module: \`modules/<name>.md\`. Each file should cover:

- Purpose and boundaries (what it does and deliberately does not do)
- Key entry points and important code paths
- Dependencies on other modules / external contracts it must satisfy
- Constraints and counter-intuitive traps ("common misjudgment -> correct
  behavior -> evidence")
`;

const SPEC_INDEX = `# Specs

Cross-module contracts and stable rules. These are normative: code must
satisfy them. A code change that conflicts with a spec is a conflict to
resolve, not a reason to edit the spec.

Add one file per contract area (e.g. \`compatibility.md\`, \`monetary-values.md\`).
`;

const RESEARCH_INDEX = `# Research

Dated evidence: investigations, experiments, and the rationale behind
decisions. Optional reading — consult it when you need to understand *why*
a rule or design exists, or when checking whether an old conclusion still
holds against the current code.

A research note proves something was true at a point in time; before relying
on it as current fact, verify against the code or the linked contract.
`;

const EMPTY_ROUTES =
  JSON.stringify(
    {
      version: 1,
      routes: [
        // { paths: ['src/foo/'], knowledge: ['.neo-trellis/modules/foo.md'] },
      ],
    },
    null,
    2,
  ) + '\n';

// Returns a path -> text dictionary for a fresh .neo-trellis/ scaffold.
// Templates contain structure only; nothing is invented about the project.
export function scaffoldKnowledge() {
  return {
    'AGENTS.md': ROUTER,
    [MAP_PATH]: MAP_TEMPLATE,
    [`${KNOWLEDGE_DIR}/skills/knowledge.md`]: KNOWLEDGE_SKILL,
    [`${KNOWLEDGE_DIR}/modules/index.md`]: MODULES_INDEX,
    [`${KNOWLEDGE_DIR}/spec/index.md`]: SPEC_INDEX,
    [`${KNOWLEDGE_DIR}/research/index.md`]: RESEARCH_INDEX,
    [ROUTES_PATH]: EMPTY_ROUTES,
  };
}

const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL_LINK_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^#/;

function isInside(candidate, root) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Inspect a knowledge installation at root.
// Returns { errors, warnings } where each entry is { file, message }.
// Errors: missing map, markdown links that escape root, malformed routes.json,
// routes escaping root. Missing link targets are warnings (may be filled in
// during progressive initialization).
export function inspectKnowledge(root) {
  const errors = [];
  const warnings = [];
  const absRoot = path.resolve(root);

  const mapAbs = path.join(absRoot, MAP_PATH);
  if (!fs.existsSync(mapAbs)) {
    errors.push({ file: MAP_PATH, message: 'project map is missing' });
  }

  const routesFile = path.join(absRoot, ROUTES_PATH);
  if (fs.existsSync(routesFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.routes)) {
        errors.push({
          file: ROUTES_PATH,
          message: 'routes.json must be {version:1, routes:[...]}',
        });
      } else {
        for (const [i, route] of parsed.routes.entries()) {
          for (const err of validateRoute(route, i, absRoot)) {
            errors.push({ file: ROUTES_PATH, message: err });
          }
          for (const k of route?.knowledge ?? []) {
            if (typeof k !== 'string') continue;
            const abs = path.resolve(absRoot, k);
            if (isInside(abs, absRoot) && !fs.existsSync(abs)) {
              warnings.push({
                file: ROUTES_PATH,
                message: `route ${i}: knowledge file '${k}' does not exist yet`,
              });
            }
          }
        }
      }
    } catch (err) {
      errors.push({ file: ROUTES_PATH, message: `invalid JSON: ${err.message}` });
    }
  }

  // Check markdown links inside .neo-trellis/ and AGENTS.md.
  const mdFiles = [];
  const kdir = path.join(absRoot, KNOWLEDGE_DIR);
  if (fs.existsSync(kdir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        // Do not follow symlinks during recursion: they can point outside
        // the project or create cycles.
        if (entry.isSymbolicLink()) continue;
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.md')) mdFiles.push(p);
      }
    };
    walk(kdir);
  }
  const agentsMd = path.join(absRoot, 'AGENTS.md');
  if (fs.existsSync(agentsMd)) mdFiles.push(agentsMd);

  for (const file of mdFiles) {
    const rel = path.relative(absRoot, file);
    const text = fs.readFileSync(file, 'utf8');
    for (const target of markdownLinks(text)) {
      if (EXTERNAL_LINK_RE.test(target)) continue;
      let decoded;
      try { decoded = decodeURIComponent(target.split(/[?#]/)[0]); }
      catch { warnings.push({ file: rel, message: `link '${target}' has invalid URL encoding` }); continue; }
      const resolved = path.resolve(path.dirname(file), decoded);
      if (!isInside(resolved, absRoot)) {
        errors.push({ file: rel, message: `link '${target}' escapes project root` });
      } else if (!fs.existsSync(resolved)) {
        warnings.push({ file: rel, message: `link '${target}' target does not exist` });
      }
    }
  }

  return { errors, warnings };
}

function normalizeRelPath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Shared strict schema check for one routes.json entry.
// Returns a list of error messages (empty when valid).
function validateRoute(route, i, absRoot) {
  const errors = [];
  for (const key of ['paths', 'knowledge']) {
    if (
      !Array.isArray(route?.[key]) ||
      route[key].length === 0 ||
      route[key].some((p) => typeof p !== 'string' || p.length === 0)
    ) {
      errors.push(`route ${i}: '${key}' must be a non-empty array of non-empty strings`);
      continue;
    }
    for (const p of route[key]) {
      if (!isInside(path.resolve(absRoot, p), absRoot)) {
        errors.push(`route ${i}: '${key}' entry '${p}' escapes project root`);
      }
    }
  }
  return errors;
}

// Map code paths to unique knowledge files via routes.json prefix matching.
// ALL matching routes contribute their knowledge files (a global or parent
// route's contract is never shadowed by a more specific route).
// paths: relative code paths (e.g. 'src/payments/refund.ts').
// Returns { knowledge: [unique paths sorted], unmatched: [input paths] }.
// Throws on malformed routes.json, schema violations, or inputs escaping
// the project root.
export function routeKnowledge(root, paths = []) {
  const absRoot = path.resolve(root);
  const routesFile = path.join(absRoot, ROUTES_PATH);

  let routes = [];
  if (fs.existsSync(routesFile)) {
    const parsed = JSON.parse(fs.readFileSync(routesFile, 'utf8'));
    if (parsed?.version !== 1 || !Array.isArray(parsed.routes)) {
      throw new Error(`${ROUTES_PATH} must be {version:1, routes:[...]}`);
    }
    routes = parsed.routes;
  }

  const schemaErrors = routes.flatMap((route, i) => validateRoute(route, i, absRoot));
  if (schemaErrors.length > 0) {
    throw new Error(`${ROUTES_PATH}: ${schemaErrors.join('; ')}`);
  }

  const knowledge = new Set();
  const unmatched = [];
  for (const codePath of paths.map(normalizeRelPath)) {
    const absCode = path.resolve(absRoot, codePath);
    if (!isInside(absCode, absRoot)) {
      throw new Error(`path '${codePath}' escapes project root`);
    }
    // Union of every matching route, ordered by prefix length so more
    // specific module knowledge sorts after broader/global entries.
    const matches = [];
    for (const route of routes) {
      let longest = -1;
      for (const prefix of route.paths.map(normalizeRelPath)) {
        if (
          prefix === '' || // root-scope route: matches everything
          codePath === prefix.replace(/\/$/, '') ||
          codePath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
        ) {
          if (prefix.length > longest) longest = prefix.length;
        }
      }
      if (longest >= 0) matches.push({ longest, route });
    }
    matches.sort((a, b) => a.longest - b.longest);
    if (matches.length > 0) {
      for (const { route } of matches) {
        for (const k of route.knowledge) knowledge.add(normalizeRelPath(k));
      }
    } else {
      unmatched.push(codePath);
    }
  }

  return { knowledge: [...knowledge].sort(), unmatched };
}
