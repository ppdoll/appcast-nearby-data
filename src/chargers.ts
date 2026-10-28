import { inKorea, roundCoordinate } from './geo.js';
import { field, type JsonObject } from './portal.js';
import { cleanText, MAX_ID_LENGTH, MAX_TEXT_LENGTH, optionalText } from './text.js';

/** 충전기 출력 상한 (kW). packages/protocol 의 MAX_CHARGER_KW 와 같다 */
export const MAX_CHARGER_KW = 1000;

/** 커넥터 종류. 나중에 「테슬라로 쓸 수 있는 곳」 거르기에 쓴다 */
export type Plug = 'chademo' | 'ac-slow' | 'dc-combo' | 'ac3' | 'nacs';
const PLUG_ORDER: readonly Plug[] = ['chademo', 'ac-slow', 'dc-combo', 'ac3', 'nacs'];

/**
 * chgerType → 커넥터. 01 DC차데모, 02 AC완속, 03 DC차데모+AC3상, 04 DC콤보, 05 DC차데모+DC콤보,
 * 06 DC차데모+AC3상+DC콤보, 07 AC3상, 08 DC콤보(완속), 09 NACS, 10 DC콤보+NACS
 */
const PLUGS_BY_TYPE: ReadonlyMap<string, readonly Plug[]> = new Map<string, readonly Plug[]>([
  ['01', ['chademo']],
  ['02', ['ac-slow']],
  ['03', ['chademo', 'ac3']],
  ['04', ['dc-combo']],
  ['05', ['chademo', 'dc-combo']],
  ['06', ['chademo', 'ac3', 'dc-combo']],
  ['07', ['ac3']],
  ['08', ['dc-combo']],
  ['09', ['nacs']],
  ['10', ['dc-combo', 'nacs']],
]);

// 급속·완속 구분은 폰의 EvChargers 와 같다
const FAST_TYPES = new Set(['01', '03', '04', '05', '06', '07', '09', '10']);
const SLOW_TYPES = new Set(['02', '08']);
/** 버스 전용 (DC 콤보 2). 승용차는 쓸 수 없다 */
const BUS_ONLY_TYPES = new Set(['11']);
/** 처음 보는 충전기 타입은 출력으로 가른다 */
const FAST_KW = 30;
/** stat 2 = 충전대기 (1 통신이상, 3 충전중, 4 운영중지, 5 점검중, 9 상태미확인) */
export const AVAILABLE = '2';
const UNKNOWN_STATUS = '9';

/** 충전기 정보 조회(getChargerInfo) 항목 하나 = 충전기 한 대. 글자는 아직 다듬지 않았다 */
export interface ChargerRow {
  stationId: string;
  chargerId: string;
  name: string;
  lat?: number;
  lng?: number;
  address?: string;
  operator?: string;
  hours?: string;
  type: string;
  status: string;
  outputKw?: number;
  /** 이용자 제한 (입주민 전용 등) */
  limited: boolean;
  deleted: boolean;
}

/** 수집기 상태에 두는 충전소. 이용자 제한·삭제·버스 전용은 처음부터 뺐고, 글자는 다듬었다 */
export interface StoredStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  operator?: string;
  hours?: string;
  maxKw?: number;
  plugs: Plug[];
  /** 급속 충전기 id */
  fast: string[];
  /** 완속 충전기 id */
  slow: string[];
  /** 충전기별 상태(stat) 한 글자씩. 급속 다음 완속, fast·slow 와 같은 순서 */
  stat: string;
}

export interface ChargerCount {
  total: number;
  available: number;
}

/** 칸 파일에 들어가는 충전소 (docs/nearby-server.md 3.3) */
export interface TileStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  operator?: string;
  hours?: string;
  fast: ChargerCount;
  slow: ChargerCount;
  maxKw?: number;
  plugs: Plug[];
}

export function chargerRow(item: JsonObject): ChargerRow | null {
  const stationId = field(item, 'statId');
  const chargerId = field(item, 'chgerId');
  const name = field(item, 'statNm');
  const type = field(item, 'chgerType')?.padStart(2, '0');
  if (!stationId || !chargerId || !name || !type) return null;
  return {
    stationId,
    chargerId,
    name,
    lat: number(field(item, 'lat')),
    lng: number(field(item, 'lng')),
    address: field(item, 'addr'),
    operator: field(item, 'busiNm') ?? field(item, 'bnm'),
    hours: field(item, 'useTime'),
    type,
    status: field(item, 'stat') ?? '',
    // "50+50" 처럼 정수가 아닌 출력은 추측하지 않는다
    outputKw: integer(field(item, 'output')),
    limited: field(item, 'limitYn')?.toUpperCase() === 'Y',
    deleted: field(item, 'delYn')?.toUpperCase() === 'Y',
  };
}

interface Draft {
  first: ChargerRow;
  lat?: number;
  lng?: number;
  limited: boolean;
  fast: string[];
  fastStat: string[];
  slow: string[];
  slowStat: string[];
  maxKw?: number;
  plugs: Set<Plug>;
}

/**
 * 전국 목록(getChargerInfo)을 쪽마다 받아 충전소로 묶는다. 50만 대를 한꺼번에 들고 있지 않게 쪽마다 넣는다.
 * 묶고 거르는 규칙은 폰의 EvChargers.stations 와 같다.
 */
export class InventoryBuilder {
  /** 받은 항목 수 */
  items = 0;
  /** 겹치지 않는 (충전소, 충전기) 수. 쪽을 받는 사이 목록이 밀려 같은 충전기가 두 번 오면 한 번만 센다 */
  get uniqueChargers(): number {
    return this.seen.size;
  }

  private readonly seen = new Set<string>();
  private readonly drafts = new Map<string, Draft>();

  addItems(items: readonly JsonObject[]): void {
    for (const item of items) {
      this.items++;
      const row = chargerRow(item);
      if (row) this.add(row);
    }
  }

  add(row: ChargerRow): void {
    const key = `${row.stationId}\u0000${row.chargerId}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    // 지운 충전기·버스 전용은 충전소를 고르는 데에도 넣지 않는다
    if (row.deleted || BUS_ONLY_TYPES.has(row.type)) return;
    const id = cleanText(row.stationId, MAX_ID_LENGTH);
    if (!id) return;
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = { first: row, limited: false, fast: [], fastStat: [], slow: [], slowStat: [], plugs: new Set() };
      this.drafts.set(id, draft);
    }
    draft.limited ||= row.limited;
    if (draft.lat === undefined && row.lat !== undefined && row.lng !== undefined && inKorea(row.lat, row.lng)) {
      draft.lat = row.lat;
      draft.lng = row.lng;
    }
    const chargerId = cleanText(row.chargerId, MAX_ID_LENGTH);
    const status = row.status.length === 1 ? row.status : UNKNOWN_STATUS;
    if (isFast(row)) {
      draft.fast.push(chargerId);
      draft.fastStat.push(status);
    } else {
      draft.slow.push(chargerId);
      draft.slowStat.push(status);
    }
    if (row.outputKw !== undefined && row.outputKw >= 1 && row.outputKw <= MAX_CHARGER_KW) {
      draft.maxKw = Math.max(draft.maxKw ?? 0, row.outputKw);
    }
    for (const plug of PLUGS_BY_TYPE.get(row.type) ?? []) draft.plugs.add(plug);
  }

  /** 이용자 제한이 있거나 좌표가 이상한 충전소는 뺀다 */
  build(): StoredStation[] {
    const stations: StoredStation[] = [];
    for (const [id, draft] of this.drafts) {
      if (draft.limited || draft.lat === undefined || draft.lng === undefined) continue;
      const name = cleanText(draft.first.name, MAX_TEXT_LENGTH);
      if (!name) continue;
      stations.push({
        id,
        name,
        lat: roundCoordinate(draft.lat),
        lng: roundCoordinate(draft.lng),
        address: optionalText(draft.first.address),
        operator: optionalText(draft.first.operator),
        hours: optionalText(draft.first.hours),
        maxKw: draft.maxKw,
        plugs: PLUG_ORDER.filter((plug) => draft.plugs.has(plug)),
        fast: draft.fast,
        slow: draft.slow,
        stat: draft.fastStat.join('') + draft.slowStat.join(''),
      });
    }
    return stations;
  }
}

function isFast(row: ChargerRow): boolean {
  if (FAST_TYPES.has(row.type)) return true;
  if (SLOW_TYPES.has(row.type)) return false;
  return (row.outputKw ?? 0) >= FAST_KW;
}

export interface StatusUpdate {
  stationId: string;
  chargerId: string;
  status: string;
}

/** 충전기 상태 조회(getChargerStatus) 항목 → 바뀐 상태 */
export function statusUpdate(item: JsonObject): StatusUpdate | null {
  const stationId = cleanText(field(item, 'statId'), MAX_ID_LENGTH);
  const chargerId = cleanText(field(item, 'chgerId'), MAX_ID_LENGTH);
  const status = field(item, 'stat');
  if (!stationId || !chargerId || !status) return null;
  return { stationId, chargerId, status: status.length === 1 ? status : UNKNOWN_STATUS };
}

/**
 * 바뀐 상태를 저장된 충전소에 반영한다 (stat 를 고친다).
 * 목록에 없는 충전기(새로 생긴 곳, 이용자 제한으로 뺀 곳)는 세기만 하고 다음 전체 갱신을 기다린다.
 */
export function applyStatus(
  stations: ReadonlyMap<string, StoredStation>,
  updates: readonly StatusUpdate[],
): { applied: number; unknown: number } {
  let applied = 0;
  let unknown = 0;
  for (const update of updates) {
    const station = stations.get(update.stationId);
    const index = station ? chargerIndex(station, update.chargerId) : -1;
    if (!station || index < 0) {
      unknown++;
      continue;
    }
    station.stat = station.stat.slice(0, index) + update.status + station.stat.slice(index + 1);
    applied++;
  }
  return { applied, unknown };
}

function chargerIndex(station: StoredStation, chargerId: string): number {
  const fast = station.fast.indexOf(chargerId);
  if (fast >= 0) return fast;
  const slow = station.slow.indexOf(chargerId);
  return slow >= 0 ? station.fast.length + slow : -1;
}

export function tileStation(station: StoredStation): TileStation {
  const fastStat = station.stat.slice(0, station.fast.length);
  const slowStat = station.stat.slice(station.fast.length);
  return {
    id: station.id,
    name: station.name,
    lat: station.lat,
    lng: station.lng,
    address: station.address,
    operator: station.operator,
    hours: station.hours,
    fast: { total: station.fast.length, available: count(fastStat, AVAILABLE) },
    slow: { total: station.slow.length, available: count(slowStat, AVAILABLE) },
    maxKw: station.maxKw,
    plugs: station.plugs,
  };
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

function number(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function integer(text: string | undefined): number | undefined {
  return text !== undefined && /^[+-]?\d{1,9}$/.test(text) ? Number(text) : undefined;
}
