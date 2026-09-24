# 1단계 사이트 호환성 구현·검증 기록

최초 검증일: 2026-09-16. 완료 HTML 추가 검증일: 2026-09-23. 이 도구로 실제 예약은 생성하지 않았습니다.

## 1. 변경 파일

- manifest.json, extension/popup.html, extension/popup.css, extension/popup.js: 사용자가 누를 때만 동작하는 읽기 전용 진단 확장.
- src/keyescape-site.js: DOM 검사 및 날짜·시간·NEXT 조작을 분리한 사이트 전용 모듈.
- test/fixtures.mjs, test/keyescape-site.test.js: 외부 요청이 없는 축약 모의 화면과 오류/이동 검증.
- scripts/check-snapshots.mjs: 사용자 저장 HTML의 정적 진단.
- package.json, package-lock.json, .gitignore: 독립 프로젝트 및 jsdom 개발 의존성.
- README.md, 이 문서: 사용 방법, API, 확인 근거 및 한계.

## 2. 주요 구현 내용

### 파일과 화면의 관계

| 첨부 파일 | 실제 페이지 | 확인 내용 |
|---|---|---|
| 예약1.html | reservation1.php | 괴록 시간표, 숨김 전달 필드는 비어 있음 |
| 예약2.html | reservation1.php | 같은 시간표, 숨김 필드에 괴록 / 2026-09-22 / 13:30 / 시간 ID 2896 |
| 예약3.html | reservation2.php | 괴록 정보 입력 화면. 완료 화면이 아님 |
| 완료.html | reservation3.php | 괴록 / 2026-09-29 / 11:35 완료 본문과 예약 정보 목록 |

예약1·2의 저장된 select#theme에서는 AYAKO option에 selected가 남아 있으나, #themeTitle과 시간표는 괴록입니다. 브라우저 저장 과정에서 동적 선택 상태가 완전히 직렬화되지 않았을 가능성이 있으나 원인은 확정하지 않았습니다. 원본 불일치는 수정하거나 무시하지 않으며 TARGET_MISMATCH로 판정합니다.

### 대상 식별

| 테마 | 지점 ID | 테마 ID | 테마 정보 ID |
|---|---|---|---|
| AYAKO | 23 | 71 | 63 |
| 괴록 | 23 | 70 | 61 |
| 투투 어드벤쳐 | 23 | 69 | 60 |

사용자 확인: 실제 목표는 AYAKO. 예약 가능한 시간대가 없는 관계로 괴록 자료를 공통 흐름 검증에 사용. 모듈은 위 세 항목만 허용하는 방식이 아니라 명시적으로 전달된 숫자 식별자와 테마명을 검증합니다. 다른 테마에도 같은 DOM 계약이 적용되는지는 별도 확인이 필요합니다.

### 관찰된 DOM 계약

| 역할 | 선택자 / 판정 |
|---|---|
| 지점 | select#zizum의 현재 value |
| 테마 | select#theme의 현재 value = themeInfoId, 선택 option의 data-themenum = themeId |
| 표시된 테마 | #themeTitle과 선택 option의 이름 일치 |
| 달력 날짜 | #datepicker .selDate[data-date]; available이며 disabled가 없어야 함 |
| 월 이동 | button.change-month의 data-num=-1 또는 +1 |
| 시간표 | .timeList input.selThemeTimeNum[name=themeTimeNum]; value는 서버 시간 ID |
| 시간 표시 | radio가 들어 있는 label의 span; disabled radio는 마감 |
| 선택 후 요약 | #reservInfo value 및 #form의 revTimes, themeName |
| 다음 화면 | .btn_next_step; 사이트 click 핸들러가 숨김 필드를 채우고 POST |
| 정보 입력 화면 | form#form의 t=ins_rev, 지점·테마·날짜·시간 ID와 .reserv_info 요약 |
| 인원 / 금액 | select#person; option의 data-price, data-rev_price |
| 예약자 / 연락처 | #name_input, mobile1(010, readonly), mobile2, mobile3 |
| 결제 | #payment의 D = 무통장입금 |
| 필수 동의 | agree_1, agree_2 |
| 선택 동의 | agree_3; 전체동의는 선택사항도 켜므로 사용하지 않음 |
| 자동등록방지 | #captcha.g-recaptcha 안의 reCAPTCHA iframe과 응답 textarea 존재만 확인 |
| 최종 버튼 | button.submit.pc와 .mb 중 CSS상 표시된 하나. 진단만 하고 클릭하지 않음 |

각 선택자와 날짜·시간은 유일성을 확인합니다. 누락, 중복, 로딩 중, 다른 상품, 선택 변경, 외부 폼 경로면 동작을 멈춥니다. 사이트 자체의 클릭 처리와 POST 흐름을 사용하며 숨김 값이나 서버 API를 직접 조작하지 않습니다.

### HTML에서 추적한 흐름

1. 테마 change가 get_theme_date 응답으로 달력을 표시합니다.
2. 날짜 click이 get_theme_time 응답으로 시간 목록을 만듭니다.
3. radio click이 #reservInfo, revTimes, themeName을 갱신합니다.
4. NEXT click이 나머지 전달 필드를 채워 reservation2.php로 이동합니다.
5. 최종 예약 버튼의 사이트 핸들러는 필수 입력·인증·동의를 검사한 뒤 ins_rev 요청을 보냅니다.
6. 성공 시 alert 후 reservation3.php?num=…&ck_code=…로 이동하는 코드는 확인했습니다. 2026-09-23 제공된 완료.html로 완료 본문의 실제 DOM을 추가 확인했습니다.

사이트 스크립트의 날짜 처리에서는 서버 응답의 today를 사용하고 있습니다. 날짜 선택은 사이트가 표시한 가능 여부를 따릅니다. 완료 경로 또는 모든 화면의 사이드바에 있는 “예약 완료” 문구만으로 성공을 판정하지 않습니다. reservation3.php에서는 표시된 본문 완료 문구, .resrvStep.step3 안의 .resrv_result2, 상품 요약, 예약 정보 목록을 함께 검사합니다. URL만 있거나 사이드바 문구만 있으면 거부합니다.

## 3. 계획과 달라진 사항

- 사용자 요청에 따라 단일 AYAKO 대상에서 같은 구조의 다른 테마에도 재사용 가능한 모듈로 확장했습니다.
- 실사이트 상호작용 검증은 완료하지 못했습니다. 재시작한 크롬의 기존 AYAKO 예약 탭에서 지점·테마 선택과 2026년 9월 달력은 읽었으나, 다음 테마 선택 시점에 사이트가 “개발자 도구 사용이 금지되어 있습니다.”로 본문을 교체했습니다.
- 첨부 HTML 정적 검사와 로컬 모의 화면 테스트를 구현했습니다. 이는 일반 확장 프로그램이 실사이트에서 끝까지 작동한다는 검증을 대신하지 않습니다.
- 진단 확장 프로그램을 최소 골격으로 추가했습니다. 개인정보 저장/입력, 정시 실행, 인증 클릭, 최종 제출 등 2~3단계 기능은 추가하지 않았습니다.

## 4. 실행한 명령

- npm install --ignore-scripts --no-audit --no-fund
- node --test test/keyescape-site.test.js
- npm run check
- npm run check:snapshots -- 예약1.html 예약2.html 예약3.html

## 5. 테스트·린트·빌드 결과

- DOM/동작 테스트: 38개 통과(기존 28개 + 완료 화면 관련 10개). 날짜·시간 선택, 마감, 누락/중복 요소, 다른 테마, 상품/선택 불일치, 로딩, 사이트 차단, PC/모바일 버튼, 중복 NEXT, 개인정보 비출력, 완료 오판 방지 포함.
- JavaScript 구문 검사: 통과.
- 첨부 원본 검사: 예약1·2는 선택 테마 불일치를 검출. 예약3은 괴록 대상에서 정보 입력 구조를 확인하고, AYAKO·투투 대상으로는 거부.
- 원본 HTML 검사 시 스크립트와 외부 CSS는 실행/로드하지 않으며 .none, .hide, .mb의 데스크톱 숨김 규칙만 로컬 재현합니다. 실제 레이아웃/네트워크 검증은 아닙니다.
- 별도 린트 설정과 번들 빌드는 없음. 확장 프로그램은 소스 그대로 로드합니다.
- 테스트 실행 초기에 sandbox의 프로세스 생성 제한(EPERM)이 발생하여 허용된 테스트 명령으로 다시 실행했습니다. 초기 구현의 br 구분 처리 오류는 수정 후 전체 테스트를 통과했습니다.

## 6. 완료 기준별 충족 여부

| 기준 | 상태 | 근거 |
|---|---|---|
| 날짜·시간 선택, 정보 입력 구조 확인 | 충족(HTML 기준) | 첨부된 DOM과 inline 핸들러 추적 |
| 사이트 전용 모듈 분리 | 충족 | createKeyescapeSite 및 독립 테스트 |
| 요소 누락/모호함에서 중단 | 충족 | 해당 테스트 통과, CompatibilityError/진단 오류 |
| 일반 크롬에서 선택→정보 입력까지 실제 이동 | 확인 불가 | 최초 달력은 관찰했으나 이후 사이트 차단 |
| 완료 화면의 명시적 성공 표시 확인 | 충족(HTML 기준) | 완료.html의 본문 문구·상품 요약·예약번호 항목을 함께 확인 |
| 실제 예약 제출 없이 검증 | 충족 | 진단 UI는 읽기 전용, 테스트는 모의 DOM, 예약 제출 미수행 |

## 7. 기존부터 존재하던 실패

기존 코드 테스트 실패로 확인된 항목은 없습니다. 출석 관리 프로젝트의 소스와 테스트는 변경하거나 실행하지 않았습니다. 크롬 조사 도구 연결 후 사이트 차단은 계획에 이미 기록된 제약이며 이번에도 관찰했습니다.

## 8. 남은 문제와 다음 단계 진행 가능 여부

**조건부 가능.** 설정·저장 등 2단계 개발에는 사용할 수 있습니다. 실제 예약 자동 실행을 완료했다고 판단하려면 다음 사항이 필요합니다.

- 일반 크롬에서 진단 확장 프로그램 설치/실행과 날짜→시간→정보 입력까지의 실사이트 확인.
- 완료 화면은 첨부 HTML로 판정 구현·검증 완료. 실행 중인 예약의 성공 판정에는 앞 단계의 대상·선택과 실제 제출·이동 이력을 후속 호출부에서 연결해야 함.
- 할인 문구가 시간 표시에 붙는 테마나 다른 폼 구조를 사용하는 지점은 현재 계약과의 일치를 추가 확인. 확인되지 않은 형태는 추측하지 않고 중단.

1단계의 코드 및 로컬 검증과 완료 HTML 구조 확인은 완료했습니다. 일반 Chrome의 실사이트 이동·확장 실행 검증은 미완료입니다.


## 2026-09-23 완료 HTML 추가 검증

- 첨부 파일의 스크립트와 외부 리소스는 실행하지 않고 jsdom으로 정적 파싱했습니다. 첨부 내용은 검사 대상 데이터로만 취급했습니다.
- 완료 본문의 p.text_result 중 현재 표시되는 하나가 정확한 완료 문구를 가져야 하며, .resrvStep.step3 .resrv_result2 안의 상품 요약과 예약번호·인원·예약자·연락처·요금·결제방법 항목이 모두 있어야 합니다. 예약번호는 숫자 형식만 확인합니다.
- inspect()는 phase=completion과 화면의 테마명·날짜·시간을 반환합니다. 예약번호 실제 값, 이름, 연락처, 접근용 URL 쿼리는 반환하거나 프로젝트에 저장하지 않습니다. 테스트는 합성 데이터만 사용합니다.
- inspectCompletion({ date, time })는 앞 단계의 날짜·시간과 비교합니다. 이 화면에는 지점/테마/시간 식별자가 없으므로 identityBasis=displayed-theme-name을 반환하며, 입력 target의 ID를 확인했다고 주장하지 않습니다.
- paymentStatus=unverified: 본문의 예약 완료 표시는 입금 확인 증거가 아닙니다. 같은 날짜·시간의 오래된 완료 페이지도 있을 수 있어, selectionVerified=true만으로 이번 실행이 새 예약을 생성했다고 판단하면 안 됩니다. 후속 실행 상태에서 제출·페이지 이동 이력을 연결해야 합니다.
- 기존 예약3.html은 2026-09-22 13:30, 완료.html은 2026-09-29 11:35입니다. 서로 다른 예약 선택이므로 연속된 실사이트 이동의 증거로 사용하지 않습니다.
- 변경 전 28개 테스트 통과, 변경 후 38개 통과. node --test --test-isolation=none test/keyescape-site.test.js 실행으로 별도 자식 프로세스 없이 검증했습니다. npm run check 통과.
- npm run check:snapshots -- 완료.html 예약3.html: 괴록 대상으로 각각 completion / details를 확인했고, AYAKO·투투 대상으로는 TARGET_MISMATCH를 반환했습니다.
- Chrome 실사이트 이동을 이번 작업에서 재시도하거나 성공했다고 판단하지 않았습니다. 이 기록 작성 시점에는 2단계가 시작되지 않았습니다. 2026-09-23에 별도 [2단계 설정 구현 기록](stage2-settings.md)을 추가했습니다.
