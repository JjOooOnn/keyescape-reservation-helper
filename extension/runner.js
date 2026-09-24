import { createKeyescapeSite } from '../src/keyescape-site.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const path = location.pathname;
if (window === window.top && ['/reservation1.php', '/reservation2.php', '/reservation3.php'].includes(path)) {
  void main();
}

async function send(type, values = {}) {
  try { return await chrome.runtime.sendMessage({ type, ...values }); }
  catch { return { ok: false, code: 'EXTENSION_UNAVAILABLE' }; }
}

async function context() {
  const response = await send('GET_RUN_CONTEXT');
  if (!response.ok) await send('BOOTSTRAP_FAILED');
  return response.ok ? response.context : null;
}

async function ensureActive(runId, status) {
  const current = await context();
  return current?.runId === runId && (!status || current.status === status) ? current : null;
}

function banner(status, message) {
  let root = document.querySelector('#keyescape-helper-status');
  if (!root) {
    root = document.createElement('aside');
    root.id = 'keyescape-helper-status';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    Object.assign(root.style, { position: 'fixed', bottom: '16px', left: '16px', zIndex: '2147483647',
      width: 'min(340px, calc(100vw - 32px))', padding: '10px 12px', borderRadius: '10px',
      border: '1px solid currentColor', background: '#e9f2fa', color: '#17547e',
      font: '12px/1.45 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      boxShadow: '0 3px 12px #1d314925', pointerEvents: 'none' });
    const heading = document.createElement('strong');
    heading.style.display = 'block';
    const text = document.createElement('p');
    text.style.margin = '3px 0 0';
    root.append(heading, text);
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = '중지';
    Object.assign(stop.style, { marginTop: '8px', padding: '5px 10px', border: '1px solid currentColor',
      borderRadius: '5px', background: 'transparent', color: 'inherit', font: '700 11px sans-serif',
      cursor: 'pointer', pointerEvents: 'auto' });
    stop.addEventListener('click', async () => {
      const response = await send('STOP_RUN');
      if (response.ok && response.state?.status === 'stopped') banner('stopped', '자동 진행을 중지했습니다. 이미 제출한 예약의 취소는 아닙니다.');
    });
    root.append(stop);
    document.body.append(root);
  }
  const labels = { preparing: '탭 준비', selecting: '시간 선택 중', waiting_captcha: 'CAPTCHA 대기',
    submitting: '완료 확인 중', needs_review: '확인 필요', completed: '완료 화면 확인',
    failed: '자동 진행 중단', stopped: '중지됨' };
  const tone = ['waiting_captcha', 'needs_review'].includes(status) ? ['#fff1d8', '#7b4c0d']
    : status === 'failed' ? ['#fbe9e8', '#933a36']
      : status === 'completed' ? ['#e5f4eb', '#146243'] : ['#e9f2fa', '#17547e'];
  root.style.background = tone[0];
  root.style.color = tone[1];
  root.querySelector('strong').textContent = `상태 · ${labels[status] ?? status}`;
  root.querySelector('p').textContent = message;
  root.querySelector('button').hidden = !['preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review'].includes(status);
}

function watchBanner(tabId) {
  // Local storage is restricted to TRUSTED_CONTEXTS. Keep the page runner's
  // module graph public and read banner updates through the existing message API.
  let closed = false;
  let timer;
  const stop = () => { closed = true; clearTimeout(timer); };
  window.addEventListener('pagehide', stop, { once: true });
  async function tick() {
    const response = await send('GET_RUN_STATE');
    if (closed) return;
    // Each new run gets a new tab; an old page must not display a later run.
    if (!response.ok || response.state?.tabId !== tabId) { stop(); return; }
    const state = response.state.status;
    if (document.querySelector('#keyescape-helper-status')) {
      if (state === 'stopped') banner('stopped', '자동 진행을 중지했습니다. 이미 제출한 예약의 취소는 아닙니다.');
      if (state === 'failed') banner('failed', '예약 자동 진행이 중단되었습니다. 확장 프로그램에서 사유를 확인해 주세요.');
      if (state === 'needs_review') banner('needs_review', '제출 결과를 확인하지 못했습니다. 예약 결과를 직접 확인하세요. 자동 재제출하지 않습니다.');
      if (state === 'completed') banner('completed', '완료 화면을 확인했습니다. 예약금 입금 상태는 별도로 확인해 주세요.');
    }
    if (['completed', 'failed', 'stopped'].includes(state)) { stop(); return; }
    timer = setTimeout(tick, 1000);
  }
  timer = setTimeout(tick, 1000);
}

async function waitFor(site, expected, timeoutMs = 8000) {
  const until = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < until) {
    const result = site.inspect();
    if (result.ok && result.phase === expected) return result;
    lastError = result.ok ? null : result;
    if (!result.ok && !['PAGE_LOADING', 'MISSING_ELEMENT', 'UNKNOWN_PICKER', 'TARGET_MISMATCH'].includes(result.code)) {
      const error = new Error(result.message);
      error.code = result.code;
      throw error;
    }
    await sleep(100);
  }
  const error = new Error(lastError?.code === 'TARGET_MISMATCH'
    ? lastError.message : '화면을 기다리는 시간이 초과되었습니다.');
  error.code = lastError?.code === 'TARGET_MISMATCH' ? 'TARGET_MISMATCH' : 'PAGE_TIMEOUT';
  throw error;
}

async function reloadAvailability(ctx, code) {
  const response = await send('REQUEST_RELOAD', { runId: ctx.runId });
  if (!response.ok) {
    const error = new Error('예약 가능 시간이 없습니다.');
    error.code = code;
    throw error;
  }
  await sleep(250);
  if (await ensureActive(ctx.runId, 'selecting')) location.reload();
}

async function waitForOpening(ctx) {
  while (Date.now() < ctx.openingAt) {
    if (!await ensureActive(ctx.runId, 'preparing')) return false;
    await sleep(Math.min(500, Math.max(20, ctx.openingAt - Date.now())));
  }
  return Boolean(await ensureActive(ctx.runId, 'preparing'));
}

async function chooseDate(site, ctx) {
  let report = await waitFor(site, 'calendar');
  for (let step = 0; step < 12; step++) {
    const hasDate = report.dates.some(item => item.date === ctx.date);
    const label = document.querySelector('#datepicker .current-month-year')?.textContent ?? '';
    const match = label.match(/(\d{4})년\s*(\d{1,2})월/);
    if (hasDate && (!match || (Number(match[1]) === Number(ctx.date.slice(0, 4))
      && Number(match[2]) === Number(ctx.date.slice(5, 7))))) return report;
    if (!match) {
      const error = new Error('달력의 월을 확인할 수 없습니다.');
      error.code = 'UNKNOWN_MONTH';
      throw error;
    }
    const currentMonth = Number(match[1]) * 12 + Number(match[2]);
    const targetMonth = Number(ctx.date.slice(0, 4)) * 12 + Number(ctx.date.slice(5, 7));
    if (currentMonth === targetMonth) return report;
    if (!await ensureActive(ctx.runId, 'selecting')) return null;
    site.changeMonth(currentMonth < targetMonth ? 1 : -1);
    const previous = label;
    const until = Date.now() + 6000;
    while (Date.now() < until && document.querySelector('#datepicker .current-month-year')?.textContent === previous) {
      await sleep(100);
    }
    report = await waitFor(site, 'calendar');
  }
  const error = new Error('방문 날짜가 달력 범위를 벗어났습니다.');
  error.code = 'DATE_NOT_FOUND';
  throw error;
}

async function reservationPage(site, ctx) {
  if (ctx.status === 'preparing') {
    banner('preparing', '예약 탭이 열렸습니다. 오픈 시각을 기다리고 있습니다.');
    if (!await waitForOpening(ctx)) return;
    // A calendar loaded before opening can retain stale availability.
    if (performance.timeOrigin < ctx.openingAt) {
      location.reload();
      return;
    }
    const begun = await send('BEGIN_SELECTION', { runId: ctx.runId });
    if (!begun.ok) return;
  }
  if (!await ensureActive(ctx.runId, 'selecting')) return;
  banner('selecting', '방문 날짜와 희망 시간을 우선순위대로 확인 중입니다.');
  let report = await chooseDate(site, ctx);
  if (!report) return;
  const date = report.dates.find(item => item.date === ctx.date);
  if (!date?.available) return reloadAvailability(ctx, 'DATE_UNAVAILABLE');
  if (!await ensureActive(ctx.runId, 'selecting')) return;
  site.selectDate(ctx.date);
  report = await waitFor(site, 'times');
  const wanted = ctx.times.find(time => report.slots.some(slot => slot.time === time && slot.available));
  if (!wanted) return reloadAvailability(ctx, 'SLOTS_UNAVAILABLE');
  if (!await ensureActive(ctx.runId, 'selecting')) return;
  const selected = site.selectTime(wanted);
  const recorded = await send('SET_SELECTED', { runId: ctx.runId, selected });
  if (!recorded.ok || !await ensureActive(ctx.runId, 'selecting')) return;
  site.openDetails();
  setTimeout(async () => {
    if (location.pathname === '/reservation1.php' && await ensureActive(ctx.runId, 'selecting')) {
      await send('FAIL_RUN', { runId: ctx.runId, code: 'NAVIGATION_TIMEOUT' });
    }
  }, 15_000);
}

async function detailsPage(site, ctx) {
  if (!ctx.selected || !ctx.profile) return;
  if (['submitting', 'needs_review'].includes(ctx.status)) {
    banner(ctx.status, ctx.status === 'needs_review'
      ? '제출 결과를 확인하지 못했습니다. 예약 결과를 직접 확인하세요. 자동 재제출하지 않습니다.'
      : '예약하기를 한 번 시도했습니다. 완료 화면을 확인 중이며 자동 재제출하지 않습니다.');
    return;
  }
  if (!['selecting', 'waiting_captcha'].includes(ctx.status)) return;
  await waitFor(site, 'details');
  site.inspectDetails(ctx.selected);
  site.fillDetails(ctx.selected, ctx.profile);
  if (ctx.status === 'selecting') {
    const waiting = await send('WAIT_CAPTCHA', { runId: ctx.runId });
    if (!waiting.ok) return;
  }
  banner('waiting_captcha', '지금 할 일 · CAPTCHA를 직접 완료하세요. 완료되면 예약하기를 한 번 클릭합니다.');
  for (;;) {
    if (!await ensureActive(ctx.runId, 'waiting_captcha')) return;
    if (site.captchaReady(ctx.selected)) break;
    await sleep(350);
  }
  if (!await ensureActive(ctx.runId, 'waiting_captcha')) return;
  const claimed = await send('CLAIM_SUBMISSION', { runId: ctx.runId });
  if (!claimed.ok || !await ensureActive(ctx.runId, 'submitting')) return;
  banner('submitting', '예약하기를 한 번 시도했습니다. 완료 화면을 확인 중이며 자동 재제출하지 않습니다.');
  setTimeout(async () => {
    if (location.pathname === '/reservation2.php' && await ensureActive(ctx.runId, 'submitting')) {
      const timeout = await send('SUBMISSION_TIMEOUT', { runId: ctx.runId });
      if (!timeout.ok) return;
      const current = await send('GET_RUN_STATE');
      if (current.ok && current.state?.status === 'needs_review') {
        banner('needs_review', '제출 결과를 확인하지 못했습니다. 예약 결과를 직접 확인하세요. 자동 재제출하지 않습니다.');
      }
    }
  }, 90_000);
  site.submitOnce(ctx.selected, ctx.profile);
}

async function completionPage(site, ctx) {
  if (!ctx.selected || !['submitting', 'needs_review'].includes(ctx.status)
    || !ctx.submitAttemptedAt || performance.timeOrigin < ctx.submitAttemptedAt) return;
  site.inspectCompletion(ctx.selected);
  const result = await send('FINISH_RUN', { runId: ctx.runId, selected: ctx.selected });
  if (result.ok) banner('completed', '완료 화면을 확인했습니다. 예약금 입금 상태는 별도로 확인해 주세요.');
}

async function main() {
  const initial = await send('GET_RUN_STATE');
  const ctx = await context();
  if (!ctx) return;
  // GET_RUN_CONTEXT verifies this page still belongs to the active run after
  // capturing its tab binding. No settings or private storage are read here.
  if (initial.ok && Number.isInteger(initial.state?.tabId)) watchBanner(initial.state.tabId);
  try {
    const site = createKeyescapeSite(document, { target: ctx.target });
    if (path === '/reservation1.php') await reservationPage(site, ctx);
    if (path === '/reservation2.php') await detailsPage(site, ctx);
    if (path === '/reservation3.php') await completionPage(site, ctx);
  } catch (error) {
    const code = typeof error.code === 'string' ? error.code : 'RUN_FAILED';
    await send('FAIL_RUN', { runId: ctx.runId, code });
    const current = await send('GET_RUN_STATE');
    if (current.ok && current.state?.status === 'needs_review') {
      banner('needs_review', '제출 결과를 확인하지 못했습니다. 예약 결과를 직접 확인하세요. 자동 재제출하지 않습니다.');
    } else if (current.ok && current.state?.status === 'failed') {
      banner('failed', '예약 자동 진행이 중단되었습니다. 확장 프로그램에서 사유를 확인해 주세요.');
    }
  }
}
