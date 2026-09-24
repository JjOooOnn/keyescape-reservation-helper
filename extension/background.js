import { RUN_KEY, SETTINGS_KEY, validateForRun } from './settings.js';

const PREOPEN_MS = 90_000;
const PREOPEN_ALARM = 'keyescape-preopen';
const SUBMIT_ALARM = 'keyescape-submit-review';
const ACTIVE = new Set(['armed', 'preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review']);
let queue = Promise.resolve();

function enqueue(action) {
  const result = queue.catch(() => {}).then(action);
  queue = result.catch(() => {});
  return result;
}

function openingAt(settings) {
  return new Date(settings.openingDate + 'T' + settings.openingTime).getTime();
}

function publicState(state) {
  return { status: state?.status ?? 'idle', tabId: state?.tabId ?? null,
    selected: state?.selected ?? null, reason: state?.reason ?? null,
    updatedAt: state?.updatedAt ?? null };
}

async function readState() {
  return (await chrome.storage.local.get(RUN_KEY))[RUN_KEY]
    ?? { status: 'idle', runId: null, updatedAt: null };
}

async function saveState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [RUN_KEY]: state });
  const text = state.status === 'waiting_captcha' ? 'CAP'
    : state.status === 'completed' ? 'OK'
      : state.status === 'needs_review' ? '?' : ACTIVE.has(state.status) ? '…' : '';
  await chrome.action.setBadgeText({ text }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: '#193c55' }).catch(() => {});
  return state;
}

async function failRun(state, reason) {
  if (state.status === 'submitting' || state.status === 'needs_review') {
    state.status = 'needs_review';
  } else {
    state.status = 'failed';
  }
  state.reason = reason;
  await chrome.alarms.clear(PREOPEN_ALARM);
  if (state.status !== 'needs_review') await chrome.alarms.clear(SUBMIT_ALARM);
  return saveState(state);
}

async function openReservationTab(state) {
  if (state.status !== 'armed') return state;
  const settings = state.settingsSnapshot;
  const url = new URL('https://www.keyescape.com/reservation1.php');
  url.search = new URLSearchParams({ zizum_num: settings.branchId,
    theme_num: settings.themeId, theme_info_num: settings.themeInfoId }).toString();
  try {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    state.status = 'preparing';
    state.tabId = tab.id;
    await saveState(state); // Bind the tab before its site content script can run.
    await chrome.tabs.update(tab.id, { url: url.href, active: true });
  } catch {
    await failRun(state, 'TAB_OPEN_FAILED');
  }
  return state;
}

async function schedule(state) {
  const due = openingAt(state.settingsSnapshot);
  if (!Number.isFinite(due) || Date.now() > due + 60_000) {
    return failRun(state, 'OPENING_TIME_MISSED');
  }
  if (due - Date.now() <= PREOPEN_MS) return openReservationTab(state);
  await chrome.alarms.create(PREOPEN_ALARM, { when: due - PREOPEN_MS });
  return state;
}

async function reconcile() {
  const state = await readState();
  if (state.status === 'armed') {
    state.refreshCount ??= 0;
    await saveState(state);
    return schedule(state);
  }
  if (state.status === 'submitting') {
    const due = state.submitAttemptedAt + 90_000;
    if (Date.now() >= due) return failRun(state, 'SUBMISSION_UNCONFIRMED');
    await chrome.alarms.create(SUBMIT_ALARM, { when: due });
  }
  if (ACTIVE.has(state.status) && state.tabId) {
    try { await chrome.tabs.get(state.tabId); }
    catch { return failRun(state, 'RESERVATION_TAB_CLOSED'); }
  }
  return state;
}

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await reconcile();
  });
});
chrome.runtime.onStartup.addListener(() => { enqueue(reconcile); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === PREOPEN_ALARM) enqueue(async () => openReservationTab(await readState()));
  if (alarm.name === SUBMIT_ALARM) enqueue(async () => {
    const state = await readState();
    if (state.status === 'submitting') await failRun(state, 'SUBMISSION_UNCONFIRMED');
  });
});
chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => {
    const state = await readState();
    if (ACTIVE.has(state.status) && state.tabId === tabId) await failRun(state, 'RESERVATION_TAB_CLOSED');
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;
  const result = enqueue(() => handleMessage(message, sender));
  result.then(sendResponse, () => sendResponse({ ok: false, code: 'RUN_ERROR', message: '요청을 처리하지 못했습니다.' }));
  return true;
});

function boundPage(sender, state, pathname) {
  if (!sender.tab || sender.tab.id !== state.tabId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === 'https://www.keyescape.com'
      && (!pathname || url.pathname === pathname);
  } catch { return false; }
}

async function handleMessage(message, sender) {
  const state = await readState();
  if (message.type === 'GET_RUN_STATE') return { ok: true, state: publicState(state) };
  if (message.type === 'START_RUN') {
    if (ACTIVE.has(state.status)) return { ok: false, code: 'ALREADY_RUNNING', message: '이미 대기 중인 실행이 있습니다.' };
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    let settings;
    try { settings = validateForRun(stored[SETTINGS_KEY]); }
    catch (error) { return { ok: false, code: 'INVALID_SETTINGS', message: error.message }; }
    const next = { status: 'armed', runId: crypto.randomUUID(), tabId: null,
      selected: null, refreshCount: 0, submitAttemptedAt: null, settingsSnapshot: settings };
    await saveState(next);
    try { await schedule(next); }
    catch { await failRun(next, 'SCHEDULING_FAILED'); }
    return { ok: next.status !== 'failed', state: publicState(next),
      message: next.status === 'failed' ? '예약 탭을 열지 못했습니다.' : undefined };
  }
  if (message.type === 'STOP_RUN') {
    if (sender.tab && sender.tab.id !== state.tabId) return { ok: false, code: 'WRONG_TAB' };
    if (!ACTIVE.has(state.status)) return { ok: true, state: publicState(state), message: '중지할 실행이 없습니다.' };
    state.status = 'stopped';
    state.reason = null;
    await chrome.alarms.clear(PREOPEN_ALARM);
    await chrome.alarms.clear(SUBMIT_ALARM);
    await saveState(state);
    return { ok: true, state: publicState(state) };
  }
  if (!ACTIVE.has(state.status) || (!['BOOTSTRAP_FAILED', 'GET_RUN_CONTEXT'].includes(message.type) && message.runId !== state.runId)
    || !boundPage(sender, state)) {
    return { ok: false, code: 'RUN_NOT_ACTIVE' };
  }
  const path = new URL(sender.url).pathname;
  if (message.type === 'BOOTSTRAP_FAILED') {
    if (!['submitting', 'needs_review'].includes(state.status)) await failRun(state, 'RUN_BOOTSTRAP_FAILED');
    return { ok: true };
  }
  if (message.type === 'GET_RUN_CONTEXT') {
    const settings = state.settingsSnapshot;
    const context = { runId: state.runId, status: state.status, selected: state.selected,
      submitAttemptedAt: state.submitAttemptedAt,
      openingAt: openingAt(settings), target: { branchId: settings.branchId,
        themeId: settings.themeId, themeInfoId: settings.themeInfoId, name: settings.themeName },
      date: settings.visitDate, times: settings.candidateTimes.split(',').map(item => item.trim()) };
    if (path === '/reservation2.php' && state.selected) {
      context.profile = { personCount: settings.personCount, name: settings.name, phone: settings.phone };
    }
    return { ok: true, context };
  }
  if (message.type === 'BEGIN_SELECTION' && path === '/reservation1.php'
    && state.status === 'preparing' && Date.now() >= openingAt(state.settingsSnapshot)) {
    state.status = 'selecting';
    await saveState(state);
    return { ok: true, state: publicState(state) };
  }
  if (message.type === 'REQUEST_RELOAD' && path === '/reservation1.php'
    && state.status === 'selecting' && !state.selected && state.refreshCount < 2) {
    state.refreshCount++;
    await saveState(state);
    return { ok: true };
  }
  if (message.type === 'SET_SELECTED' && path === '/reservation1.php'
    && state.status === 'selecting' && !state.selected) {
    const selected = message.selected;
    if (selected?.date !== state.settingsSnapshot.visitDate
      || !state.settingsSnapshot.candidateTimes.split(',').map(item => item.trim()).includes(selected?.time)
      || !/^\d+$/.test(selected?.slotId ?? '')) return { ok: false, code: 'SELECTION_MISMATCH' };
    state.selected = { date: selected.date, time: selected.time, slotId: selected.slotId };
    await saveState(state);
    return { ok: true };
  }
  if (message.type === 'WAIT_CAPTCHA' && path === '/reservation2.php'
    && state.status === 'selecting' && state.selected) {
    state.status = 'waiting_captcha';
    await saveState(state);
    return { ok: true };
  }
  if (message.type === 'CLAIM_SUBMISSION' && path === '/reservation2.php'
    && state.status === 'waiting_captcha' && state.selected && !state.submitAttemptedAt) {
    state.status = 'submitting';
    state.submitAttemptedAt = Date.now(); // Persist before an uncertain site click.
    await saveState(state);
    await chrome.alarms.create(SUBMIT_ALARM, { when: state.submitAttemptedAt + 90_000 });
    return { ok: true };
  }
  if (message.type === 'SUBMISSION_TIMEOUT' && path === '/reservation2.php'
    && state.status === 'submitting') {
    await failRun(state, 'SUBMISSION_UNCONFIRMED');
    return { ok: true };
  }
  if (message.type === 'FINISH_RUN' && path === '/reservation3.php'
    && ['submitting', 'needs_review'].includes(state.status) && state.submitAttemptedAt
    && state.selected?.date === message.selected?.date && state.selected?.time === message.selected?.time) {
    state.status = 'completed';
    state.reason = null;
    await chrome.alarms.clear(SUBMIT_ALARM);
    await saveState(state);
    return { ok: true };
  }
  if (message.type === 'FAIL_RUN' && !['submitting', 'needs_review'].includes(state.status)) {
    const code = typeof message.code === 'string' && /^[A-Z_]{3,40}$/.test(message.code)
      ? message.code : 'RUN_FAILED';
    await failRun(state, code);
    return { ok: true };
  }
  return { ok: false, code: 'INVALID_TRANSITION' };
}
