import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editorPreferencesFile,
  loadEditorPreferences,
  saveSourceEditor,
} from '../dist/editor-preferences.js';

const tempHome = () => mkdtempSync(join(tmpdir(), 'codestory-editor-preferences-'));

test('source editor defaults to VS Code when no preference exists', () => {
  const home = tempHome();
  try {
    assert.deepEqual(loadEditorPreferences(home), { version: 1, editor: 'vscode' });
    assert.equal(editorPreferencesFile(home), join(home, '.codestory', 'settings.json'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('source editor preference round-trips and preserves unrelated settings', () => {
  const home = tempHome();
  try {
    mkdirSync(join(home, '.codestory'), { recursive: true });
    writeFileSync(
      editorPreferencesFile(home),
      JSON.stringify({ version: 1, futureSetting: true, editor: 'vscode' }),
    );

    saveSourceEditor(home, 'zed');

    assert.deepEqual(loadEditorPreferences(home), { version: 1, editor: 'zed' });
    assert.deepEqual(JSON.parse(readFileSync(editorPreferencesFile(home), 'utf8')), {
      version: 1,
      futureSetting: true,
      editor: 'zed',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('malformed or unsupported source editor preferences fail closed to the default', () => {
  const home = tempHome();
  try {
    mkdirSync(join(home, '.codestory'), { recursive: true });
    writeFileSync(editorPreferencesFile(home), 'not json');
    assert.equal(loadEditorPreferences(home).editor, 'vscode');

    writeFileSync(editorPreferencesFile(home), '{"version":1,"editor":"vim"}');
    assert.equal(loadEditorPreferences(home).editor, 'vscode');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('the integration helper selects Zed without discarding future settings', () => {
  const home = tempHome();
  try {
    mkdirSync(join(home, '.codestory'), { recursive: true });
    writeFileSync(editorPreferencesFile(home), '{"futureSetting":"kept","editor":"vscode"}\n');

    execFileSync(
      process.execPath,
      ['scripts/set-source-editor.mjs', 'zed', home],
      { cwd: new URL('..', import.meta.url), stdio: 'pipe' },
    );

    const settings = JSON.parse(readFileSync(editorPreferencesFile(home), 'utf8'));
    assert.deepEqual(settings, {
      futureSetting: 'kept',
      editor: 'zed',
      version: 1,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
