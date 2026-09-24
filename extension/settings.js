export const SETTINGS_KEY = 'keyescapeSettings';
export const RUN_KEY = 'keyescapeRun';
export const DEFAULT_SETTINGS = Object.freeze({
  branchId: '23', themeId: '71', themeInfoId: '63', themeName: 'AYAKO',
  visitDate: '', candidateTimes: '', openingDate: '', openingTime: '11:00:00',
  personCount: '2', name: '', phone: '',
});

export function normalizeSettings(input) {
  const value = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key =>
    [key, String(input?.[key] ?? '').trim()]));
  for (const key of ['branchId', 'themeId', 'themeInfoId']) {
    if (value[key] && !/^[1-9]\d{0,8}$/.test(value[key])) throw new Error('지점·테마 ID는 양의 숫자로 입력해 주세요.');
  }
  if (value.themeName.length > 60) throw new Error('테마명은 60자 이내로 입력해 주세요.');
  if (value.visitDate && !validDate(value.visitDate)) throw new Error('방문 날짜를 확인해 주세요.');
  if (value.openingDate && !validDate(value.openingDate)) throw new Error('예약 오픈 날짜를 확인해 주세요.');
  if (value.openingTime && !validTime(value.openingTime)) throw new Error('예약 오픈 시간을 확인해 주세요.');
  if (value.candidateTimes) {
    const times = value.candidateTimes.split(/[ ,，\n]+/).filter(Boolean);
    if (!times.length || times.length > 8 || times.some(time => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))
      || new Set(times).size !== times.length) {
      throw new Error('희망 시간은 중복 없이 HH:mm 형식으로 최대 8개 입력해 주세요.');
    }
    value.candidateTimes = times.join(', ');
  }
  if (value.personCount && !['2', '3', '4'].includes(value.personCount)) throw new Error('인원은 2명, 3명, 4명 중에서 선택해 주세요.');
  if (value.name && (value.name.length < 2 || value.name.length > 30)) throw new Error('예약자 이름은 2~30자로 입력해 주세요.');
  if (value.phone) {
    const digits = value.phone.replaceAll('-', '').replaceAll(' ', '');
    if (!/^010\d{8}$/.test(digits)) throw new Error('휴대전화 번호를 010-0000-0000 형식으로 입력해 주세요.');
    value.phone = digits;
  }
  return value;
}

export function validateForRun(input, now = Date.now()) {
  const settings = normalizeSettings(input);
  const required = ['branchId', 'themeId', 'themeInfoId', 'themeName', 'visitDate', 'candidateTimes', 'openingDate', 'openingTime', 'personCount', 'name', 'phone'];
  const missing = required.filter(key => !settings[key]);
  if (missing.length) throw new Error('필수 설정을 입력해 주세요: ' + missing.join(', '));
  const today = new Date();
  const todayString = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  if (settings.visitDate < todayString) throw new Error('방문 날짜는 오늘 이후로 입력해 주세요.');
  const openingAt = new Date(settings.openingDate + 'T' + settings.openingTime).getTime();
  if (!Number.isFinite(openingAt) || openingAt <= now) throw new Error('예약 오픈 시각은 현재보다 나중이어야 합니다.');
  return settings;
}

function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value); }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
