import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  codexStoryModelChoices,
  codexTaskBinary,
  listCodexStoryModels,
} from '../dist/codex-tasks.js';

test('configured Codex task runtime overrides platform discovery', () => {
  const before = process.env.CODESTORY_CODEX_BINARY;
  process.env.CODESTORY_CODEX_BINARY = '/tmp/codex-desktop-test';
  try {
    assert.equal(codexTaskBinary(), '/tmp/codex-desktop-test');
  } finally {
    if (before === undefined) delete process.env.CODESTORY_CODEX_BINARY;
    else process.env.CODESTORY_CODEX_BINARY = before;
  }
});

test('the pre-rename DIFFSTORY_CODEX_BINARY still works, and CODESTORY_CODEX_BINARY wins', () => {
  const names = ['CODESTORY_CODEX_BINARY', 'DIFFSTORY_CODEX_BINARY'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.CODESTORY_CODEX_BINARY;
    process.env.DIFFSTORY_CODEX_BINARY = '/tmp/codex-under-the-old-name';
    assert.equal(codexTaskBinary(), '/tmp/codex-under-the-old-name');
    process.env.CODESTORY_CODEX_BINARY = '/tmp/codex-under-the-new-name';
    assert.equal(codexTaskBinary(), '/tmp/codex-under-the-new-name');
    process.env.CODESTORY_CODEX_BINARY = '   ';
    assert.equal(codexTaskBinary(), '/tmp/codex-under-the-old-name', 'a blank new name falls through to the old one');
  } finally {
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
});

test('story model choices come from the live visible Codex catalog', () => {
  assert.deepEqual(codexStoryModelChoices({ data: [
    { model: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', hidden: false, isDefault: true },
    { model: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', hidden: false, isDefault: false },
    { model: 'codex-auto-review', displayName: 'Auto Review', hidden: true, isDefault: false },
  ] }), [
    {
      label: 'Best quality',
      model: 'gpt-5.6-sol',
      description: 'GPT-5.6-Sol · recommended by your Codex app',
    },
    {
      label: 'Lower cost',
      model: 'gpt-5.4-mini',
      description: 'GPT-5.4-Mini · smaller model available in your Codex app',
    },
  ]);
});

test('model discovery uses app-server model/list and never invents a fallback model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-codex-models-'));
  const fake = join(dir, 'codex');
  writeFileSync(
    fake,
    `#!/usr/bin/env node
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\\n');
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id === 1) process.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\\n');
    if (message.id === 2) {
      if (message.method !== 'model/list') process.exit(3);
      process.stdout.write(JSON.stringify({ id: 2, result: { data: [
        { model: 'codex-best', displayName: 'Codex Best', hidden: false, isDefault: true }
      ] } }) + '\\n');
    }
  }
});
`,
  );
  chmodSync(fake, 0o755);
  try {
    // Match the production timeout: the complete suite starts many child
    // processes in parallel, so a 3s test-only deadline can expire before this
    // tiny fixture is scheduled even though the protocol is healthy.
    assert.deepEqual(await listCodexStoryModels({ binary: fake, timeoutMs: 8000 }), [{
      label: 'Best quality',
      model: 'codex-best',
      description: 'Codex Best · recommended by your Codex app',
    }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
