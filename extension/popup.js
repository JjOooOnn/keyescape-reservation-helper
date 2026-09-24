import { TARGETS } from '../src/keyescape-site.js';
import { DEFAULT_SETTINGS, RUN_KEY, SETTINGS_KEY, normalizeSettings } from './settings.js';

const form = document.querySelector('#settings-form');
const fields = Object.fromEntries([...form.elements].filter(element => element.name).map(element => [element.name, element]));
const candidateInput = document.querySelector('#candidate-new');
const candidateList = document.querySelector('#candidate-list');
const dashboard = document.querySelector('#dashboard');
const editor = document.querySelector('#editor');
const status = document.querySelector('#status');
const activeStatuses = new Set(['armed', 'preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review']);
const terminalStatuses = new Set(['completed', 'failed', 'stopped']);
const labels = {
  idle: '설정 중', armed: '예약 대기', preparing: '탭 준비', selecting: '시간 선택 중',
  waiting_captcha: 'CAPTCHA 대기', submitting: '완료 확인 중', needs_review: '확인 필요',
  completed: '완료 화면 확인', failed: '자동 진행 중단', stopped: '중지됨',
};
const descriptions = {
  idle: '설정을 확인하고 저장한 뒤 예약 대기를 시작하세요.',
  armed: '예약 오픈 시각을 기다리고 있습니다. 약 90초 전에 예약 탭을 준비합니다.',
  preparing: '예약 탭이 열렸습니다. 오픈 시각을 기다립니다.',
  selecting: '방문 날짜와 희망 시간을 우선순위대로 확인하고 있습니다.',
  waiting_captcha: '예약 정보를 입력했습니다. 사용자 확인을 기다립니다.',
  submitting: '예약하기를 한 번 시도했습니다. 완료 화면을 확인 중입니다.',
  needs_review: '제출 결과를 아직 확인하지 못했습니다.',
  completed: '같은 예약 탭에서 완료 화면을 확인했습니다.',
  failed: '자동 진행이 중단되었습니다.',
  stopped: '예약 대기가 중지되었습니다.',
};
const reasonLabels = {
  SUBMISSION_UNCONFIRMED: '제출 후 완료 화면을 확인하지 못함',
  RESERVATION_TAB_CLOSED: '예약 탭이 닫힘',
  SLOTS_UNAVAILABLE: '희망 시간이 예약 불가',
  DATE_UNAVAILABLE: '방문 날짜가 예약 불가',
  TAB_OPEN_FAILED: '예약 탭을 열지 못함',
  OPENING_TIME_MISSED: '예약 오픈 시각을 놓침',
  SCHEDULING_FAILED: '예약 대기 등록 실패',
  RUN_BOOTSTRAP_FAILED: '예약 페이지 실행 준비 실패',
};
const model = { savedSettings: null, run: null, candidates: [], editing: false, preparingNext: false, busy: false, tabAvailable: null, tabCheck: 0 };
const pad = value => String(value).padStart(2, '0');
const runStatus = () => model.run?.status ?? 'idle';
const isActive = () => activeStatuses.has(runStatus());
const isTerminal = () => terminalStatuses.has(runStatus());
// Preparing another reservation changes only the popup view, never RUN_KEY.
const viewStatus = () => model.preparingNext && isTerminal() ? 'idle' : runStatus();
const display = value => value ? String(value) : '미설정';
const dateText = value => value ? value.replaceAll('-', '. ') : '미설정';

function formatTimeInput(value, seconds = false) {
  const text = String(value ?? '').trim();
  let parts;
  if (/^\d{3,4}$/.test(text)) parts = [text.slice(0, -2), text.slice(-2)];
  else if (seconds && /^\d{5,6}$/.test(text)) parts = [text.slice(0, -4), text.slice(-4, -2), text.slice(-2)];
  else if ((seconds ? /^\d{1,2}:\d{2}(?::\d{2})?$/ : /^\d{1,2}:\d{2}$/).test(text)) parts = text.split(':');
  if (!parts || Number(parts[0]) > 23 || parts.slice(1).some(part => Number(part) > 59)) return text;
  if (seconds && parts.length === 2) parts.push('00');
  return parts.map(part => pad(Number(part))).join(':');
}

function currentDraft() {
  return Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
}

function setFields(settings) {
  const data = { ...DEFAULT_SETTINGS, ...settings };
  for (const [key, input] of Object.entries(fields)) input.value = data[key] ?? '';
  model.candidates = String(data.candidateTimes ?? '').split(/[ ,，\n]+/).filter(Boolean);
  candidateInput.value = '';
  renderCandidates();
}

function syncCandidates() { fields.candidateTimes.value = model.candidates.join(', '); }
function renderCandidates() {
  candidateList.replaceChildren();
  model.candidates.forEach((time, index) => {
    const row = document.createElement('div');
    row.className = 'time-item';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = index + 1;
    const value = document.createElement('strong'); value.textContent = time;
    row.append(rank, value);
    for (const [action, symbol, label, disabled] of [
      ['up', '↑', '우선순위 올리기', index === 0],
      ['down', '↓', '우선순위 내리기', index === model.candidates.length - 1],
      ['remove', '×', '삭제', false],
    ]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = symbol; button.dataset.action = action; button.dataset.index = index;
      button.setAttribute('aria-label', `${time} ${label}`); button.disabled = disabled || isActive();
      row.append(button);
    }
    candidateList.append(row);
  });
  document.querySelector('#candidate-hint').textContent = `${model.candidates.length} / 8개 · Enter로 추가 · 앞쪽부터 우선 선택`;
  syncCandidates();
}

function settingsMatchSaved() {
  if (!model.savedSettings || candidateInput.value.trim()) return false;
  try {
    return JSON.stringify(normalizeSettings(currentDraft())) === JSON.stringify(normalizeSettings(model.savedSettings));
  } catch { return false; }
}

function clearError() {
  status.textContent = '';
  status.dataset.tone = '';
  status.setAttribute('role', 'status');
  for (const input of form.querySelectorAll('[aria-invalid]')) {
    input.removeAttribute('aria-invalid');
    if (input !== candidateInput && input !== fields.openingTime) input.removeAttribute('aria-describedby');
  }
  for (const item of form.querySelectorAll('.field-error')) item.remove();
  candidateInput.setAttribute('aria-describedby', 'candidate-hint');
  fields.openingTime.setAttribute('aria-describedby', 'opening-hint');
}

function showStatus(message, danger = false) {
  status.textContent = message;
  status.dataset.tone = danger ? 'danger' : 'active';
  status.setAttribute('role', danger ? 'alert' : 'status');
}

function errorField(message) {
  if (message.startsWith('필수 설정을 입력해 주세요:')) {
    return message.split(':')[1].split(',')[0].trim();
  }
  if (message.includes('희망 시간')) return 'candidateTimes';
  if (message.includes('방문 날짜')) return 'visitDate';
  if (message.includes('예약 오픈 날짜')) return 'openingDate';
  if (message.includes('예약 오픈 시간') || message.includes('예약 오픈 시각')) return 'openingTime';
  if (message.includes('지점·테마 ID')) return ['branchId', 'themeId', 'themeInfoId'].find(key => fields[key].value && !/^[1-9]\d{0,8}$/.test(fields[key].value.trim())) || 'branchId';
  if (message.includes('테마명')) return 'themeName';
  if (message.includes('예약자 이름')) return 'name';
  if (message.includes('휴대전화')) return 'phone';
  if (message.includes('인원')) return 'personCount';
  return null;
}

function showError(message, key = errorField(message)) {
  showStatus(message, true);
  model.editing = true;
  render();
  const input = key === 'candidateTimes' ? candidateInput : fields[key];
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  const id = `${key}-error`;
  const error = document.createElement('span'); error.id = id; error.className = 'field-error'; error.textContent = message;
  const anchor = key === 'candidateTimes' ? candidateInput.closest('.time-add') : input;
  anchor.insertAdjacentElement('afterend', error);
  const hint = key === 'candidateTimes' ? 'candidate-hint ' : key === 'openingTime' ? 'opening-hint ' : '';
  input.setAttribute('aria-describedby', `${hint}${id}`);
  input.focus({ preventScroll: true });
  input.scrollIntoView({ block: 'center' });
}

function appendSummary(label, value, selected = false) {
  const row = document.createElement('div'); row.className = `summary-row${selected ? ' selected' : ''}`;
  const term = document.createElement('dt'); term.textContent = label;
  const description = document.createElement('dd'); description.textContent = value;
  row.append(term, description);
  document.querySelector('#summary').append(row);
}

function renderSummary() {
  const summary = document.querySelector('#summary'); summary.replaceChildren();
  const data = viewStatus() === 'idle' ? currentDraft() : model.run?.settingsSnapshot ?? {};
  const selected = viewStatus() === 'idle' ? null : model.run?.selected;
  if (selected?.date && selected?.time) appendSummary('선택된 시간', `${dateText(selected.date)} · ${selected.time}`, true);
  appendSummary('예약 대상', display(data.themeName));
  appendSummary('방문', dateText(data.visitDate));
  appendSummary('희망 시간', display(data.candidateTimes));
  appendSummary('예약 오픈', data.openingDate && data.openingTime ? `${dateText(data.openingDate)} ${data.openingTime}` : '미설정');
  appendSummary('예약자', data.name ? `${data.name} · ${display(data.personCount)}명` : '미설정');
}

function renderProgress() {
  const progress = document.querySelector('#progress'); progress.replaceChildren();
  const state = viewStatus();
  if (state === 'failed' || state === 'stopped') {
    progress.className = '';
    const note = document.createElement('p'); note.className = 'progress-note';
    note.textContent = state === 'failed' ? '자동 진행이 종료되었습니다.' : '대기 실행을 중지했습니다.';
    progress.append(note); return;
  }
  progress.className = 'progress';
  const current = ['armed', 'preparing'].includes(state) ? 0 : state === 'selecting' ? 1
    : state === 'waiting_captcha' ? 2 : ['submitting', 'needs_review', 'completed'].includes(state) ? 3 : -1;
  ['대기', '선택', 'CAPTCHA', '결과'].forEach((label, index) => {
    const step = document.createElement('span'); step.className = `progress-step${state === 'completed' || index < current ? ' done' : index === current ? ' current' : ''}`;
    step.textContent = label; progress.append(step);
  });
}

function renderCountdown() {
  const block = document.querySelector('#countdown-block');
  const state = runStatus();
  const data = model.run?.settingsSnapshot;
  const due = data?.openingDate && data?.openingTime ? new Date(`${data.openingDate}T${data.openingTime}`).getTime() : NaN;
  block.hidden = !['armed', 'preparing'].includes(state) || !Number.isFinite(due);
  if (block.hidden) return;
  const remaining = Math.ceil((due - Date.now()) / 1000);
  if (remaining <= 0) {
    document.querySelector('#countdown').textContent = '오픈 시각 도달';
    document.querySelector('#countdown-caption').textContent = '상태 갱신 대기';
    return;
  }
  document.querySelector('#countdown').textContent = `${pad(Math.floor(remaining / 3600))}:${pad(Math.floor(remaining % 3600 / 60))}:${pad(remaining % 60)}`;
  document.querySelector('#countdown-caption').textContent = `예약 오픈까지 · ${dateText(data.openingDate)} ${data.openingTime}`;
}

function renderNotice() {
  const notice = document.querySelector('#action-notice');
  const state = viewStatus();
  const missingTab = model.run?.reason === 'RESERVATION_TAB_CLOSED'
    || !Number.isSafeInteger(model.run?.tabId) || model.tabAvailable === false;
  const messages = {
    idle: model.preparingNext && model.run?.submitAttemptedAt
      ? '이전 실행에서 제출을 시도했습니다. 새 대기를 시작하기 전에 예약 조회에서 기존 결과를 확인하세요.' : '',
    waiting_captcha: '지금 할 일 · 예약 탭에서 CAPTCHA를 직접 완료하세요.',
    submitting: '예약하기를 한 번 시도했습니다. 결과 확인 중에는 자동으로 다시 제출하지 않습니다.',
    needs_review: missingTab
      ? '제출 결과를 확인하지 못했고 예약 탭도 열 수 없습니다. 예약 조회에서 결과를 직접 확인하세요. 자동 재제출하지 않습니다.'
      : '지금 할 일 · 예약 탭에서 결과를 확인하세요. 자동 재제출하지 않습니다.',
    completed: '완료 화면을 확인했습니다. 예약금 입금 상태는 별도로 확인하세요.',
    failed: `자동 진행이 멈췄습니다. 사유: ${reasonLabels[model.run?.reason] ?? model.run?.reason ?? '확인 불가'}`,
    stopped: model.run?.submitAttemptedAt
      ? '자동 진행을 중지했습니다. 이미 제출한 예약의 취소는 아닙니다. 새 실행 전 예약 조회에서 결과를 확인하세요.'
      : '자동 진행을 중지했습니다. 새 예약을 설정할 수 있습니다.',
  };
  notice.hidden = !messages[state];
  notice.textContent = messages[state] ?? '';
  notice.dataset.tone = state === 'completed' ? 'success' : ['idle', 'waiting_captcha', 'needs_review'].includes(state) ? 'attention'
    : state === 'failed' ? 'danger' : 'neutral';
}

function renderPreviousRun() {
  const previous = document.querySelector('#previous-run');
  previous.hidden = !model.preparingNext || !isTerminal();
  if (previous.hidden) { previous.open = false; return; }
  document.querySelector('#previous-run-label').textContent = `이전 실행 · ${labels[runStatus()]}`;
  const snapshot = model.run.settingsSnapshot;
  document.querySelector('#previous-run-description').textContent = [
    snapshot?.themeName, dateText(snapshot?.visitDate),
    model.run.selected?.time ?? snapshot?.candidateTimes,
    model.run.reason ? `사유: ${reasonLabels[model.run.reason] ?? model.run.reason}` : '',
  ].filter(Boolean).join(' · ');
}

function renderActions() {
  const state = viewStatus();
  const active = isActive(); const terminal = terminalStatuses.has(state);
  const canFocus = Number.isSafeInteger(model.run?.tabId) && model.tabAvailable !== false;
  const focus = document.querySelector('#focus-tab');
  document.querySelector('#edit').hidden = state !== 'idle';
  document.querySelector('#start').hidden = state !== 'idle';
  document.querySelector('#stop').hidden = !active;
  document.querySelector('#new-run').hidden = !terminal;
  document.querySelector('#new-run').className = `button ${state === 'completed' ? 'secondary' : 'primary'}`;
  focus.hidden = !canFocus || state === 'idle';
  focus.disabled = model.busy || model.tabAvailable !== true;
  focus.dataset.tabId = model.run?.tabId ?? '';
  const attention = ['waiting_captcha', 'needs_review'].includes(state);
  focus.className = `button ${attention || state === 'completed' ? 'primary' : 'secondary'}`;
  focus.style.order = attention ? '-1' : '0';
  document.querySelector('#start').disabled = model.busy;
  document.querySelector('#stop').disabled = model.busy;
  document.querySelector('#new-run').disabled = model.busy;
  document.querySelector('#save').disabled = model.busy || active;
  for (const input of form.querySelectorAll('input, select')) input.disabled = active;
  candidateInput.disabled = active;
  document.querySelector('#candidate-add').disabled = active;
  for (const button of candidateList.querySelectorAll('button')) {
    const index = Number(button.dataset.index);
    button.disabled = active || button.dataset.action === 'up' && index === 0
      || button.dataset.action === 'down' && index === model.candidates.length - 1;
  }
}

function render() {
  const state = viewStatus();
  if (isActive()) model.editing = false;
  dashboard.hidden = model.editing;
  editor.hidden = !model.editing;
  document.querySelector('#dashboard-actions').hidden = model.editing;
  document.querySelector('#editor-actions').hidden = !model.editing;
  document.querySelector('#run-state').textContent = state === 'idle' && model.savedSettings && settingsMatchSaved()
    ? '예약 준비' : labels[state] ?? '상태 확인 중';
  document.querySelector('#run-description').textContent = descriptions[state] ?? '실행 상태를 확인하고 있습니다.';
  const tone = state === 'completed' ? 'success' : ['waiting_captcha', 'needs_review'].includes(state) ? 'attention'
    : state === 'failed' ? 'danger' : isActive() ? 'active' : 'neutral';
  for (const badge of [document.querySelector('#header-status'), document.querySelector('#hero-status')]) {
    badge.dataset.tone = tone;
    badge.textContent = state === 'idle' && model.savedSettings ? settingsMatchSaved() ? '저장됨' : '변경됨' : labels[state] ?? '상태 확인 중';
  }
  renderCountdown(); renderNotice(); renderSummary(); renderProgress(); renderActions(); renderPreviousRun();
  document.querySelector('#save-state').textContent = isActive() ? '실행 중 · 설정 잠김'
    : terminalStatuses.has(state) ? '마지막 실행 결과 표시 중'
      : !model.savedSettings ? '아직 저장하지 않은 설정' : settingsMatchSaved() ? '설정 저장됨' : '변경사항 미저장';
}

async function checkTab() {
  const token = ++model.tabCheck;
  const tabId = model.run?.tabId;
  model.tabAvailable = null;
  render();
  if (!Number.isSafeInteger(tabId)) return;
  try { await chrome.tabs.get(tabId); if (token !== model.tabCheck) return; model.tabAvailable = true; }
  catch { if (token !== model.tabCheck) return; model.tabAvailable = false; }
  render();
}

async function refreshRunState() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_RUN_STATE' });
  if (!response?.ok) return;
  const stored = await chrome.storage.local.get(RUN_KEY);
  model.run = stored[RUN_KEY] ?? response.state;
  void checkTab();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY, RUN_KEY]);
  model.savedSettings = stored[SETTINGS_KEY] ?? null;
  model.run = stored[RUN_KEY] ?? null;
  // A different saved configuration belongs to the next reservation, even when
  // reopening the popup. The previous run retains its immutable snapshot.
  model.preparingNext = isTerminal() && Boolean(model.savedSettings && model.run.settingsSnapshot)
    && JSON.stringify(model.savedSettings) !== JSON.stringify(model.run.settingsSnapshot);
  setFields(model.savedSettings);
  render();
  void checkTab();
}

function openEditor() {
  if (isActive()) return;
  if (isTerminal()) model.preparingNext = true;
  model.editing = true; clearError(); render();
  editor.scrollTop = 0;
  fields.visitDate.focus({ preventScroll: true });
}

function addCandidate() {
  if (isActive()) return;
  const time = formatTimeInput(candidateInput.value);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return showError('희망 시간은 00:00~23:59 사이로 입력해 주세요. 예: 18:30 또는 1830', 'candidateTimes');
  if (model.candidates.includes(time)) return showError('희망 시간은 중복 없이 입력해 주세요.', 'candidateTimes');
  if (model.candidates.length >= 8) return showError('희망 시간은 최대 8개 입력할 수 있습니다.', 'candidateTimes');
  clearError(); model.candidates.push(time); candidateInput.value = '';
  renderCandidates(); render(); candidateInput.focus({ preventScroll: true });
}

function normalizedDraft() {
  if (candidateInput.value.trim()) {
    const error = new Error('입력 중인 희망 시간을 먼저 시간 추가로 목록에 넣어 주세요.'); error.field = 'candidateTimes'; throw error;
  }
  fields.openingTime.value = formatTimeInput(fields.openingTime.value, true);
  syncCandidates();
  return normalizeSettings(currentDraft());
}

async function saveSettings() {
  const settings = normalizedDraft();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  model.savedSettings = settings;
  setFields(settings);
  return settings;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (isActive() || model.busy) return;
  model.busy = true; clearError(); render();
  try {
    await saveSettings();
    if (isTerminal()) model.preparingNext = true;
    model.editing = false;
    showStatus('설정을 이 Chrome 프로필에 저장했습니다.'); render();
    dashboard.scrollTop = 0;
    document.querySelector('#start').focus({ preventScroll: true });
  } catch (error) { showError(error.message, error.field); }
  finally { model.busy = false; render(); }
});

async function startRun() {
  if (isActive() || model.busy) return;
  model.busy = true; clearError(); render();
  try {
    await saveSettings();
    const response = await chrome.runtime.sendMessage({ type: 'START_RUN' });
    if (!response?.ok) throw new Error(response?.message ?? '대기 등록에 실패했습니다.');
    model.editing = false;
    await refreshRunState();
    showStatus('설정을 저장하고 예약 대기를 시작했습니다.');
    render();
  } catch (error) {
    showError(error.message, error.field);
    try { await refreshRunState(); } catch {}
  } finally { model.busy = false; render(); }
}
document.querySelector('#start').addEventListener('click', startRun);
document.querySelector('#edit').addEventListener('click', openEditor);
document.querySelector('#new-run').addEventListener('click', openEditor);
document.querySelector('#edit-close').addEventListener('click', () => { clearError(); model.editing = false; render(); dashboard.scrollTop = 0; });
document.querySelector('#candidate-add').addEventListener('click', addCandidate);
candidateInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addCandidate(); } });
candidateInput.addEventListener('blur', () => { candidateInput.value = formatTimeInput(candidateInput.value); });
fields.openingTime.addEventListener('blur', () => { fields.openingTime.value = formatTimeInput(fields.openingTime.value, true); render(); });
form.addEventListener('input', () => { clearError(); render(); });
form.addEventListener('change', () => render());
candidateList.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button || isActive()) return;
  const index = Number(button.dataset.index);
  const time = model.candidates[index];
  if (button.dataset.action === 'remove') model.candidates.splice(index, 1);
  if (button.dataset.action === 'up' && index > 0) [model.candidates[index - 1], model.candidates[index]] = [model.candidates[index], model.candidates[index - 1]];
  if (button.dataset.action === 'down' && index < model.candidates.length - 1) [model.candidates[index + 1], model.candidates[index]] = [model.candidates[index], model.candidates[index + 1]];
  clearError(); renderCandidates(); render();
  const next = [...candidateList.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === `${time} ${button.dataset.action === 'remove' ? '삭제' : button.dataset.action === 'up' ? '우선순위 올리기' : '우선순위 내리기'}` && !item.disabled);
  (next ?? candidateInput).focus({ preventScroll: true });
});

document.querySelector('#stop').addEventListener('click', async () => {
  if (!isActive() || model.busy) return;
  model.busy = true; render();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STOP_RUN' });
    if (!response?.ok) throw new Error(response?.message ?? '중지 요청에 실패했습니다.');
    await refreshRunState();
    showStatus(response.message ?? '대기 실행을 중지했습니다.');
  } catch (error) { showStatus(error.message, true); try { await refreshRunState(); } catch {} }
  finally { model.busy = false; render(); }
});

document.querySelector('#focus-tab').addEventListener('click', async () => {
  const tabId = model.run?.tabId;
  if (!Number.isSafeInteger(tabId) || model.tabAvailable !== true) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch { model.tabAvailable = false; showStatus('예약 탭을 찾지 못했습니다. 예약 조회에서 결과를 확인해 주세요.', true); render(); }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[SETTINGS_KEY]) {
    const wasSaved = settingsMatchSaved();
    model.savedSettings = changes[SETTINGS_KEY].newValue ?? null;
    if (!model.editing && wasSaved) setFields(model.savedSettings);
  }
  if (changes[RUN_KEY]) {
    model.preparingNext = false;
    status.textContent = '';
    status.dataset.tone = '';
    status.setAttribute('role', 'status');
    model.run = changes[RUN_KEY].newValue ?? null;
    void checkTab();
  } else render();
});

const targetInput = document.querySelector('#target');
for (const [key, target] of Object.entries(TARGETS)) targetInput.add(new Option(target.name, key));
document.querySelector('#inspect').addEventListener('click', async event => {
  const button = event.currentTarget;
  const output = document.querySelector('#result');
  const target = TARGETS[targetInput.value];
  button.disabled = true;
  output.textContent = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    if (url.origin !== 'https://www.keyescape.com' || !/^\/reservation[123]\.php$/.test(url.pathname)) {
      throw new Error('키이스케이프 예약 페이지에서 실행해 주세요.');
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (moduleUrl, expectedTarget) => {
        const { createKeyescapeSite } = await import(moduleUrl);
        return createKeyescapeSite(document, { target: expectedTarget }).inspect();
      },
      args: [chrome.runtime.getURL('src/keyescape-site.js'), target],
    });
    if (results.length !== 1 || !results[0].result) throw new Error('페이지 진단 결과를 받지 못했습니다.');
    output.textContent = JSON.stringify(results[0].result, null, 2);
  } catch (error) { output.textContent = error.message; }
  finally { button.disabled = false; }
});

setInterval(renderCountdown, 1000);
loadSettings().then(refreshRunState).catch(error => showStatus('설정을 읽지 못했습니다: ' + error.message, true));
