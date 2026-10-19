// While a retired storyteller copy is still installed, both client surfaces say
// which skill was renamed to codestory-storyteller, from the server's
// legacyNames. Both helpers run here for real, not as matched source text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const engine = readFileSync(new URL('../client/surfaces/review/engine/review-engine.js', import.meta.url), 'utf8');
const banner = readFileSync(new URL('../client/surfaces/picker/SkillBanner.tsx', import.meta.url), 'utf8');

/** The review engine's generator warning for one skills payload. */
function engineWarning(skills) {
  const source = engine.match(/  function showStorySkillState\([^]*?\n  }/)?.[0];
  assert.ok(source, 'the engine has showStorySkillState');
  const els = {
    warn: { hidden: true },
    warnText: { textContent: '' },
    updateBtn: { hidden: true, disabled: true, textContent: '' },
    agentSel: { value: '' },
  };
  const context = vm.createContext({
    storySkills: null,
    storySkillHide: null,
    storyGenEls: () => els,
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  vm.runInContext(source, context);
  context.showStorySkillState(skills);
  return els;
}

/** The picker banner's sentence for a list of retired names. */
function bannerText(names) {
  const source = banner.match(/function legacyText\([^]*?\n}/)?.[0];
  assert.ok(source, 'SkillBanner has legacyText');
  const context = vm.createContext({});
  vm.runInContext(transformSync(source, { loader: 'ts' }).code, context);
  return context.legacyText(names);
}

test('the review engine names the retired storyteller skill it was told about', () => {
  const one = engineWarning({ legacyInstalled: true, legacyNames: ['diffstory-storyteller'] });
  assert.equal(
    one.warnText.textContent,
    'diffstory-storyteller was renamed to codestory-storyteller. Update skills to remove the retired copy before generating.',
  );
  assert.equal(one.warn.hidden, false);
  assert.equal(one.updateBtn.hidden, false);
  assert.equal(
    engineWarning({ legacyInstalled: true, legacyNames: ['review-tour', 'diffstory-storyteller'] }).warnText.textContent,
    'review-tour and diffstory-storyteller were renamed to codestory-storyteller. Update skills to remove the retired copies before generating.',
  );
  assert.match(
    engineWarning({ legacyInstalled: true }).warnText.textContent,
    /^An older storyteller skill was renamed to codestory-storyteller\./,
    'a payload without names still explains the rename',
  );
});

test('the picker banner names the retired storyteller skill it was told about', () => {
  assert.match(banner, /if \(skills\.legacyInstalled\) return legacyText\(skills\.legacyNames\);/);
  assert.equal(
    bannerText(['diffstory-storyteller']),
    'diffstory-storyteller was renamed to codestory-storyteller. Update skills to remove the retired copy and finish migration.',
  );
  assert.equal(
    bannerText(['review-tour', 'diffstory-storyteller']),
    'review-tour and diffstory-storyteller were renamed to codestory-storyteller. Update skills to remove the retired copies and finish migration.',
  );
  assert.match(bannerText(undefined), /^An older storyteller skill was renamed to codestory-storyteller\./);
});
