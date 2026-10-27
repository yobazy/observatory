import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTagReply,
  buildTagPrompt,
  listKey,
  parseTagReply,
  previewTagReply,
  tagPass,
  tagThread,
  toTag,
} from '../src/nebula/tagging.ts';
import { addTag, setThreadTags } from '../src/nebula/threadtags.ts';

const REPO = '/r/client-branding';
const LIST = ['blkwtr', 'hoam'];
const rec = (tags, by = 'you', extra = {}) => ({ tags, by, at: 1, ...extra });
const thread = (id, extra = {}) => ({ id, name: `Thread ${id}`, recent_prompts: [], root: REPO, ...extra });

test('toTag returns only the threads with no record', () => {
  const prefs = {
    threadTagLists: { [REPO]: LIST },
    threadTags: {
      A: rec(['blkwtr']),
      B: rec(['hoam']),
      C: rec(['hoam'], 'prompt'),
      D: rec([], 'you'),
    },
  };
  const threads = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => thread(id));
  assert.deepEqual(toTag(threads, prefs, REPO).map((t) => t.id), ['E', 'F']);
});

test('toTag leaves out a thread the prompt gave no tag, until the tag list changes', () => {
  const prefs = {
    threadTagLists: { [REPO]: LIST },
    threadTags: { A: rec([], 'prompt', { list: listKey(LIST) }) },
  };
  assert.deepEqual(toTag([thread('A')], prefs, REPO), []);
  const added = addTag(prefs, REPO, 'acme');
  assert.deepEqual(toTag([thread('A')], added, REPO).map((t) => t.id), ['A']);
  assert.equal(listKey(['hoam', 'blkwtr']), listKey(LIST), 'order alone is no change');
});

const stub = ({ prefs: start, ...overrides } = {}) => {
  const calls = [];
  let prefs = start ?? {
    threadTagLists: { [REPO]: LIST },
    threadTags: {},
  };
  const deps = {
    command: 'claude -p',
    prefs: () => prefs,
    projects: [{ repo: REPO, threads: ['A', 'B'].map((id) => thread(id)) }],
    edits: async () => ({}),
    run: async (prompt, tags, threads) => {
      calls.push(prompt);
      return JSON.stringify({ threads: threads.map((t) => ({ id: t.id, tags: ['blkwtr'] })) });
    },
    save: async (change) => {
      prefs = change(prefs);
    },
    now: () => 5,
    ...overrides,
  };
  return { deps, calls, prefs: () => prefs };
};

test('the runner makes no call with no tagging command, no project tags, or nothing to tag', async () => {
  for (const command of ['', '   ', undefined]) {
    const s = stub({ command });
    const r = await tagPass(s.deps);
    assert.equal(s.calls.length, 0, `command ${JSON.stringify(command)}`);
    assert.equal(r.calls, 0);
  }
  const noTags = stub({ prefs: { threadTagLists: { [REPO]: [] } } });
  await tagPass(noTags.deps);
  assert.equal(noTags.calls.length, 0, 'empty tag list');
  const allTagged = stub({ prefs: { threadTagLists: { [REPO]: LIST }, threadTags: { A: rec(['hoam']), B: rec([]) } } });
  await tagPass(allTagged.deps);
  assert.equal(allTagged.calls.length, 0, 'nothing needs tagging');

  const s = stub();
  const r = await tagPass(s.deps);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.prefs().threadTags.A, { tags: ['blkwtr'], by: 'prompt', at: 5 });
  assert.equal(r.tagged, 2);
});

test('buildTagPrompt holds the tags and each thread, clipped, and 45 threads go in 3 calls of at most 20', async () => {
  const long = 'blkwtr '.repeat(300);
  const files = Array.from({ length: 40 }, (_, i) => ({ path: `${REPO}/src/f${i}.ts`, at: 100 - i }));
  const t = tagThread(thread('A', { name: 'Logo for blkwtr', recent_prompts: [{ text: long }, { text: 'later' }] }), files, REPO);
  assert.equal(t.firstPrompt.length, 1000);
  assert.equal(t.files.length, 30);
  assert.equal(t.files[0], 'src/f0.ts', 'relative to the repo, last touched first');
  const prompt = buildTagPrompt(LIST, [t]);
  assert.match(prompt, /Tags: blkwtr, hoam/);
  assert.match(prompt, /\[A\] Logo for blkwtr/);
  assert.ok(prompt.includes(JSON.stringify(long.slice(0, 1000))));
  assert.ok(!prompt.includes(long.slice(0, 1001)));
  assert.ok(!prompt.includes('later'), 'only the first prompt');
  assert.ok(prompt.includes('src/f29.ts') && !prompt.includes('src/f30.ts'));
  assert.match(prompt, /\{"threads":\[\{"id":/);

  const many = Array.from({ length: 45 }, (_, i) => thread(`t${i}`));
  const s = stub({ projects: [{ repo: REPO, threads: many }] });
  const r = await tagPass(s.deps);
  assert.equal(s.calls.length, 3);
  const sizes = s.calls.map((p) => (p.match(/^- \[/gm) ?? []).length);
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.equal(r.sent, 45);
  assert.equal(s.calls.filter((p) => p.includes('Tags: blkwtr, hoam')).length, 3, 'the tags once per call');
});

test('parseTagReply cleans tags, keeps them to the list, and ignores ids not sent', () => {
  const reply = JSON.stringify({
    threads: [
      { id: 'A', tags: ['blkwtr', '#HOAM'] },
      { id: 'B', tags: ['acme'] },
      { id: 'Z', tags: ['hoam'] },
    ],
  });
  const r = parseTagReply(`Here you go:\n${reply}`, ['A', 'B'], LIST);
  assert.equal(r.ok, true);
  assert.deepEqual(r.threads, { A: ['blkwtr', 'hoam'], B: [] });
});

test('parseTagReply gives one error for a reply that is not JSON or has no threads list, and nothing changes', async () => {
  for (const text of ['not json at all', '{"threads": nope}', '{"tasks":[]}', '']) {
    const r = parseTagReply(text, ['A'], LIST);
    assert.equal(r.ok, false, text);
    assert.equal(typeof r.error, 'string');
  }
  const s = stub({ run: async () => 'Sorry, I can not help' });
  const r = await tagPass(s.deps);
  assert.equal(r.errors.length, 1);
  assert.deepEqual(s.prefs().threadTags, {}, "no thread's record changed");
});

test('applyTagReply leaves a thread tagged by hand while its pass ran as it is', async () => {
  const prefs = { threadTagLists: { [REPO]: LIST }, threadTags: {} };
  const reply = { A: ['blkwtr'], B: [] };
  const handTagged = setThreadTags(prefs, 'A', ['hoam'], 3);
  const next = applyTagReply(handTagged, REPO, reply, listKey(LIST), 9);
  assert.deepEqual(next.threadTags.A, { tags: ['hoam'], by: 'you', at: 3 });
  assert.deepEqual(next.threadTags.B, { tags: [], by: 'prompt', at: 9, list: listKey(LIST) });

  // The same through a pass: you tag A while the call is out.
  const s = stub();
  s.deps.run = async (prompt, tags, threads) => {
    await s.deps.save((p) => setThreadTags(p, 'A', [], 4));
    return JSON.stringify({ threads: threads.map((t) => ({ id: t.id, tags: ['blkwtr'] })) });
  };
  await tagPass(s.deps);
  assert.deepEqual(s.prefs().threadTags.A, { tags: [], by: 'you', at: 4 });
  assert.equal(s.prefs().threadTags.B.by, 'prompt');
});

test('a prompt tag changed from the menu becomes yours, and later passes skip it', () => {
  const prefs = { threadTagLists: { [REPO]: LIST }, threadTags: { A: rec(['hoam'], 'prompt') } };
  const changed = setThreadTags(prefs, 'A', ['blkwtr']);
  assert.equal(changed.threadTags.A.by, 'you');
  assert.deepEqual(toTag([thread('A')], changed, REPO), []);
  assert.deepEqual(toTag([thread('A')], addTag(changed, REPO, 'acme'), REPO), [], 'even once the list changes');
});

test('the preview reply tags each thread with the tags it names', () => {
  const r = parseTagReply(
    previewTagReply(LIST, [
      { id: 'A', title: 'blkwtr logo', firstPrompt: '', files: [] },
      { id: 'B', title: 'Other', firstPrompt: 'about hoam', files: [] },
    ]),
    ['A', 'B'],
    LIST,
  );
  assert.deepEqual(r.threads, { A: ['blkwtr'], B: ['hoam'] });
});
