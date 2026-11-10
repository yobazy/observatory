import test from 'node:test';
import assert from 'node:assert/strict';
import { costOf, summarize, totalTokens } from '../src/nebula/usageData.ts';

const now = new Date(2026, 8, 29, 12).getTime() / 1000;
const state = {
  agents: {
    a: { id: 'a', kind: 'claude', session_id: 'same-id', worktree_id: 'w', name: 'Claude task' },
    b: { id: 'b', kind: 'codex', session_id: 'same-id', worktree_id: 'w', name: 'Codex task' },
  },
  projects: { p: { id: 'p', name: 'Project', repo_path: '/repo' } },
  worktrees: { w: { id: 'w', project_id: 'p', path: '/repo', is_main: true } },
};
const bucket = (overrides = {}) => ({
  source: 'claude', session: 'same-id', cwd: '/repo', model: 'claude-opus-5-5',
  hour: now, input: 100, output: 20, cacheRead: 40, cacheWrite5m: 10, cacheWrite1h: 0,
  responses: 1, ...overrides,
});
const report = (...buckets) => ({ sources: [], files: 1, buckets });

test('all agent totals retain tokens even when a price is unknown', () => {
  const known = bucket();
  const unknown = bucket({ source: 'codex', model: 'unpriced-model' });
  const sum = summarize(report(known, unknown), state, { days: 7, now });
  assert.equal(sum.range.tokens, 340);
  assert.equal(sum.range.unpricedTokens, 170);
  assert.equal(sum.range.cost, costOf(known, known.model));
  assert.deepEqual(sum.tasks.map((t) => t.label).sort(), ['Claude task', 'Codex task']);
  assert.equal(sum.projects.length, 1);
  assert.equal(sum.projects[0].tokens, 340);
});

test('agent filter applies to totals, tasks, projects and daily chart', () => {
  const sum = summarize(report(bucket(), bucket({ source: 'codex', model: 'gpt-6-astra' })), state, { days: 7, source: 'codex', now });
  assert.equal(sum.tasks.length, 1);
  assert.equal(sum.tasks[0].agent.id, 'b');
  assert.equal(sum.range.tokens, 170);
  assert.equal(sum.today.tokens, 170);
  assert.equal(sum.daily.at(-1).tokens, 170);
  assert.equal(sum.block.tokens, 170);
});

test('recorded costs take precedence, including genuinely free requests', () => {
  assert.equal(costOf(bucket({ recordedCost: 0 }), 'unknown'), 0);
  assert.equal(costOf(bucket({ recordedCost: 1.23 }), 'gpt-6-astra'), 1.23);
  assert.equal(costOf(bucket(), 'unknown'), null);
  assert.equal(costOf(bucket({ recordedCost: -1 }), 'unknown'), null);
});

test('pricing accepts dated snapshots without guessing rates for other variants', () => {
  const tokens = bucket();
  assert.equal(costOf(tokens, 'claude-opus-5-5-20260901'), costOf(tokens, 'claude-opus-5-5'));
  assert.equal(costOf(tokens, 'gpt-6-astra-2026-09-03'), costOf(tokens, 'gpt-6-astra'));
  assert.equal(costOf(tokens, 'gpt-6-astra-pro'), null);
  assert.equal(costOf(tokens, 'claude-future-model'), null);
  assert.equal(totalTokens(tokens), 170);
});

test('project filters do not alter the all-project chart; future and old usage stay out of totals', () => {
  const data = report(bucket(), bucket({ cwd: '/outside', session: 'outside' }), bucket({ hour: now + 3600 }), bucket({ hour: now - 40 * 86400 }));
  const sum = summarize(data, state, { days: 7, project: 'p', now });
  assert.equal(sum.range.tokens, 170);
  assert.equal(sum.projects.length, 2);
  assert.equal(sum.daily.at(-1).tokens, 340);
  assert.equal(sum.block.tokens, 340);
});

/** One million of each kind of token, so a cost reads as the rates summed. */
const million = { input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite5m: 0, cacheWrite1h: 0 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('the Claude 5 family is priced: Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1', () => {
  // input + output + cache reads, $ per million (platform.claude.com pricing).
  close(costOf(million, 'claude-haiku-5-5'), 0.1 + 0.5 + 0.01);
  close(costOf(million, 'claude-sonnet-5-5'), 2 + 10 + 0.1);
  close(costOf(million, 'claude-opus-5-5'), 4 + 20 + 0.2);
  close(costOf(million, 'claude-fable-5-1'), 10 + 50 + 0.25);
  // What `claude -p --model haiku` resolves to has a price now.
  assert.notEqual(costOf(bucket(), 'claude-haiku-5-5'), null);
});

test('a family alias or a versioned name not in the table takes the latest known price of its family', () => {
  for (const family of ['haiku', 'sonnet', 'opus', 'fable']) {
    const latest = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' }[family];
    assert.equal(costOf(million, `claude-${family}`), costOf(million, latest), `claude-${family}`);
    assert.equal(costOf(million, `claude-${family}-9-9`), costOf(million, latest), `claude-${family}-9-9`);
    assert.equal(costOf(million, `claude-${family}-9-9-20270101`), costOf(million, latest), 'dated snapshot of a new version');
  }
  // Listed versions keep their own prices.
  close(costOf(million, 'claude-haiku-4-5'), 1 + 5 + 0.1);
  close(costOf(million, 'claude-sonnet-4-6'), 3 + 15 + 0.3);
  // Not a known family: still unpriced, not guessed.
  assert.equal(costOf(million, 'claude-future-model'), null);
  assert.equal(costOf(million, 'claude-haikus'), null);
});
