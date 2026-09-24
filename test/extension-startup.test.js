import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, Script, SourceTextModule } from 'node:vm';
import { JSDOM } from 'jsdom';
import { selectionHtml, detailsHtml, simulateSelection } from './fixtures.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const origin = 'chrome-extension://startup-test/';
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

// Node normally allows every local import. Model Chrome's resource boundary for
// the actual content-script entrypoint and every dependency of its dynamic import.
function moduleLoader(globals, accessible = null, denied = []) {
  const context = createContext(globals);
  const cache = new Map();
  function compile(url) {
    const path = new URL(url).pathname.slice(1);
    if (accessible && !accessible.has(path)) {
      denied.push(path);
      throw new Error('Resource is not web accessible: ' + path);
    }
    if (!cache.has(url)) cache.set(url, new SourceTextModule(read(path), { context, identifier: url }));
    return cache.get(url);
  }
  async function load(url) {
    const module = compile(url);
    await module.link((specifier, parent) => compile(new URL(specifier, parent.identifier).href));
    await module.evaluate();
    return module;
  }
  return {
    load: path => load(new URL(path, origin).href),
    bootstrap() {
      new Script(read(manifest.content_scripts[0].js[0]), {
        importModuleDynamically: specifier => load(specifier),
      }).runInContext(context);
    },
  };
}

async function harness() {
  const saved = {};
  const listeners = {};
  const storageListeners = new Set();
  const tabs = new Map();
  const calls = [];
  const denied = [];
  let now = Date.now();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const local = {
    async get(keys) { return structuredClone(Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, saved[key]]))); },
    async set(values) {
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: saved[key], newValue: value }]));
      Object.assign(saved, structuredClone(values));
      for (const listener of storageListeners) listener(structuredClone(changes), 'local');
    },
    async setAccessLevel(options) { assert.equal(options.accessLevel, 'TRUSTED_CONTEXTS'); },
  };
  const backgroundChrome = {
    runtime: {
      onInstalled: { addListener(fn) { listeners.installed = fn; } },
      onStartup: { addListener(fn) { listeners.startup = fn; } },
      onMessage: { addListener(fn) { listeners.message = fn; } },
    },
    storage: { local },
    alarms: { onAlarm: { addListener() {} }, async create() {}, async clear() {} },
    tabs: {
      onRemoved: { addListener() {} },
      async create(options) {
        assert.equal(options.url, 'about:blank');
        const tab = { id: tabs.size + 1, ...options }; tabs.set(tab.id, tab); return { ...tab };
      },
      async update(id, options) {
        // The run must already be bound when navigation starts the content script.
        assert.equal(saved.keyescapeRun.tabId, id);
        Object.assign(tabs.get(id), options); return { ...tabs.get(id) };
      },
      async get(id) { if (!tabs.has(id)) throw new Error('Missing tab'); return { ...tabs.get(id) }; },
    },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  };
  await moduleLoader({ chrome: backgroundChrome, crypto, URL, URLSearchParams, Date: Clock }).load('extension/background.js');
  listeners.installed();
  await flush();
  function send(message, sender = {}) {
    calls.push(message.type);
    return new Promise(resolve => listeners.message(message, sender, resolve));
  }
  async function popup() {
    const dom = new JSDOM(read('extension/popup.html'), { url: origin + 'extension/popup.html' });
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    const registered = [];
    const chrome = { ...backgroundChrome,
      runtime: { sendMessage: send, getURL: path => origin + path },
      storage: { local, onChanged: { addListener(fn) { registered.push(fn); storageListeners.add(fn); } } },
    };
    await moduleLoader({ chrome, window: dom.window, document: dom.window.document,
      Option: dom.window.Option, Date: Clock, setInterval() {} }).load('extension/popup.js');
    await flush();
    return { document: dom.window.document, close() { registered.forEach(fn => storageListeners.delete(fn)); dom.window.close(); } };
  }
  async function content({ html = '<!doctype html><body></body>', prepare = () => {}, blockedResource = null } = {}) {
    const tab = { ...tabs.get(saved.keyescapeRun.tabId) };
    const dom = new JSDOM(html, { url: tab.url });
    prepare(dom.window.document);
    let reloads = 0;
    const timers = new Map();
    let nextTimer = 0;
    const chrome = {
      runtime: { getURL: path => origin + path, sendMessage: message => send(message, { tab: { id: tab.id }, url: tab.url }) },
      // No local storage access/events: background restricts it to trusted contexts.
    };
    const loader = moduleLoader({ chrome, window: dom.window, document: dom.window.document,
      location: { pathname: dom.window.location.pathname, reload() { reloads++; } },
      performance: { timeOrigin: now }, Date: Clock, URL,
      setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
    }, new Set(manifest.web_accessible_resources.flatMap(entry => entry.resources).filter(path => path !== blockedResource)), denied);
    loader.bootstrap();
    await flush();
    return { document: dom.window.document, reloads: () => reloads,
      async tick() { const pending = [...timers.values()]; timers.clear(); for (const fn of pending) await fn(); await flush(); },
      close() { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); timers.clear(); },
    };
  }
  return { saved, local, tabs, calls, denied, now, send, popup, content, advance(ms) { now += ms; } };
}

const localDate = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((value, i) => i ? String(value).padStart(2, '0') : value).join('-');
const localTime = date => [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
function settings(now) {
  const opening = new Date(now + 60_000);
  return {
    branchId: '23', themeId: '70', themeInfoId: '61', themeName: '괴록',
    visitDate: localDate(new Date(now + 86400_000)), candidateTimes: '13:30, 11:35',
    openingDate: localDate(opening), openingTime: localTime(opening),
    personCount: '2', name: '테스트', phone: '01012345678',
  };
}

test('actual popup, background and manifest-loaded content script start, survive reopening, and stop', async t => {
  const app = await harness();
  let popup = await app.popup();
  popup.document.querySelector('#start').click();
  await flush();
  assert.equal(app.saved.keyescapeRun, undefined, 'empty settings must not start a run');
  assert.equal((await app.send({ type: 'START_RUN' })).code, 'INVALID_SETTINGS');
  popup.close();
  await app.local.set({ keyescapeSettings: settings(app.now) });
  popup = await app.popup();
  popup.document.querySelector('#start').click();
  await flush();
  assert.equal(app.saved.keyescapeRun.status, 'preparing');
  const runId = app.saved.keyescapeRun.runId;
  assert.equal(app.saved.keyescapeRun.settingsSnapshot.candidateTimes, '13:30, 11:35');
  assert.equal(app.tabs.size, 1);
  assert.match(app.tabs.get(app.saved.keyescapeRun.tabId).url, /reservation1\.php\?zizum_num=23&theme_num=70&theme_info_num=61/);
  const page = await app.content();
  if (app.denied.length) t.diagnostic(JSON.stringify({ denied: app.denied,
    bootstrapFailed: app.calls.includes('BOOTSTRAP_FAILED'), status: app.saved.keyescapeRun.status,
    reason: app.saved.keyescapeRun.reason }));
  assert.deepEqual(app.denied, [], 'all runner dependencies must be web accessible');
  assert.equal(app.calls.includes('BOOTSTRAP_FAILED'), false);
  assert.equal(app.saved.keyescapeRun.status, 'preparing');
  assert.match(page.document.querySelector('#keyescape-helper-status').textContent, /오픈 시각을 기다리고/);
  assert.equal((await app.send({ type: 'START_RUN' })).code, 'ALREADY_RUNNING');
  assert.equal(app.tabs.size, 1);
  popup.close();
  popup = await app.popup();
  assert.equal(app.saved.keyescapeRun.runId, runId);
  assert.match(popup.document.querySelector('#run-state').textContent, /탭 준비/);
  assert.equal(popup.document.querySelector('#edit').hidden, true);
  popup.document.querySelector('#stop').click();
  await flush();
  await page.tick();
  assert.equal(app.saved.keyescapeRun.status, 'stopped');
  assert.match(page.document.querySelector('#keyescape-helper-status').textContent, /중지됨/);
  assert.equal(app.calls.includes('CLAIM_SUBMISSION'), false);
  page.close();
  popup.close();
});

test('opening reload reconnects the runner and reaches manual CAPTCHA without submitting', async () => {
  const app = await harness();
  const config = { ...settings(app.now), candidateTimes: '13:30, 09:40' };
  await app.local.set({ keyescapeSettings: config });
  assert.equal((await app.send({ type: 'START_RUN' })).ok, true);
  const waiting = await app.content();
  app.advance(61_000);
  await waiting.tick();
  assert.equal(waiting.reloads(), 1, 'a calendar loaded before opening is refreshed');
  assert.equal(app.saved.keyescapeRun.status, 'preparing');
  waiting.close();

  const date = config.visitDate;
  let selection;
  const calendarPage = await app.content({
    html: selectionHtml().replaceAll('2026-09-22', date)
      .replace('2026년 09월', `${date.slice(0, 4)}년 ${date.slice(5, 7)}월`),
    prepare(document) { selection = simulateSelection(document); },
  });
  assert.equal(app.saved.keyescapeRun.status, 'selecting', app.saved.keyescapeRun.reason);
  assert.equal(app.saved.keyescapeRun.selected.time, '13:30', 'first available candidate wins');
  assert.equal(selection.nextCount(), 1);
  calendarPage.close();

  app.tabs.get(app.saved.keyescapeRun.tabId).url = 'https://www.keyescape.com/reservation2.php';
  let submits = 0;
  const detailsPage = await app.content({
    html: detailsHtml().replaceAll('2026-09-22', date).replaceAll('2026.09.22', date.replaceAll('-', '.')),
    prepare(document) { document.querySelector('#form').addEventListener('submit', event => { event.preventDefault(); submits++; }); },
  });
  assert.deepEqual(app.denied, []);
  assert.equal(app.calls.includes('BOOTSTRAP_FAILED'), false);
  assert.equal(app.saved.keyescapeRun.status, 'waiting_captcha');
  assert.equal(detailsPage.document.querySelector('#name_input').value, '테스트');
  assert.match(detailsPage.document.querySelector('#keyescape-helper-status').textContent, /CAPTCHA를 직접 완료/);
  assert.equal(detailsPage.document.querySelector('[name="g-recaptcha-response"]').value, '');
  await detailsPage.tick();
  assert.equal(app.saved.keyescapeRun.status, 'waiting_captcha');
  detailsPage.document.querySelector('#keyescape-helper-status button').click();
  await flush();
  await detailsPage.tick();
  assert.equal(app.saved.keyescapeRun.status, 'stopped');
  assert.equal(app.calls.includes('CLAIM_SUBMISSION'), false);
  assert.equal(submits, 0);
  detailsPage.close();
});

test('a genuinely blocked runner dependency still reports bootstrap failure', async () => {
  const app = await harness();
  await app.local.set({ keyescapeSettings: settings(app.now) });
  await app.send({ type: 'START_RUN' });
  const page = await app.content({ blockedResource: 'src/keyescape-site.js' });
  assert.deepEqual(app.denied, ['src/keyescape-site.js']);
  assert.equal(app.calls.includes('BOOTSTRAP_FAILED'), true);
  assert.equal(app.saved.keyescapeRun.status, 'failed');
  assert.equal(app.saved.keyescapeRun.reason, 'RUN_BOOTSTRAP_FAILED');
  page.close();
});

test('saved next reservation reopens as preparation without overwriting the previous run', async () => {
  const app = await harness();
  const previous = { status: 'failed', runId: 'previous-run', tabId: null, reason: 'RUN_BOOTSTRAP_FAILED',
    settingsSnapshot: settings(app.now), selected: null, submitAttemptedAt: null };
  await app.local.set({ keyescapeSettings: settings(app.now), keyescapeRun: previous });
  let popup = await app.popup();
  assert.match(popup.document.querySelector('#run-state').textContent, /자동 진행 중단/);
  popup.document.querySelector('#new-run').click();
  const field = popup.document.querySelector('#themeName');
  field.value = '다음 예약';
  field.dispatchEvent(new popup.document.defaultView.Event('input', { bubbles: true }));
  popup.document.querySelector('#save').click();
  await flush();
  popup.close();
  popup = await app.popup();
  assert.equal(popup.document.querySelector('#run-state').textContent, '예약 준비');
  assert.match(popup.document.querySelector('#summary').textContent, /다음 예약/);
  assert.equal(popup.document.querySelector('#progress').children.length, 4);
  assert.equal(popup.document.querySelector('#start').hidden, false);
  assert.equal(popup.document.querySelector('#action-notice').hidden, true);
  assert.deepEqual(app.saved.keyescapeRun, previous);

  await app.local.set({ keyescapeRun: { ...previous, status: 'needs_review', submitAttemptedAt: app.now } });
  await flush();
  assert.equal(popup.document.querySelector('#run-state').textContent, '확인 필요');
  assert.equal(popup.document.querySelector('#start').hidden, true);
  popup.document.querySelector('#new-run').click();
  assert.equal(popup.document.querySelector('#editor').hidden, true);
  popup.close();
});
