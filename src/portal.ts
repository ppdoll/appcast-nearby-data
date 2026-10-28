import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanText } from './text.js';

/** 수집기가 부르는 공공데이터포털 API. 모두 같은 인증키로 부르고, API 마다 활용신청이 필요하다 */
export const PORTAL_APIS = {
  chargerInfo: {
    label: '한국환경공단_전기자동차 충전소 정보 (충전기 정보 조회)',
    url: 'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo',
  },
  chargerStatus: {
    label: '한국환경공단_전기자동차 충전소 정보 (충전기 상태 조회)',
    url: 'https://apis.data.go.kr/B552584/EvCharger/getChargerStatus',
  },
  restAreas: {
    label: '전국휴게소정보표준데이터',
    url: 'https://api.data.go.kr/openapi/tn_pubr_public_rest_area_api',
  },
} as const;

export type PortalApi = keyof typeof PORTAL_APIS;

/** 충전소 API 두 가지. 하루 호출 예산을 함께 쓴다 */
const CHARGER_APIS: ReadonlySet<PortalApi> = new Set<PortalApi>(['chargerInfo', 'chargerStatus']);

export type JsonObject = Record<string, unknown>;

export interface PageRequest {
  api: PortalApi;
  params: Readonly<Record<string, string | number>>;
}

/** 공공데이터포털(또는 견본). 응답 본문을 그대로 돌려준다. 인증키는 구현이 붙인다 */
export interface Portal {
  get(request: PageRequest): Promise<string>;
}

/** 공공데이터를 받지 못했다. 메시지에는 요청 주소·인증키를 넣지 않는다 */
export class PortalError extends Error {
  /** 잠깐 뒤 다시 부르면 될 수 있는 오류 (연결 끊김, 포털 쪽 일시 오류) */
  readonly retryable: boolean;

  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'PortalError';
    this.retryable = retryable;
  }
}

export interface Page {
  items: JsonObject[];
  /** 전체 항목 수. 응답에 없으면 null */
  totalCount: number | null;
}

const OK_CODES = new Set(['00', '0', '000', 'INFO-0', 'INFO-000', 'NORMAL_SERVICE']);
const NO_DATA_CODES = new Set(['03', 'NODATA_ERROR', 'INFO-200', 'INFO-3']);
/** 포털 쪽 일시 오류: 01 APPLICATION_ERROR, 04 HTTP_ERROR, 05 SERVICETIMEOUT_ERROR */
const RETRYABLE_CODES = new Set(['01', '04', '05']);
const RETRYABLE_NAMES = /APPLICATION_ERROR|HTTP_ERROR|SERVICE_?TIME_?OUT/;
const ITEM_KEYS = ['item', 'row'];

/**
 * 공공데이터포털 응답 읽기 (폰의 PublicData.page 와 같은 규칙). API 마다 감싸는 모양이 달라 너그럽게 읽는다:
 *  - 충전소: {"resultCode":"00", "totalCount":…, "items":{"item":[…]}}
 *  - 표준데이터(휴게소): {"response":{"header":{"resultCode":"00"}, "body":{"items":[…], "totalCount":"…"}}}
 *  - 인증키 오류 등은 JSON 을 요청해도 XML 로 온다 (<returnReasonCode>30</returnReasonCode>)
 * 결과 코드가 정상이 아니면 PortalError, 데이터가 없다는 코드면 빈 쪽.
 */
export function parsePage(api: PortalApi, body: string): Page {
  const text = body.trim(); // BOM 도 지운다
  if (text.startsWith('<')) return xmlPage(api, text);
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new PortalError(`「${PORTAL_APIS[api].label}」 응답을 읽지 못했어요.`, true);
  }
  const code = find(root, 'resultCode');
  if (code !== undefined && !OK_CODES.has(code)) {
    if (NO_DATA_CODES.has(code)) return { items: [], totalCount: 0 };
    throw failure(api, code, find(root, 'resultMsg'));
  }
  return { items: findItems(root), totalCount: toInt(find(root, 'totalCount')) };
}

/** 공공데이터 항목의 값. 숫자로 온 값도 문자열로 읽고, 빈 값·null 은 undefined (폰의 JsonObject.text) */
export function field(item: JsonObject, key: string): string | undefined {
  const value = item[key];
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function xmlPage(api: PortalApi, xml: string): Page {
  const code = tag(xml, 'returnReasonCode') ?? tag(xml, 'resultCode');
  if (code === undefined) throw new PortalError(`「${PORTAL_APIS[api].label}」 응답을 읽지 못했어요.`, true);
  if (NO_DATA_CODES.has(code)) return { items: [], totalCount: 0 };
  if (OK_CODES.has(code)) throw new PortalError(`「${PORTAL_APIS[api].label}」 응답이 JSON 이 아니라 XML 로 왔어요.`);
  throw failure(api, code, tag(xml, 'returnAuthMsg') ?? tag(xml, 'resultMsg') ?? tag(xml, 'errMsg'));
}

function tag(xml: string, name: string): string | undefined {
  return new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml)?.[1] || undefined;
}

/** 공공데이터포털 공통 오류 코드 → 안내. code 는 숫자("30")나 이름(SERVICE_KEY_IS_NOT_REGISTERED_ERROR)으로 온다 */
function failure(api: PortalApi, code: string, message: string | undefined): PortalError {
  const label = PORTAL_APIS[api].label;
  const both = `${code} ${message ?? ''}`;
  const means = (number: string, name: string): boolean => code === number || both.includes(name);
  if (means('30', 'SERVICE_KEY_IS_NOT_REGISTERED')) {
    return new PortalError('공공데이터포털 인증키가 등록되지 않았어요. 시크릿에 넣은 키를 확인하고, 막 받은 키라면 1~2시간 뒤에 다시 해 보세요.');
  }
  if (means('20', 'SERVICE_ACCESS_DENIED')) return new PortalError(`「${label}」 활용신청이 되어 있지 않아요.`);
  if (means('22', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS')) return new PortalError(`「${label}」 오늘 호출 한도를 다 썼어요.`);
  if (means('31', 'DEADLINE_HAS_EXPIRED')) return new PortalError('공공데이터포털 인증키의 활용 기간이 끝났어요. 포털에서 연장해 주세요.');
  if (means('12', 'NO_OPENAPI_SERVICE')) return new PortalError(`「${label}」 서비스를 찾을 수 없어요. 주소가 바뀌었을 수 있어요.`);
  if (means('32', 'UNREGISTERED_IP')) return new PortalError('공공데이터포털 인증키에 등록되지 않은 IP 예요.');
  const retryable = RETRYABLE_CODES.has(code) || RETRYABLE_NAMES.test(both);
  return new PortalError(
    `「${label}」 오류: ${cleanText(message, 80) || '알 수 없음'} (코드 ${cleanText(code, 40)})`,
    retryable,
  );
}

/** 처음 나오는 "item"·"row"(객체 하나나 배열), 또는 객체 배열인 "items" 를 항목으로 본다 */
function findItems(root: unknown): JsonObject[] {
  const queue: unknown[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const element = queue[i];
    if (Array.isArray(element)) {
      enqueueContainers(queue, element);
    } else if (isObject(element)) {
      for (const key of ITEM_KEYS) {
        const items = objects(element[key]);
        if (items) return items;
      }
      if (Array.isArray(element.items)) return unwrap(objects(element.items) ?? []);
      enqueueContainers(queue, Object.values(element));
    }
  }
  return [];
}

function objects(value: unknown): JsonObject[] | undefined {
  if (Array.isArray(value)) return value.filter(isObject);
  if (isObject(value)) return [value];
  return undefined;
}

/** "items":[{"item":{…}}, …] 처럼 한 겹 더 감싼 경우 */
function unwrap(list: JsonObject[]): JsonObject[] {
  const wrapped = list.length > 0 && list.every((it) => Object.keys(it).length === 1 && isObject(it.item));
  return wrapped ? list.map((it) => it.item as JsonObject) : list;
}

/** key 의 값 중 얕은 곳에서 처음 나오는 것 (문자열·숫자) */
function find(root: unknown, key: string): string | undefined {
  const queue: unknown[] = [root];
  for (let i = 0; i < queue.length; i++) {
    const element = queue[i];
    if (Array.isArray(element)) {
      enqueueContainers(queue, element);
    } else if (isObject(element)) {
      const value = element[key];
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      enqueueContainers(queue, Object.values(element));
    }
  }
  return undefined;
}

function enqueueContainers(queue: unknown[], values: unknown[]): void {
  for (const value of values) if (Array.isArray(value) || isObject(value)) queue.push(value);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInt(text: string | undefined): number | null {
  return text !== undefined && /^-?\d{1,15}$/.test(text) ? Number(text) : null;
}

/**
 * 포털의 Encoding 키(%2B…)를 넣어도, Decoding 키(+/=…)를 넣어도 주소에 한 번만 인코딩해 넣는다.
 */
export function encodeServiceKey(raw: string): string {
  return encodeURIComponent(decodedKey(raw));
}

function decodedKey(raw: string): string {
  const key = raw.trim();
  if (!key.includes('%')) return key;
  try {
    return decodeURIComponent(key);
  } catch {
    throw new PortalError('인증키 형식이 맞지 않아요 (% 다음에는 16진수 두 자리가 와야 해요).');
  }
}

/** 요청 주소. 인증키가 들어 있으므로 로그·오류에 쓰지 않는다 */
export function portalUrl(request: PageRequest, encodedKey: string): string {
  const query = Object.entries(request.params)
    .map(([name, value]) => `&${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join('');
  return `${PORTAL_APIS[request.api].url}?serviceKey=${encodedKey}${query}`;
}

export interface HttpPortalOptions {
  /** 한 번 부를 때 기다리는 시간. 전국 목록 한 쪽(9,999대)은 수 MB 라 넉넉히 둔다 */
  timeoutMs?: number;
  maxBytes?: number;
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
/** 오류 응답은 결과 코드를 읽을 만큼만 */
const ERROR_BODY_BYTES = 8 * 1024;
const KEY_LIKE = /[A-Za-z0-9+/=%]{20,}/g;

/** 공공데이터포털을 https 로 부른다. 주소에 인증키가 들어 있으므로 오류에도 주소를 넣지 않는다 */
export class HttpPortal implements Portal {
  private readonly encodedKey: string;
  /** 오류 메시지에서 가릴 인증키 모양들 (포털이 키를 되풀이해 보내는 경우까지 막는다) */
  private readonly secrets: string[];

  constructor(serviceKey: string, private readonly options: HttpPortalOptions = {}) {
    const decoded = decodedKey(serviceKey);
    this.encodedKey = encodeURIComponent(decoded);
    this.secrets = [...new Set([serviceKey.trim(), decoded, this.encodedKey])].filter((it) => it.length >= 8);
  }

  async get(request: PageRequest): Promise<string> {
    try {
      return await this.fetchText(request);
    } catch (e) {
      if (e instanceof PortalError) throw new PortalError(this.redact(e.message), e.retryable);
      throw new PortalError(`「${PORTAL_APIS[request.api].label}」 을 부르다 오류가 났어요 (${networkReason(e)}).`, true);
    }
  }

  private async fetchText(request: PageRequest): Promise<string> {
    const label = PORTAL_APIS[request.api].label;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(portalUrl(request, this.encodedKey), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      throw new PortalError(`「${label}」 에 연결하지 못했어요 (${networkReason(e)}).`, true);
    }
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    let body: string | null;
    try {
      body = response.ok ? await readText(response, maxBytes, false) : await readText(response, ERROR_BODY_BYTES, true);
    } catch (e) {
      throw new PortalError(`「${label}」 응답을 받다가 끊겼어요 (${networkReason(e)}).`, true);
    }
    if (body === null) throw new PortalError(`「${label}」 응답이 ${Math.round(maxBytes / 1024 / 1024)}MB 를 넘어요.`);
    if (!response.ok) throw httpError(request.api, response.status, body);
    return body;
  }

  /** 인증키와, 잘려서 일부만 남았을 수 있는 키 모양(20자 넘는 base64·퍼센트 인코딩 글자 줄)을 가린다 */
  private redact(message: string): string {
    return this.secrets
      .reduce((text, secret) => text.split(secret).join('***'), message)
      .replace(KEY_LIKE, '***');
  }
}

/** 본문을 maxBytes 까지 읽는다. 넘으면 truncate 일 때 거기까지, 아니면 null */
async function readText(response: Response, maxBytes: number, truncate: boolean): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      if (!truncate) return null;
      chunks.push(value.subarray(0, maxBytes - size));
      size = maxBytes;
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  return new TextDecoder().decode(Buffer.concat(chunks, size));
}

/** HTTP 오류 → 안내. 본문에 결과 코드가 있으면 그쪽을 따른다 */
function httpError(api: PortalApi, status: number, body: string): PortalError {
  if (body.includes('resultCode') || body.includes('returnReasonCode')) {
    try {
      parsePage(api, body);
    } catch (e) {
      if (e instanceof PortalError) return e;
    }
  }
  const label = PORTAL_APIS[api].label;
  if (status === 401 || status === 403) {
    return new PortalError(`「${label}」 인증키가 맞지 않거나 활용신청이 되어 있지 않아요 (HTTP ${status}).`);
  }
  if (status === 429) return new PortalError(`「${label}」 호출 한도를 넘었어요 (HTTP 429).`);
  return new PortalError(`「${label}」 서버가 답하지 않아요 (HTTP ${status}).`, status >= 500);
}

/** 연결 오류의 짧은 이유. 오류 메시지에는 주소가 들어 있을 수 있어 쓰지 않는다 */
function networkReason(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return '시간 초과';
  const cause = error instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? code : '네트워크 오류';
}

/** 공공데이터포털 대신 견본 응답 파일 <폴더>/<api>-<pageNo>.json 을 읽는다 (테스트·PC 데모용) */
export class FixturePortal implements Portal {
  constructor(private readonly dir: string) {}

  async get(request: PageRequest): Promise<string> {
    const name = `${request.api}-${request.params.pageNo ?? 1}.json`;
    try {
      return await readFile(join(this.dir, name), 'utf8');
    } catch {
      throw new PortalError(`견본 응답 ${name} 이 없어요.`);
    }
  }
}

export interface MeteredPortalOptions {
  /** 이번 실행에서 충전소 API 를 더 부를 수 있는 횟수 (오늘 남은 예산) */
  chargerCallBudget: number;
  /** 일시 오류를 다시 부르는 횟수 */
  retries?: number;
  sleep?: (ms: number) => Promise<unknown>;
}

const RETRY_DELAYS_MS = [3_000, 10_000];

/**
 * 응답을 읽어 주는 Portal. 충전소 API 호출을 다시 부른 것까지 세고, 예산을 넘기 전에 멈춘다.
 * 연결 끊김 같은 일시 오류는 잠깐 쉬고 다시 부른다.
 */
export class MeteredPortal {
  chargerCalls = 0;
  restAreaCalls = 0;

  constructor(
    private readonly portal: Portal,
    private readonly options: MeteredPortalOptions,
  ) {}

  get remainingChargerCalls(): number {
    return this.options.chargerCallBudget - this.chargerCalls;
  }

  async page(request: PageRequest): Promise<Page> {
    const retries = this.options.retries ?? RETRY_DELAYS_MS.length;
    for (let attempt = 0; ; attempt++) {
      this.count(request.api);
      try {
        return parsePage(request.api, await this.portal.get(request));
      } catch (e) {
        if (!(e instanceof PortalError) || !e.retryable || attempt >= retries) throw e;
        await (this.options.sleep ?? delay)(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
      }
    }
  }

  private count(api: PortalApi): void {
    if (!CHARGER_APIS.has(api)) {
      this.restAreaCalls++;
      return;
    }
    if (this.remainingChargerCalls <= 0) throw new PortalError('충전소 API 의 오늘 호출 예산을 다 썼어요.');
    this.chargerCalls++;
  }
}
