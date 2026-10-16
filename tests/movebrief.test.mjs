import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ASKS, moveBrief } from '../src/nebula/movebrief.ts';

const from = {
  thread: 'Sync Retry Backoff',
  project: 'storefront',
  branch: 'cart-sync',
  path: '/Users/me/code/storefront-worktrees/cart-sync',
  prompts: ['add exponential backoff when a cart sync fails'],
};
const e = (n, kind, text, steps = []) => ({ n, kind, text, at: 0, steps });

test('the brief says where the thread was, what was asked, where it got to and what it changed', () => {
  const brief = moveBrief({
    ...from,
    entries: [
      e(0, 'you', 'add exponential backoff when a cart sync fails'),
      e(1, 'steps', '', [
        { tool: 'Edit', target: '/Users/me/code/storefront-worktrees/cart-sync/src/cart/sync.ts', ok: true },
        { tool: 'Read', target: '/Users/me/code/storefront-worktrees/cart-sync/src/cart/api.ts', ok: true },
        { tool: 'Write', target: '/Users/me/code/storefront-worktrees/cart-sync/src/cart/backoff.ts', ok: true },
        { tool: 'Edit', target: '/Users/me/code/storefront-worktrees/cart-sync/src/cart/sync.ts', ok: true },
      ]),
      e(2, 'claude', 'Failed syncs now retry after 1s, 2s, 4s.\nCommitted, not pushed.'),
      e(3, 'you', 'cap it at a minute'),
    ],
  });
  assert.match(brief, /^This continues “Sync Retry Backoff”, a thread in storefront \(branch cart-sync, ~\/code\/storefront-worktrees\/cart-sync\)/);
  assert.match(brief, /What was asked there:\n- add exponential backoff when a cart sync fails\n- cap it at a minute/);
  assert.match(brief, /in its last words:\n> Failed syncs now retry after 1s, 2s, 4s\.\n> Committed, not pushed\./);
  assert.match(brief, /Files it changed there:\n- src\/cart\/sync\.ts\n- src\/cart\/backoff\.ts\n\nPick up/);
  assert.doesNotMatch(brief, /api\.ts/);
});

test('without a transcript it goes by the prompts, and keeps only the latest asks', () => {
  const prompts = Array.from({ length: MAX_ASKS + 3 }, (_, i) => `ask ${i + 1}`);
  const brief = moveBrief({ ...from, prompts });
  assert.match(brief, new RegExp(`the last ${MAX_ASKS} of ${MAX_ASKS + 3}`));
  assert.match(brief, /- ask 9/);
  assert.doesNotMatch(brief, /- ask 3\n/);
  assert.doesNotMatch(brief, /last words|Files it changed/);
});
