import { JSDOM } from 'jsdom';
import { TARGETS, createKeyescapeSite } from '../src/keyescape-site.js';

// Reduced local fixtures transcribed from the supplied HTML and its calendar generator.
// No original scripts, external resources, payment processing, or CAPTCHA service is loaded.
export const calendar = '<div class="datepicker-ui"><button class="change-month" data-num="-1">◀</button><span class="current-month-year">2026년 09월</span><button class="change-month" data-num="+1">▶</button><table><tbody><tr><td class="selDate disabled" data-date="2026-09-15">15</td><td class="selDate available" data-date="2026-09-22">22</td></tr></tbody></table></div>';
export const timetable = '<div class="timepicker-ui"><button id="back_btn">뒤로</button><ul class="timeList">' +
  [['2894', '11:35', true], ['2896', '13:30', false], ['3140', '09:40', false]].map(([id, time, disabled]) =>
    '<li><label><input type="radio" class="selThemeTimeNum" name="themeTimeNum" value="' + id + '"' +
    (disabled ? ' disabled' : '') + '><span>' + time + '</span></label></li>').join('') + '</ul></div>';

export function selectionHtml(target = TARGETS.goerok) {
  return '<!doctype html><html><head><style>.none,.mb{display:none}</style></head><body>' +
    '<section id="resrvPage"><select id="zizum"><option value="' + target.branchId + '">지점</option></select>' +
    '<select id="theme"><option value="' + target.themeInfoId + '" data-themenum="' + target.themeId + '">' + target.name + '</option></select>' +
    '<h4 id="themeTitle">' + target.name + '</h4><div id="datepicker">' + calendar + '</div>' +
    '<form id="form" method="post" action="https://www.keyescape.com/reservation2.php">' +
    ['zizumNum', 'themeNum', 'themeInfoNum', 'revDays', 'themeTimeNum', 'revTimes', 'themeName'].map(name =>
      '<input type="hidden" name="' + name + '" value="">').join('') +
    '</form><input id="reservInfo" readonly><button class="btn_next_step">NEXT</button>' +
    '<div class="stepList">STEP 3. 예약 완료</div></section><div id="mask" style="display:none"></div></body></html>';
}

export function detailsHtml(target = TARGETS.goerok) {
  const values = { t: 'ins_rev', device: 'pc', zizum_num: target.branchId, theme_num: target.themeId,
    theme_info_num: target.themeInfoId, rev_days: '2026-09-22', theme_time_num: '2896', rev_price: '70000' };
  return '<!doctype html><html><head><style>.none,.mb{display:none}</style></head><body><section id="resrvPage">' +
    '<div class="reserv_info"><div class="info"><h4>예약 상품 정보</h4><div>' + target.name + '<br>2026.09.22<br>13:30</div></div></div>' +
    '<form id="form" method="post" action="https://www.keyescape.com/reservation2.php">' +
    Object.entries(values).map(([name, value]) => '<input type="hidden" name="' + name + '" value="' + value + '">').join('') +
    '<select id="person" name="person"><option value="2" data-rev_price="70000" data-price="70000">2명</option><option value="3" data-rev_price="105000" data-price="105000">3명</option><option value="4" data-rev_price="140000" data-price="140000">4명</option></select>' +
    '<input id="name_input" name="name"><input name="mobile1" value="010" readonly><input name="mobile2"><input name="mobile3">' +
    '<select id="payment" name="payment"><option value="D">무통장입금</option></select>' +
    '<input type="checkbox" name="agree_all"><input type="checkbox" name="agree_1"><input type="checkbox" name="agree_2"><input type="checkbox" name="agree_3">' +
    '<span id="captcha" class="g-recaptcha"><iframe title="reCAPTCHA"></iframe><textarea name="g-recaptcha-response"></textarea></span>' +
    '<button type="submit" class="submit pc">예약하기</button><button type="submit" class="submit mb">예약하기</button>' +
    '</form><form id="order_info"><input name="name" value="unrelated payment form"></form>' +
    '<div class="stepList">STEP 3. 예약 완료</div></section><div id="mask" style="display:none"></div></body></html>';
}

export function setup(t, { details = false, target = TARGETS.goerok } = {}) {
  const dom = new JSDOM(details ? detailsHtml(target) : selectionHtml(target), {
    url: 'https://www.keyescape.com/reservation' + (details ? '2' : '1') + '.php',
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  return { dom, document, site: createKeyescapeSite(document, { target }) };
}

// This is a local simulation of the saved site's click-handler effects, not a live-site test.
export function simulateSelection(document, target = TARGETS.goerok) {
  let date = '';
  let nextCount = 0;
  document.addEventListener('click', event => {
    const el = event.target;
    if (el.matches('.selDate:not(.disabled)')) {
      date = el.dataset.date;
      document.querySelector('#datepicker').innerHTML = timetable;
    } else if (el.matches('.selThemeTimeNum')) {
      const time = el.nextElementSibling.textContent.slice(0, 5);
      document.querySelector('#reservInfo').value = target.name + ' - ' + date.replaceAll('-', '.') + ' - ' + time;
      document.querySelector('[name="revTimes"]').value = time;
      document.querySelector('[name="themeName"]').value = target.name;
    } else if (el.matches('#back_btn')) {
      document.querySelector('#datepicker').innerHTML = calendar;
    } else if (el.matches('.btn_next_step')) {
      nextCount++;
      document.querySelector('[name="revDays"]').value = date;
    }
  });
  return { nextCount: () => nextCount };
}


// Synthetic completion data; no original booking numbers, names, phone numbers or access codes.
export const completionHtml = '<style>.mb{display:none}</style><section id="resrvPage">' +
  '<p class="text_result pc">예약 완료! 보다 설레는 Key의 세상으로!</p>' +
  '<div class="resrvStep step3"><div class="resrv_result2">' +
  '<p class="text_result mb">예약 완료! 보다 설레는 Key의 세상으로!</p>' +
  '<div class="reserv_info"><div class="info"><div>괴록<br>2026. 09. 29<br>11:35</div></div>' +
  '<ul class="resrv_info_list">' +
  [['예약번호', '99999'], ['인원', '2명'], ['예약자', 'PRIVATE_NAME'],
    ['연락처', 'PRIVATE_PHONE'], ['요금', '70,000'], ['결제방법', '무통장입금']].map(([label, value]) =>
    '<li><span class="subject width_20">' + label + '</span><span class="width_80">' + value + '</span></li>').join('') +
  '</ul></div></div><div class="stepList"><div class="step active">STEP 3. 예약 완료</div></div></div></section>';
