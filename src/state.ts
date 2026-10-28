import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { StoredStation } from './chargers.js';
import type { Ledger } from './plan.js';
import type { RestArea } from './rest-areas.js';

/**
 * 실행 사이에 남기는 상태 (GitHub Actions 에서는 actions/cache 로 옮긴다).
 *  - ledger.json      오늘 쓴 호출 예산과 지난 시도. 실패한 실행에서도 저장한다
 *  - chargers.json    전국 충전소와 충전기 상태
 *  - rest-areas.json  휴게소
 */
export interface State {
  ledger: Ledger | null;
  chargers: ChargerState | null;
  restAreas: RestAreaState | null;
}

export interface ChargerState {
  version: 1;
  /** 전국 목록을 받기 시작한 시각 (epoch ms) */
  inventoryAt: number;
  /** 충전기 상태를 마지막으로 맞춘 시각. 그 실행이 공공데이터를 부르기 시작한 시각이다 */
  statusAt: number;
  /** 상태 변경분을 빠짐없이 이어 받았는지 */
  statusComplete: boolean;
  /** 전국 목록을 받을 때 포털이 알려 준 충전기 수 (다음 전체 갱신의 호출 수를 어림한다) */
  rows: number;
  stations: StoredStation[];
}

export interface RestAreaState {
  version: 1;
  updatedAt: number;
  restAreas: RestArea[];
}

const FILES = { ledger: 'ledger.json', chargers: 'chargers.json', restAreas: 'rest-areas.json' } as const;

/** 없거나 읽을 수 없는 파일은 null (처음부터 다시 받는다) */
export async function loadState(dir: string, log: (line: string) => void): Promise<State> {
  return {
    ledger: await load(join(dir, FILES.ledger), isLedger, log),
    chargers: await load(join(dir, FILES.chargers), isChargerState, log),
    restAreas: await load(join(dir, FILES.restAreas), isRestAreaState, log),
  };
}

/** 넘긴 것만 저장한다. 장부는 맨 뒤에 쓴다 */
export async function saveState(dir: string, state: Partial<State>): Promise<void> {
  await mkdir(dir, { recursive: true });
  if (state.chargers) await writeJsonAtomic(join(dir, FILES.chargers), state.chargers);
  if (state.restAreas) await writeJsonAtomic(join(dir, FILES.restAreas), state.restAreas);
  if (state.ledger) await writeJsonAtomic(join(dir, FILES.ledger), state.ledger);
}

async function load<T>(path: string, valid: (value: unknown) => value is T, log: (line: string) => void): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  try {
    const value: unknown = JSON.parse(text);
    if (valid(value)) return value;
  } catch {
    // 아래에서 알린다
  }
  log(`상태 파일 ${basename(path)} 을 읽지 못해 없는 셈 쳐요.`);
  return null;
}

/** 쓰다가 멈춰도 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 바꾼다 */
async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isOptionalTime = (value: unknown): boolean => value === undefined || isTime(value);
const isOptionalText = (value: unknown): boolean => value === undefined || typeof value === 'string';
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every((it) => typeof it === 'string');

function isLedger(value: unknown): value is Ledger {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.day === 'string' &&
    isTime(value.chargerCalls) &&
    isTime(value.fullRuns) &&
    isOptionalTime(value.lastFullAttemptAt) &&
    isOptionalTime(value.lastRestAreaAttemptAt) &&
    isOptionalText(value.lastDataVersion)
  );
}

function isChargerState(value: unknown): value is ChargerState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isTime(value.inventoryAt) &&
    isTime(value.statusAt) &&
    typeof value.statusComplete === 'boolean' &&
    isTime(value.rows) &&
    Array.isArray(value.stations) &&
    value.stations.every(isStoredStation)
  );
}

function isStoredStation(value: unknown): value is StoredStation {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    isOptionalText(value.address) &&
    isOptionalText(value.operator) &&
    isOptionalText(value.hours) &&
    (value.maxKw === undefined || Number.isInteger(value.maxKw)) &&
    isTextList(value.plugs) &&
    isTextList(value.fast) &&
    isTextList(value.slow) &&
    typeof value.stat === 'string' &&
    value.stat.length === value.fast.length + value.slow.length
  );
}

function isRestAreaState(value: unknown): value is RestAreaState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isTime(value.updatedAt) &&
    Array.isArray(value.restAreas) &&
    value.restAreas.every(
      (area) =>
        isRecord(area) &&
        typeof area.id === 'string' &&
        typeof area.name === 'string' &&
        Number.isFinite(area.lat) &&
        Number.isFinite(area.lng) &&
        isTextList(area.facilities),
    )
  );
}
