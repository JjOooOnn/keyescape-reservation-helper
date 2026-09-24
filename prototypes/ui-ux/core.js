import { DEFAULT_SETTINGS, normalizeSettings, validateForRun } from '../../extension/settings.js';

// All state lives in this comparison page. Nothing is sent to the extension or reservation site.
const keys = ['a', 'b', 'c'];
const screens = Object.fromEntries(keys.map(key => [key, document.querySelector(`#screen-${key}`)]));
const sites = Object.fromEntries(keys.map(key => [key, document.querySelector(`#site-${key}`)]));
const active = new Set(['armed', 'preparing', 'selecting', 'waiting_captcha', 'submitting', 'needs_review']);
const labels = { idle: '설정 중', armed: '예약 대기', preparing: '탭 준비', selecting: '시간 선택 중', waiting_captcha: 'CAPTCHA 대기', submitting: '완료 확인 중', needs_review: '확인 필요', completed: '완료 화면 확인', failed: '자동 진행 중단', stopped: '중지됨' };
const tones = { idle: 'neutral', armed: 'active', preparing: 'active', selecting: 'active', waiting_captcha: 'attention', submitting: 'active', needs_review: 'attention', completed: 'success', failed: 'danger', stopped: 'neutral' };
const copy = { idle: '설정을 확인하고 저장한 뒤 예약 대기를 시작하세요.', armed: '오픈 시각을 기다리고 있습니다. 약 90초 전에 예약 탭을 준비합니다.', preparing: '예약 탭이 열렸습니다. 오픈 시각을 기다리고 있습니다.', selecting: '방문 날짜와 희망 시간을 우선순위대로 확인하고 있습니다.', waiting_captcha: '예약 정보 입력을 마쳤습니다. 사용자 확인을 기다립니다.', submitting: '예약하기를 한 번 시도했습니다. 완료 화면을 확인 중입니다.', needs_review: '제출 결과를 아직 확인하지 못했습니다.', completed: '같은 예약 탭의 완료 화면을 확인했습니다.', failed: '자동 진행이 중단되었습니다.', stopped: '예약 대기가 중지되었습니다.' };
const reasonLabels = { SUBMISSION_UNCONFIRMED: '제출 후 완료 화면을 확인하지 못함', RESERVATION_TAB_CLOSED: '예약 탭이 닫힘', SLOTS_UNAVAILABLE: '희망 시간이 예약 불가' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pad = value => String(value).padStart(2, '0');
const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = date => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
function seed() {
  const opening = new Date(Date.now() + 2 * 3600000);
  return { ...DEFAULT_SETTINGS, visitDate: localDate(new Date(Date.now() + 7 * 86400000)), candidateTimes: '11:00, 13:30', openingDate: localDate(opening), openingTime: localTime(opening), name: '홍길동', phone: '01000000000' };
}
const fresh = key => ({ key, draft: seed(), saved: null, status: 'idle', selected: null, tabOpen: false, reason: null, step: 0, editing: false, targetOpen: false, profileOpen: false, newTime: '', error: '', errorField: '', message: '', siteOpen: false });
const models = Object.fromEntries(keys.map(key => [key, fresh(key)]));
const locked = model => active.has(model.status) ? 'disabled' : '';
function savedState(model) {
  if (active.has(model.status)) return '실행 중 · 설정 잠김';
  if (!model.saved) return '아직 저장하지 않은 설정';
  try {
    return JSON.stringify(normalizeSettings(model.draft)) === JSON.stringify(model.saved)
      ? '설정 저장됨' : '변경사항 미저장';
  } catch { return '변경사항 미저장'; }
}
const pill = model => `<span class="status-pill" data-tone="${tones[model.status]}">${model.status === 'idle' && model.saved ? (savedState(model) === '설정 저장됨' ? '저장됨' : '변경됨') : labels[model.status]}</span>`;
const dateText = date => date ? date.replaceAll('-', '. ') : '미설정';
const timeText = time => time ? (time.length === 5 ? `${time}:00` : time) : '미설정';
// Accept convenient typing in the prototype; keep the existing HH:mm[:ss] data format.
function formatTimeInput(value, seconds = false) {
  const text = value.trim();
  let parts;
  if (/^\d{3,4}$/.test(text)) parts = [text.slice(0, -2), text.slice(-2)];
  else if (seconds && /^\d{5,6}$/.test(text)) parts = [text.slice(0, -4), text.slice(-4, -2), text.slice(-2)];
  else if ((seconds ? /^\d{1,2}:\d{2}(?::\d{2})?$/ : /^\d{1,2}:\d{2}$/).test(text)) parts = text.split(':');
  if (!parts || Number(parts[0]) > 23 || parts.slice(1).some(part => Number(part) > 59)) return text;
  if (seconds && parts.length === 2) parts.push('00');
  return parts.map(part => pad(Number(part))).join(':');
}
const countdown = model => { if (!['armed', 'preparing'].includes(model.status)) return ''; const seconds = Math.ceil(Math.max(0, new Date(`${model.draft.openingDate}T${model.draft.openingTime}`).getTime() - Date.now()) / 1000); return `${Math.floor(seconds / 3600) ? `${pad(Math.floor(seconds / 3600))}:` : ''}${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`; };
const feedback = model => model.error || model.message ? `<div class="alert" role="${model.error ? 'alert' : 'status'}" data-tone="${model.error ? 'danger' : 'active'}">${esc(model.error || model.message)}</div>` : '';
const actionCopy = { waiting_captcha: '지금 할 일 · 예약 탭에서 CAPTCHA를 직접 완료하세요.', needs_review: '지금 할 일 · 예약 탭에서 결과를 확인하세요. 자동 재제출하지 않습니다.', failed: '자동 진행이 멈췄습니다. 오류 사유를 확인하세요.', completed: '완료 화면을 확인했습니다. 예약금 입금 상태는 별도로 확인하세요.', stopped: '중지는 자동 진행을 멈춥니다. 이미 제출되었다면 예약 취소가 아닙니다.' };
const issue = model => actionCopy[model.status] ? `<div class="alert" data-tone="${tones[model.status]}">${esc(actionCopy[model.status])}${model.reason ? `<br>사유: ${esc(reasonLabels[model.reason] || model.reason)}` : ''}</div>` : '';
const tabButton = (model, secondary = false) => `<button class="btn ${secondary ? 'secondary' : ''}" type="button" data-action="open-tab" ${model.tabOpen ? '' : 'disabled'}>예약 탭 열기</button>`;
const stopButton = model => `<button class="btn danger" type="button" data-action="stop" ${active.has(model.status) ? '' : 'disabled'}>중지</button>`;
const completedActions = model => `${tabButton(model)}<button class="btn secondary" type="button" data-action="new-run">새 예약 설정</button>`;

function field(model, name, label, type = 'text', placeholder = '') {
  const invalid = model.error && model.errorField === name;
  if (type === 'time') return `<div class="field"><label for="${model.key}-${name}">${label} <span class="time-format">24시간제 · 시:분:초</span></label><input class="time-input" id="${model.key}-${name}" data-field="${name}" data-time-seconds type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="18:30:00" value="${esc(model.draft[name])}" aria-describedby="${model.key}-${name}-hint${invalid ? ` ${model.key}-${name}-error` : ''}" ${invalid ? 'aria-invalid="true"' : ''} ${locked(model)}>${invalid ? `<span class="field-error" id="${model.key}-${name}-error">${esc(model.error)}</span>` : ''}<span class="time-hint" id="${model.key}-${name}-hint">183000 → 18:30:00 · 초 생략 시 00초</span></div>`;
  return `<div class="field"><label for="${model.key}-${name}">${label}</label><input id="${model.key}-${name}" data-field="${name}" type="${type}" value="${esc(model.draft[name])}" ${placeholder ? `placeholder="${esc(placeholder)}"` : ''} ${type === 'time' ? 'step="1"' : ''} ${invalid ? `aria-invalid="true" aria-describedby="${model.key}-${name}-error"` : ''} ${locked(model)}>${invalid ? `<span class="field-error" id="${model.key}-${name}-error">${esc(model.error)}</span>` : ''}</div>`;
}
function times(model) {
  const values = model.draft.candidateTimes.split(',').map(value => value.trim()).filter(Boolean);
  const invalid = model.error && model.errorField === 'candidateTimes';
  return `<div class="field"><label for="${model.key}-new-time">희망 시간 · 앞쪽이 우선</label>
    <div class="time-list">${values.map((value, index) => `<div class="time-item" data-time="${esc(value)}"><span class="rank">${index + 1}</span><strong>${esc(value)}</strong>
      <button type="button" data-action="time-up" data-index="${index}" aria-label="${esc(value)} 우선순위 올리기" ${index === 0 || active.has(model.status) ? 'disabled' : ''}>↑</button>
      <button type="button" data-action="time-down" data-index="${index}" aria-label="${esc(value)} 우선순위 내리기" ${index === values.length - 1 || active.has(model.status) ? 'disabled' : ''}>↓</button>
      <button type="button" data-action="time-remove" data-index="${index}" aria-label="${esc(value)} 삭제" ${locked(model)}>×</button></div>`).join('')}</div>
    <span class="time-format">24시간제 · 시:분</span>
    <div class="time-add"><input class="time-input" id="${model.key}-new-time" data-new-time type="text" inputmode="numeric" autocomplete="off" spellcheck="false" placeholder="예: 18:30 또는 1830" value="${esc(model.newTime)}" aria-describedby="${model.key}-time-hint${invalid ? ` ${model.key}-candidateTimes-error` : ''}" ${invalid ? 'aria-invalid="true"' : ''} ${locked(model)}><button class="btn secondary" type="button" data-action="time-add" ${locked(model)}>시간 추가</button></div>
    ${invalid ? `<span class="field-error" id="${model.key}-candidateTimes-error">${esc(model.error)}</span>` : ''}
    <span class="time-hint" id="${model.key}-time-hint">${values.length} / 8개 · Enter로 추가 · 앞쪽부터 우선 선택</span></div>`;
}
const visitFields = model => `${field(model, 'visitDate', '방문 날짜', 'date')}${times(model)}`;
const targetFields = model => `${field(model, 'themeName', '테마명', 'text', '예: AYAKO')}<div class="field-grid">${field(model, 'branchId', '지점 ID')}${field(model, 'themeId', '테마 ID')}</div>${field(model, 'themeInfoId', '테마 정보 ID')}<p class="notice-line">ID는 키이스케이프 예약 페이지에서 확인한 값을 입력하세요.</p>`;
const openingFields = model => `${field(model, 'openingDate', '예약 오픈 날짜', 'date')}${field(model, 'openingTime', '오픈 시각', 'time')}<p class="notice-line">이 브라우저의 현지 시간 기준</p>`;
const personFields = model => `<div class="field"><label for="${model.key}-personCount">인원</label><select id="${model.key}-personCount" data-field="personCount" ${locked(model)}>${['2', '3', '4'].map(n => `<option value="${n}" ${model.draft.personCount === n ? 'selected' : ''}>${n}명</option>`).join('')}</select></div>${field(model, 'name', '예약자 이름')}${field(model, 'phone', '휴대전화', 'tel', '010-0000-0000')}<p class="notice-line">운영 확장에서는 이름과 전화번호가 이 Chrome 프로필의 로컬 저장소에 보관됩니다.</p>`;
function summary(model) {
  const data = model.draft;
  return `${model.selected ? `<div class="summary-line selected-result"><span>선택된 시간</span><strong>${esc(dateText(model.selected.date))} · ${esc(model.selected.time)}</strong></div>` : ''}<div class="summary-line"><span>예약 대상</span><strong>${esc(data.themeName || '미입력')}</strong></div><div class="summary-line"><span>방문</span><strong>${esc(dateText(data.visitDate))}</strong></div><div class="summary-line"><span>희망 시간</span><strong>${esc(data.candidateTimes || '미입력')}</strong></div><div class="summary-line"><span>예약 오픈</span><strong>${esc(dateText(data.openingDate))} ${esc(timeText(data.openingTime))}</strong></div><div class="summary-line"><span>예약자</span><strong>${esc(data.name || '미입력')} · ${esc(data.personCount)}명</strong></div>`;
}
function renderA(model) {
  const running = active.has(model.status);
  const completed = model.status === 'completed';
  const attention = ['waiting_captcha', 'needs_review'].includes(model.status);
  const summaryOnly = running || completed;
  const controls = completed ? `<div class="btn-row">${completedActions(model)}</div>`
    : running ? `<div class="btn-row">${attention ? tabButton(model) : stopButton(model)}${attention ? stopButton(model) : tabButton(model, true)}</div>`
      : `<div class="btn-row"><button class="btn secondary" type="button" data-action="save">설정 저장</button><button class="btn" type="button" data-action="start">저장하고 대기 시작</button></div>${model.tabOpen ? `<div class="a-tab-action">${tabButton(model, true)}</div>` : ''}`;
  screens.a.innerHTML = `<div class="screen screen-a">
    <header class="a-head"><div class="brand-row"><div class="brand"><small>KEYESCAPE</small>예약 도우미</div>${pill(model)}</div></header>
    <div class="a-main"><section class="a-status"><div class="a-status-top"><div><p class="section-label">현재 상태</p><div class="state-title">${labels[model.status]}</div></div>${countdown(model) ? `<div class="countdown" aria-label="오픈까지 남은 시간">${countdown(model)}</div>` : ''}</div><p class="state-copy">${copy[model.status]}</p>${issue(model)}</section>
      <section class="a-form"><div class="card"><h3>${completed ? '확인된 예약 결과' : running ? '예약 설정 · 실행 중 잠김' : '방문 일정'}</h3>${summaryOnly ? summary(model) : visitFields(model)}</div>
        ${summaryOnly ? '' : `<div class="card"><h3>예약 오픈</h3>${openingFields(model)}</div><details class="disclosure" data-detail="target" ${model.targetOpen ? 'open' : ''}><summary>예약 대상 상세 · ${esc(model.draft.themeName)}</summary><div class="disclosure-body">${targetFields(model)}</div></details><details class="disclosure" data-detail="profile" ${model.profileOpen ? 'open' : ''}><summary>예약자 정보 · ${esc(model.draft.name)}</summary><div class="disclosure-body">${personFields(model)}</div></details>`}
        <details class="disclosure"><summary>도구 · 페이지 진단</summary><p class="notice-line">운영 화면에 있는 진단 기능의 위치 예시입니다.</p></details>
      </section></div><footer class="a-actions">${controls}</footer></div>`;
}
function renderB(model) {
  const flow = model.status !== 'idle';
  let body, footer;
  if (flow) {
    const terminated = ['failed', 'stopped'].includes(model.status);
    const progress = ['armed', 'preparing'].includes(model.status) ? 0 : model.status === 'selecting' ? 1 : model.status === 'waiting_captcha' ? 2 : 3;
    body = `<p class="b-kicker">${terminated ? '예약 진행 · 종료' : `예약 진행 · ${progress + 1} / 4`}</p><h2 class="b-main-title">${labels[model.status]}</h2><p class="b-description">${copy[model.status]}</p>${issue(model)}${model.status === 'completed' ? `<div class="card"><h3>확인된 예약 결과</h3>${summary(model)}</div>` : ''}${countdown(model) ? `<div class="card"><p class="section-label">오픈까지</p><div class="countdown">${countdown(model)}</div><p class="notice-line">${esc(dateText(model.draft.openingDate))} ${esc(timeText(model.draft.openingTime))}</p></div>` : ''}${terminated ? '' : `<div class="card"><h3>${model.status === 'completed' ? '진행 결과' : '현재 단계'}</h3><div class="step-list">${[['오픈 대기', '예약 탭 준비'], ['예약 진행', '날짜와 후보 시간 선택'], ['직접 확인', 'CAPTCHA 완료'], ['결과 확인', '완료 화면 또는 확인 필요']].map(([title, subtitle], index) => `<div class="step-row ${(index < progress || model.status === 'completed') ? 'done' : index === progress ? 'current' : ''}"><span class="step-dot">${(index < progress || model.status === 'completed') ? '✓' : index + 1}</span><div>${title}<small>${subtitle}</small></div></div>`).join('')}</div></div>`}${model.status === 'completed' ? '' : `<div class="card"><h3>예약 내용</h3>${summary(model)}</div>`}`;
    const attention = ['waiting_captcha', 'needs_review'].includes(model.status);
    footer = `<footer class="b-footer">${model.status === 'completed' ? completedActions(model) : !active.has(model.status) ? `<button class="btn" type="button" data-action="new-run">설정 다시 보기</button>${model.tabOpen ? tabButton(model, true) : ''}` : `${attention ? tabButton(model) : stopButton(model)}${attention ? stopButton(model) : tabButton(model, true)}`}</footer>`;
  } else {
    const titles = ['방문 일정', '예약자와 오픈 시각', '확인하고 시작'];
    const descriptions = ['방문 날짜와 희망 시간을 우선순위대로 설정하세요.', '예약 정보와 대기 시작 시각을 확인하세요.', '입력 내용을 살핀 뒤 설정을 저장하거나 대기를 시작하세요.'];
    body = `<p class="b-kicker">예약 준비 · ${model.step + 1} / 3</p><h2 class="b-main-title">${titles[model.step]}</h2><p class="b-description">${descriptions[model.step]}</p><div class="b-nav">${[0, 1, 2].map(index => `<span class="${index <= model.step ? 'active' : ''}"></span>`).join('')}</div>${model.step === 0 ? `<div class="card"><h3>방문 일정</h3>${visitFields(model)}</div><details class="disclosure" data-detail="target" ${model.targetOpen ? 'open' : ''}><summary>예약 대상 · ${esc(model.draft.themeName)}</summary><div class="disclosure-body">${targetFields(model)}</div></details>` : ''}${model.step === 1 ? `<div class="card"><h3>예약 오픈</h3>${openingFields(model)}</div><div class="card"><h3>예약자 정보</h3>${personFields(model)}</div>` : ''}${model.step === 2 ? `<div class="card"><h3>예약 요약</h3>${summary(model)}<div class="divider"></div><p class="small muted">대기 시작 시 입력 내용이 함께 저장됩니다. 실행 중에는 변경할 수 없습니다.</p></div>` : ''}${issue(model)}`;
    footer = `<footer class="b-footer">${model.step > 0 ? '<button class="btn secondary" type="button" data-action="back">이전</button>' : ''}${model.step < 2 ? '<button class="btn" type="button" data-action="next">다음</button>' : '<button class="btn secondary" type="button" data-action="save">설정 저장</button><button class="btn" type="button" data-action="start">대기 시작</button>'}</footer>`;
  }
  screens.b.innerHTML = `<div class="screen screen-b"><header class="b-head"><div class="brand-row"><div class="brand"><small>KEYESCAPE</small>예약 도우미</div>${pill(model)}</div></header><main class="b-body">${body}<details class="disclosure"><summary>도구 · 페이지 진단</summary><p class="notice-line">운영 화면에 있는 진단 기능의 위치 예시입니다.</p></details></main>${footer}</div>`;
}
function renderC(model) {
  const running = active.has(model.status);
  const attention = ['waiting_captcha', 'needs_review'].includes(model.status);
  let body, footer;
  if (model.editing && !running) {
    body = `<div class="c-edit"><p class="section-label">설정 편집</p><div class="card"><h3>방문 일정</h3>${visitFields(model)}</div><div class="card"><h3>예약 오픈</h3>${openingFields(model)}</div><div class="card"><h3>예약 대상</h3>${targetFields(model)}</div><div class="card"><h3>예약자 정보</h3>${personFields(model)}</div></div>`;
    footer = '<footer class="c-footer"><div class="btn-row"><button class="btn secondary" type="button" data-action="edit-close">요약으로</button><button class="btn" type="button" data-action="save">설정 저장</button></div></footer>';
  } else {
    const progress = model.status === 'idle' ? -1 : ['armed', 'preparing'].includes(model.status) ? 0 : model.status === 'selecting' ? 1 : model.status === 'waiting_captcha' ? 2 : 3;
    body = `<div class="c-body"><div class="c-hero"><div class="brand-row"><p class="section-label">LIVE STATUS</p>${pill(model)}</div><div class="state-title">${labels[model.status]}</div>${countdown(model) ? `<div class="countdown">${countdown(model)}</div><p class="notice-line">예약 오픈까지 · ${esc(timeText(model.draft.openingTime))}</p>` : ''}<p class="state-copy">${copy[model.status]}</p></div>${issue(model)}<div class="card"><div class="brand-row"><h3>예약 요약</h3>${!running && model.status !== 'completed' ? '<button class="btn ghost" type="button" data-action="edit">편집</button>' : ''}</div>${summary(model)}</div><div class="card"><h3>진행 현황</h3>${['failed', 'stopped'].includes(model.status) ? '<p class="small muted">자동 진행이 종료되었습니다. 설정을 확인해 새 대기를 시작할 수 있습니다.</p>' : `<div class="progress">${[0, 1, 2, 3].map(index => `<i class="${(index < progress || model.status === 'completed') ? 'done' : index === progress ? 'current' : ''}"></i>`).join('')}</div><div class="progress-labels"><span>대기</span><span>선택</span><span>CAPTCHA</span><span>결과</span></div>`}</div>${!running && model.status !== 'completed' ? '<p class="notice-line">설정 저장은 편집 화면에서, 대기 시작은 아래 버튼에서 진행합니다.</p>' : ''}<details class="disclosure"><summary>도구 · 페이지 진단</summary><p class="notice-line">운영 화면에 있는 진단 기능의 위치 예시입니다.</p></details></div>`;
    footer = `<footer class="c-footer"><div class="btn-row">${model.status === 'completed' ? completedActions(model) : running ? `${attention ? tabButton(model) : stopButton(model)}${attention ? stopButton(model) : tabButton(model, true)}` : `<button class="btn" type="button" data-action="start">저장하고 대기 시작</button>${model.tabOpen ? tabButton(model, true) : ''}`}</div></footer>`;
  }
  screens.c.innerHTML = `<div class="screen screen-c"><header class="c-head"><div class="brand-row"><div class="brand"><small>KEYESCAPE</small>예약 도우미</div>${pill(model)}</div></header>${body}${footer}</div>`;
}
function renderSite(model) {
  const key = model.key;
  const site = sites[key];
  if (!model.tabOpen) {
    site.innerHTML = `<p class="preview-caption">예약 페이지 안내 배너</p><div class="site-canvas"><p class="notice-line">현재 열려 있는 모의 예약 탭이 없습니다.</p><div class="site-skeleton mid"></div><div class="site-skeleton short"></div></div>`;
    return;
  }
  const next = model.status === 'waiting_captcha' ? '사용자 확인 단계' : model.status === 'needs_review' ? '예약 결과 확인 단계' : labels[model.status];
  const step = ['armed', 'preparing'].includes(model.status) ? '01 / 04' : model.status === 'selecting' ? '02 / 04' : model.status === 'waiting_captcha' ? '03 / 04' : ['failed', 'stopped'].includes(model.status) ? '종료' : '04 / 04';
  const badge = key === 'a' ? '●' : key === 'b' ? '단계' : '상태';
  const guidance = actionCopy[model.status] || copy[model.status];
  const content = key === 'a'
    ? `<strong>${badge} ${labels[model.status]}</strong><p>${esc(guidance)}</p>`
    : key === 'b'
      ? `<div class="banner-step"><span>${step}</span><strong>${next}</strong></div><p>${esc(guidance)}</p>`
      : `<div class="brand-row"><strong>${badge} · ${labels[model.status]}</strong><span>KEYESCAPE</span></div><p>${esc(guidance)}</p>`;
  site.innerHTML = `<p class="preview-caption">모의 예약 페이지 · 안내 배너</p><div class="site-canvas">
    <div class="site-skeleton mid"></div><div class="site-skeleton short"></div>
    <div class="banner banner-${key}" data-tone="${tones[model.status]}"><div class="banner-content">${content}</div>${active.has(model.status) ? '<button type="button" class="banner-stop" data-action="stop">중지</button>' : ''}</div>
    ${model.siteOpen ? `<div class="site-detail" tabindex="-1"><strong>예약 화면 미리보기</strong><p>${model.status === 'waiting_captcha' ? 'CAPTCHA는 사용자가 실제 예약 탭에서 직접 완료해야 합니다.' : model.status === 'needs_review' ? '예약 결과를 직접 확인하세요. 이 화면은 제출하지 않습니다.' : '이 페이지는 모형이며 예약 사이트에 접속하지 않습니다.'}</p><button class="btn secondary" type="button" data-action="return-popup">팝업으로 돌아가기</button></div>` : ''}
  </div>`;
}
function updateFeedback(model) {
  const slot = screens[model.key].querySelector('.feedback-slot');
  if (slot) slot.innerHTML = `${feedback(model)}<p class="save-state" role="status">${savedState(model)}</p>`;
  for (const badge of screens[model.key].querySelectorAll('.status-pill')) badge.outerHTML = pill(model);
}
function render(key, preserveScroll = false) {
  const model = models[key];
  const previous = screens[key].querySelector('.a-main, .b-body, .c-body, .c-edit');
  const top = preserveScroll ? previous?.scrollTop ?? 0 : 0;
  if (key === 'a') renderA(model);
  if (key === 'b') renderB(model);
  if (key === 'c') renderC(model);
  screens[key].querySelector('footer').insertAdjacentHTML('afterbegin', '<div class="feedback-slot"></div>');
  updateFeedback(model);
  const scrollArea = screens[key].querySelector('.a-main, .b-body, .c-body, .c-edit');
  scrollArea.scrollTop = top;
  renderSite(model);
}
function focusWithin(key, element) {
  if (!element) return;
  if (!element.matches('button, input, select, summary')) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  const scrollArea = element.closest('.a-main, .b-body, .c-body, .c-edit');
  if (!scrollArea) return;
  const target = element.closest('.time-item') || element.closest('.field') || element;
  const bounds = scrollArea.getBoundingClientRect();
  let rect = target.getBoundingClientRect();
  if (rect.height > bounds.height - 16) {
    const inputRect = element.getBoundingClientRect();
    const errorRect = target.querySelector('.field-error')?.getBoundingClientRect();
    rect = { top: inputRect.top, bottom: Math.max(inputRect.bottom, errorRect?.bottom ?? 0) };
  }
  if (rect.top < bounds.top + 8) scrollArea.scrollTop += rect.top - bounds.top - 8;
  else if (rect.bottom > bounds.bottom - 8) scrollArea.scrollTop += rect.bottom - bounds.bottom + 8;
}
function renderAll() { keys.forEach(render); }
function error(model, issue) {
  const names = { branchId: '지점 ID', themeId: '테마 ID', themeInfoId: '테마 정보 ID', themeName: '테마명', visitDate: '방문 날짜', candidateTimes: '희망 시간', openingDate: '예약 오픈 날짜', openingTime: '오픈 시각', personCount: '인원', name: '예약자 이름', phone: '휴대전화' };
  const missing = issue.message.startsWith('필수 설정을 입력해 주세요:') ? issue.message.split(':')[1].split(',').map(name => name.trim()) : [];
  model.error = missing.length ? `필수 항목을 입력해 주세요: ${missing.map(name => names[name] || name).join(', ')}` : issue.message;
  if (issue.message === '예약 오픈 시간을 확인해 주세요.') model.error = '오픈 시각은 00:00:00~23:59:59 사이로 입력해 주세요. 예: 18:30:00 또는 183000';
  model.message = '';
  const match = [['희망 시간', 'candidateTimes'], ['방문 날짜', 'visitDate'], ['예약 오픈 시각', 'openingTime'], ['예약 오픈 시간', 'openingTime'], ['예약 오픈 날짜', 'openingDate'], ['휴대전화', 'phone'], ['예약자 이름', 'name'], ['테마명', 'themeName'], ['인원', 'personCount']].find(([part]) => issue.message.includes(part));
  model.errorField = missing[0] || match?.[1] || '';
  if (issue.message.includes('지점·테마 ID')) model.errorField = ['branchId', 'themeId', 'themeInfoId'].find(name => model.draft[name] && !/^[1-9]\d{0,8}$/.test(model.draft[name].trim())) || 'branchId';
  if (['branchId', 'themeId', 'themeInfoId', 'themeName'].includes(model.errorField) || issue.message.includes('지점·테마 ID')) model.targetOpen = true;
  if (['personCount', 'name', 'phone'].includes(model.errorField)) model.profileOpen = true;
  if (model.key === 'b') model.step = ['branchId', 'themeId', 'themeInfoId', 'themeName', 'visitDate', 'candidateTimes'].includes(model.errorField) || issue.message.includes('지점·테마 ID') ? 0 : 1;
  if (model.key === 'c') model.editing = true;
}
function save(model) {
  model.draft.openingTime = formatTimeInput(model.draft.openingTime, true);
  try { const settings = normalizeSettings(model.draft); model.draft = { ...settings }; model.saved = { ...settings }; model.error = ''; model.errorField = ''; model.message = ''; if (model.key === 'c') model.editing = false; return true; }
  catch (issue) { error(model, issue); return false; }
}
function start(model) {
  model.draft.openingTime = formatTimeInput(model.draft.openingTime, true);
  try { const settings = validateForRun(model.draft); model.draft = { ...settings }; model.saved = { ...settings }; model.status = 'armed'; model.tabOpen = false; model.editing = false; model.selected = null; model.reason = null; model.siteOpen = false; model.error = ''; model.errorField = ''; model.message = ''; return true; }
  catch (issue) { error(model, issue); return false; }
}
function changeTime(model, action, index) {
  if (active.has(model.status)) return;
  const list = model.draft.candidateTimes.split(',').map(value => value.trim()).filter(Boolean);
  model.error = ''; model.message = '';
  if (action === 'time-add') {
    model.newTime = formatTimeInput(model.newTime);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(model.newTime)) return error(model, new Error('희망 시간은 00:00~23:59 사이로 입력해 주세요. 예: 18:30 또는 1830'));
    if (list.includes(model.newTime)) return error(model, new Error('희망 시간은 중복 없이 입력해 주세요.'));
    if (list.length >= 8) return error(model, new Error('희망 시간은 최대 8개 입력할 수 있습니다.'));
    list.push(model.newTime); model.newTime = '';
  } else if (action === 'time-remove' && index >= 0 && index < list.length) list.splice(index, 1);
  else if (action === 'time-up' && index > 0 && index < list.length) [list[index - 1], list[index]] = [list[index], list[index - 1]];
  else if (action === 'time-down' && index >= 0 && index < list.length - 1) [list[index + 1], list[index]] = [list[index], list[index + 1]];
  model.draft.candidateTimes = list.join(', ');
}
const comparison = document.querySelector('#comparison');
function onField(event) {
  const key = event.target.closest('[data-concept]')?.dataset.concept;
  if (!key) return;
  const model = models[key];
  if (active.has(model.status)) return;
  if (!event.target.dataset.field && !event.target.hasAttribute('data-new-time')) return;
  if (event.type !== 'input' && event.target.matches('.time-input')) event.target.value = formatTimeInput(event.target.value, event.target.hasAttribute('data-time-seconds'));
  const previousValue = event.target.dataset.field ? model.draft[event.target.dataset.field] : model.newTime;
  if (event.type === 'focusout' && previousValue === event.target.value) return;
  if (event.target.dataset.field) model.draft[event.target.dataset.field] = event.target.value;
  if (event.target.hasAttribute('data-new-time')) model.newTime = event.target.value;
  const edited = event.target.dataset.field || 'candidateTimes';
  if (model.errorField === edited) {
    model.error = ''; model.errorField = '';
    event.target.removeAttribute('aria-invalid');
    const hintId = event.target.hasAttribute('data-new-time') ? `${key}-time-hint` : event.target.hasAttribute('data-time-seconds') ? `${key}-${edited}-hint` : '';
    if (hintId) event.target.setAttribute('aria-describedby', hintId);
    else event.target.removeAttribute('aria-describedby');
    event.target.closest('.field')?.querySelector('.field-error')?.remove();
  }
  model.message = '';
  updateFeedback(model);
}
comparison.addEventListener('input', onField);
comparison.addEventListener('change', onField);
comparison.addEventListener('focusout', event => {
  if (event.target.matches('.time-input')) onField(event);
});
comparison.addEventListener('toggle', event => {
  const detail = event.target.dataset.detail;
  const key = event.target.closest('[data-concept]')?.dataset.concept;
  if (key && detail) models[key][detail === 'target' ? 'targetOpen' : 'profileOpen'] = event.target.open;
}, true);
comparison.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  const key = button?.closest('[data-concept]')?.dataset.concept;
  if (!key) return;
  const model = models[key]; const action = button.dataset.action;
  if (action === 'open-tab' && model.tabOpen) {
    model.siteOpen = true;
    renderSite(model);
    sites[key].querySelector('.site-detail').focus({ preventScroll: true });
    sites[key].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  if (action === 'return-popup') {
    screens[key].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    focusWithin(key, screens[key].querySelector('[data-action="open-tab"]'));
    return;
  }
  const fromSite = Boolean(button.closest('.site-preview'));
  const itemTime = button.closest('.time-item')?.dataset.time;
  const oldIndex = Number(button.dataset.index);
  const wasEditing = model.editing;
  if (action.startsWith('time-')) changeTime(model, action, Number(button.dataset.index));
  else if (action === 'save') save(model);
  else if (action === 'start') start(model);
  else if (action === 'stop' && active.has(model.status)) { model.status = 'stopped'; model.reason = null; model.message = '대기 실행을 중지했습니다. (모의 상태)'; model.error = ''; }
  else if (action === 'next') model.step = Math.min(2, model.step + 1);
  else if (action === 'back') model.step = Math.max(0, model.step - 1);
  else if (action === 'edit') model.editing = true;
  else if (action === 'edit-close') model.editing = false;
  else if (action === 'new-run' && !active.has(model.status)) { model.status = 'idle'; model.step = 0; model.editing = key === 'c'; model.selected = null; model.tabOpen = false; model.siteOpen = false; model.reason = null; model.message = '설정을 확인한 뒤 새 대기를 시작할 수 있습니다.'; }
  const preserveScroll = action.startsWith('time-') || (action === 'save' && !(key === 'c' && wasEditing && !model.error));
  render(key, preserveScroll);
  if (model.error) {
    focusWithin(key, screens[key].querySelector(model.errorField === 'candidateTimes' ? '[data-new-time]' : `[data-field="${model.errorField}"]`) || screens[key].querySelector('[role="alert"]'));
  } else if (action === 'time-add') focusWithin(key, screens[key].querySelector('[data-new-time]'));
  else if (action.startsWith('time-')) {
    const rows = [...screens[key].querySelectorAll('.time-item')];
    const row = action === 'time-remove' ? rows[Math.min(oldIndex, rows.length - 1)] : rows.find(row => row.dataset.time === itemTime);
    focusWithin(key, row?.querySelector(`[data-action="${action}"]:not(:disabled)`) || row?.querySelector('button:not(:disabled)') || screens[key].querySelector('[data-new-time]'));
  } else if (action === 'save') focusWithin(key, screens[key].querySelector(`[data-action="${key === 'c' && !model.editing ? 'start' : 'save'}"]`));
  else if (action === 'next' || action === 'back') focusWithin(key, screens[key].querySelector('.b-main-title'));
  else if (action === 'edit') focusWithin(key, screens[key].querySelector('input'));
  else if (action === 'edit-close') focusWithin(key, screens[key].querySelector('[data-action="edit"]'));
  else if (action === 'new-run') focusWithin(key, screens[key].querySelector('input'));
  else focusWithin(key, screens[key].querySelector('.state-title, .b-main-title'));
  if (fromSite) screens[key].scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
comparison.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || !event.target.matches('[data-new-time]')) return;
  event.preventDefault();
  event.target.closest('.time-add').querySelector('[data-action="time-add"]').click();
});
const scenarios = [
  ['idle', '설정 입력'], ['saved', '설정 저장됨'], ['form_error', '입력 오류'], ['armed', '예약 대기'],
  ['preparing', '예약 탭 준비'], ['selecting', '예약 진행'], ['waiting_captcha', 'CAPTCHA 직접 완료'],
  ['submitting', '제출 결과 확인 중'], ['needs_review', '결과 확인 필요'], ['completed', '완료 화면 확인'],
  ['failed', '자동 진행 중단'], ['tab_closed', '예약 탭 닫힘'], ['stopped', '중지됨'],
];
const scenarioInput = document.querySelector('#scenario');
scenarioInput.innerHTML = scenarios.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
function applyScenario(scenario) {
  for (const key of keys) {
    const model = fresh(key);
    if (scenario === 'saved') { model.saved = { ...model.draft }; model.message = '설정을 저장했습니다. 대기를 시작할 수 있습니다.'; }
    else if (scenario === 'form_error') { model.draft.candidateTimes = '11:00, 11:00'; model.error = '희망 시간은 중복 없이 HH:mm 형식으로 최대 8개 입력해 주세요.'; model.errorField = 'candidateTimes'; }
    else if (scenario !== 'idle') {
      model.status = scenario === 'tab_closed' ? 'failed' : scenario;
      model.saved = { ...model.draft };
      model.tabOpen = !['armed', 'tab_closed'].includes(scenario);
      model.siteOpen = model.tabOpen;
      model.selected = ['waiting_captcha', 'submitting', 'needs_review', 'completed'].includes(scenario)
        ? { date: model.draft.visitDate, time: '11:00' } : null;
      model.reason = scenario === 'needs_review' ? 'SUBMISSION_UNCONFIRMED'
        : scenario === 'tab_closed' ? 'RESERVATION_TAB_CLOSED'
          : scenario === 'failed' ? 'SLOTS_UNAVAILABLE' : null;
    }
    models[key] = model;
  }
  renderAll();
}
scenarioInput.addEventListener('change', event => applyScenario(event.target.value));
document.querySelector('#width').addEventListener('change', event => comparison.style.setProperty('--phone-width', `${event.target.value}px`));
document.querySelector('#reset').addEventListener('click', () => { for (const key of keys) models[key] = fresh(key); document.querySelector('#scenario').value = 'idle'; renderAll(); });
setInterval(() => { for (const key of keys) { const element = screens[key].querySelector('.countdown'); if (element && ['armed', 'preparing'].includes(models[key].status)) element.textContent = countdown(models[key]); } }, 1000);
renderAll();
