import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createKeyescapeSite, TARGETS } from '../src/keyescape-site.js';
import { setup, timetable, simulateSelection, completionHtml } from './fixtures.mjs';

const errorCode = (code) => (error) => error.code === code;
const selection = { date: '2026-09-22', time: '13:30', slotId: '2896' };

test('calendar is recognized; sidebar 예약 완료 is not a success signal', t => {
  const { site } = setup(t);
  assert.deepEqual(site.inspect().dates, [
    { date: '2026-09-15', available: false }, { date: '2026-09-22', available: true },
  ]);
  assert.equal(site.inspect().phase, 'calendar');
});

test('native date -> time -> NEXT handlers run once with verified selection', t => {
  const { site, document } = setup(t);
  const effects = simulateSelection(document);
  assert.deepEqual(site.selectDate(selection.date), { requestedDate: selection.date });
  assert.equal(site.inspect().phase, 'times');
  assert.deepEqual(site.selectTime(selection.time), selection);
  assert.deepEqual(site.openDetails(), selection);
  assert.equal(effects.nextCount(), 1);
  assert.throws(() => site.openDetails(), errorCode('ALREADY_ADVANCED'));
  assert.equal(effects.nextCount(), 1);
});

test('targets are configurable, including other branches and themes', t => {
  const target = { branchId: '100', themeId: '200', themeInfoId: '300', name: '다른 테마' };
  const { site, document } = setup(t, { target });
  const effects = simulateSelection(document, target);
  site.selectDate(selection.date);
  site.selectTime(selection.time);
  site.openDetails();
  assert.equal(site.inspect().product.name, '다른 테마');
  assert.equal(effects.nextCount(), 1);
});

test('calendar disabled date is rejected without clicking', t => {
  const { site, document } = setup(t);
  let clicks = 0;
  document.addEventListener('click', () => clicks++);
  assert.throws(() => site.selectDate('2026-09-15'), errorCode('UNAVAILABLE'));
  assert.throws(() => site.selectDate('2026-02-30'), errorCode('INVALID_DATE'));
  assert.throws(() => site.selectDate('2026-10-01'), errorCode('DATE_NOT_FOUND'));
  assert.equal(clicks, 0);
});

test('duplicate and malformed dates stop the adapter', t => {
  const { site, document } = setup(t);
  const cell = document.querySelector('[data-date="2026-09-22"]');
  cell.parentElement.append(cell.cloneNode(true));
  assert.equal(site.inspect().code, 'INVALID_DATES');
  assert.throws(() => site.selectDate(selection.date), errorCode('INVALID_DATES'));
});

test('disabled time is skipped by inspection and cannot be selected', t => {
  const { site, document } = setup(t);
  simulateSelection(document);
  site.selectDate(selection.date);
  assert.equal(site.inspect().slots.find(slot => slot.time === '11:35').available, false);
  assert.throws(() => site.selectTime('11:35'), errorCode('UNAVAILABLE'));
  assert.throws(() => site.selectTime('13:31'), errorCode('TIME_NOT_FOUND'));
  assert.throws(() => site.selectTime('25:00'), errorCode('INVALID_TIME'));
  assert.equal(document.querySelector('input:checked'), null);
});

test('time table alone cannot prove the selected date', t => {
  const { site, document } = setup(t);
  document.querySelector('#datepicker').innerHTML = timetable;
  assert.equal(site.inspect().phase, 'times');
  assert.throws(() => site.selectTime('13:30'), errorCode('DATE_NOT_CONFIRMED'));
});

test('missing site handlers cannot lead to NEXT', t => {
  const { site, document } = setup(t);
  site.selectDate(selection.date);
  document.querySelector('#datepicker').innerHTML = timetable;
  assert.throws(() => site.selectTime(selection.time), errorCode('SELECTION_NOT_CONFIRMED'));
  assert.throws(() => site.openDetails(), errorCode('SELECTION_REQUIRED'));
});

test('changed selection prevents NEXT', t => {
  const { site, document } = setup(t);
  const effects = simulateSelection(document);
  site.selectDate(selection.date);
  site.selectTime(selection.time);
  document.querySelector('#reservInfo').value = '괴록 - 2026.09.23 - 13:30';
  assert.throws(() => site.openDetails(), errorCode('SELECTION_CHANGED'));
  assert.equal(effects.nextCount(), 0);
});

test('slot sold out after selection prevents NEXT', t => {
  const { site, document } = setup(t);
  const effects = simulateSelection(document);
  site.selectDate(selection.date);
  site.selectTime(selection.time);
  document.querySelector('.selThemeTimeNum:checked').disabled = true;
  assert.throws(() => site.openDetails(), errorCode('SELECTION_CHANGED'));
  assert.equal(effects.nextCount(), 0);
});

test('duplicate NEXT buttons stop before navigation', t => {
  const { site, document } = setup(t);
  const effects = simulateSelection(document);
  site.selectDate(selection.date);
  site.selectTime(selection.time);
  document.querySelector('#resrvPage').append(document.querySelector('.btn_next_step').cloneNode(true));
  assert.throws(() => site.openDetails(), errorCode('AMBIGUOUS_ELEMENT'));
  assert.equal(effects.nextCount(), 0);
});

test('missing navigation payload field prevents NEXT', t => {
  const { site, document } = setup(t);
  const effects = simulateSelection(document);
  site.selectDate(selection.date);
  site.selectTime(selection.time);
  document.querySelector('[name="themeInfoNum"]').remove();
  assert.throws(() => site.openDetails(), errorCode('MISSING_ELEMENT'));
  assert.equal(effects.nextCount(), 0);
});

test('duplicated navigation payload field prevents date selection', t => {
  const { site, document } = setup(t);
  const field = document.querySelector('[name="themeNum"]');
  field.parentElement.append(field.cloneNode(true));
  assert.throws(() => site.selectDate(selection.date), errorCode('AMBIGUOUS_ELEMENT'));
});

test('ambiguous slots fail closed', t => {
  const { site, document } = setup(t);
  simulateSelection(document);
  site.selectDate(selection.date);
  const list = document.querySelector('.timeList');
  list.append(list.firstElementChild.cloneNode(true));
  assert.equal(site.inspect().code, 'INVALID_SLOTS');
  assert.throws(() => site.selectTime(selection.time), errorCode('INVALID_SLOTS'));
});

test('theme title and dropdown mismatch is rejected like saved snapshots', t => {
  const { document } = setup(t, { target: TARGETS.ayako });
  document.querySelector('#themeTitle').textContent = '괴록';
  const site = createKeyescapeSite(document, { target: TARGETS.ayako });
  assert.equal(site.inspect().code, 'TARGET_MISMATCH');
  assert.throws(() => site.selectDate(selection.date), errorCode('TARGET_MISMATCH'));
});

test('caller cannot mutate the target after adapter creation', t => {
  const target = { ...TARGETS.goerok };
  const { document } = setup(t);
  const site = createKeyescapeSite(document, { target });
  target.name = '변경';
  assert.equal(site.inspect().product.name, '괴록');
});

test('off-site form action and document URL are rejected', t => {
  const { site, document, dom } = setup(t);
  document.querySelector('#form').action = 'https://example.org/reservation2.php';
  assert.equal(site.inspect().code, 'FORM_CONTRACT_CHANGED');
  dom.reconfigure({ url: 'https://example.org/reservation1.php' });
  assert.equal(site.inspect().code, 'WRONG_ORIGIN');
});

test('loading mask prevents clicks', t => {
  const { site, document } = setup(t);
  document.querySelector('#mask').style.display = 'block';
  assert.equal(site.inspect().code, 'PAGE_LOADING');
  assert.throws(() => site.selectDate(selection.date), errorCode('PAGE_LOADING'));
});

test('detector script text does not falsely trigger a block, rendered block does', t => {
  const { site, document } = setup(t);
  const script = document.createElement('script');
  script.textContent = "const text = '개발자 도구 사용이 금지되어 있습니다.'";
  document.body.append(script);
  assert.equal(site.inspect().ok, true);
  document.body.innerHTML = '<div>개발자 도구 사용이 금지되어 있습니다.</div>';
  assert.equal(site.inspect().code, 'SITE_BLOCKED');
});

test('calendar back and month controls preserve site handling', t => {
  const { site, document } = setup(t);
  simulateSelection(document);
  let month = null;
  document.addEventListener('click', event => {
    if (event.target.matches('.change-month')) month = event.target.dataset.num;
  });
  site.changeMonth(1);
  assert.equal(month, '+1');
  assert.throws(() => site.changeMonth(2), errorCode('INVALID_DIRECTION'));
  site.selectDate(selection.date);
  site.backToCalendar();
  assert.equal(site.inspect().phase, 'calendar');
  document.querySelector('#datepicker').innerHTML = timetable;
  assert.throws(() => site.selectTime(selection.time), errorCode('DATE_NOT_CONFIRMED'));
});

test('form reads correct product and price options, never personal data or token', t => {
  const { site, document } = setup(t, { details: true });
  document.querySelector('#name_input').value = 'PRIVATE_NAME';
  document.querySelector('[name="mobile2"]').value = '1234';
  document.querySelector('[name="g-recaptcha-response"]').value = 'PRIVATE_TOKEN';
  const before = document.documentElement.outerHTML;
  const report = site.inspectDetails(selection);
  assert.equal(report.ok, true);
  assert.equal(report.phase, 'details');
  assert.equal(report.people.length, 3);
  assert.deepEqual(report.requiredAgreements, ['agree_1', 'agree_2']);
  assert.deepEqual(report.optionalAgreements, ['agree_3']);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal(site.submit, undefined);
});

test('details verifies theme IDs and slot ID, not just visible time', t => {
  const { document, site } = setup(t, { details: true });
  assert.throws(() => site.inspectDetails({ ...selection, slotId: '999' }), errorCode('SELECTION_MISMATCH'));
  assert.throws(() => site.inspectDetails(), errorCode('SELECTION_REQUIRED'));
  document.querySelector('[name="theme_num"]').value = '71';
  assert.equal(site.inspect().code, 'TARGET_MISMATCH');
});

test('AYAKO target refuses a 괴록 form', t => {
  const { document } = setup(t, { details: true });
  assert.equal(createKeyescapeSite(document, { target: TARGETS.ayako }).inspect().code, 'TARGET_MISMATCH');
});

test('mobile button is selected only when desktop button is hidden', t => {
  const { site, document } = setup(t, { details: true });
  assert.equal(site.inspect().visibleSubmitButtons, 1);
  document.querySelector('style').textContent = '.pc{display:none}.mb{display:block}';
  assert.equal(site.inspect().visibleSubmitButtons, 1);
  document.querySelector('style').textContent = '.mb,.pc{display:block}';
  assert.equal(site.inspect().code, 'AMBIGUOUS_ELEMENT');
  document.querySelector('style').textContent = '.mb,.pc{display:none}';
  assert.equal(site.inspect().code, 'MISSING_ELEMENT');
});

test('missing or duplicated required fields are incompatible', t => {
  const { site, document } = setup(t, { details: true });
  const name = document.querySelector('#name_input');
  name.parentElement.append(name.cloneNode(true));
  assert.equal(site.inspect().code, 'AMBIGUOUS_ELEMENT');
  document.querySelectorAll('#name_input').forEach(node => node.remove());
  assert.equal(site.inspect().code, 'MISSING_ELEMENT');
});

test('details rejects hidden/visible date disagreement', t => {
  const { site, document } = setup(t, { details: true });
  document.querySelector('[name="rev_days"]').value = '2026-09-23';
  assert.equal(site.inspect().code, 'SELECTION_MISMATCH');
});

test('completion route alone is never treated as successful booking', t => {
  const { site, dom } = setup(t, { details: true });
  dom.reconfigure({ url: 'https://www.keyescape.com/reservation3.php?num=example&ck_code=example' });
  assert.equal(site.inspect().ok, false);
  assert.equal(site.inspect().code, 'MISSING_ELEMENT');
  assert.throws(() => site.openDetails(), errorCode('WRONG_PHASE'));
});

test('manifest limits automatic content scripts to Keyescape reservation pages', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'alarms', 'tabs']);
  assert.equal(manifest.content_scripts.length, 1);
  assert.equal(manifest.background.service_worker, 'extension/background.js');
});

function completed(t) {
  const result = setup(t);
  result.dom.reconfigure({ url: 'https://www.keyescape.com/reservation3.php?num=123456&ck_code=PRIVATE_CODE' });
  result.document.body.innerHTML = completionHtml;
  return result;
}
const completedSelection = { date: '2026-09-29', time: '11:35' };

test('completion recognizes body evidence without exposing booking access or personal data', t => {
  const { site, document } = completed(t);
  const before = document.documentElement.outerHTML;
  const report = site.inspect();
  assert.equal(report.ok, true);
  assert.equal(report.phase, 'completion');
  assert.deepEqual(report.product, { name: '괴록', ...completedSelection });
  assert.equal(report.identityBasis, 'displayed-theme-name');
  assert.equal(report.selectionVerified, false);
  assert.equal(report.paymentStatus, 'unverified');
  assert.equal(report.reservationNumberPresent, true);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|99999|123456|ck_code/);
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal(site.inspectCompletion(completedSelection).selectionVerified, true);
  assert.throws(() => site.openDetails(), errorCode('WRONG_PHASE'));
});

test('completion compares selected date and time and never accepts a stale different slot', t => {
  const { site } = completed(t);
  assert.throws(() => site.inspectCompletion(), errorCode('SELECTION_REQUIRED'));
  assert.throws(() => site.inspectCompletion(selection), errorCode('SELECTION_MISMATCH'));
  assert.throws(() => site.inspectCompletion({ ...completedSelection, time: '13:30' }), errorCode('SELECTION_MISMATCH'));
});

test('completion rejects another theme and works with a generic theme name', t => {
  const { document } = completed(t);
  assert.equal(createKeyescapeSite(document, { target: TARGETS.ayako }).inspect().code, 'TARGET_MISMATCH');
  document.querySelector('.info > div').textContent = '다른 테마 2026.09.29 11:35';
  const target = { branchId: '100', themeId: '200', themeInfoId: '300', name: '다른 테마' };
  assert.equal(createKeyescapeSite(document, { target }).inspect().ok, true);
});

test('completion accepts one visible desktop or mobile success message, rejects ambiguous messages', t => {
  const { site, document } = completed(t);
  document.querySelectorAll('style').forEach(node => node.remove());
  const style = document.createElement('style');
  document.head.append(style);
  style.textContent = '.pc{display:none}.mb{display:block}';
  assert.equal(site.inspect().ok, true);
  style.textContent = '.pc,.mb{display:block}';
  assert.equal(site.inspect().code, 'AMBIGUOUS_ELEMENT');
  style.textContent = '.pc,.mb{display:none}';
  assert.equal(site.inspect().code, 'MISSING_ELEMENT');
});

for (const [name, selector, replacement, code] of [
  ['missing success body', '.text_result.pc', null, 'MISSING_ELEMENT'],
  ['failure body', '.text_result.pc', '예약 실패', 'COMPLETION_UNVERIFIED'],
  ['invalid date', '.info > div', '괴록 2026.02.30 11:35', 'SELECTION_MISMATCH'],
  ['empty number', '.resrv_info_list li:first-child .width_80', '', 'COMPLETION_UNVERIFIED'],
  ['missing result', '.resrv_result2', null, 'MISSING_ELEMENT'],
]) {
  test('completion rejects ' + name, t => {
    const { site, document } = completed(t);
    const element = document.querySelector(selector);
    if (replacement === null) element.remove();
    else element.textContent = replacement;
    assert.equal(site.inspect().code, code);
  });
}

test('completion rejects duplicate reservation rows, loading, and off-site documents', t => {
  const { site, document, dom } = completed(t);
  const row = document.querySelector('.resrv_info_list li');
  const duplicate = row.cloneNode(true);
  row.parentElement.append(duplicate);
  assert.equal(site.inspect().code, 'AMBIGUOUS_ELEMENT');
  duplicate.remove();
  const mask = document.createElement('div');
  mask.id = 'mask';
  document.body.append(mask);
  assert.equal(site.inspect().code, 'PAGE_LOADING');
  dom.reconfigure({ url: 'https://example.org/reservation3.php' });
  assert.equal(site.inspect().code, 'WRONG_ORIGIN');
});


test('details fill uses site controls, required consents and one native submit', t => {
  const { site, document } = setup(t, { details: true });
  const profile = { personCount: '3', name: 'TEST_NAME', phone: '01012345678' };
  let submitClicks = 0;
  document.querySelector('#form').addEventListener('submit', event => event.preventDefault());
  document.querySelector('.submit.pc').addEventListener('click', () => submitClicks++);
  const output = site.fillDetails(selection, profile);
  assert.deepEqual(output, { ...selection, personCount: 3, payment: 'D' });
  assert.equal(document.querySelector('#person').value, '3');
  assert.equal(document.querySelector('[name="mobile2"]').value, '1234');
  assert.equal(document.querySelector('[name="mobile3"]').value, '5678');
  assert.equal(document.querySelector('[name="agree_1"]').checked, true);
  assert.equal(document.querySelector('[name="agree_2"]').checked, true);
  assert.equal(document.querySelector('[name="agree_3"]').checked, false);
  assert.equal(site.captchaReady(selection), false);
  assert.throws(() => site.submitOnce(selection, profile), errorCode('SUBMISSION_NOT_READY'));
  assert.equal(submitClicks, 0);
  document.querySelector('[name="g-recaptcha-response"]').value = 'PRIVATE_TOKEN';
  assert.equal(site.captchaReady(selection), true);
  assert.deepEqual(site.submitOnce(selection, profile), { attempted: true });
  assert.equal(submitClicks, 1);
  assert.throws(() => site.submitOnce(selection, profile), errorCode('ALREADY_SUBMITTED'));
  assert.equal(submitClicks, 1);
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE|TEST_NAME|01012345678/);
});

test('details refuse stale selection, invalid profile and changed consent before submission', t => {
  const { site, document } = setup(t, { details: true });
  const profile = { personCount: '2', name: 'TEST_NAME', phone: '01012345678' };
  assert.throws(() => site.fillDetails({ ...selection, slotId: '9999' }, profile), errorCode('SELECTION_MISMATCH'));
  assert.throws(() => site.fillDetails(selection, { ...profile, phone: '000' }), errorCode('INVALID_PROFILE'));
  assert.equal(document.querySelector('#name_input').value, '');
  site.fillDetails(selection, profile);
  document.querySelector('[name="g-recaptcha-response"]').value = 'PRIVATE_TOKEN';
  document.querySelector('[name="agree_2"]').checked = false;
  assert.throws(() => site.submitOnce(selection, profile), errorCode('SUBMISSION_NOT_READY'));
  assert.equal(document.querySelector('.submit.pc').dataset.attempted, undefined);
});
