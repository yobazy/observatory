import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { localUrls, remember, pick, portOf, KEEP } = await import('../src/nebula/serving.ts');

test('addresses come out once each, in the order last printed', () => {
  const text = 'Started on http://localhost:3000\nmoved: now on http://localhost:5174/ .\nback on http://localhost:3000';
  assert.deepEqual(localUrls(text), ['http://localhost:5174/', 'http://localhost:3000']);
});

test('prose without a scheme counts when it names a port', () => {
  assert.deepEqual(localUrls("It's up on localhost:4321."), ['http://localhost:4321']);
  assert.deepEqual(localUrls('bound to 0.0.0.0:8080'), ['http://localhost:8080']);
  assert.deepEqual(localUrls('edit /etc/hosts for localhost'), []);
  assert.deepEqual(localUrls('ssh git@localhost:22'), []);
  assert.deepEqual(localUrls('see https://example.com/localhost:3000'), []);
});

test('words Claude Code places with cursor moves stay apart', () => {
  const screen = '\x1b[39mup\x1b[8Gat\x1b[11Glocalhost:5173\r\x1b[1B\x1b[Kand\x1b[5Gmore';
  assert.deepEqual(localUrls(screen), ['http://localhost:5173']);
  // As Claude Code drew it.
  const drawn = ';255m⏺\x1b[3G\x1b[39mOnce\x1b[8Gmore,\x1b[14Gthe\x1b[18Gtest\x1b[23Gaddress:\x1b[32Ghttp://127.0.0.1:4321\r\x1b[1B\x1b[K\r\x1b[1B';
  assert.deepEqual(localUrls(drawn), ['http://127.0.0.1:4321']);
});

test('an agent keeps its last few addresses, newest last', () => {
  assert.deepEqual(remember(['a', 'b'], ['a', 'c']), ['b', 'a', 'c']);
  const many = Array.from({ length: KEEP + 2 }, (_, i) => `u${i}`);
  assert.equal(remember([], many).length, KEEP);
  assert.equal(remember([], many).at(-1), `u${KEEP + 1}`);
});

test('the newest address that answers is the one shown', () => {
  // The live server, then an example written in prose after it.
  const found = ['http://127.0.0.1:4321', 'http://localhost:5173'];
  assert.deepEqual(pick(found, new Set([4321]), undefined), { url: 'http://127.0.0.1:4321', live: true });
  assert.deepEqual(pick(found, new Set([4321, 5173]), undefined), { url: 'http://localhost:5173', live: true });
});

test('a server that stops is greyed, an address that never answered never shows', () => {
  const found = ['http://localhost:5173'];
  assert.equal(pick(found, new Set(), undefined), undefined);
  assert.deepEqual(pick(found, new Set(), { url: 'http://localhost:5173', live: true }), { url: 'http://localhost:5173', live: false });
});

test('the port is the one in the address, else the scheme’s', () => {
  assert.equal(portOf('http://localhost:5173/'), 5173);
  assert.equal(portOf('http://localhost/'), 80);
  assert.equal(portOf('https://localhost'), 443);
});
