// A picked color fills the row (styles.css, "a picked color fills the
// row"): its text has to read on the fill, plain, hovered and selected, for
// every color in the picker, in both themes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
// The picker's colors, read from icons.ts (which needs the app to import).
const icons = readFileSync(new URL('../src/nebula/icons.ts', import.meta.url), 'utf8');
const PROJECT_COLORS = [...icons.matchAll(/\{ name: "(\w+)", hue: (\d+) \}/g)].map((m) => ({ name: m[1], hue: Number(m[2]) }));
assert.equal(PROJECT_COLORS.length, 8);
const block = css.slice(css.indexOf('/* ---------- a picked color fills the row ---------- */'));

/** The `--name: hsl(var(--pc) S% L%)` declarations in the rule for `selector`. */
function tokens(selector) {
  const at = block.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  const body = block.slice(at, block.indexOf('}', at));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*hsl\(var\(--pc\)\s+([\d.]+)%\s+([\d.]+)%\)/g)) out[m[1]] = [Number(m[2]), Number(m[3])];
  return out;
}

function hsl(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}

function luminance([r, g, b]) {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const dark = tokens('.row.has-color');
const light = { ...dark, ...tokens(':root[data-mode="light"] .row.has-color') };

for (const [mode, t] of [['dark', dark], ['light', light]]) {
  test(`in ${mode} mode, names and details read on every color's fill`, () => {
    for (const { name, hue } of PROJECT_COLORS) {
      for (const surface of ['fill', 'fill-hover', 'fill-on']) {
        const bg = hsl(hue, ...t[surface]);
        // Names: the WCAG bar for body text. Details and times: for large
        // or secondary text.
        const text = contrast(hsl(hue, ...t['on-fill']), bg);
        const muted = contrast(hsl(hue, ...t.muted), bg);
        const faint = contrast(hsl(hue, ...t.faint), bg);
        assert.ok(text >= 4.5, `${name} ${surface}: text ${text.toFixed(2)}`);
        assert.ok(muted >= 4.5, `${name} ${surface}: details ${muted.toFixed(2)}`);
        assert.ok(faint >= 3, `${name} ${surface}: times ${faint.toFixed(2)}`);
      }
    }
  });
}

test('the selected ring stands out from the fill it sits on', () => {
  for (const t of [dark, light]) {
    for (const { name, hue } of PROJECT_COLORS) {
      const ring = contrast(hsl(hue, ...t['fill-ring']), hsl(hue, ...t['fill-on']));
      assert.ok(ring >= 2.5, `${name}: ring ${ring.toFixed(2)}`);
    }
  }
});

test('rows are filled, not striped', () => {
  assert.ok(!/\.has-color::before/.test(css), 'the old stripe is gone');
  assert.match(block, /background: var\(--fill\);/);
});
