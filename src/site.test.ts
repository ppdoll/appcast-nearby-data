import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InventoryBuilder } from './chargers.js';
import { tileId } from './geo.js';
import type { JsonObject } from './portal.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { buildSite, checkSite, SOURCE, writeSite } from './site.js';
import type { ChargerState, RestAreaState } from './state.js';
import { evItem } from './test-samples.js';

const INVENTORY_AT = 1_793_128_320_000;
const STATUS_AT = 1_793_156_700_000;
const REST_AREAS_AT = 1_792_869_600_000;

function chargerState(items: JsonObject[]): ChargerState {
  const builder = new InventoryBuilder();
  builder.addItems(items);
  return { version: 1, inventoryAt: INVENTORY_AT, statusAt: STATUS_AT, statusComplete: true, rows: items.length, stations: builder.build() };
}

const chargers = chargerState([
  evItem({ statId: 'B' }),
  evItem({ statId: 'A', chgerId: '01', type: '02', lat: 37.5548, lng: 126.9708 }),
  evItem({ statId: 'A', chgerId: '02', stat: '3', lat: 37.5548, lng: 126.9708 }),
  evItem({ statId: 'C', lat: 35.1796, lng: 129.0756 }),
]);
const restAreas: RestAreaState = {
  version: 1,
  updatedAt: REST_AREAS_AT,
  restAreas: [{ id: 'ra-1', name: '안성휴게소', lat: 37.0042, lng: 127.1965, facilities: ['ev'] }],
};

describe('buildSite', () => {
  it('충전소를 칸 파일로 나누고, 칸 안에서는 id 순으로 둔다', () => {
    const site = buildSite(chargers, restAreas, '20261028-120500');
    expect(site.files.map((file) => file.path)).toEqual([
      'v1/chargers/703_2581.json',
      'v1/chargers/751_2539.json',
      'v1/rest-areas.json',
      'v1/meta.json',
      'index.html',
    ]);
    const tile = JSON.parse(site.files[1].text);
    expect(tile).toMatchObject({ version: 1, tile: '751_2539', statusAt: STATUS_AT });
    expect(tile.stations.map((station: { id: string }) => station.id)).toEqual(['A', 'B']);
    expect(tile.stations[0]).toMatchObject({ fast: { total: 1, available: 0 }, slow: { total: 1, available: 1 } });
  });

  it('칸은 게시하는 좌표(소수 5자리)로 정해서, 칸 파일 안의 좌표는 늘 그 칸 안에 있다', () => {
    const site = buildSite(chargerState([evItem({ statId: 'EDGE', lat: 37.549999, lng: 126.949999 })]), null, 'v');
    const tile = JSON.parse(site.files[0].text);
    expect(tile.tile).toBe('751_2539');
    expect([tile.stations[0].lat, tile.stations[0].lng]).toEqual([37.55, 126.95]);
    expect(tileId(tile.stations[0].lat, tile.stations[0].lng)).toBe(tile.tile);
  });

  it('meta.json 에 게시 정보와 출처를 쓴다', () => {
    const site = buildSite(chargers, restAreas, '20261028-120500');
    expect(JSON.parse(site.files.find((file) => file.path === 'v1/meta.json')!.text)).toEqual({
      version: 1,
      dataVersion: '20261028-120500',
      tileSize: 0.05,
      inventoryAt: INVENTORY_AT,
      statusAt: STATUS_AT,
      statusComplete: true,
      restAreasAt: REST_AREAS_AT,
      stations: 3,
      chargers: 4,
      tiles: 2,
      source: SOURCE,
    });
    expect(JSON.parse(site.files.find((file) => file.path === 'v1/rest-areas.json')!.text)).toEqual({
      version: 1,
      updatedAt: REST_AREAS_AT,
      restAreas: restAreas.restAreas,
    });
  });

  it('휴게소를 아직 받지 못했으면 rest-areas.json 없이 만든다', () => {
    const site = buildSite(chargers, null, '20261028-120500');
    expect(site.meta.restAreasAt).toBeNull();
    expect(site.files.some((file) => file.path === 'v1/rest-areas.json')).toBe(false);
  });
});

describe('checkSite', () => {
  it('폰이 읽는 한도를 넘는 칸을 알린다', () => {
    const site = buildSite(chargerState(Array.from({ length: 30 }, (_, i) => evItem({ statId: `ME${i}` }))), null, 'v');
    expect(checkSite(site, DEFAULT_SETTINGS)).toEqual([]);
    expect(checkSite(site, { ...DEFAULT_SETTINGS, maxTileStations: 29 })).toEqual([
      expect.stringContaining('칸 751_2539 이 폰이 읽는 한도를 넘어요 (충전소 30곳'),
    ]);
    expect(checkSite(site, { ...DEFAULT_SETTINGS, maxTileBytes: 1000 })).toHaveLength(1);
  });

  it('휴게소 파일 크기도 본다', () => {
    const site = buildSite(chargers, restAreas, 'v');
    expect(checkSite(site, { ...DEFAULT_SETTINGS, maxRestAreaBytes: 10 })).toEqual([
      expect.stringContaining('rest-areas.json 이 폰이 읽는 한도를 넘어요'),
    ]);
  });
});

describe('writeSite', () => {
  let dir = '';
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('v1 폴더를 통째로 바꿔 지난 실행의 칸 파일을 남기지 않는다', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nearby-site-'));
    await mkdir(join(dir, 'v1', 'chargers'), { recursive: true });
    await writeFile(join(dir, 'v1', 'chargers', '1_1.json'), '{}');
    const site = buildSite(chargers, null, '20261028-120500');
    await writeSite(dir, site.files);
    expect((await readdir(dir)).sort()).toEqual(['index.html', 'v1']);
    expect((await readdir(join(dir, 'v1', 'chargers'))).sort()).toEqual(['703_2581.json', '751_2539.json']);
    expect(JSON.parse(await readFile(join(dir, 'v1', 'meta.json'), 'utf8')).dataVersion).toBe('20261028-120500');
  });
});
