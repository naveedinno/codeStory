#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const editor = process.argv[2];
if (editor !== 'vscode' && editor !== 'zed') {
  console.error('usage: node scripts/set-source-editor.mjs <vscode|zed> [home]');
  process.exit(2);
}

const home = process.argv[3] || homedir();
const file = join(home, '.codestory', 'settings.json');
let current = {};
if (existsSync(file)) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) current = parsed;
  } catch {
    // Replace a malformed preference with a valid minimal file.
  }
}

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify({ ...current, version: 1, editor }, null, 2) + '\n');
console.log(`Selected ${editor === 'zed' ? 'Zed' : 'VS Code'} for codeStory source jumps.`);
