const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 전국 목록(getChargerInfo) 한 쪽. 포털이 허용하는 가장 큰 값이다 */
export const INVENTORY_PAGE_SIZE = 9999;
/** 이보다 많은 쪽이면 무언가 잘못된 것으로 보고 받지 않는다 (2026-10 기준 약 53쪽) */
export const MAX_INVENTORY_PAGES = 100;
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
