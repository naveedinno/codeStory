import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// `src/nav.ts` is gone — the top bar is `client/shared/nav.tsx`, covered by
// test/change-page.test.mjs. The diff stylesheet is a client file now.
const DIFF_CSS = readFileSync(new URL('../client/surfaces/review/review.css', import.meta.url), 'utf8');
import { sharedTokens, themeBootstrapScript, themeControl, threadAtmosphereStyles } from '../dist/theme.js';

function cssBlock(css, selector) {
  const start = css.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `missing ${selector} rule`);
  const bodyStart = start + selector.length + 1;
  return css.slice(bodyStart, css.indexOf('}', bodyStart));
}

function hexVariable(block, name) {
  const match = block.match(new RegExp(`${name}:(#[0-9a-f]{6})`, 'i'));
  assert.ok(match, `missing literal ${name}`);
  return match[1].slice(1).match(/.{2}/g).map((part) => Number.parseInt(part, 16));
}

function rgbaVariable(block, name) {
  const match = block.match(new RegExp(`${name}:rgba\\((\\d+),(\\d+),(\\d+),([\\d.]+)\\)`));
  assert.ok(match, `missing rgba literal ${name}`);
  return {
    rgb: match.slice(1, 4).map((part) => Number.parseInt(part, 10)),
    alpha: Number.parseFloat(match[4]),
  };
}

function composite({ rgb, alpha }, base) {
  return rgb.map((channel, index) => channel * alpha + base[index] * (1 - alpha));
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function apcaContrast(foreground, background) {
  const apcaY = (rgb) =>
    0.2126729 * (rgb[0] / 255) ** 2.4 +
    0.7151522 * (rgb[1] / 255) ** 2.4 +
    0.072175 * (rgb[2] / 255) ** 2.4;
  const clamp = (value) => (value > 0.022 ? value : value + (0.022 - value) ** 1.414);
  const text = clamp(apcaY(foreground));
  const back = clamp(apcaY(background));
  if (Math.abs(back - text) < 0.0005) return 0;
  if (back > text) {
    const sapc = (back ** 0.56 - text ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (back ** 0.65 - text ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

test('theme control offers persistent System, Light, and Dark choices', () => {
  const control = themeControl();
  const script = themeBootstrapScript();

  assert.match(control, /data-theme-toggle[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/);
  assert.equal((control.match(/role="menuitemradio"/g) || []).length, 3);
  assert.match(control, /data-theme-choice="system"[^>]+aria-checked="true"/);
  assert.match(control, /data-theme-choice="light"[^>]+aria-checked="false"/);
  assert.match(control, /data-theme-choice="dark"[^>]+aria-checked="false"/);
  assert.match(script, /localStorage\.setItem\(key,mode\)/);
  assert.match(script, /localStorage\.removeItem\(key\)/);
  assert.match(script, /root\.setAttribute\('data-theme',value\)/);
  assert.match(script, /media\.addEventListener\('change',onScheme\)/);
  assert.match(script, /event\.key==='ArrowDown'/);
  assert.match(script, /event\.key==='Escape'/);
});

test('theme palettes use a resolved data attribute instead of an OS-only media query', () => {
  const tokens = sharedTokens();

  assert.match(tokens, /:root\{color-scheme:dark;/);
  assert.match(tokens, /--bg:#0a0c0f/);
  assert.match(tokens, /:root\[data-theme="light"\]\{color-scheme:light;/);
  assert.match(tokens, /--bg:#edf0f4/);
  assert.doesNotMatch(tokens, /prefers-color-scheme/);
  // The review stylesheet is the last surface CSS that is not utilities; it
  // must not reintroduce an OS-only palette switch either.
  assert.doesNotMatch(DIFF_CSS, /prefers-color-scheme/);
});

test('shared geometry gives every surface soft islands and pill controls', () => {
  const tokens = sharedTokens();

  assert.match(tokens, /--radius-sm:8px;--radius:12px;--radius-lg:18px;--radius-island:26px;--radius-pill:999px/);
  assert.match(tokens, /--control-h:34px;--control-h-lg:40px/);
  // The bar itself is `client/shared/nav.tsx` now (asserted in
  // test/change-page.test.mjs); what stays checkable here is that the shared
  // geometry it consumes still exists.
});

test('light semantic diff ink stays WCAG AA on header, split, and unified surfaces', () => {
  const tokens = sharedTokens();
  const light = cssBlock(tokens, ':root[data-theme="light"]');
  const surface = hexVariable(light, '--surface');
  const header = hexVariable(light, '--surface-2');
  const addText = hexVariable(light, '--diff-add-text');
  const delText = hexVariable(light, '--diff-del-text');
  const addBackground = composite(rgbaVariable(light, '--add-bg'), surface);
  const delBackground = composite(rgbaVariable(light, '--del-bg'), surface);
  const cases = [
    ['add header', addText, header],
    ['delete header', delText, header],
    ['add split', addText, addBackground],
    ['delete split', delText, delBackground],
    ['add unified', addText, addBackground],
    ['delete unified', delText, delBackground],
  ];

  for (const [label, foreground, background] of cases) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 is below WCAG AA`);
  }
});

test('light syntax tokens stay WCAG AA across plain and tinted diff surfaces', () => {
  const tokens = sharedTokens();
  const light = cssBlock(tokens, ':root[data-theme="light"]');
  const surface = hexVariable(light, '--surface');
  const foregrounds = ['--tk-k', '--tk-t', '--tk-f', '--tk-s', '--tk-n', '--tk-c']
    .map((name) => [name, hexVariable(light, name)]);
  const addBackground = composite(rgbaVariable(light, '--add-bg'), surface);
  const delBackground = composite(rgbaVariable(light, '--del-bg'), surface);
  const backgrounds = [
    ['plain', surface],
    ['split add', addBackground],
    ['split delete', delBackground],
    ['unified add', addBackground],
    ['unified delete', delBackground],
  ];

  for (const [token, foreground] of foregrounds) {
    for (const [surfaceName, background] of backgrounds) {
      const ratio = contrastRatio(foreground, background);
      assert.ok(ratio >= 4.5, `${token} on ${surfaceName} is ${ratio.toFixed(2)}:1, below WCAG AA`);
    }
  }
});

test('semantic action and status inks stay WCAG AA in the light theme', () => {
  const tokens = sharedTokens();
  const light = cssBlock(tokens, ':root[data-theme="light"]');
  const surface2 = hexVariable(light, '--surface-2');
  const surface3 = hexVariable(light, '--surface-3');
  const fill2 = composite(rgbaVariable(light, '--fill-2'), surface2);
  const amberSoft = composite(rgbaVariable(light, '--amber-soft'), surface2);
  const cases = [
    ['solid action hover', hexVariable(light, '--on-accent'), hexVariable(light, '--accent-solid-hover')],
    ['warning label', hexVariable(light, '--amber-text'), surface2],
    ['warning badge', hexVariable(light, '--amber-text'), amberSoft],
    ['danger action', hexVariable(light, '--diff-del-text'), surface3],
    ['neutral status', hexVariable(light, '--neutral-status-text'), fill2],
    ['decorative numeral', hexVariable(light, '--accent-text'), surface2],
  ];

  assert.match(light, /--numeral:var\(--accent-text\)/);
  for (const [label, foreground, background] of cases) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${label} contrast ${ratio.toFixed(2)}:1 is below WCAG AA`);
  }
  const bodyLc = Math.abs(apcaContrast(hexVariable(light, '--text-2'), surface2));
  assert.ok(bodyLc >= 75, `light secondary body contrast Lc ${bodyLc.toFixed(1)} is below 75`);
});

test('dark secondary text keeps APCA body and label contrast on elevated surfaces', () => {
  const dark = cssBlock(sharedTokens(), ':root');
  const surface2 = hexVariable(dark, '--surface-2');
  const surface3 = hexVariable(dark, '--surface-3');
  const accentSoft = composite(rgbaVariable(dark, '--accent-soft'), surface2);
  const neutralStatusBackground = composite(rgbaVariable(dark, '--fill-2'), surface3);
  const bodyLc = Math.abs(apcaContrast(hexVariable(dark, '--text-2'), surface3));
  const labelLc = Math.abs(apcaContrast(hexVariable(dark, '--text-3'), surface3));
  const accentLc = Math.abs(apcaContrast(hexVariable(dark, '--accent-text'), accentSoft));
  const dangerLc = Math.abs(apcaContrast(hexVariable(dark, '--diff-del-text'), surface3));
  const neutralStatusLc = Math.abs(apcaContrast(hexVariable(dark, '--neutral-status-text'), neutralStatusBackground));
  const onAccentLc = Math.abs(apcaContrast(hexVariable(dark, '--on-accent'), hexVariable(dark, '--accent')));

  assert.ok(bodyLc >= 75, `secondary body contrast Lc ${bodyLc.toFixed(1)} is below 75`);
  assert.ok(labelLc >= 60, `muted label contrast Lc ${labelLc.toFixed(1)} is below 60`);
  assert.ok(accentLc >= 60, `accent label contrast Lc ${accentLc.toFixed(1)} is below 60`);
  assert.ok(dangerLc >= 60, `danger label contrast Lc ${dangerLc.toFixed(1)} is below 60`);
  assert.ok(neutralStatusLc >= 60, `neutral status contrast Lc ${neutralStatusLc.toFixed(1)} is below 60`);
  assert.ok(onAccentLc >= 60, `on-accent label contrast Lc ${onAccentLc.toFixed(1)} is below 60`);
});

test('page atmosphere shares one map, thread pulse, compact, and reduced-motion contract', () => {
  const css = threadAtmosphereStyles();
  assert.match(css, /body\.ds-map-bg::before/);
  assert.match(css, /animation:ds-thread-pulse 11s linear 2s infinite backwards/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.ds-atmosphere-thread \.thread-pulse\{display:none\}/);
  assert.match(css, /max-width:480px\)\{\.ds-thread-layer\[data-thread-compact="hide"\]\{display:none\}/);
});

test('syntax and text inks stay WCAG AA on word-level emphasis backgrounds in both themes', () => {
  const tokens = sharedTokens();
  const themes = [
    ['dark', cssBlock(tokens, ':root')],
    ['light', cssBlock(tokens, ':root[data-theme="light"]')],
  ];
  const tokenNames = ['--tk-k', '--tk-t', '--tk-f', '--tk-s', '--tk-n', '--tk-c', '--text'];

  for (const [theme, block] of themes) {
    const surface = hexVariable(block, '--surface');
    const addEmphasis = composite(
      rgbaVariable(block, '--add-emphasis-bg'),
      composite(rgbaVariable(block, '--add-bg'), surface),
    );
    const delEmphasis = composite(
      rgbaVariable(block, '--del-emphasis-bg'),
      composite(rgbaVariable(block, '--del-bg'), surface),
    );
    const backgrounds = [
      ['add emphasis', addEmphasis],
      ['delete emphasis', delEmphasis],
    ];
    for (const name of tokenNames) {
      const foreground = hexVariable(block, name);
      for (const [surfaceName, background] of backgrounds) {
        const ratio = contrastRatio(foreground, background);
        assert.ok(ratio >= 4.5, `${theme} ${name} on ${surfaceName} is ${ratio.toFixed(2)}:1, below WCAG AA`);
      }
    }
  }
});

test('type size tokens use rem so a larger root font size scales text', () => {
  const dark = cssBlock(sharedTokens(), ':root');
  const expected = [
    ['--text-xs', '.625rem'],
    ['--text-sm', '.6875rem'],
    ['--text-md', '.78125rem'],
    ['--text-base', '.8125rem'],
    ['--text-lg', '1rem'],
    ['--text-xl', '1.25rem'],
    ['--text-2xl', '1.625rem'],
    ['--text-numeral', '1.625rem'],
    ['--text-numeral-lg', '3.5rem'],
  ];
  for (const [name, value] of expected) {
    assert.ok(dark.includes(`${name}:${value};`), `${name} should be ${value}`);
  }
  assert.doesNotMatch(dark, /--text-(?:xs|sm|md|base|lg|xl|2xl|numeral|numeral-lg):[^;]*px/);
});

test('increased contrast widens canonical text, line and ink tokens', () => {
  const tokens = sharedTokens();
  assert.match(tokens, /@media \(prefers-contrast: more\)/);
  const block = tokens.slice(tokens.indexOf('@media (prefers-contrast: more)'));
  for (const name of ['--text:', '--text-2:', '--line:', '--accent-text:', '--diff-add-text:', '--amber-text:']) {
    assert.ok(block.includes(name), `prefers-contrast block should widen ${name}`);
  }
});

test('front-door pages apply the saved theme before CSS and expose one selector', () => {
  // All three front doors — the repository picker, review history and the
  // change/scope page — are React surfaces now and none of them renders its
  // theme control server-side. Their half of this contract (bootstrap before
  // the stylesheet, exactly one theme control, one theme-color meta, the
  // `ds-map-bg` body class, and no ornamental thread furniture on the two that
  // never had it) is asserted in test/picker.test.mjs,
  // test/story-picker.test.mjs and test/change-page.test.mjs — against the
  // shell each route serves, and against the real page in a browser.
  //
  // The review page was the last server-rendered theme control and is a React
  // surface too now, so `src/nav.ts` is gone. What is still assertable here is
  // that the bootstrap the shell inlines is the ONLY thing that resolves a
  // theme before paint — everything else reacts to the attribute it sets.
  const script = themeBootstrapScript();
  assert.match(script, /data-theme/);
  assert.equal((script.match(/<script>/g) || []).length, 1);
});
