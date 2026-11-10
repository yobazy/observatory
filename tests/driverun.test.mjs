import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A stand-in for the app's control socket (control.rs): it answers each
// request the way the app does and remembers what it was asked.
function fakeApp(answer) {
  const dir = mkdtempSync(join(tmpdir(), 'drive-'));
  const socket = join(dir, 'c.sock');
  const asked = [];
  const server = createServer((conn) => {
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      if (!buf.endsWith('\n')) return;
      const req = JSON.parse(buf);
      asked.push(req);
      if (req.cmd === 'shot') writeFileSync(req.out, '');
      conn.end(JSON.stringify(answer(req)) + '\n');
    });
  });
  return new Promise((ok) => server.listen(socket, () => ok({ dir, socket, asked, server })));
}

// Async, so the fake app's socket keeps answering while drive runs.
function drive(app, steps, ...args) {
  return new Promise((ok) => {
    const child = spawn('python3', ['scripts/drive', 'run', '-', '--shots', join(app.dir, 'shots'), ...args], {
      env: { ...process.env, OBSERVATORY_CONTROL: app.socket },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => ok({ status, stdout, stderr }));
    child.stdin.end(steps);
  });
}
const ok = (req) => ({ ok: true, value: req.cmd === 'shot' ? req.out : req.cmd === 'text' ? 'Sent to Fix login' : 'done' });

test('a run does every step in order, and numbers its screenshots in one folder', async () => {
  const app = await fakeApp(ok);
  const r = await drive(app, 'select "Fix login"   # the thread\nshot before\n\nclick "Follow up" --nth 1\nwait Sent\nshot after.png\n');
  app.server.close();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(app.asked.map((q) => q.cmd), ['select', 'shot', 'click', 'text', 'shot']);
  assert.equal(app.asked[0].thread, 'Fix login');
  assert.equal(app.asked[2].nth, 1);
  assert.deepEqual(readdirSync(join(app.dir, 'shots')).sort(), ['01-before.png', '02-after.png']);
  assert.match(r.stdout, /✓ click "Follow up" --nth 1 → done/);
  assert.match(r.stdout, /5 steps done; screenshots in/);
});

test('a run stops at the first step that fails, and says which', async () => {
  const app = await fakeApp((req) => (req.cmd === 'click' ? { ok: false, error: 'no control called "Nope"' } : ok(req)));
  const r = await drive(app, 'select x\nclick Nope\nshot after\n');
  app.server.close();
  assert.equal(r.status, 1);
  assert.deepEqual(app.asked.map((q) => q.cmd), ['select', 'click']);
  assert.match(r.stdout, /✗ click Nope: no control called "Nope"/);
  assert.match(r.stderr, /stopped at line 2/);
});

test('a run with a line it can\'t read does nothing at all', async () => {
  const app = await fakeApp(ok);
  const r = await drive(app, 'select x\nclik Follow\n');
  app.server.close();
  assert.equal(r.status, 1);
  assert.equal(app.asked.length, 0);
  assert.match(r.stderr, /line 2: can't read `clik Follow`/);
});
