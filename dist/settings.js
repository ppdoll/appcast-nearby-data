const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 전국 목록(getChargerInfo) 한 쪽. 포털이 허용하는 가장 큰 값이다 */
export const INVENTORY_PAGE_SIZE = 9999;
/** 이보다 많은 쪽이면 무언가 잘못된 것으로 보고 받지 않는다 (2026-10 기준 약 53쪽) */
export const MAX_INVENTORY_PAGES = 100;
/**
 * 전국 목록을 나눠 받는 시도(zcode). 전국을 한 줄로 9,999대씩 받으면 뒤쪽 쪽에서 포털이 504 로 끊겨(2026-10-28 첫 실행),
 * 시도마다 나눠 받아 한 번에 넘기는 쪽 수를 줄인다. 받은 합계를 전국 수와 맞춰 보므로, 개편으로 시도 코드가 바뀌어
 * 빠지는 곳이 생기면 게시하지 않고 알린다. 강원·전북은 특별자치도가 되기 전 코드(42·45)도 남은 자료가 있을까 봐 함께 부른다.
 */
export const REGIONS = [
    ['11', '서울'],
    ['26', '부산'],
    ['27', '대구'],
    ['28', '인천'],
    ['29', '광주'],
    ['30', '대전'],
    ['31', '울산'],
    ['36', '세종'],
    ['41', '경기'],
    ['42', '강원(옛 코드)'],
    ['43', '충북'],
    ['44', '충남'],
    ['45', '전북(옛 코드)'],
    ['46', '전남'],
    ['47', '경북'],
    ['48', '경남'],
    ['50', '제주'],
    ['51', '강원'],
    ['52', '전북'],
];
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/**
 * 시도별 합계가 전국 수보다 모자랄 때 [REGIONS] 에 없는 시도 코드를 물어보는 차례 (1대만 받아 수를 본다).
 * 새 코드는 지금 코드 뒤에 붙어 왔으므로 53 부터 99 까지, 그다음 10 부터 52 까지.
 * 2026-10-28: 광주(29)·전남(46)이 0대이고 합계가 3만 대쯤 모자랐다 (통합으로 새 코드가 생긴 것으로 보인다).
 */
export const PROBE_CODES = [...range(53, 99), ...range(10, 52)].map(String);
/** 상태 변경분(getChargerStatus) 한 쪽 */
export const STATUS_PAGE_SIZE = 9999;
/** 상태 변경분 창 (분). 포털이 허용하는 가장 긴 값이다 */
export const STATUS_PERIOD_MINUTES = 10;
export const MAX_STATUS_PAGES = 5;
export const REST_AREA_PAGE_SIZE = 1000;
export const MAX_REST_AREA_PAGES = 5;
export const DEFAULT_SETTINGS = {
    dailyChargerCalls: 900,
    inventoryMaxAgeMs: DAY,
    statusGapMs: 9 * MINUTE,
    maxFullRunsPerDay: 4,
    fullRetryMs: HOUR,
    restAreaMaxAgeMs: 7 * DAY,
    restAreaRetryMs: HOUR,
    countTolerance: 0.005,
    maxStationDrop: 0.2,
    minRestAreas: 100,
    maxTileStations: 5000,
    maxTileBytes: 1024 * 1024,
    maxRestAreaBytes: 1024 * 1024,
};
/** 견본 응답(--fixtures)은 전국 데이터가 아니므로 휴게소 수 기준만 낮춘다 */
export const FIXTURE_SETTINGS = { ...DEFAULT_SETTINGS, minRestAreas: 1 };
