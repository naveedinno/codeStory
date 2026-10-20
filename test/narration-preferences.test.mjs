import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadNarrationPreferences, narrationPreferencesFile, saveNarrationPreferences } from '../dist/narration-preferences.js';

test('CodeStory narration preferences are private, atomic and independent of Lino', () => {
  const home = mkdtempSync(join(tmpdir(), 'codestory-narration-'));
  try {
    assert.equal(loadNarrationPreferences(home).engine, 'kokoro');
    saveNarrationPreferences(home, {engine:'kokoro',voice:'af_nicole',rate:1.25});
    saveNarrationPreferences(home, {engine:'pocket',voice:'alba',rate:1.25});
    const saved = loadNarrationPreferences(home);
    assert.equal(saved.voicesByEngine.kokoro, 'af_nicole');
    assert.equal(saved.voicesByEngine.pocket, 'alba');
    assert.equal(narrationPreferencesFile(home), join(home, '.codestory/narration.json'));
    assert.equal(JSON.parse(readFileSync(narrationPreferencesFile(home),'utf8')).rate,1.25);
  } finally { rmSync(home,{recursive:true,force:true}); }
});

test('corrupt or future narration preferences recover without blocking review', () => {
  const home = mkdtempSync(join(tmpdir(), 'codestory-narration-'));
  try {
    const file = narrationPreferencesFile(home); mkdirSync(dirname(file),{recursive:true});
    for(const value of ['null','[]','invalid','{"version":99,"engine":"other","voice":"other"}']) {
      writeFileSync(file,value); assert.equal(loadNarrationPreferences(home).voice,'af_heart');
    }
  } finally { rmSync(home,{recursive:true,force:true}); }
});
