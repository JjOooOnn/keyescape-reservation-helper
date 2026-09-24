import test from 'node:test';
import assert from 'node:assert/strict';

const listeners = {};
const saved = {};
const alarmCalls = [];
const tabs = new Map();
let nextTabId = 40;
globalThis.chrome = {
  runtime: {
    onInstalled: { addListener(fn) { listeners.installed = fn; } },
    onStartup: { addListener(fn) { listeners.startup = fn; } },
    onMessage: { addListener(fn) { listeners.message = fn; } },
  },
  storage: { local: {
    async get(keys) {
      const result = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) result[key] = saved[key];
      return result;
    },
    async set(values) { Object.assign(saved, values); },
    async setAccessLevel() {},
  } },
  alarms: {
    onAlarm: { addListener(fn) { listeners.alarm = fn; } },
    async create(name, info) { alarmCalls.push({ name, info }); },
    async clear() { return true; },
  },
  tabs: {
    onRemoved: { addListener(fn) { listeners.removed = fn; } },
    async create(options) {
      assert.equal(options.url, 'about:blank');
      const tab = { id: ++nextTabId, url: options.url };
      tabs.set(tab.id, tab);
      return tab;
    },
    async update(id, options) { Object.assign(tabs.get(id), options); return tabs.get(id); },
    async get(id) { if (!tabs.has(id)) throw new Error('Tab missing'); return tabs.get(id); },
  },
  action: {
    async setBadgeText() {}, async setBadgeBackgroundColor() {},
  },
};
await import('../extension/background.js');

function send(message, sender = {}) {
  return new Promise(resolve => listeners.message(message, sender, resolve));
}
async function until(check) {
  for (let i = 0; i < 50; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('State transition did not finish');
}

const now = Date.now();
const openDate = new Date(now + 120_000);
const tomorrow = new Date(now + 86_400_000);
const localDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0')].join('-');
const localTime = date => [date.getHours(), date.getMinutes(), date.getSeconds()]
  .map(item => String(item).padStart(2, '0')).join(':');
saved.keyescapeSettings = {
  branchId: '23', themeId: '70', themeInfoId: '61', themeName: '괴록',
  visitDate: localDate(tomorrow), candidateTimes: '11:35, 13:30',
  openingDate: localDate(openDate), openingTime: localTime(openDate),
  personCount: '2', name: 'PRIVATE_NAME', phone: '01012345678',
};

test('one armed run opens one bound tab and redacts the profile until details', async () => {
  const started = await send({ type: 'START_RUN' });
  assert.equal(started.ok, true);
  assert.equal(started.state.status, 'armed');
  assert.doesNotMatch(JSON.stringify(started), /PRIVATE_NAME|01012345678/);
  assert.equal(alarmCalls.length, 1);
  assert.equal((await send({ type: 'START_RUN' })).code, 'ALREADY_RUNNING');
  listeners.alarm({ name: 'keyescape-preopen' });
  await until(() => saved.keyescapeRun?.status === 'preparing' && tabs.get(saved.keyescapeRun.tabId)?.url?.startsWith('https://'));
  const tabId = saved.keyescapeRun.tabId;
  assert.equal(tabs.size, 1);
  const first = await send({ type: 'GET_RUN_CONTEXT' },
    { tab: { id: tabId }, url: tabs.get(tabId).url });
  assert.equal(first.ok, true);
  assert.equal(first.context.profile, undefined);
  assert.equal(first.context.target.name, '괴록');
  assert.deepEqual(first.context.times, ['11:35', '13:30']);
});

test('selection, CAPTCHA wait, submission claim and completion obey one-way transitions', async () => {
  const state = saved.keyescapeRun;
  const selectionPage = { tab: { id: state.tabId }, url: tabs.get(state.tabId).url };
  const detailsPage = { tab: { id: state.tabId }, url: 'https://www.keyescape.com/reservation2.php' };
  const completionPage = { tab: { id: state.tabId }, url: 'https://www.keyescape.com/reservation3.php?num=PRIVATE_CODE' };
  assert.equal((await send({ type: 'GET_RUN_CONTEXT' },
    { ...selectionPage, tab: { id: 9999 } })).code, 'RUN_NOT_ACTIVE');
  assert.equal((await send({ type: 'BEGIN_SELECTION', runId: 'wrong-run' }, selectionPage)).code, 'RUN_NOT_ACTIVE');
  assert.equal((await send({ type: 'BEGIN_SELECTION', runId: state.runId }, selectionPage)).code, 'INVALID_TRANSITION');
  const originalNow = Date.now;
  Date.now = () => openDate.getTime() + 1000;
  try { assert.equal((await send({ type: 'BEGIN_SELECTION', runId: state.runId }, selectionPage)).ok, true); }
  finally { Date.now = originalNow; }
  const selected = { date: saved.keyescapeSettings.visitDate, time: '11:35', slotId: '2896' };
  assert.equal((await send({ type: 'SET_SELECTED', runId: state.runId,
    selected: { ...selected, time: '18:00' } }, selectionPage)).code, 'SELECTION_MISMATCH');
  assert.equal((await send({ type: 'SET_SELECTED', runId: state.runId, selected }, selectionPage)).ok, true);
  const info = await send({ type: 'GET_RUN_CONTEXT' }, detailsPage);
  assert.equal(info.context.profile.name, 'PRIVATE_NAME');
  assert.equal((await send({ type: 'WAIT_CAPTCHA', runId: state.runId }, detailsPage)).ok, true);
  assert.equal((await send({ type: 'CLAIM_SUBMISSION', runId: state.runId }, detailsPage)).ok, true);
  assert.equal((await send({ type: 'CLAIM_SUBMISSION', runId: state.runId }, detailsPage)).code, 'INVALID_TRANSITION');
  assert.equal(saved.keyescapeRun.status, 'submitting');
  assert.equal((await send({ type: 'FINISH_RUN', runId: state.runId, selected }, completionPage)).ok, true);
  assert.equal(saved.keyescapeRun.status, 'completed');
  assert.equal((await send({ type: 'FINISH_RUN', runId: state.runId, selected }, completionPage)).code, 'RUN_NOT_ACTIVE');
});

test('stop prevents a later page from claiming submission', async () => {
  const started = await send({ type: 'START_RUN' });
  assert.equal(started.ok, true);
  const stopped = await send({ type: 'STOP_RUN' });
  assert.equal(stopped.state.status, 'stopped');
  const page = { tab: { id: 9999 }, url: 'https://www.keyescape.com/reservation2.php' };
  assert.equal((await send({ type: 'CLAIM_SUBMISSION', runId: saved.keyescapeRun.runId }, page)).code, 'RUN_NOT_ACTIVE');
});


test('uncertain submission becomes review-only and cannot be claimed again', async () => {
  const started = await send({ type: 'START_RUN' });
  assert.equal(started.ok, true);
  listeners.alarm({ name: 'keyescape-preopen' });
  await until(() => saved.keyescapeRun?.status === 'preparing' && tabs.get(saved.keyescapeRun.tabId)?.url?.startsWith('https://'));
  const state = saved.keyescapeRun;
  const first = { tab: { id: state.tabId }, url: tabs.get(state.tabId).url };
  const details = { tab: { id: state.tabId }, url: 'https://www.keyescape.com/reservation2.php' };
  const originalNow = Date.now;
  Date.now = () => openDate.getTime() + 1000;
  try { assert.equal((await send({ type: 'BEGIN_SELECTION', runId: state.runId }, first)).ok, true); }
  finally { Date.now = originalNow; }
  const selected = { date: saved.keyescapeSettings.visitDate, time: '11:35', slotId: '2896' };
  assert.equal((await send({ type: 'SET_SELECTED', runId: state.runId, selected }, first)).ok, true);
  assert.equal((await send({ type: 'WAIT_CAPTCHA', runId: state.runId }, details)).ok, true);
  assert.equal((await send({ type: 'CLAIM_SUBMISSION', runId: state.runId }, details)).ok, true);
  listeners.alarm({ name: 'keyescape-submit-review' });
  await until(() => saved.keyescapeRun?.status === 'needs_review');
  assert.equal((await send({ type: 'CLAIM_SUBMISSION', runId: state.runId }, details)).code, 'INVALID_TRANSITION');
  assert.equal((await send({ type: 'START_RUN' })).code, 'ALREADY_RUNNING');
  assert.equal((await send({ type: 'STOP_RUN' })).state.status, 'stopped');
});
