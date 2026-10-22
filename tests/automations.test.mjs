import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  health,
  jobList,
  nextRun,
  parseLaunchctl,
  scheduleText,
  shownLabels,
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
  const tail = text('todos-notion.log').trimEnd().split('\n');
  assert.deepEqual(health(raw({ tail }), NOW), {
    health: 'failing',
    reason: "PermissionError: [Errno 1] Operation not permitted: '/Users/x/Documents/Programming'",
  });
});

test('health: every 120 s, logs last written 10 min ago, is stale', () => {
  const r = raw({ plist: plist('com.bazil.wispr-watch.plist'), lastWrite: NOW - 10 * MIN });
  assert.deepEqual(health(r, NOW), { health: 'stale', reason: 'No run in 10 min (expected every 2 min)' });
  assert.equal(health({ ...r, lastWrite: NOW - 5 * MIN }, NOW).health, 'ok');
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
