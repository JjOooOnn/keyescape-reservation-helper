/**
 * DOM contracts observed in the user-supplied reservation HTML.
 * Site actions are explicit and never bypass the site handlers or CAPTCHA.
 */
export const TARGETS = Object.freeze({
  ayako: Object.freeze({ branchId: '23', themeId: '71', themeInfoId: '63', name: 'AYAKO' }),
  goerok: Object.freeze({ branchId: '23', themeId: '70', themeInfoId: '61', name: '괴록' }),
  tutu: Object.freeze({ branchId: '23', themeId: '69', themeInfoId: '60', name: '투투 어드벤쳐' }),
});

export class CompatibilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CompatibilityError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new CompatibilityError(code, message);
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const validTime = (value) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isVisible(element) {
  if (!element?.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  for (let node = element; node?.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)) return false;
  }
  return true;
}

function unique(root, selector, label, predicate = () => true) {
  const matches = [...root.querySelectorAll(selector)].filter(predicate);
  if (matches.length !== 1) {
    fail(matches.length ? 'AMBIGUOUS_ELEMENT' : 'MISSING_ELEMENT',
      label + ': 요소가 정확히 하나여야 합니다. 발견: ' + matches.length);
  }
  return matches[0];
}

function enabled(element) {
  return !element.matches(':disabled') && !element.classList.contains('disabled')
    && element.getAttribute('aria-disabled') !== 'true' && !element.closest('[inert]');
}

function assertActionable(element, visible) {
  if (!visible(element) || !enabled(element)) fail('UNAVAILABLE', '현재 선택할 수 없는 요소입니다.');
}

function formValue(form, name) {
  return unique(form, 'input[name="' + name + '"]', name).value;
}

function textWithBreaks(element) {
  const copy = element.cloneNode(true);
  copy.querySelectorAll('br').forEach(node => node.replaceWith(' '));
  return clean(copy.textContent);
}

function checkForm(form) {
  const action = new URL(form.action, form.ownerDocument.URL);
  if (form.method.toLowerCase() !== 'post'
    || action.origin !== 'https://www.keyescape.com' || action.pathname !== '/reservation2.php'
    || action.search || action.hash) {
    fail('FORM_CONTRACT_CHANGED', '예상한 예약 화면 이동 경로와 다릅니다.');
  }
}

export function createKeyescapeSite(document, { target, visible = isVisible } = {}) {
  if (!target || !['branchId', 'themeId', 'themeInfoId'].every(key => /^[1-9]\d*$/.test(target[key] ?? ''))
    || typeof target.name !== 'string' || !clean(target.name) || clean(target.name) !== target.name) {
    fail('TARGET_REQUIRED', '지점·테마 식별자와 테마명을 명시해야 합니다.');
  }
  // Keep a private immutable copy; a caller cannot change the target mid-run.
  const expectedTarget = Object.freeze({ branchId: String(target.branchId), themeId: String(target.themeId),
    themeInfoId: String(target.themeInfoId), name: target.name });
  let selectedDate = null;
  let selectedSlot = null;
  let advanceAttempted = false;
  let detailsFilled = false;
  let submitAttempted = false;

  function page() {
    const url = new URL(document.URL);
    if (url.origin !== 'https://www.keyescape.com') fail('WRONG_ORIGIN', '키이스케이프 예약 페이지가 아닙니다.');
    if (!['/reservation1.php', '/reservation2.php', '/reservation3.php'].includes(url.pathname)) {
      fail('UNSUPPORTED_PAGE', '지원하는 예약 경로가 아닙니다.');
    }
    // Exclude script text: the original page's detector script contains this phrase.
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll('script, style, noscript, template').forEach(node => node.remove());
    if (copy.textContent.includes('개발자 도구 사용이 금지되어 있습니다.')) {
      fail('SITE_BLOCKED', '사이트가 개발자 도구 차단 화면을 표시합니다.');
    }
    if (url.pathname === '/reservation3.php') {
      return { phase: 'completion' };
    }
    const root = unique(document, '#resrvPage', '예약 영역');
    const form = unique(root, 'form#form', '예약 폼');
    checkForm(form);
    const mask = document.querySelector('#mask');
    if (mask && visible(mask)) fail('PAGE_LOADING', '사이트 조회가 진행 중입니다.');
    if (url.pathname === '/reservation2.php') {
      if (formValue(form, 't') !== 'ins_rev') fail('FORM_CONTRACT_CHANGED', '예약 폼 구분값이 다릅니다.');
      return { phase: 'details', root, form };
    }
    for (const name of ['zizumNum', 'themeNum', 'themeInfoNum', 'revDays', 'themeTimeNum', 'revTimes', 'themeName']) {
      unique(form, 'input[type="hidden"][name="' + name + '"]', '다음 화면 전달 항목: ' + name);
    }
    const picker = unique(root, '#datepicker', '날짜·시간 영역');
    const calendars = picker.querySelectorAll('.datepicker-ui');
    const timetables = picker.querySelectorAll('.timepicker-ui');
    if (calendars.length + timetables.length !== 1) {
      fail('UNKNOWN_PICKER', '날짜·시간 영역의 상태를 확정할 수 없습니다.');
    }
    return { phase: calendars.length ? 'calendar' : 'times', root, form, picker };
  }

  function identity(state) {
    if (state.phase === 'details') {
      const { form, root } = state;
      const found = {
        branchId: formValue(form, 'zizum_num'),
        themeId: formValue(form, 'theme_num'),
        themeInfoId: formValue(form, 'theme_info_num'),
      };
      for (const key of Object.keys(found)) {
        if (found[key] !== expectedTarget[key]) fail('TARGET_MISMATCH', '예약 대상 식별자가 설정과 다릅니다: ' + key);
      }
      const summary = textWithBreaks(unique(root, '.reserv_info .info > div', '예약 상품 요약'));
      const match = summary.match(/^(.+?)\s+(\d{4}\.\d{2}\.\d{2})\s+((?:[01]\d|2[0-3]):[0-5]\d)$/);
      if (!match || clean(match[1]) !== expectedTarget.name) {
        fail('TARGET_MISMATCH', '예약 상품명 또는 요약 형식이 설정과 다릅니다.');
      }
      const date = formValue(form, 'rev_days');
      const slotId = formValue(form, 'theme_time_num');
      if (!validDate(date) || date !== match[2].replaceAll('.', '-') || !/^\d+$/.test(slotId)) {
        fail('SELECTION_MISMATCH', '상품 요약과 예약 폼의 날짜·시간 식별자가 일치하지 않습니다.');
      }
      return { ...found, name: expectedTarget.name, date, time: match[3], slotId };
    }
    const branch = unique(state.root, 'select#zizum', '지점 선택');
    const theme = unique(state.root, 'select#theme', '테마 선택');
    if (theme.selectedOptions.length !== 1) fail('TARGET_MISMATCH', '선택된 테마가 불명확합니다.');
    const option = theme.selectedOptions[0];
    const name = clean(unique(state.root, '#themeTitle', '표시된 테마명').textContent);
    if (branch.value !== expectedTarget.branchId || theme.value !== expectedTarget.themeInfoId
      || option.dataset.themenum !== expectedTarget.themeId
      || clean(option.textContent) !== expectedTarget.name || name !== expectedTarget.name) {
      fail('TARGET_MISMATCH', '드롭다운·표시된 테마·설정이 일치하지 않습니다. 테마를 다시 선택하세요.');
    }
    return { ...expectedTarget };
  }

  function requirePhase(phase) {
    const state = page();
    if (state.phase !== phase) fail('WRONG_PHASE', '현재 단계에서 실행할 수 없습니다: ' + state.phase);
    identity(state);
    return state;
  }

  function dates(state) {
    const nodes = [...state.picker.querySelectorAll('.selDate[data-date]')];
    if (!nodes.length) fail('MISSING_ELEMENT', '달력의 날짜 요소가 없습니다.');
    const seen = new Set();
    return nodes.map(element => {
      const date = element.dataset.date;
      if (!validDate(date) || seen.has(date)) fail('INVALID_DATES', '날짜가 잘못되었거나 중복됩니다.');
      seen.add(date);
      return { date, available: element.classList.contains('available') && enabled(element), element };
    });
  }

  function slots(state) {
    const nodes = [...state.picker.querySelectorAll('.timeList input.selThemeTimeNum[name="themeTimeNum"]')];
    if (!nodes.length) fail('MISSING_ELEMENT', '시간 목록이 없습니다.');
    const ids = new Set();
    const times = new Set();
    return nodes.map(element => {
      const label = element.closest('label');
      if (!label || element.type !== 'radio') fail('INVALID_SLOTS', '시간 선택 항목의 구조가 다릅니다.');
      const labelText = clean(unique(label, 'span', '시간 표시').textContent);
      const time = labelText.slice(0, 5);
      if (!validTime(time) || !/^\d+$/.test(element.value) || ids.has(element.value) || times.has(time)) {
        fail('INVALID_SLOTS', '시간 또는 시간 식별자가 잘못되었거나 중복됩니다.');
      }
      ids.add(element.value);
      times.add(time);
      return { time, slotId: element.value, available: enabled(element), element, label };
    });
  }

  function getFormControls(state) {
    const controls = {};
    const selectors = {
      person: 'select#person[name="person"]',
      name: 'input#name_input[name="name"]',
      mobile1: 'input[name="mobile1"]',
      mobile2: 'input[name="mobile2"]',
      mobile3: 'input[name="mobile3"]',
      payment: 'select#payment[name="payment"]',
      privacy: 'input[type="checkbox"][name="agree_1"]',
      paymentAgreement: 'input[type="checkbox"][name="agree_2"]',
      marketing: 'input[type="checkbox"][name="agree_3"]',
      captcha: '#captcha.g-recaptcha',
      captchaResponse: 'textarea[name="g-recaptcha-response"]',
    };
    for (const [name, selector] of Object.entries(selectors)) {
      controls[name] = unique(state.form, selector, name);
    }
    controls.submit = unique(state.form, 'button.submit[type="submit"]', '표시된 예약 버튼', visible);
    assertActionable(controls.submit, visible);
    if (!controls.mobile1.readOnly || controls.mobile1.value !== '010') {
      fail('FORM_CONTRACT_CHANGED', '연락처 앞자리 구조가 예상과 다릅니다.');
    }
    if (![...controls.payment.options].some(option => option.value === 'D' && clean(option.textContent) === '무통장입금')) {
      fail('FORM_CONTRACT_CHANGED', '무통장입금 선택 항목이 없습니다.');
    }
    unique(controls.captcha, 'iframe[title="reCAPTCHA"]', '인증 체크박스 프레임');
    return controls;
  }

  function completionReport() {
    const root = unique(document, '#resrvPage', '예약 영역');
    const step = unique(root, '.resrvStep.step3', '완료 단계', visible);
    const result = unique(step, '.resrv_result2', '완료 결과 영역', visible);
    const message = unique(root, 'p.text_result', '표시된 완료 문구', visible);
    if (clean(message.textContent) !== '예약 완료! 보다 설레는 Key의 세상으로!') {
      fail('COMPLETION_UNVERIFIED', '본문의 예약 완료 표시를 확인할 수 없습니다.');
    }
    const mask = document.querySelector('#mask');
    if (mask && visible(mask)) fail('PAGE_LOADING', '사이트 조회가 진행 중입니다.');
    const summary = textWithBreaks(unique(result, '.reserv_info .info > div', '완료 상품 요약', visible));
    const match = summary.match(/^(.+?)\s+(\d{4})\.\s*(\d{2})\.\s*(\d{2})\s+((?:[01]\d|2[0-3]):[0-5]\d)$/);
    if (!match || clean(match[1]) !== expectedTarget.name) {
      fail('TARGET_MISMATCH', '완료 화면의 테마명 또는 요약 형식이 설정과 다릅니다.');
    }
    const date = match[2] + '-' + match[3] + '-' + match[4];
    if (!validDate(date)) fail('SELECTION_MISMATCH', '완료 화면의 날짜가 유효하지 않습니다.');
    const list = unique(result, '.reserv_info .resrv_info_list', '완료 정보 목록', visible);
    for (const label of ['예약번호', '인원', '예약자', '연락처', '요금', '결제방법']) {
      const subject = unique(list, 'li > span.subject', '완료 항목: ' + label,
        node => clean(node.textContent) === label && visible(node));
      const value = unique(subject.parentElement, ':scope > span:not(.subject)', '완료 값: ' + label, visible);
      if (!clean(value.textContent) || (label === '예약번호' && !/^\d+$/.test(clean(value.textContent)))) {
        fail('COMPLETION_UNVERIFIED', '완료 정보 항목이 비어 있거나 형식이 다릅니다.');
      }
    }
    // No branch/theme IDs or slot ID are exposed by this completion DOM.
    // A saved or stale success page is not evidence that the current run submitted a booking.
    return { ok: true, phase: 'completion', product: { name: expectedTarget.name, date, time: match[5] },
      identityBasis: 'displayed-theme-name', reservationNumberPresent: true,
      selectionVerified: false, paymentStatus: 'unverified' };
  }

  function inspectCompletion(expectedSelection) {
    if (page().phase !== 'completion') fail('WRONG_PHASE', '예약 완료 화면이 아닙니다.');
    if (!expectedSelection || !validDate(expectedSelection.date) || !validTime(expectedSelection.time)) {
      fail('SELECTION_REQUIRED', '앞 단계에서 확인한 날짜·시간이 필요합니다.');
    }
    const report = completionReport();
    for (const key of ['date', 'time']) {
      if (report.product[key] !== expectedSelection[key]) {
        fail('SELECTION_MISMATCH', '완료 화면의 날짜·시간이 선택 내용과 다릅니다.');
      }
    }
    return { ...report, selectionVerified: true };
  }

  function inspect() {
    try {
      const state = page();
      if (state.phase === 'completion') return completionReport();
      const product = identity(state);
      if (state.phase === 'details') {
        const controls = getFormControls(state);
        const people = [...controls.person.options].map(option => {
          if (!/^[1-9]\d*$/.test(option.value)
            || !/^\d+$/.test(option.dataset.rev_price ?? '')
            || !/^\d+$/.test(option.dataset.price ?? '')) {
            fail('FORM_CONTRACT_CHANGED', '인원·요금 선택 항목이 예상과 다릅니다.');
          }
          return { count: Number(option.value), price: Number(option.dataset.price), deposit: Number(option.dataset.rev_price) };
        });
        if (!people.length) fail('MISSING_ELEMENT', '인원 선택 항목이 없습니다.');
        return { ok: true, phase: state.phase, product, people,
          requiredAgreements: ['agree_1', 'agree_2'], optionalAgreements: ['agree_3'],
          payment: 'D', captchaPresent: true, visibleSubmitButtons: 1 };
      }
      const data = state.phase === 'calendar'
        ? { dates: dates(state).map(({ element, ...item }) => item) }
        : { slots: slots(state).map(({ element, label, ...item }) => item) };
      return { ok: true, phase: state.phase, product, ...data };
    } catch (error) {
      if (!(error instanceof CompatibilityError)) throw error;
      return { ok: false, code: error.code, message: error.message };
    }
  }

  function selectDate(date) {
    if (!validDate(date)) fail('INVALID_DATE', '날짜는 유효한 YYYY-MM-DD 형식이어야 합니다.');
    const state = requirePhase('calendar');
    const matches = dates(state).filter(item => item.date === date);
    if (matches.length !== 1) fail('DATE_NOT_FOUND', '현재 달력에 지정한 날짜가 없습니다.');
    const match = matches[0];
    if (!match.available) fail('UNAVAILABLE', '선택할 수 없는 날짜입니다.');
    assertActionable(match.element, visible);
    selectedDate = null;
    selectedSlot = null;
    match.element.click(); // Site handler performs its own availability request.
    selectedDate = date;
    return { requestedDate: date }; // Caller must wait for the site's time table to finish loading.
  }

  function selectTime(time) {
    if (!validTime(time)) fail('INVALID_TIME', '시간은 HH:mm 형식이어야 합니다.');
    const state = requirePhase('times');
    if (!selectedDate) fail('DATE_NOT_CONFIRMED', '이 모듈을 통해 날짜를 먼저 선택해야 합니다.');
    const matches = slots(state).filter(item => item.time === time);
    if (matches.length !== 1) fail('TIME_NOT_FOUND', '해당 시간이 목록에 없습니다.');
    const slot = matches[0];
    if (!slot.available) fail('UNAVAILABLE', '마감된 시간입니다.');
    assertActionable(slot.label, visible);
    selectedSlot = null;
    slot.element.click(); // A native radio click triggers the site's delegated jQuery handler.
    const summary = unique(state.root, '#reservInfo', '선택 요약');
    const expectedSummary = expectedTarget.name + ' - ' + selectedDate.replaceAll('-', '.') + ' - ' + time;
    if (!slot.element.checked || clean(summary.value) !== expectedSummary
      || formValue(state.form, 'revTimes') !== time
      || formValue(state.form, 'themeName') !== expectedTarget.name) {
      fail('SELECTION_NOT_CONFIRMED', '사이트가 날짜·시간 선택 결과를 확인해 주지 않았습니다.');
    }
    selectedSlot = { time, slotId: slot.slotId };
    return { date: selectedDate, ...selectedSlot };
  }

  function openDetails() {
    if (advanceAttempted) fail('ALREADY_ADVANCED', '정보 입력 화면 이동을 이미 시도했습니다.');
    const state = requirePhase('times');
    if (!selectedSlot || !selectedDate) fail('SELECTION_REQUIRED', '검증된 날짜·시간 선택이 필요합니다.');
    const selected = slots(state).filter(item => item.element.checked);
    if (selected.length !== 1 || !selected[0].available
      || selected[0].slotId !== selectedSlot.slotId || selected[0].time !== selectedSlot.time) {
      fail('SELECTION_CHANGED', '선택한 시간 상태가 변경되었습니다.');
    }
    const summary = unique(state.root, '#reservInfo', '선택 요약');
    const expectedSummary = expectedTarget.name + ' - ' + selectedDate.replaceAll('-', '.') + ' - ' + selectedSlot.time;
    if (clean(summary.value) !== expectedSummary
      || formValue(state.form, 'revTimes') !== selectedSlot.time
      || formValue(state.form, 'themeName') !== expectedTarget.name) {
      fail('SELECTION_CHANGED', '선택 요약이 변경되었습니다.');
    }
    const next = unique(state.root, 'button.btn_next_step', 'NEXT 버튼');
    assertActionable(next, visible);
    advanceAttempted = true; // Never repeat an uncertain navigation.
    next.click(); // Site handler navigates reservation1 -> reservation2.
    return { date: selectedDate, ...selectedSlot };
  }

  function backToCalendar() {
    const state = requirePhase('times');
    const back = unique(state.picker, 'button#back_btn', '달력 돌아가기');
    assertActionable(back, visible);
    selectedDate = null;
    selectedSlot = null;
    back.click();
  }

  function changeMonth(direction) {
    if (direction !== -1 && direction !== 1) fail('INVALID_DIRECTION', '월 이동은 -1 또는 1만 지원합니다.');
    const state = requirePhase('calendar');
    const button = unique(state.picker, 'button.change-month', '월 이동 버튼',
      element => element.getAttribute('data-num') === (direction === -1 ? '-1' : '+1'));
    assertActionable(button, visible);
    selectedDate = null;
    selectedSlot = null;
    button.click();
  }

  function inspectDetails(expectedSelection) {
    const state = requirePhase('details');
    const product = identity(state);
    getFormControls(state);
    if (!expectedSelection || !validDate(expectedSelection.date) || !validTime(expectedSelection.time)
      || !/^\d+$/.test(expectedSelection.slotId ?? '')) {
      fail('SELECTION_REQUIRED', '앞 단계에서 확인한 날짜·시간·시간 식별자가 필요합니다.');
    }
    for (const key of ['date', 'time', 'slotId']) {
      if (product[key] !== expectedSelection[key]) fail('SELECTION_MISMATCH', '정보 입력 화면의 선택 내용이 다릅니다: ' + key);
    }
    return inspect();
  }

  function fillDetails(expectedSelection, profile) {
    if (detailsFilled) fail('ALREADY_FILLED', '예약 정보를 이미 입력했습니다.');
    inspectDetails(expectedSelection);
    if (!profile || !['2', '3', '4'].includes(String(profile.personCount))
      || typeof profile.name !== 'string' || !profile.name.trim()
      || !/^010\d{8}$/.test(profile.phone ?? '')) {
      fail('INVALID_PROFILE', '예약자 정보를 확인해 주세요.');
    }
    const controls = getFormControls(requirePhase('details'));
    const option = [...controls.person.options].find(item => item.value === String(profile.personCount));
    if (!option || option.disabled) fail('UNAVAILABLE', '선택한 인원이 현재 이용 가능하지 않습니다.');
    detailsFilled = true;
    function setValue(element, value) {
      element.value = value;
      element.dispatchEvent(new element.ownerDocument.defaultView.Event('input', { bubbles: true }));
      element.dispatchEvent(new element.ownerDocument.defaultView.Event('change', { bubbles: true }));
    }
    setValue(controls.person, option.value);
    setValue(controls.name, profile.name);
    setValue(controls.mobile2, profile.phone.slice(3, 7));
    setValue(controls.mobile3, profile.phone.slice(7));
    setValue(controls.payment, 'D');
    if (!controls.privacy.checked) controls.privacy.click();
    if (!controls.paymentAgreement.checked) controls.paymentAgreement.click();
    if (controls.marketing.checked) controls.marketing.click();
    const confirmed = getFormControls(requirePhase('details'));
    if (confirmed.person.value !== option.value || confirmed.name.value !== profile.name
      || confirmed.mobile2.value !== profile.phone.slice(3, 7)
      || confirmed.mobile3.value !== profile.phone.slice(7)
      || confirmed.payment.value !== 'D' || !confirmed.privacy.checked
      || !confirmed.paymentAgreement.checked || confirmed.marketing.checked) {
      fail('FILL_NOT_CONFIRMED', '입력한 예약 정보가 사이트 화면에 반영되지 않았습니다.');
    }
    return { date: expectedSelection.date, time: expectedSelection.time,
      slotId: expectedSelection.slotId, personCount: Number(option.value), payment: 'D' };
  }

  function captchaReady(expectedSelection) {
    inspectDetails(expectedSelection);
    const controls = getFormControls(requirePhase('details'));
    return Boolean(controls.captchaResponse.value.trim());
  }

  function submitOnce(expectedSelection, profile) {
    if (submitAttempted) fail('ALREADY_SUBMITTED', '예약하기를 이미 시도했습니다.');
    if (!detailsFilled) fail('DETAILS_NOT_FILLED', '이 모듈에서 예약 정보를 먼저 입력해야 합니다.');
    inspectDetails(expectedSelection);
    const controls = getFormControls(requirePhase('details'));
    if (controls.name.value !== profile?.name || controls.mobile1.value !== '010'
      || controls.mobile2.value !== profile?.phone?.slice(3, 7)
      || controls.mobile3.value !== profile?.phone?.slice(7)
      || controls.person.value !== String(profile?.personCount)
      || controls.payment.value !== 'D' || !controls.privacy.checked
      || !controls.paymentAgreement.checked || controls.marketing.checked
      || !controls.captchaResponse.value.trim()) {
      fail('SUBMISSION_NOT_READY', '예약 정보·동의·자동등록방지 상태를 다시 확인해 주세요.');
    }
    submitAttempted = true; // An uncertain click must never be repeated.
    controls.submit.click(); // Uses the site's own click handler and AJAX submission.
    return { attempted: true };
  }

  return Object.freeze({ inspect, inspectDetails, inspectCompletion, selectDate, selectTime,
    openDetails, backToCalendar, changeMonth, fillDetails, captchaReady, submitOnce });
}
