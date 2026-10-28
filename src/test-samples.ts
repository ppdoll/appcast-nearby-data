import type { JsonObject, PageRequest, Portal } from './portal.js';

/**
 * 공공데이터포털 응답 견본. 필드 이름은 각 API 의 활용가이드를 따랐다 (android/core 의 NearbySamples 와 같다).
 */
export const SEOUL_STATION = { lat: 37.5547, lng: 126.9707 };

export interface EvItemOptions {
  statId: string;
  chgerId?: string;
  type?: string;
  stat?: string;
  output?: string;
  lat?: number;
  lng?: number;
  name?: string;
  limitYn?: string;
  delYn?: string;
  /** 시도 코드 (기본 11 서울) */
  zcode?: string;
}

/** 충전기 정보 조회(getChargerInfo) 항목 = 충전기 한 대 */
export function evItem(options: EvItemOptions): JsonObject {
  const { statId, chgerId = '01', type = '04', stat = '2', output = '100', limitYn = 'N', delYn = 'N', zcode = '11' } = options;
  return {
    statNm: options.name ?? `충전소 ${statId}`,
    statId,
    chgerId,
    chgerType: type,
    addr: '서울특별시 중구 한강대로 405',
    location: '지하 2층',
    useTime: '24시간 이용가능',
    lat: String(options.lat ?? SEOUL_STATION.lat),
    lng: String(options.lng ?? SEOUL_STATION.lng),
    busiId: 'ME',
    bnm: '환경부',
    busiNm: '환경부',
    busiCall: '1661-9408',
    stat,
    statUpdDt: '20261028101500',
    output,
    zcode,
    zscode: `${zcode}140`,
    limitYn,
    limitDetail: limitYn === 'Y' ? '입주민 외 이용불가' : '',
    delYn,
  };
}

/** 충전기 상태 조회(getChargerStatus) 항목 */
export function statusItem(statId: string, chgerId: string, stat: string): JsonObject {
  return { busiId: 'ME', statId, chgerId, stat, statUpdDt: '20261028102000', lastTsdt: '', lastTedt: '', nowTsdt: '' };
}

/** 충전소 API 의 JSON 응답 (dataType=JSON) */
export function evResponse(items: readonly JsonObject[], total = items.length): string {
  return JSON.stringify({
    resultMsg: 'NORMAL SERVICE.',
    totalCount: total,
    items: { item: items },
    pageNo: 1,
    resultCode: '00',
    numOfRows: items.length,
  });
}

/**
 * 요청한 쪽만큼 잘라 돌려주는 충전소 API. 시도(zcode)를 주면 그 시도 항목만 센다.
 * [total] 은 전국 수(시도 없이 부를 때)를 바꿔 볼 때 쓴다.
 */
export function pagedEvResponse(request: PageRequest, items: readonly JsonObject[], total?: number): string {
  const zcode = request.params.zcode;
  const region = zcode === undefined ? items : items.filter((item) => item.zcode === zcode);
  const page = Number(request.params.pageNo);
  const size = Number(request.params.numOfRows);
  const count = zcode === undefined ? (total ?? items.length) : region.length;
  return evResponse(region.slice((page - 1) * size, page * size), count);
}

export interface RestAreaItemOptions {
  route?: string;
  direction?: string;
  open?: string;
  close?: string;
  flags?: Record<string, string>;
}

/** 전국휴게소정보표준데이터 항목 */
export function restAreaItem(name: string, lat: number, lng: number, options: RestAreaItemOptions = {}): JsonObject {
  const { route = '경부선', direction = '부산방향', open = '00:00', close = '24:00' } = options;
  const flags = options.flags ?? { elctyYn: 'Y', oltYn: 'Y', rstrtYn: 'Y' };
  const item: JsonObject = {
    entrpsNm: name,
    roadKnd: '고속국도',
    roadRouteNo: '1',
    roadRouteNm: route,
    roadRouteDrc: direction,
    latitude: String(lat),
    longitude: String(lng),
    restAreaType: '일반휴게소',
    operOpenHhmm: open,
    operCloseHhmm: close,
  };
  for (const key of ['crrpwrkYn', 'oltYn', 'lpgYn', 'elctyYn', 'shopYn', 'parmacyYn', 'nrsgYn', 'rstrtYn', 'toiletYn']) {
    item[key] = flags[key] ?? 'N';
  }
  return { ...item, rprsntvRstrt: '국밥', phoneNumber: '031-000-0000', referenceDate: '2026-07-01', instt_code: 'B551011' };
}

/** 휴게소 수 기준(100곳)을 넘기는 견본. 경부선을 따라 남쪽으로 놓는다 */
export function manyRestAreaItems(count = 120): JsonObject[] {
  return Array.from({ length: count }, (_, i) => restAreaItem(`휴게소 ${i + 1}`, 37.4 - i * 0.02, 127.1));
}

/** 표준데이터 API 의 JSON 응답 (type=json) */
export function standardResponse(items: readonly JsonObject[], total = items.length): string {
  return JSON.stringify({
    response: {
      header: { resultCode: '00', resultMsg: 'NORMAL_SERVICE', type: 'json' },
      body: { items, totalCount: String(total), numOfRows: '1000', pageNo: '1' },
    },
  });
}

/** 인증키 오류 등. JSON 을 요청해도 XML 로 온다 */
export function xmlError(code: string, message: string): string {
  return (
    '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>' +
    `<returnAuthMsg>${message}</returnAuthMsg><returnReasonCode>${code}</returnReasonCode>` +
    '</cmmMsgHeader></OpenAPI_ServiceResponse>'
  );
}

/** 요청마다 handler 의 응답을 돌려주는 Portal. 받은 요청을 남긴다 */
export class FakePortal implements Portal {
  readonly requests: PageRequest[] = [];

  constructor(private readonly handler: (request: PageRequest) => string | Promise<string>) {}

  async get(request: PageRequest): Promise<string> {
    this.requests.push(request);
    return this.handler(request);
  }

  calls(api: PageRequest['api']): number {
    return this.requests.filter((request) => request.api === api).length;
  }
}
