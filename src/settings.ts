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

/** 할 일 판단·호출 예산·게시 전 검사 기준 (docs/nearby-server.md 4.3·4.5) */
export interface Settings {
  /** 충전소 API 를 한국 시간 하루에 부를 수 있는 횟수 (개발계정 한도 1,000회에서 여유를 둔다) */
  dailyChargerCalls: number;
  /** 전국 목록을 다시 받는 주기 */
  inventoryMaxAgeMs: number;
  /** 마지막 상태 갱신이 이보다 오래면 변경분 창(10분)이 끊긴 것으로 본다. 시계 차이를 생각해 1분 여유를 둔다 */
  statusGapMs: number;
  /** 하루(한국 시간)에 전체 갱신을 시작할 수 있는 횟수. 실패한 시도도 센다 */
  maxFullRunsPerDay: number;
  /** 전체 갱신을 다시 시작하기까지 기다리는 시간 */
  fullRetryMs: number;
  /** 휴게소 목록을 다시 받는 주기 */
  restAreaMaxAgeMs: number;
  /** 휴게소 받기에 실패했을 때 다시 해 보기까지 기다리는 시간 */
  restAreaRetryMs: number;
  /** 받은 충전기 수와 포털이 알려 준 수의 허용 차이 (비율). 쪽을 받는 사이 목록이 조금 바뀔 수 있다 */
  countTolerance: number;
  /** 충전소 수가 지난 전체 갱신보다 이 비율 넘게 줄면 게시하지 않는다 */
  maxStationDrop: number;
  /** 휴게소가 이보다 적으면 받은 목록을 쓰지 않는다 */
  minRestAreas: number;
  /** 폰이 읽는 칸 파일 상한 (docs/nearby-server.md 5.1) */
  maxTileStations: number;
  maxTileBytes: number;
  maxRestAreaBytes: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
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
export const FIXTURE_SETTINGS: Readonly<Settings> = { ...DEFAULT_SETTINGS, minRestAreas: 1 };
