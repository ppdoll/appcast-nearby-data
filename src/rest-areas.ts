import { inKorea, roundCoordinate } from './geo.js';
import { field, type JsonObject } from './portal.js';
import { javaHashCode, optionalText } from './text.js';

/** packages/protocol 의 RestAreaFacility 와 같다 */
export type Facility = 'ev' | 'gas' | 'lpg' | 'food' | 'shop' | 'pharmacy' | 'nursing' | 'repair';

/** rest-areas.json 에 들어가는 휴게소 (docs/nearby-server.md 3.4) */
export interface RestArea {
  id: string;
  name: string;
  lat: number;
  lng: number;
  route?: string;
  direction?: string;
  hours?: string;
  facilities: Facility[];
  food?: string;
  phone?: string;
}

/** 편의시설 유무 필드(Y/N) → Facility. 순서도 폰의 RestAreas 와 같다 */
const FACILITY_FIELDS: ReadonlyArray<readonly [string, Facility]> = [
  ['elctyYn', 'ev'],
  ['oltYn', 'gas'],
  ['lpgYn', 'lpg'],
  ['rstrtYn', 'food'],
  ['shopYn', 'shop'],
  ['parmacyYn', 'pharmacy'],
  ['nrsgYn', 'nursing'],
  ['crrpwrkYn', 'repair'],
];
const TIME = /^(\d{1,2}):?(\d{2})$/;

/** 전국휴게소정보표준데이터 항목 → 휴게소. 규칙은 폰의 RestAreas.parse 와 같다 */
export function parseRestAreas(items: readonly JsonObject[]): RestArea[] {
  const seen = new Set<string>();
  const areas: RestArea[] = [];
  for (const item of items) {
    const area = restArea(item);
    if (!area || seen.has(area.id)) continue;
    seen.add(area.id);
    areas.push(area);
  }
  return areas;
}

function restArea(item: JsonObject): RestArea | null {
  const name = optionalText(field(item, 'entrpsNm'));
  const lat = Number(field(item, 'latitude') ?? NaN);
  const lng = Number(field(item, 'longitude') ?? NaN);
  if (!name || !inKorea(lat, lng)) return null;
  const route = optionalText(field(item, 'roadRouteNm'));
  const direction = optionalText(field(item, 'roadRouteDrc'));
  return {
    // 표준데이터에는 휴게소 번호가 없어 이름·노선·방향으로 만든다 (폰: "ra-" + Integer.toHexString(hashCode))
    id: 'ra-' + (javaHashCode(`${name}|${route ?? 'null'}|${direction ?? 'null'}`) >>> 0).toString(16),
    name,
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng),
    route,
    direction,
    hours: restAreaHours(field(item, 'operOpenHhmm'), field(item, 'operCloseHhmm')),
    facilities: FACILITY_FIELDS.filter(([key]) => field(item, key)?.toUpperCase() === 'Y').map(([, facility]) => facility),
    food: optionalText(field(item, 'rprsntvRstrt')),
    phone: optionalText(field(item, 'phoneNumber')),
  };
}

/** 운영 시간 ("07:00~22:00"). 하루 내내 열면 "24시간", 읽을 수 없으면 undefined */
export function restAreaHours(open: string | undefined, close: string | undefined): string | undefined {
  const from = time(open);
  const to = time(close);
  if (from === undefined || to === undefined) return undefined;
  if (from === to || (from === '00:00' && (to === '24:00' || to === '23:59'))) return '24시간';
  return `${from}~${to}`;
}

function time(raw: string | undefined): string | undefined {
  const match = TIME.exec(raw?.trim() ?? '');
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute > 0)) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
