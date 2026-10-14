import test from 'node:test';
import assert from 'node:assert/strict';
import { gridFont, termFont, zoomed, SIZE_DEFAULT, SIZE_MAX, SIZE_MIN } from '../src/nebula/termfont.ts';

test('unset prefs give the bundled face at the default size', () => {
  const f = termFont({});
  assert.match(f.family, /^"JetBrains Mono"/);
  assert.equal(f.size, SIZE_DEFAULT);
  assert.equal(f.lineHeight, 1.15);
});

test('odd values fall back instead of breaking the terminal', () => {
  const f = termFont({ terminalFont: 'comic', terminalFontSize: 400, terminalLineHeight: 7 });
  assert.match(f.family, /JetBrains/);
  assert.equal(f.size, SIZE_MAX);
  assert.equal(f.lineHeight, 1.15);
  assert.equal(termFont({ terminalFontSize: Number.NaN }).size, SIZE_DEFAULT);
});

test('zoom steps by one and stops at the ends', () => {
  assert.equal(zoomed({}, 1), SIZE_DEFAULT + 1);
  assert.equal(zoomed({ terminalFontSize: SIZE_MIN }, -1), SIZE_MIN);
  assert.equal(zoomed({ terminalFontSize: 18 }, 0), SIZE_DEFAULT);
});

test('the grid follows, smaller', () => {
  assert.equal(gridFont({ terminalFontSize: 16, terminalFont: 'menlo' }).size, 14.5);
  assert.equal(gridFont({ terminalFontSize: 16, terminalFont: 'menlo' }).family, 'Menlo, monospace');
});
