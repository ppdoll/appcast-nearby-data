import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collect, type CollectOptions } from './collector.js';
import { HttpPortal, type JsonObject, type PageRequest } from './portal.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { saveState } from './state.js';
import {
  evItem,
  evResponse,
  FakePortal,
  manyRestAreaItems,
  pagedEvResponse,
  restAreaItem,
  standardResponse,
  statusItem,
  xmlError,
} from './test-samples.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** 2026-10-28 12:00 KST */
const T0 = Date.UTC(2026, 9, 28, 3, 0, 0);

interface World {
  inventory: JsonObject[];
  /** 포털이 알려 주는 전체 수. 없으면 inventory 길이 */
  total?: number;
  status: JsonObject[];
  restAreas: JsonObject[];
  /** 응답 대신 돌려줄 오류 본문 */
  fail?: (request: PageRequest) => string | undefined;
}

let root = '';
let stateDir = '';
let outDir = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nearby-collect-'));
  stateDir = join(root, 'state');
  outDir = join(root, 'site');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function world(overrides: Partial<World> = {}): World {
  return {
    inventory: [
      evItem({ statId: 'ME1', chgerId: '01', stat: '3' }),
      evItem({ statId: 'ME1', chgerId: '02', type: '02', stat: '2' }),
      evItem({ statId: 'ME2', lat: 35.1796, lng: 129.0756 }),
    ],
    status: [],
    restAreas: manyRestAreaItems(),
    ...overrides,
  };
}

function portalFor(state: World): FakePortal {
  return new FakePortal((request) => {
    const failure = state.fail?.(request);
    if (failure !== undefined) return failure;
    if (request.api === 'chargerInfo') return pagedEvResponse(request, state.inventory, state.total);
    if (request.api === 'chargerStatus') return evResponse(state.status);
    return standardResponse(state.restAreas);
  });
}

async function run(portal: CollectOptions['portal'], at: number, options: Partial<CollectOptions> = {}) {
  const lines: string[] = [];
  const result = await collect({
    stateDir,
    outDir,
    portal,
    now: () => at,
    sleep: async () => undefined,
    log: (line) => lines.push(line),
    ...options,
  });
  return { ...result, lines };
}

const readJson = async (...path: string[]) => JSON.parse(await readFile(join(...path), 'utf8'));
const meta = () => readJson(outDir, 'v1', 'meta.json');
const ledger = () => readJson(stateDir, 'ledger.json');

describe('collect', () => {
  it('처음에는 전국 목록과 휴게소를 받아 사이트를 쓴다', async () => {
    const portal = portalFor(world());
    const result = await run(portal, T0);
    expect(result).toMatchObject({
      plan: { chargers: 'full', restAreas: true },
      published: true,
      dataVersion: '20261028-120000',
      chargerCalls: 1,
      restAreaCalls: 1,
      problems: [],
    });
    expect(portal.requests[0]).toEqual({ api: 'chargerInfo', params: { pageNo: 1, numOfRows: 9999, dataType: 'JSON' } });
    expect(await meta()).toMatchObject({
      dataVersion: '20261028-120000',
      inventoryAt: T0,
      statusAt: T0,
      statusComplete: true,
      restAreasAt: T0,
      stations: 2,
      chargers: 3,
      tiles: 2,
    });
    const tile = await readJson(outDir, 'v1', 'chargers', '751_2539.json');
    expect(tile.stations[0]).toMatchObject({ id: 'ME1', fast: { total: 1, available: 0 }, slow: { total: 1, available: 1 } });
    expect((await readJson(outDir, 'v1', 'rest-areas.json')).restAreas).toHaveLength(120);
    expect(await ledger()).toMatchObject({ day: '2026-10-28', chargerCalls: 1, fullRuns: 1, lastFullAttemptAt: T0 });
  });

  it('5분 뒤에는 최근 10분 변경분만 받아 충전기 상태를 고친다', async () => {
    const state = world();
    await run(portalFor(state), T0);
    state.status = [statusItem('ME1', '01', '2'), statusItem('NEW', '01', '2')];
    const portal = portalFor(state);
    const result = await run(portal, T0 + 5 * MINUTE);
    expect(result).toMatchObject({ plan: { chargers: 'status', incomplete: false, restAreas: false }, published: true });
    expect(portal.requests).toEqual([
      { api: 'chargerStatus', params: { pageNo: 1, numOfRows: 9999, period: 10, dataType: 'JSON' } },
    ]);
    expect(result.lines).toContain('상태 변경분 2건: 반영 1, 목록에 없음 1');
    expect(await meta()).toMatchObject({ dataVersion: '20261028-120500', inventoryAt: T0, statusAt: T0 + 5 * MINUTE, statusComplete: true });
    const tile = await readJson(outDir, 'v1', 'chargers', '751_2539.json');
    expect(tile.stations[0].fast).toEqual({ total: 1, available: 1 });
    expect(await ledger()).toMatchObject({ chargerCalls: 2, fullRuns: 1 });
  });

  it('같은 초에 다시 게시해도 dataVersion 이 바뀐다', async () => {
    const state = world();
    await run(portalFor(state), T0);
    const again = await run(portalFor(state), T0);
    expect(again).toMatchObject({ plan: { chargers: 'status' }, dataVersion: '20261028-120000-2' });
    expect(await meta()).toMatchObject({ dataVersion: '20261028-120000-2' });
  });

  it('변경분 창이 끊기면 빠진 구간을 표시했다가 1시간 뒤 전체 갱신으로 회복한다', async () => {
    const state = world();
    await run(portalFor(state), T0);
    const late = await run(portalFor(state), T0 + 30 * MINUTE);
    expect(late.plan).toMatchObject({ chargers: 'status', incomplete: true });
    expect(await meta()).toMatchObject({ statusComplete: false });
    const soon = await run(portalFor(state), T0 + 35 * MINUTE);
    expect(soon.plan).toMatchObject({ chargers: 'status', incomplete: true });
    expect(await meta()).toMatchObject({ statusComplete: false });
    const recovered = await run(portalFor(state), T0 + 61 * MINUTE);
    expect(recovered.plan.chargers).toBe('full');
    expect(await meta()).toMatchObject({ statusComplete: true, inventoryAt: T0 + 61 * MINUTE });
  });

  it('공공데이터를 받지 못하면 지난 상태와 사이트를 그대로 두고 쓴 호출만 장부에 남긴다', async () => {
    const state = world();
    await run(portalFor(state), T0);
    state.fail = () => xmlError('22', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR');
    const result = await run(portalFor(state), T0 + 5 * MINUTE);
    expect(result.published).toBe(false);
    expect(result.problems).toEqual(['「한국환경공단_전기자동차 충전소 정보 (충전기 상태 조회)」 오늘 호출 한도를 다 썼어요.']);
    expect(await meta()).toMatchObject({ dataVersion: '20261028-120000', statusAt: T0 });
    expect(await readJson(stateDir, 'chargers.json')).toMatchObject({ statusAt: T0 });
    expect(await ledger()).toMatchObject({ chargerCalls: 2 });
  });

  it('여러 쪽을 받다가 끊기면 아무것도 바꾸지 않고, 1시간 동안 전체 갱신을 다시 하지 않는다', async () => {
    const inventory = Array.from({ length: 10_500 }, (_, i) => evItem({ statId: `ME${Math.floor(i / 5)}`, chgerId: String(i % 5) }));
    const state = world({ inventory, fail: (request) => (request.params.pageNo === 2 ? xmlError('01', 'APPLICATION_ERROR') : undefined) });
    const first = await run(portalFor(state), T0);
    expect(first).toMatchObject({ published: false, chargerCalls: 4 }); // 1쪽 + 2쪽 세 번 (두 번 다시 부름)
    expect(first.problems[0]).toContain('APPLICATION_ERROR');
    expect(await ledger()).toMatchObject({ chargerCalls: 4, fullRuns: 1, lastFullAttemptAt: T0 });
    const portal = portalFor({ ...state, fail: undefined });
    const waiting = await run(portal, T0 + 10 * MINUTE);
    expect(waiting.plan.chargers).toBe('none');
    expect(portal.calls('chargerInfo')).toBe(0);
    const retried = await run(portal, T0 + HOUR);
    expect(retried).toMatchObject({ plan: { chargers: 'full' }, published: true, chargerCalls: 2 });
    expect(await meta()).toMatchObject({ stations: 2100, chargers: 10_500 });
  });

  it('받은 충전기 수가 totalCount 와 크게 다르면 게시하지 않는다', async () => {
    const result = await run(portalFor(world({ total: 1000 })), T0);
    expect(result.published).toBe(false);
    expect(result.problems).toEqual(['충전기를 3대 받았는데 포털은 1000대라고 해요. 받는 사이 목록이 크게 바뀌었을 수 있어요.']);
  });

  it('충전소가 지난 전체 갱신보다 20% 넘게 줄면 게시하지 않는다', async () => {
    const inventory = Array.from({ length: 10 }, (_, i) => evItem({ statId: `ME${i}` }));
    await run(portalFor(world({ inventory })), T0);
    const result = await run(portalFor(world({ inventory: inventory.slice(0, 7) })), T0 + 5 * MINUTE, { mode: 'full' });
    expect(result.problems).toEqual(['충전소가 10곳에서 7곳으로 줄었어요 (20% 넘게 줄면 게시하지 않아요).']);
    expect(await meta()).toMatchObject({ stations: 10, dataVersion: '20261028-120000' });
  });

  it('휴게소가 기준보다 적으면 그 목록은 버리고 충전소는 게시한다', async () => {
    const restAreas = [restAreaItem('안성휴게소', 37.0042, 127.1965)];
    const result = await run(portalFor(world({ restAreas })), T0);
    expect(result).toMatchObject({ published: true, problems: ['휴게소가 1곳뿐이라 쓰지 않아요 (100곳 이상이어야 해요).'] });
    expect(await meta()).toMatchObject({ restAreasAt: null });
    const next = await run(portalFor(world()), T0 + 5 * MINUTE);
    expect(next.plan.restAreas).toBe(false); // 1시간 뒤에 다시 해 본다
  });

  it('충전소 목록을 받기 전에는 휴게소만 저장하고 게시하지 않는다', async () => {
    const state = world({ fail: (request) => (request.api === 'chargerInfo' ? xmlError('30', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR') : undefined) });
    const result = await run(portalFor(state), T0);
    expect(result.published).toBe(false);
    expect((await readJson(stateDir, 'rest-areas.json')).restAreas).toHaveLength(120);
    const retried = await run(portalFor({ ...state, fail: undefined }), T0 + HOUR);
    expect(retried).toMatchObject({ published: true, restAreaCalls: 0 });
    expect(await meta()).toMatchObject({ restAreasAt: T0 });
  });

  it('오늘 예산을 다 썼으면 부르지 않는다', async () => {
    await saveState(stateDir, { ledger: { version: 1, day: '2026-10-28', chargerCalls: 899, fullRuns: 0 } });
    const portal = portalFor(world());
    const result = await run(portal, T0, { settings: { ...DEFAULT_SETTINGS } });
    expect(result).toMatchObject({ plan: { chargers: 'none' }, published: false, problems: [] });
    expect(portal.calls('chargerInfo') + portal.calls('chargerStatus')).toBe(0);
  });

  it('손으로 고른 일을 예산 때문에 못 하면 문제로 알린다', async () => {
    await saveState(stateDir, { ledger: { version: 1, day: '2026-10-28', chargerCalls: 899, fullRuns: 0 } });
    const result = await run(portalFor(world()), T0, { mode: 'full' });
    expect(result.problems).toEqual([expect.stringContaining('전체 갱신을 하기에는 예산이 모자라요')]);
  });

  it('칸이 폰이 읽는 한도를 넘으면 상태도 사이트도 바꾸지 않는다', async () => {
    const result = await run(portalFor(world()), T0, { settings: { ...DEFAULT_SETTINGS, maxTileStations: 0 } });
    expect(result.published).toBe(false);
    expect(result.problems[0]).toContain('폰이 읽는 한도를 넘어요');
    await expect(readFile(join(stateDir, 'chargers.json'))).rejects.toThrow();
    expect(await ledger()).toMatchObject({ chargerCalls: 1, fullRuns: 1 });
  });

  it('상태 파일이 깨졌으면 없는 셈 치고 다시 받는다', async () => {
    await mkdir(stateDir, { recursive: true });
    await writeFile(join(stateDir, 'chargers.json'), '{"version":1,"stations":[{"id":');
    const result = await run(portalFor(world()), T0);
    expect(result.lines[0]).toContain('chargers.json 을 읽지 못해 없는 셈 쳐요.');
    expect(result.plan.chargers).toBe('full');
  });

  it('인증키와 요청 주소는 로그·문제 어디에도 남기지 않는다', async () => {
    const key = 'SecretKey0123456789+/SecretKey0123456789==';
    const fetch = (async () => new Response(xmlError('30', 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR'), { status: 401 })) as unknown as typeof globalThis.fetch;
    const result = await run(new HttpPortal(key, { fetch }), T0);
    const text = [...result.lines, ...result.problems].join('\n');
    expect(result.problems).toEqual([
      '공공데이터포털 인증키가 등록되지 않았어요. 시크릿에 넣은 키를 확인하고, 막 받은 키라면 1~2시간 뒤에 다시 해 보세요.',
      '공공데이터포털 인증키가 등록되지 않았어요. 시크릿에 넣은 키를 확인하고, 막 받은 키라면 1~2시간 뒤에 다시 해 보세요.',
    ]);
    expect(text).not.toContain('SecretKey');
    expect(text).not.toContain('serviceKey');
    expect(text).not.toContain('https://');
  });
});
