import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { RUN_KEY, SETTINGS_KEY, validateForRun } from '../extension/settings.js';

const html = readFileSync(new URL('../extension/popup.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'https://extension.test/popup.html' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Option = dom.window.Option;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const data = {};
const tabs = new Map();
let onChanged;
let nextTab = 40;
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, data[key]]));
      },
      async set(values) {
        const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
        Object.assign(data, values);
        onChanged?.(changes, 'local');
      },
    },
    onChanged: { addListener(fn) { onChanged = fn; } },
  },
  runtime: {
    async sendMessage(message) {
      if (message.type === 'GET_RUN_STATE') {
        const run = data[RUN_KEY];
        return { ok: true, state: { status: run?.status ?? 'idle', tabId: run?.tabId ?? null,
          selected: run?.selected ?? null, reason: run?.reason ?? null, updatedAt: run?.updatedAt ?? null } };
      }
      if (message.type === 'START_RUN') {
        if (['armed', 'preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review'].includes(data[RUN_KEY]?.status)) {
          return { ok: false, message: '이미 대기 중인 실행이 있습니다.' };
        }
        let settings;
        try { settings = validateForRun(data[SETTINGS_KEY]); }
        catch (error) { return { ok: false, message: error.message }; }
        const run = { status: 'armed', tabId: null, selected: null, settingsSnapshot: settings };
        await chrome.storage.local.set({ [RUN_KEY]: run });
        return { ok: true, state: { status: run.status, tabId: run.tabId } };
      }
      if (message.type === 'STOP_RUN') {
        const run = { ...data[RUN_KEY], status: 'stopped' };
        await chrome.storage.local.set({ [RUN_KEY]: run });
        return { ok: true, state: { status: 'stopped', tabId: run.tabId } };
      }
      return { ok: false };
    },
    getURL(path) { return `chrome-extension://test/${path}`; },
  },
  tabs: {
    async get(id) { if (!tabs.has(id)) throw new Error('Missing tab'); return tabs.get(id); },
    async update(id, values) { Object.assign(tabs.get(id), values); return tabs.get(id); },
    async query() { return []; },
  },
  windows: { async update() {} },
  scripting: { async executeScript() { return []; } },
};

const originalInterval = globalThis.setInterval;
let countdownTick;
globalThis.setInterval = fn => { countdownTick = fn; return 1; };
await import('../extension/popup.js');
globalThis.setInterval = originalInterval;

const q = selector => document.querySelector(selector);
const click = selector => q(selector).click();
const input = (selector, value) => {
  const field = q(selector); field.value = value;
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
};
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
const localDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const localTime = date => [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');

test('C dashboard uses real settings and run data without changing the run contract', async () => {
  await flush();
  assert.match(q('#summary').textContent, /미설정/);
  assert.equal(q('#editor').hidden, true);
  click('#edit');
  assert.equal(q('#editor').hidden, false);

  const opening = new Date(Date.now() + 4 * 3600_000);
  input('#visitDate', localDate(new Date(Date.now() + 86400_000)));
  input('#candidate-new', '930'); click('#candidate-add');
  input('#candidate-new', '1830'); click('#candidate-add');
  click('[aria-label="18:30 우선순위 올리기"]');
  assert.equal(q('[name="candidateTimes"]').value, '18:30, 09:30');
  input('#openingDate', localDate(opening));
  input('#openingTime', '183045');
  input('#name', '홍길동');
  input('#phone', '010123');
  click('#save'); await flush();
  assert.equal(document.activeElement.id, 'phone');
  assert.equal(q('#editor').hidden, false);
  assert.equal(q('#phone').getAttribute('aria-invalid'), 'true');
  input('#phone', '010-1234-5678');
  click('#save'); await flush();
  assert.equal(data[SETTINGS_KEY].openingTime, '18:30:45');
  assert.equal(data[SETTINGS_KEY].candidateTimes, '18:30, 09:30');
  assert.equal(data[SETTINGS_KEY].phone, '01012345678');
  assert.equal(q('#dashboard').hidden, false);
  assert.match(q('#save-state').textContent, /저장됨/);

  click('#edit');
  input('#openingTime', localTime(opening));
  input('#candidate-new', '20:00');
  click('#save'); await flush();
  assert.match(q('#status').textContent, /시간 추가/);
  assert.equal(q('[name="candidateTimes"]').value, '18:30, 09:30');
  input('#candidate-new', '');
  click('#save'); await flush();
  click('#start'); await flush();
  assert.equal(data[RUN_KEY].status, 'armed');
  assert.deepEqual(data[RUN_KEY].settingsSnapshot, data[SETTINGS_KEY]);
  assert.equal(q('#editor').hidden, true);
  assert.equal(q('#edit').hidden, true);
  assert.equal(q('#stop').hidden, false);
  assert.equal(q('#start').hidden, true);
  assert.match(q('#countdown').textContent, /^\d{2}:\d{2}:\d{2}$/);

  const tabId = ++nextTab;
  tabs.set(tabId, { id: tabId, windowId: 1 });
  const snapshot = data[RUN_KEY].settingsSnapshot;
  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'waiting_captcha', tabId,
    selected: { date: snapshot.visitDate, time: '18:30', slotId: '1' } } });
  await flush();
  assert.match(q('#action-notice').textContent, /CAPTCHA를 직접 완료/);
  assert.equal(q('#focus-tab').hidden, false);
  assert.equal(q('#focus-tab').disabled, false);
  assert.equal(q('#edit').hidden, true);
  assert.match(q('#summary').textContent, /선택된 시간.*18:30/);

  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'needs_review', reason: 'SUBMISSION_UNCONFIRMED', submitAttemptedAt: Date.now() } });
  await flush();
  assert.match(q('#action-notice').textContent, /자동 재제출하지 않습니다/);
  assert.equal(q('#start').hidden, true);
  assert.equal(q('#stop').hidden, false);
  tabs.delete(tabId);
  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], reason: 'RESERVATION_TAB_CLOSED' } });
  await flush();
  assert.equal(q('#focus-tab').hidden, true);
  assert.match(q('#action-notice').textContent, /예약 조회/);

  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], tabId: null, reason: 'SUBMISSION_UNCONFIRMED' } });
  await flush();
  assert.equal(q('#focus-tab').hidden, true);
  assert.match(q('#action-notice').textContent, /예약 조회/);

  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'completed', reason: null } });
  await flush();
  assert.match(q('#action-notice').textContent, /입금 상태/);
  assert.equal(q('#progress').querySelectorAll('.done').length, 4);
  click('#new-run');
  assert.equal(data[RUN_KEY].status, 'completed');
  assert.equal(q('#editor').hidden, false);
  input('#name', '김철수');
  click('#save'); await flush();
  assert.equal(data[RUN_KEY].status, 'completed');
  assert.equal(data[SETTINGS_KEY].name, '김철수');
  assert.equal(q('#editor').hidden, true);
  assert.equal(q('#dashboard').hidden, false);
  assert.match(q('#summary').textContent, /김철수/);
  assert.doesNotMatch(q('#summary').textContent, /홍길동|선택된 시간/);
  assert.equal(q('#run-state').textContent, '예약 준비');
  assert.equal(q('#edit').hidden, false);
  assert.equal(q('#start').hidden, false);
  assert.equal(q('#new-run').hidden, true);
  assert.equal(q('#previous-run').hidden, false);
  assert.equal(q('#previous-run').open, false);
  assert.match(q('#previous-run-label').textContent, /이전 실행.*완료/);
  assert.match(q('#action-notice').textContent, /이전 실행에서 제출/);
  assert.equal(q('#progress').querySelectorAll('.progress-step').length, 4);
  assert.equal(q('#progress').querySelectorAll('.done, .current').length, 0);

  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'failed', reason: 'SLOTS_UNAVAILABLE' } });
  await flush();
  assert.match(q('#action-notice').textContent, /희망 시간이 예약 불가/);
  assert.equal(q('#progress').querySelectorAll('.progress-step').length, 0);
  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'stopped' } });
  await flush();
  assert.match(q('#action-notice').textContent, /예약 조회/);

  for (const state of ['completed', 'failed', 'stopped']) {
    await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: state } });
    await flush();
    const previousRun = structuredClone(data[RUN_KEY]);
    click('#new-run');
    assert.equal(q('#editor').hidden, false);
    input('#phone', '010123');
    click('#save'); await flush();
    assert.equal(q('#editor').hidden, false, 'invalid settings keep the editor open');
    input('#phone', '01012345678');
    q('#dashboard').scrollTop = 300;
    click('#save'); await flush();
    assert.equal(q('#editor').hidden, true, `${state}: saving returns home`);
    assert.equal(q('#dashboard').hidden, false);
    assert.equal(q('#dashboard').scrollTop, 0);
    assert.equal(q('#run-state').textContent, '예약 준비');
    assert.equal(q('#header-status').textContent, '저장됨');
    assert.equal(q('#hero-status').dataset.tone, 'neutral');
    assert.equal(q('#progress').querySelectorAll('.progress-step').length, 4);
    assert.equal(q('#start').hidden, false);
    assert.equal(q('#edit').hidden, false);
    assert.doesNotMatch(q('#action-notice').textContent, /자동 진행이 멈췄/);
    assert.doesNotMatch(q('#save-state').textContent, /마지막 실행/);
    assert.deepEqual(data[RUN_KEY], previousRun, 'saving must preserve the last run');
  }

  // A new run uses the newly saved settings and replaces only the real run.
  click('#start'); await flush();
  assert.equal(data[RUN_KEY].status, 'armed');
  assert.equal(data[RUN_KEY].settingsSnapshot.name, '김철수');
  assert.equal(q('#previous-run').hidden, true);
  assert.equal(q('#edit').hidden, true);
  assert.equal(q('#stop').hidden, false);

  await chrome.storage.local.set({ [RUN_KEY]: { ...data[RUN_KEY], status: 'failed', reason: 'RUN_BOOTSTRAP_FAILED' } });
  await flush();
  assert.equal(q('#run-state').textContent, '자동 진행 중단', 'a new failure must remain visible');
  assert.match(q('#action-notice').textContent, /예약 페이지 실행 준비 실패/);
  click('#new-run');
  click('#save'); await flush();
  assert.equal(q('#action-notice').hidden, true, 'an old pre-submission failure must not be a current warning');
  assert.equal(q('#run-state').textContent, '예약 준비');

  await chrome.storage.local.set({ [RUN_KEY]: { status: 'armed', settingsSnapshot: { ...snapshot,
    openingDate: '2020-01-01', openingTime: '11:00:00' }, tabId: null } });
  await flush(); countdownTick();
  assert.equal(q('#status').textContent, '');
  assert.equal(q('#countdown').textContent, '오픈 시각 도달');
  assert.equal(q('#run-state').textContent, '예약 대기');
});
