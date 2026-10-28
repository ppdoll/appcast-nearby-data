import { describe, expect, it, vi } from 'vitest';
import {
  encodeServiceKey,
  HttpPortal,
  MeteredPortal,
  parsePage,
  PortalError,
  portalUrl,
  type PageRequest,
} from './portal.js';
import { evItem, evResponse, FakePortal, restAreaItem, standardResponse, xmlError } from './test-samples.js';

const KEY = 'abcDEF123+/xyz==abcDEF123+/xyz==';
const INFO: PageRequest = { api: 'chargerInfo', params: { pageNo: 1, numOfRows: 9999, dataType: 'JSON' } };

function thrown(work: () => unknown): PortalError {
  try {
    work();
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error('PortalError 가 나지 않았어요');
}

async function rejected(promise: Promise<unknown>): Promise<PortalError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof PortalError) return e;
    throw e;
  }
  throw new Error('PortalError 가 나지 않았어요');
}

describe('parsePage', () => {
  it('충전소 API 의 items.item 과 totalCount 를 읽는다', () => {
    const page = parsePage('chargerInfo', evResponse([evItem({ statId: 'ME1' }), evItem({ statId: 'ME2' })], 52000));
    expect(page.items.map((it) => it.statId)).toEqual(['ME1', 'ME2']);
    expect(page.totalCount).toBe(52000);
  });

  it('항목이 하나면 배열이 아니라 객체로 와도 읽는다', () => {
    const body = JSON.stringify({ resultCode: '00', totalCount: 1, items: { item: evItem({ statId: 'ME1' }) } });
    expect(parsePage('chargerInfo', body).items).toHaveLength(1);
  });

  it('표준데이터의 response.body.items 배열과 문자열 totalCount 를 읽는다', () => {
    const page = parsePage('restAreas', standardResponse([restAreaItem('안성휴게소', 37.0042, 127.1965)], 230));
    expect(page.items[0].entrpsNm).toBe('안성휴게소');
    expect(page.totalCount).toBe(230);
  });

  it('items 를 한 겹 더 감싼 모양도 읽는다', () => {
    const body = JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: [{ item: { a: '1' } }] } } });
    expect(parsePage('restAreas', body).items).toEqual([{ a: '1' }]);
  });

  it('데이터가 없다는 코드는 빈 쪽이다', () => {
    expect(parsePage('chargerStatus', JSON.stringify({ resultCode: '03', resultMsg: 'NODATA_ERROR' }))).toEqual({
      items: [],
      totalCount: 0,
    });
    expect(parsePage('restAreas', xmlError('03', 'NODATA_ERROR'))).toEqual({ items: [], totalCount: 0 });
  });

  it('인증키 오류(XML)는 다시 부르지 않는 오류다', () => {
    const error = thrown(() => parsePage('chargerInfo', xmlError('30', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR')));
    expect(error.message).toContain('인증키가 등록되지 않았어요');
    expect(error.retryable).toBe(false);
  });

  it('호출 한도 초과를 알아본다', () => {
    expect(thrown(() => parsePage('chargerInfo', xmlError('22', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'))).message).toContain(
      '오늘 호출 한도를 다 썼어요',
    );
  });

  it('포털 쪽 일시 오류는 다시 부를 수 있다', () => {
    expect(thrown(() => parsePage('chargerInfo', xmlError('01', 'APPLICATION_ERROR'))).retryable).toBe(true);
    expect(thrown(() => parsePage('chargerInfo', '{"resultCode":"99","resultMsg":"SERVICE_TIMEOUT"}')).retryable).toBe(true);
  });

  it('JSON 의 오류 코드는 메시지와 코드를 알려 준다', () => {
    const error = thrown(() => parsePage('chargerInfo', JSON.stringify({ resultCode: '10', resultMsg: '잘못된 요청 파라메터 에러' })));
    expect(error.message).toBe('「한국환경공단_전기자동차 충전소 정보 (충전기 정보 조회)」 오류: 잘못된 요청 파라메터 에러 (코드 10)');
  });

  it('읽을 수 없는 응답은 다시 부를 수 있는 오류다', () => {
    expect(thrown(() => parsePage('chargerInfo', '<html>Bad Gateway</html>')).retryable).toBe(true);
    expect(thrown(() => parsePage('chargerInfo', '{"items": [')).retryable).toBe(true);
  });
});

describe('인증키와 주소', () => {
  it('Decoding 키와 Encoding 키를 같은 값으로 한 번만 인코딩한다', () => {
    expect(encodeServiceKey(KEY)).toBe('abcDEF123%2B%2Fxyz%3D%3DabcDEF123%2B%2Fxyz%3D%3D');
    expect(encodeServiceKey(` ${encodeURIComponent(KEY)} `)).toBe(encodeServiceKey(KEY));
  });

  it('형식이 깨진 Encoding 키는 키를 드러내지 않고 알린다', () => {
    const error = thrown(() => encodeServiceKey('abc%zz'));
    expect(error.message).not.toContain('abc%zz');
  });

  it('요청 주소에 인증키와 인자를 붙인다', () => {
    expect(portalUrl(INFO, 'K%2B')).toBe(
      'https://apis.data.go.kr/B552584/EvCharger/getChargerInfo?serviceKey=K%2B&pageNo=1&numOfRows=9999&dataType=JSON',
    );
  });
});

describe('HttpPortal', () => {
  function portalWith(respond: (url: string) => Response | Promise<Response>): { portal: HttpPortal; urls: string[] } {
    const urls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      urls.push(String(input));
      return respond(String(input));
    });
    return { portal: new HttpPortal(KEY, { fetch: fetch as unknown as typeof globalThis.fetch }), urls };
  }

  it('인증키를 붙여 부르고 본문을 돌려준다', async () => {
    const { portal, urls } = portalWith(() => new Response(evResponse([])));
    await expect(portal.get(INFO)).resolves.toContain('NORMAL SERVICE');
    expect(urls[0]).toContain(`serviceKey=${encodeServiceKey(KEY)}&pageNo=1`);
  });

  it('HTTP 오류 본문의 결과 코드를 따른다', async () => {
    const { portal } = portalWith(() => new Response(xmlError('30', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'), { status: 401 }));
    await expect(portal.get(INFO)).rejects.toThrow('인증키가 등록되지 않았어요');
  });

  it('5xx 는 다시 부를 수 있는 오류다', async () => {
    const { portal } = portalWith(() => new Response('busy', { status: 503 }));
    await expect(portal.get(INFO)).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('HTTP 503') });
  });

  it('연결 오류에 주소·인증키를 넣지 않는다', async () => {
    const { portal } = portalWith((url) => {
      throw new TypeError(`fetch failed: ${url}`, { cause: Object.assign(new Error(`connect ${url}`), { code: 'ENOTFOUND' }) });
    });
    const error = await rejected(portal.get(INFO));
    expect(error.message).toBe('「한국환경공단_전기자동차 충전소 정보 (충전기 정보 조회)」 에 연결하지 못했어요 (ENOTFOUND).');
    expect(error.retryable).toBe(true);
  });

  it('포털이 인증키를 되풀이해 보내도 오류 메시지에서 가린다', async () => {
    const { portal } = portalWith(() => new Response(xmlError('99', `bad key ${KEY}`), { status: 500 }));
    const error = await rejected(portal.get(INFO));
    expect(error.message).toContain('bad key ***');
    expect(error.message).not.toContain(KEY.slice(0, 20));
  });

  it('잘려서 일부만 남은 인증키 모양도 가린다', async () => {
    const longKey = 'Q'.repeat(30) + KEY + 'Z'.repeat(40);
    const { portal } = portalWith(() => new Response(xmlError('99', `bad key ${longKey}`), { status: 500 }));
    const error = await rejected(portal.get(INFO));
    expect(error.message).not.toMatch(/Q{20}/);
  });

  it('너무 큰 응답은 받지 않는다', async () => {
    const small = new HttpPortal(KEY, {
      maxBytes: 1024 * 1024,
      fetch: (async () => new Response('x'.repeat(2 * 1024 * 1024))) as unknown as typeof globalThis.fetch,
    });
    await expect(small.get(INFO)).rejects.toThrow('응답이 1MB 를 넘어요');
  });
});

describe('MeteredPortal', () => {
  const quick = { sleep: async () => undefined };

  it('충전소 API 호출을 세고 휴게소 API 는 따로 센다', async () => {
    const fake = new FakePortal((request) => (request.api === 'restAreas' ? standardResponse([]) : evResponse([])));
    const metered = new MeteredPortal(fake, { chargerCallBudget: 10, ...quick });
    await metered.page(INFO);
    await metered.page({ api: 'chargerStatus', params: { pageNo: 1 } });
    await metered.page({ api: 'restAreas', params: { pageNo: 1 } });
    expect([metered.chargerCalls, metered.restAreaCalls, metered.remainingChargerCalls]).toEqual([2, 1, 8]);
  });

  it('예산을 넘기 전에 부르지 않고 멈춘다', async () => {
    const fake = new FakePortal(() => evResponse([]));
    const metered = new MeteredPortal(fake, { chargerCallBudget: 1, ...quick });
    await metered.page(INFO);
    await expect(metered.page(INFO)).rejects.toThrow('오늘 호출 예산을 다 썼어요');
    expect(fake.requests).toHaveLength(1);
  });

  it('일시 오류는 점점 길게 기다렸다 다시 부르고, 다시 부른 것도 센다', async () => {
    let n = 0;
    const fake = new FakePortal(() => (++n < 3 ? xmlError('01', 'APPLICATION_ERROR') : evResponse([])));
    const sleep = vi.fn(async (_ms: number) => undefined);
    const lines: string[] = [];
    const metered = new MeteredPortal(fake, { chargerCallBudget: 10, sleep, log: (line) => lines.push(line) });
    await expect(metered.page(INFO)).resolves.toEqual({ items: [], totalCount: 0 });
    expect(metered.chargerCalls).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 20_000]);
    expect(lines[1]).toBe(
      '「한국환경공단_전기자동차 충전소 정보 (충전기 정보 조회)」 오류: APPLICATION_ERROR (코드 01) 20초 뒤 다시 불러요 (2/3)',
    );
  });

  it('504 가 이어지면 세 번까지 다시 부르고 멈춘다', async () => {
    const http = new HttpPortal(KEY, {
      fetch: (async () => new Response('<html>504 Gateway Time-out</html>', { status: 504 })) as unknown as typeof globalThis.fetch,
    });
    const sleep = vi.fn(async (_ms: number) => undefined);
    const metered = new MeteredPortal(http, { chargerCallBudget: 10, sleep });
    await expect(metered.page(INFO)).rejects.toThrow('서버가 답하지 않아요 (HTTP 504)');
    expect(metered.chargerCalls).toBe(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5_000, 20_000, 60_000]);
  });

  it('인증키 오류 같은 것은 다시 부르지 않는다', async () => {
    const fake = new FakePortal(() => xmlError('30', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'));
    const metered = new MeteredPortal(fake, { chargerCallBudget: 10, ...quick });
    await expect(metered.page(INFO)).rejects.toThrow(PortalError);
    expect(fake.requests).toHaveLength(1);
  });
});
