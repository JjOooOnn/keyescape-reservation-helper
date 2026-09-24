import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const context = {
  runId: 'test-run', status: 'submitting',
  target: { branchId: '23', themeId: '71', themeInfoId: '63', name: 'AYAKO' },
  selected: { date: '2026-10-01', time: '11:00', slotId: '1' },
  profile: { personCount: '2', name: '홍길동', phone: '01012345678' },
};
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };

let instance = 0;
async function loadBanner(t, status) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.keyescape.com/reservation2.php' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  const timers = new Map();
  let nextTimer = 0;
  let state = { status, tabId: 41 };
  let stopAllowed = true;
  t.mock.method(globalThis, 'setTimeout', fn => { timers.set(++nextTimer, fn); return nextTimer; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  // Content scripts cannot read this extension's TRUSTED_CONTEXTS local storage.
  globalThis.chrome = { runtime: { async sendMessage(message) {
    if (message.type === 'GET_RUN_STATE') return state ? { ok: true, state } : { ok: false };
    if (message.type === 'GET_RUN_CONTEXT') return { ok: true, context: { ...context, status: state.status } };
    if (message.type === 'STOP_RUN' && stopAllowed) { state = { ...state, status: 'stopped' }; return { ok: true, state }; }
    return { ok: false };
  } } };
  await import(`../extension/runner.js?banner-${++instance}`);
  await flush();
  const close = () => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); };
  t.after(close);
  return { banner: dom.window.document.querySelector('#keyescape-helper-status'), timers, close,
    setState(value) { state = value; }, refuseStop() { stopAllowed = false; },
    async tick() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) await fn(); await flush(); },
  };
}

test('site banner shows actual submission state and retains stop action', async t => {
  const { banner } = await loadBanner(t, 'submitting');
  assert.match(banner.querySelector('strong').textContent, /완료 확인 중/);
  assert.match(banner.querySelector('p').textContent, /자동 재제출하지 않습니다/);
  assert.equal(banner.querySelector('button').hidden, false);
  banner.querySelector('button').click();
  await flush();
  assert.match(banner.querySelector('strong').textContent, /중지됨/);
  assert.equal(banner.querySelector('button').hidden, true);
});

test('site banner distinguishes uncertain submission from success or failure without storage access', async t => {
  const { banner, setState, tick, timers } = await loadBanner(t, 'submitting');
  setState({ tabId: 41, status: 'needs_review' });
  await tick();
  assert.match(banner.querySelector('strong').textContent, /확인 필요/);
  assert.match(banner.querySelector('p').textContent, /직접 확인/);
  assert.equal(banner.querySelector('button').hidden, false);
  assert.equal(timers.size, 1, 'needs_review remains active');
  setState({ tabId: 41, status: 'stopped' });
  await tick();
  assert.match(banner.querySelector('strong').textContent, /중지됨/);
  assert.equal(banner.querySelector('button').hidden, true);
  assert.equal(timers.size, 0);
});

for (const [status, label] of [['completed', /완료 화면 확인/], ['failed', /자동 진행 중단/]]) {
  test(`site banner reflects ${status} only from background and ends polling`, async t => {
    const { banner, setState, tick, timers } = await loadBanner(t, 'submitting');
    setState({ tabId: 41, status });
    await tick();
    assert.match(banner.querySelector('strong').textContent, label);
    assert.equal(banner.querySelector('button').hidden, true);
    assert.equal(timers.size, 0);
  });
}

test('old page ignores a later run in another tab', async t => {
  const { banner, setState, tick, timers, refuseStop } = await loadBanner(t, 'needs_review');
  setState({ tabId: 42, status: 'completed' });
  refuseStop();
  banner.querySelector('button').click();
  await tick();
  assert.match(banner.querySelector('strong').textContent, /확인 필요/);
  assert.equal(timers.size, 0);
});

test('page navigation releases the banner timer', async t => {
  const { timers, close } = await loadBanner(t, 'needs_review');
  assert.equal(timers.size, 1);
  close();
  assert.equal(timers.size, 0);
});

test('unavailable background does not invent a terminal state', async t => {
  const { banner, setState, tick, timers } = await loadBanner(t, 'submitting');
  setState(null);
  await tick();
  assert.match(banner.querySelector('strong').textContent, /완료 확인 중/);
  assert.equal(timers.size, 0);
});
