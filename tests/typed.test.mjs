import test from 'node:test';
import assert from 'node:assert/strict';
import { afterKeys, forgetKeys, isReport, noteKeys, rubOut, unsentLine } from '../src/nebula/typed.ts';

test('keys typed build up the line, and Enter empties it', () => {
  assert.equal(afterKeys('', 'cool yeah'), 'cool yeah');
  assert.equal(afterKeys('cool', ' yeah\x7f\x7f'), 'cool ye');
  assert.equal(afterKeys('cool yeah', '\r'), '');
  assert.equal(afterKeys('', 'one\rtwo'), 'two');
});

test('Shift-Enter and pastes stay on the line', () => {
  assert.equal(afterKeys('a', '\x1b\rb'), 'a\nb');
  assert.equal(afterKeys('see ', '\x1b[200~x\r\ny\x1b[201~'), 'see x\ny');
});

test('Ctrl-C and Ctrl-U clear it', () => {
  assert.equal(afterKeys('draft', '\x03'), '');
  assert.equal(afterKeys('draft', '\x15'), '');
});

test('a key that moves the cursor makes it unknown until Enter', () => {
  assert.equal(afterKeys('draft', '\x1b[D'), null);
  assert.equal(afterKeys(null, 'more'), null);
  assert.equal(afterKeys(null, '\r'), '');
  assert.equal(afterKeys('', '\x1b[A\rnext'), 'next');
  assert.equal(afterKeys('', '\t'), null);
});

test('the line is kept per agent, and rubbed out from the end', () => {
  noteKeys('a1', 'héllo 👋');
  assert.equal(unsentLine('a1'), 'héllo 👋');
  assert.equal(rubOut(unsentLine('a1')), '\x7f'.repeat(7));
  noteKeys('a1', rubOut(unsentLine('a1')));
  assert.equal(unsentLine('a1'), '');
  noteKeys('a2', 'x\x1b[A');
  assert.equal(unsentLine('a2'), null);
  forgetKeys('a2');
  assert.equal(unsentLine('a2'), '');
});

test("the terminal's own mouse and focus reports aren't keys", () => {
  assert.equal(isReport('\x1b[<35;12;7M'), true, 'a mouse move');
  assert.equal(isReport('\x1b[<0;3;4M\x1b[<0;3;4m'), true, 'a click');
  assert.equal(isReport('\x1b[I'), true, 'focus in');
  assert.equal(isReport('\x1b[O'), true, 'focus out');
  assert.equal(isReport('\x1b[M #!'), true, 'an old-style mouse report');
  assert.equal(isReport('a'), false);
  assert.equal(isReport('\x1b[D'), false, 'an arrow key');
  assert.equal(isReport('\x1b[<35;12;7Mx'), false, 'a key after a report');
  noteKeys('t-report', 'draft');
  noteKeys('t-report', '\x1b[<35;1;1M');
  assert.equal(unsentLine('t-report'), 'draft', 'a mouse move leaves the draft known');
  forgetKeys('t-report');
});
