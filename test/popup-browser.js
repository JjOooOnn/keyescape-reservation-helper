import { DEFAULT_SETTINGS, RUN_KEY, SETTINGS_KEY, validateForRun } from '../extension/settings.js';

const localDate = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const localTime = date => [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
const opening = new Date(Date.now() + 2 * 60 * 60 * 1000);
const settings = {
  ...DEFAULT_SETTINGS, visitDate: localDate(new Date(Date.now() + 86400_000)),
  candidateTimes: '18:30, 19:00, 20:30', openingDate: localDate(opening),
  openingTime: localTime(opening), name: '테스트 예약자', phone: '01012345678',
};
const data = { [SETTINGS_KEY]: settings };
const listeners = [];
let tabExists = true;
const frame = document.querySelector('#popup');
const scenario = document.querySelector('#scenario');
const width = document.querySelector('#width');

function setStorage(values) {
  const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
  Object.assign(data, values);
  for (const listener of listeners) listener(changes, 'local');
}

window.previewChrome = {
  storage: {
    local: {
      async get(keys) { return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, data[key]])); },
      async set(values) { setStorage(values); },
    },
    onChanged: { addListener(fn) { listeners.push(fn); } },
  },
  runtime: {
    async sendMessage(message) {
      if (message.type === 'GET_RUN_STATE') {
        const run = data[RUN_KEY];
        return { ok: true, state: { status: run?.status ?? 'idle', tabId: run?.tabId ?? null,
          selected: run?.selected ?? null, reason: run?.reason ?? null } };
      }
      if (message.type === 'START_RUN') {
        if (['armed', 'preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review'].includes(data[RUN_KEY]?.status)) {
          return { ok: false, message: '이미 대기 중인 실행이 있습니다.' };
        }
        let snapshot;
        try { snapshot = validateForRun(data[SETTINGS_KEY]); }
        catch (error) { return { ok: false, message: error.message }; }
        const run = { status: 'armed', tabId: null, selected: null, settingsSnapshot: snapshot };
        setStorage({ [RUN_KEY]: run });
        return { ok: true, state: { status: 'armed', tabId: null } };
      }
      if (message.type === 'STOP_RUN') {
        const run = { ...data[RUN_KEY], status: 'stopped' };
        setStorage({ [RUN_KEY]: run });
        return { ok: true, state: { status: 'stopped', tabId: run.tabId } };
      }
      return { ok: false, message: '지원하지 않는 테스트 요청' };
    },
    getURL(path) { return new URL(`../${path}`, location.href).href; },
  },
  tabs: {
    async get(id) { if (id !== 77 || !tabExists) throw new Error('Missing tab'); return { id, windowId: 1 }; },
    async update(id) { return this.get(id); },
    async query() { return []; },
  },
  windows: { async update() {} },
  scripting: { async executeScript() { return []; } },
};

function setScenario(value) {
  tabExists = value !== 'failed';
  if (value === 'idle') {
    setStorage({ [RUN_KEY]: undefined });
    return;
  }
  const selected = ['waiting_captcha', 'submitting', 'needs_review', 'completed'].includes(value)
    ? { date: settings.visitDate, time: '18:30', slotId: 'test-slot' } : null;
  setStorage({ [RUN_KEY]: {
    status: value, tabId: ['armed', 'failed'].includes(value) ? null : 77,
    selected, settingsSnapshot: { ...settings },
    reason: value === 'needs_review' ? 'SUBMISSION_UNCONFIRMED' : value === 'failed' ? 'SLOTS_UNAVAILABLE' : null,
    ...(value === 'needs_review' || value === 'completed' ? { submitAttemptedAt: Date.now() } : {}),
  } });
}

function setPreviewWidth() {
  frame.style.width = `${width.value}px`;
  frame.contentDocument?.documentElement.style.setProperty('--popup-width', `${width.value}px`);
}
width.addEventListener('change', setPreviewWidth);
scenario.addEventListener('change', () => setScenario(scenario.value));
frame.addEventListener('load', setPreviewWidth);
setPreviewWidth();
const html = await fetch('../extension/popup.html').then(response => response.text());
const base = new URL('../extension/', location.href).href;
const version = Date.now();
frame.srcdoc = html.replace('<link rel="stylesheet" href="popup.css">',
  `<base href="${base}"><link rel="stylesheet" href="popup.css?v=${version}">`)
  .replace('<script type="module" src="popup.js"></script>',
    `<script>window.chrome = parent.previewChrome;</script><script type="module" src="popup.js?v=${version}"></script>`);
