import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  ago,
  expectedEvery,
  fixPrompt,
  health,
  jobList,
  jobProject,
  nextRun,
  parseLaunchctl,
  runAction,
  runNow,
  scheduleText,
  shownLabels,
  track,
  until,
  worstHealth,
} from '../src/nebula/automations.ts';

const dir = new URL('./fixtures/automations/', import.meta.url);
const text = (name) => readFileSync(new URL(name, dir), 'utf8');
/** The way automations.rs reads a plist. */
const plist = (name) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', new URL(name, dir).pathname], { encoding: 'utf8' }));

const NOW = new Date(2026, 9, 22, 12, 0).getTime();
const MIN = 60_000;
const raw = (over = {}) => ({
  label: 'com.bazil.a',
  plistPath: '/Users/x/Library/LaunchAgents/com.bazil.a.plist',
  plist: { Label: 'com.bazil.a', StartInterval: 300 },
  launchctl: text('launchctl-wispr-watch.txt'),
  lastWrite: NOW - MIN,
  tail: ['synced'],
  ...over,
});

// ---- scheduleText ----

test('schedule: the todos-notion plist runs every 5 min and when 3 files change', () => {
  assert.equal(scheduleText(plist('com.bazil.todos-notion.plist')), 'Every 5 min, and when 3 files change');
});

test('schedule: StartInterval 7200 reads "Every 2 h"', () => {
  assert.equal(scheduleText({ StartInterval: 7200 }), 'Every 2 h');
  assert.equal(scheduleText(plist('com.bazil.career-ops.mailwatch.plist')), 'Every 2 h');
});

test('schedule: KeepAlive true reads "Always on"', () => {
  assert.equal(scheduleText({ KeepAlive: true }), 'Always on');
  assert.equal(scheduleText(plist('ai.hermes.gateway.plist')), 'Always on');
});

test('schedule: StartCalendarInterval {Hour: 9, Minute: 0} reads "Daily at 9:00 am"', () => {
  assert.equal(scheduleText({ StartCalendarInterval: { Hour: 9, Minute: 0 } }), 'Daily at 9:00 am');
  assert.equal(
    scheduleText({ StartCalendarInterval: [{ Hour: 21, Minute: 0 }, { Hour: 9, Minute: 0 }] }),
    'Daily at 9:00 am and 9:00 pm',
  );
});

test('next run: last run plus StartInterval, or the next calendar match', () => {
  assert.equal(nextRun({ StartInterval: 120 }, NOW - MIN, true, NOW), NOW + MIN);
  assert.equal(nextRun({ StartCalendarInterval: { Hour: 9, Minute: 0 } }, null, true, NOW), new Date(2026, 9, 23, 9, 0).getTime());
  assert.equal(nextRun({ KeepAlive: true }, NOW, true, NOW), null);
  assert.equal(nextRun({ StartInterval: 120 }, NOW, false, NOW), null);
});

// ---- health ----

test('health: launchctl "Could not find service" is not loaded', () => {
  assert.equal(parseLaunchctl(text('launchctl-missing.txt')).loaded, false);
  assert.equal(health(raw({ launchctl: text('launchctl-missing.txt') }), NOW).health, 'not loaded');
});

test('health: last exit code 1 is failing with "Exited with code 1"', () => {
  assert.deepEqual(health(raw({ launchctl: text('launchctl-exit1.txt') }), NOW), {
    health: 'failing',
    reason: 'Exited with code 1',
  });
});

test('health: exit code 0 with a PermissionError ending the tail is failing with that line', () => {
  const tail = text('todos-notion.log.txt').trimEnd().split('\n');
  assert.deepEqual(health(raw({ tail }), NOW), {
    health: 'failing',
    reason: "PermissionError: [Errno 1] Operation not permitted: '/Users/x/Documents/Programming'",
  });
});

test('health: every 120 s, logs last written 10 min ago, is stale', () => {
  const r = raw({ plist: plist('com.bazil.wispr-watch.plist'), lastWrite: NOW - 10 * MIN });
  // Watched for the last 10 minutes, with runs never going up.
  const watch = { since: NOW - 10 * MIN, runs: 77, ranAt: null };
  assert.deepEqual(health(r, NOW, watch), { health: 'stale', reason: 'No run in 10 min (expected every 2 min)' });
  assert.equal(health({ ...r, lastWrite: NOW - 5 * MIN }, NOW, watch).health, 'ok');
});

/** launchctl print output with a given runs count and exit code 0. */
const printed = (runs) => text('launchctl-wispr-watch.txt').replace('runs = 77', `runs = ${runs}`);

test('runs: a silent job whose runs went up 1 min ago is ok, last run about 1 min ago', () => {
  const label = 'com.bazil.wispr-watch';
  let w = track({}, [{ label, launchctl: printed(76) }], NOW - 3 * MIN);
  w = track(w, [{ label, launchctl: printed(77) }], NOW - MIN);
  assert.equal(w[label].ranAt, NOW - MIN);
  const silent = raw({ label, plist: plist('com.bazil.wispr-watch.plist'), launchctl: printed(77), lastWrite: NOW - 3 * 60 * MIN, tail: [] });
  assert.equal(health(silent, NOW, w[label]).health, 'ok');
  const [job] = jobList({ config: null, jobs: [silent] }, undefined, NOW, w).jobs;
  assert.equal(job.health, 'ok');
  assert.equal(job.lastRun, NOW - MIN);
  assert.equal(ago(job.lastRun, NOW), 'About 1 min ago');
});

test('runs: a silent job watched 2 min with a 2 min interval is not stale yet', () => {
  const label = 'com.bazil.wispr-watch';
  const w = track({}, [{ label, launchctl: printed(77) }], NOW - 2 * MIN);
  const silent = raw({ label, plist: plist('com.bazil.wispr-watch.plist'), launchctl: printed(77), lastWrite: null, tail: [] });
  assert.deepEqual(health(silent, NOW, w[label]), { health: 'ok', reason: 'Watching for its next run' });
  // A log written long ago is still no sign of a run while watched briefly.
  assert.equal(health({ ...silent, lastWrite: NOW - 3 * 60 * MIN }, NOW, w[label]).health, 'ok');
});

test('runs: watched 10 min with no increase and an old log is stale', () => {
  const label = 'com.bazil.wispr-watch';
  let w = track({}, [{ label, launchctl: printed(77) }], NOW - 10 * MIN);
  w = track(w, [{ label, launchctl: printed(77) }], NOW - 5 * MIN);
  w = track(w, [{ label, launchctl: printed(77) }], NOW);
  assert.equal(w[label].ranAt, null);
  assert.equal(w[label].since, NOW - 10 * MIN);
  const silent = raw({ label, plist: plist('com.bazil.wispr-watch.plist'), launchctl: printed(77), lastWrite: NOW - 3 * 60 * MIN, tail: [] });
  assert.deepEqual(health(silent, NOW, w[label]), { health: 'stale', reason: 'No run in 3 h (expected every 2 min)' });
  assert.deepEqual(health({ ...silent, lastWrite: null }, NOW, w[label]), {
    health: 'stale',
    reason: 'No run seen in 10 min (expected every 2 min)',
  });
});

test('health: a KeepAlive job with a pid is running', () => {
  const r = raw({ plist: plist('ai.hermes.gateway.plist'), launchctl: text('launchctl-hermes-gateway.txt') });
  assert.equal(parseLaunchctl(r.launchctl).pid, 1980);
  assert.equal(health(r, NOW).health, 'running');
});

// ---- which jobs, and names ----

test('filter: default prefixes list com.bazil.a and ai.hermes.gateway, not Google', () => {
  const labels = ['com.bazil.a', 'com.google.keystone.agent', 'ai.hermes.gateway'];
  assert.deepEqual(shownLabels(labels, undefined), ['ai.hermes.gateway', 'com.bazil.a']);
  assert.deepEqual(shownLabels(labels, []), ['ai.hermes.gateway', 'com.bazil.a']);
  assert.deepEqual(shownLabels(labels, ['com.bazil.']), ['com.bazil.a']);

  const report = { config: null, jobs: labels.map((label) => raw({ label })) };
  assert.deepEqual(jobList(report, undefined, NOW).jobs.map((j) => j.label).sort(), ['ai.hermes.gateway', 'com.bazil.a']);
});

test('names: an automations.json entry names the row, the label otherwise', () => {
  const config = JSON.stringify({ jobs: [{ label: 'com.bazil.wispr-watch', name: 'Wispr watcher' }] });
  const report = { config, jobs: [raw({ label: 'com.bazil.wispr-watch' }), raw({ label: 'com.bazil.todos-notion' })] };
  const { jobs, configError } = jobList(report, undefined, NOW);
  assert.equal(configError, null);
  assert.equal(jobs.find((j) => j.label === 'com.bazil.wispr-watch').name, 'Wispr watcher');
  assert.equal(jobs.find((j) => j.label === 'com.bazil.todos-notion').name, 'com.bazil.todos-notion');
  assert.match(jobList({ ...report, config: '{nope' }, undefined, NOW).configError, /doesn't parse/);
});

// ---- footer dot ----

test('worstHealth: any failing is red, all ok green, stale or not loaded orange', () => {
  assert.equal(worstHealth(['ok', 'failing', 'ok']), 'red');
  assert.equal(worstHealth(['ok', 'ok']), 'green');
  assert.equal(worstHealth(['ok', 'running']), 'green');
  assert.equal(worstHealth(['ok', 'stale']), 'orange');
  assert.equal(worstHealth(['not loaded', 'ok']), 'orange');
  assert.equal(worstHealth(['stale', 'failing']), 'red');
  assert.equal(worstHealth([]), null);
});

test('runs: a count that went down but not to 0 (launchd reloaded it) counts as a run', () => {
  const label = 'com.bazil.wispr-watch';
  let w = track({}, [{ label, launchctl: printed(77) }], NOW - 5 * MIN);
  w = track(w, [{ label, launchctl: printed(2) }], NOW);
  assert.equal(w[label].ranAt, NOW);
  assert.equal(w[label].runs, 2);
  w = track(w, [{ label, launchctl: printed(0) }], NOW + MIN);
  assert.equal(w[label].ranAt, NOW);
});

test('next run: past due reads "Due now", and "Overdue" only once stale', () => {
  assert.equal(until(NOW - MIN, NOW), 'Due now');
  assert.equal(until(NOW - MIN, NOW, true), 'Overdue');
  assert.equal(until(NOW + 3 * MIN, NOW), 'In 3 min');
});

test('next run: a leap-day calendar entry is found years ahead', () => {
  const leap = { StartCalendarInterval: { Month: 2, Day: 29, Hour: 9, Minute: 0 } };
  assert.equal(nextRun(leap, null, true, NOW), new Date(2028, 1, 29, 9, 0).getTime());
  // From just after one leap day, the next is nearly 4 years on.
  assert.equal(nextRun(leap, null, true, new Date(2028, 1, 29, 10).getTime()), new Date(2032, 1, 29, 9, 0).getTime());
});

test('calendar: {Hour: 9} with no Minute runs every minute of 9 am, but is stale-checked daily', () => {
  const nine = { StartCalendarInterval: { Hour: 9 } };
  assert.equal(expectedEvery(nine), 24 * 60 * MIN);
  const at = new Date(2026, 9, 23, 9, 0).getTime();
  assert.equal(nextRun(nine, null, true, at + 5 * MIN), at + 5 * MIN);
  assert.equal(nextRun(nine, null, true, at + 60 * MIN), at + 24 * 60 * MIN);
  assert.equal(expectedEvery({ StartCalendarInterval: { Minute: 30 } }), 60 * MIN);
});

// ---- Run now (S12) ----

const stubs = (accept) => {
  const calls = [];
  const confirms = [];
  return {
    calls,
    confirms,
    deps: {
      invoke: async (cmd, args) => void calls.push([cmd, args]),
      confirm: async (c) => (confirms.push(c), accept),
    },
  };
};

test('run now: a StartInterval job calls kickstart without -k, and no confirm', async () => {
  const report = { config: null, jobs: [raw({ label: 'com.bazil.wispr-watch', plist: plist('com.bazil.wispr-watch.plist') })] };
  const [job] = jobList(report, undefined, NOW).jobs;
  assert.equal(runAction(job).label, 'Run now');
  const s = stubs(true);
  assert.equal(await runNow(job, s.deps), true);
  assert.deepEqual(s.calls, [['automations_kickstart', { label: 'com.bazil.wispr-watch', restart: false }]]);
  assert.equal(s.confirms.length, 0);
});

test('run now: an always-on job reads Restart and kickstarts -k only after the confirm is accepted', async () => {
  const report = {
    config: null,
    jobs: [raw({ label: 'ai.hermes.gateway', plist: plist('ai.hermes.gateway.plist'), launchctl: text('launchctl-hermes-gateway.txt') })],
  };
  const [job] = jobList(report, undefined, NOW).jobs;
  assert.equal(runAction(job).label, 'Restart');

  const declined = stubs(false);
  assert.equal(await runNow(job, declined.deps), false);
  assert.equal(declined.confirms.length, 1);
  assert.deepEqual(declined.calls, []);

  const accepted = stubs(true);
  assert.equal(await runNow(job, accepted.deps), true);
  assert.match(accepted.confirms[0].title, /^Restart /);
  assert.deepEqual(accepted.calls, [['automations_kickstart', { label: 'ai.hermes.gateway', restart: true }]]);
});

test('run now: a not loaded job is disabled with "Not loaded in launchd"', async () => {
  const report = { config: null, jobs: [raw({ label: 'com.bazil.todos-notion', launchctl: text('launchctl-missing.txt') })] };
  const [job] = jobList(report, undefined, NOW).jobs;
  assert.deepEqual(
    { disabled: runAction(job).disabled, title: runAction(job).title },
    { disabled: true, title: 'Not loaded in launchd' },
  );
  const s = stubs(true);
  assert.equal(await runNow(job, s.deps), false);
  assert.deepEqual(s.calls, []);
});

test('status command: a config entry with statusCommand marks the job', () => {
  const config = JSON.stringify({ jobs: [{ label: 'com.bazil.wispr-watch', statusCommand: 'wispr-watch --status' }] });
  const report = { config, jobs: [raw({ label: 'com.bazil.wispr-watch' }), raw({ label: 'com.bazil.todos-notion' })] };
  const jobs = jobList(report, undefined, NOW).jobs;
  assert.equal(jobs.find((j) => j.label === 'com.bazil.wispr-watch').hasStatus, true);
  assert.equal(jobs.find((j) => j.label === 'com.bazil.todos-notion').hasStatus, false);
});

test('jobProject finds the repo a job runs from, the deepest one, whole path components only', () => {
  const projects = [
    { id: 'p', repo_path: '/Users/x/Programming' },
    { id: 'c', repo_path: '/Users/x/Programming/career-ops' },
    { id: 'c2', repo_path: '/Users/x/Programming/career-ops-two/' },
  ];
  const job = (command, logs = []) => ({ command, logs });
  assert.equal(jobProject(job('/usr/bin/python3 /Users/x/Programming/career-ops/watch.py'), projects), 'c');
  assert.equal(jobProject(job('/usr/bin/node /Users/x/Programming/career-ops-two/run.js'), projects), 'c2');
  assert.equal(jobProject(job('/bin/sh -c x', ['/Users/x/Programming/career-ops/log.txt']), projects), 'c');
  assert.equal(jobProject(job('/usr/bin/python3 /Users/x/.local/bin/todos'), projects), null);
});

test('fixPrompt carries the job, its log, and how to check a fix', () => {
  const base = {
    label: 'com.bazil.todos', name: 'Todos', where: 'This Mac (launchd)', command: '/usr/bin/python3 /x/todos',
    plistPath: '/x/com.bazil.todos.plist', schedule: 'Every 5 min', lastRun: null, nextRun: null, health: 'failing',
    reason: 'PermissionError', pid: null, tail: ['Traceback', 'PermissionError: [Errno 1]'], logs: ['/x/todos.log'],
    alwaysOn: false, hasStatus: false,
  };
  const p = fixPrompt(base);
  assert.match(p, /Todos \(com\.bazil\.todos\)/);
  assert.match(p, /PermissionError: \[Errno 1\]/);
  assert.match(p, /launchctl kickstart gui\/\$\(id -u\)\/com\.bazil\.todos/);
  assert.match(fixPrompt({ ...base, alwaysOn: true, health: 'running' }), /kickstart -k/);
  assert.match(fixPrompt({ ...base, health: 'not loaded' }), /launchctl bootstrap gui\/\$\(id -u\) \/x\/com\.bazil\.todos\.plist/);
  assert.match(fixPrompt({ ...base, tail: [] }), /Its log is empty/);
});
