import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { lastLocalUrl, portOf } = await import('../src/nebula/serving.ts');

test('the last address an agent printed wins', () => {
  const text = 'Started on http://localhost:3000\nmoved it: now on http://localhost:5174/ .';
  assert.equal(lastLocalUrl(text), 'http://localhost:5174/');
});

test('a "Local:" line beats a request the server logged after it', () => {
  const text = '\x1b[32m  ➜  Local:\x1b[0m   http://localhost:5173/\n  ➜  Network: use --host\nGET http://127.0.0.1:9229/json 200';
  assert.equal(lastLocalUrl(text), 'http://localhost:5173/');
});

test('prose without a scheme counts when it names a port', () => {
  assert.equal(lastLocalUrl("It's up on localhost:4321."), 'http://localhost:4321');
  assert.equal(lastLocalUrl('bound to 0.0.0.0:8080'), 'http://localhost:8080');
  assert.equal(lastLocalUrl('edit /etc/hosts for localhost'), null);
  assert.equal(lastLocalUrl('ssh git@localhost:22'), null);
  assert.equal(lastLocalUrl('see https://example.com/localhost:3000'), null);
});

test('the port is the one in the address, else the scheme’s', () => {
  assert.equal(portOf('http://localhost:5173/'), 5173);
  assert.equal(portOf('http://localhost/'), 80);
  assert.equal(portOf('https://localhost'), 443);
});

test('words Claude Code places with cursor moves stay apart', () => {
  const screen = '\x1b[39mup\x1b[8Gat\x1b[11Glocalhost:5173\r\x1b[1B\x1b[Kand\x1b[5Gmore';
  assert.equal(lastLocalUrl(screen), 'http://localhost:5173');
  assert.equal(lastLocalUrl('see\x1b[5Ghttp://localhost:3000\x1b[1Bdone'), 'http://localhost:3000');
  // As Claude Code drew it.
  const drawn = ';255m⏺\x1b[3G\x1b[39mOnce\x1b[8Gmore,\x1b[14Gthe\x1b[18Gtest\x1b[23Gaddress:\x1b[32Ghttp://127.0.0.1:4321\r\x1b[1B\x1b[K\r\x1b[1B';
  assert.equal(lastLocalUrl(drawn), 'http://127.0.0.1:4321');
});
