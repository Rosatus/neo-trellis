import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  scaffoldKnowledge,
  inspectKnowledge,
  routeKnowledge,
  ROUTER,
  KNOWLEDGE_SKILL,
  MAP_PATH,
  ROUTES_PATH,
} from '../src/knowledge.mjs';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'neo-trellis-'));
}

function writeScaffold(root) {
  for (const [rel, text] of Object.entries(scaffoldKnowledge())) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

test('scaffold returns all expected files', () => {
  const files = scaffoldKnowledge();
  assert.deepEqual(Object.keys(files).sort(), [
    '.neo-trellis/map.md',
    '.neo-trellis/modules/index.md',
    '.neo-trellis/research/index.md',
    '.neo-trellis/routes.json',
    '.neo-trellis/skills/knowledge.md',
    '.neo-trellis/spec/index.md',
    'AGENTS.md',
  ]);
});

test('scaffold templates contain no invented project facts', () => {
  const files = scaffoldKnowledge();
  assert.equal(files['AGENTS.md'], ROUTER);
  // Map is a template, not a hallucinated project description.
  assert.match(files[MAP_PATH], /progressively/);
  assert.doesNotMatch(files[MAP_PATH], /\b(payments|database|auth)\b/i);
  // routes.json is valid JSON with no routes.
  const routes = JSON.parse(files[ROUTES_PATH]);
  assert.deepEqual(routes, { version: 1, routes: [] });
  // Internal skill is installed alongside knowledge.
  assert.equal(files['.neo-trellis/skills/knowledge.md'], KNOWLEDGE_SKILL);
});

test('ROUTER stays generic and does not hardcode project specifics', () => {
  assert.match(ROUTER, /\.neo-trellis\/map\.md/);
  assert.match(ROUTER, /routes\.json/);
  assert.match(ROUTER, /knowledge-maintenance skill/);
  assert.doesNotMatch(ROUTER, /This project is|tech stack/i);
});

test('KNOWLEDGE_SKILL encodes the required invariants', () => {
  assert.match(KNOWLEDGE_SKILL, /FACTS/);
  assert.match(KNOWLEDGE_SKILL, /CONTRACTS/);
  assert.match(KNOWLEDGE_SKILL, /Do NOT auto-resume/);
  assert.match(KNOWLEDGE_SKILL, /re-read the file/i);
  assert.match(KNOWLEDGE_SKILL, /not write a journal entry for every change/i);
  assert.match(KNOWLEDGE_SKILL, /superseded/);
  assert.match(KNOWLEDGE_SKILL, /do not widen/i);
  assert.match(KNOWLEDGE_SKILL, /bounded pass/);
  assert.match(KNOWLEDGE_SKILL, /never depend on them/i);
});

test('inspect passes on a fresh scaffold', () => {
  const root = tmpRoot();
  writeScaffold(root);
  const { errors, warnings } = inspectKnowledge(root);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('inspect reports missing map as an error', () => {
  const root = tmpRoot();
  const { errors } = inspectKnowledge(root);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, MAP_PATH);
});

test('inspect flags links escaping root and missing targets', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, MAP_PATH),
    [
      '[outside](../../secret.md)',
      '[missing](modules/nope.md)',
      '[ok](modules/index.md)',
      '[anchor](#overview)',
      '[web](https://example.com)',
    ].join('\n'),
  );
  const { errors, warnings } = inspectKnowledge(root);
  assert.deepEqual(errors.map((e) => e.message), [
    "link '../../secret.md' escapes project root",
  ]);
  assert.deepEqual(warnings.map((w) => w.message), [
    "link 'modules/nope.md' target does not exist",
  ]);
});

test('inspect flags malformed and escaping routes', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [
        { paths: ['../outside/'], knowledge: ['.neo-trellis/modules/x.md'] },
      ],
    }),
  );
  const { errors, warnings } = inspectKnowledge(root);
  assert.ok(errors.some((e) => e.message.includes('escapes project root')));
  assert.ok(warnings.some((w) => w.message.includes('does not exist')));

  fs.writeFileSync(path.join(root, ROUTES_PATH), '{bad json');
  const res = inspectKnowledge(root);
  assert.ok(res.errors.some((e) => e.message.startsWith('invalid JSON')));
});

test('inspect collects all route schema errors structurally', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [
        { paths: [], knowledge: ['.neo-trellis/modules/x.md'] },
        { paths: ['src/'], knowledge: [] },
        { paths: ['src/'], knowledge: [42] },
        { paths: 'src/', knowledge: ['.neo-trellis/modules/y.md'] },
      ],
    }),
  );
  const { errors } = inspectKnowledge(root);
  const routeErrors = errors.filter((e) => e.file === ROUTES_PATH);
  assert.equal(routeErrors.length, 4);
  assert.ok(routeErrors.every((e) => e.message.includes('non-empty array')));
});

test('inspect does not follow symlinks during recursion', () => {
  const root = tmpRoot();
  writeScaffold(root);
  // A symlink pointing outside the root must not be walked.
  const link = path.join(root, '.neo-trellis', 'outside-link');
  try {
    fs.symlinkSync(os.tmpdir(), link, 'junction');
  } catch {
    return; // platform without symlink permission — skip silently
  }
  const { errors } = inspectKnowledge(root);
  assert.deepEqual(errors, []);
});

test('routeKnowledge unions all matching routes (no prefix shadowing)', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [
        { paths: ['src/'], knowledge: ['.neo-trellis/modules/core.md'] },
        {
          paths: ['src/payments/'],
          knowledge: [
            '.neo-trellis/modules/payments.md',
            '.neo-trellis/spec/compatibility.md',
          ],
        },
      ],
    }),
  );

  const result = routeKnowledge(root, [
    'src/payments/refund.ts',
    'src/payments/submit.ts',
    'src/util.ts',
    'docs/guide.md',
  ]);
  assert.deepEqual(result.knowledge, [
    '.neo-trellis/modules/core.md',
    '.neo-trellis/modules/payments.md',
    '.neo-trellis/spec/compatibility.md',
  ]);
  assert.deepEqual(result.unmatched, ['docs/guide.md']);
});

test('routeKnowledge collects global + nested + specific routes together', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [
        { paths: ['./'], knowledge: ['.neo-trellis/spec/global.md'] },
        { paths: ['src/'], knowledge: ['.neo-trellis/modules/core.md'] },
        { paths: ['src/payments/'], knowledge: ['.neo-trellis/modules/payments.md'] },
      ],
    }),
  );
  const result = routeKnowledge(root, ['src/payments/refund.ts']);
  assert.deepEqual(result.knowledge, [
    '.neo-trellis/modules/core.md',
    '.neo-trellis/modules/payments.md',
    '.neo-trellis/spec/global.md',
  ]);
});

test('routeKnowledge handles empty paths and missing routes file', () => {
  const root = tmpRoot();
  const result = routeKnowledge(root, []);
  assert.deepEqual(result, { knowledge: [], unmatched: [] });

  const result2 = routeKnowledge(root, ['src/x.ts']);
  assert.deepEqual(result2.knowledge, []);
  assert.deepEqual(result2.unmatched, ['src/x.ts']);
});

test('routeKnowledge rejects escaping inputs and route entries', () => {
  const root = tmpRoot();
  assert.throws(() => routeKnowledge(root, ['../outside.ts']), /escapes/);

  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [{ paths: ['src/'], knowledge: ['../outside.md'] }],
    }),
  );
  assert.throws(() => routeKnowledge(root, ['src/x.ts']), /escapes/);

  fs.writeFileSync(path.join(root, ROUTES_PATH), '{"version":2,"routes":[]}');
  assert.throws(() => routeKnowledge(root, []), /version:1/);
});

test('routeKnowledge rejects invalid route schema', () => {
  const root = tmpRoot();
  writeScaffold(root);
  for (const routes of [
    [{ paths: [], knowledge: ['a.md'] }],
    [{ paths: ['src/'], knowledge: [] }],
    [{ paths: ['src/'], knowledge: [42] }],
    [{ paths: 'src/', knowledge: ['a.md'] }],
    [{ paths: ['src/'] }],
    [{ knowledge: ['a.md'] }],
  ]) {
    fs.writeFileSync(
      path.join(root, ROUTES_PATH),
      JSON.stringify({ version: 1, routes }),
    );
    assert.throws(
      () => routeKnowledge(root, ['src/x.ts']),
      /non-empty array/,
      `routes=${JSON.stringify(routes)}`,
    );
  }
});

test('routeKnowledge normalizes windows separators and leading ./', () => {
  const root = tmpRoot();
  writeScaffold(root);
  fs.writeFileSync(
    path.join(root, ROUTES_PATH),
    JSON.stringify({
      version: 1,
      routes: [{ paths: ['src/'], knowledge: ['.neo-trellis/modules/core.md'] }],
    }),
  );
  const result = routeKnowledge(root, ['./src\\util.ts']);
  assert.deepEqual(result.knowledge, ['.neo-trellis/modules/core.md']);
});
