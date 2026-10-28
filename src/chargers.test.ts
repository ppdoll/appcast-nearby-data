import { describe, expect, it } from 'vitest';
import { applyStatus, InventoryBuilder, statusUpdate, tileStation, type StoredStation } from './chargers.js';
import type { JsonObject } from './portal.js';
import { evItem, statusItem } from './test-samples.js';

function build(items: JsonObject[]): StoredStation[] {
  const builder = new InventoryBuilder();
  builder.addItems(items);
  return builder.build();
}

describe('InventoryBuilder', () => {
  it('충전기를 충전소로 묶고 급속·완속과 충전대기 수를 센다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', type: '04', stat: '2', output: '100' }),
      evItem({ statId: 'ME1', chgerId: '02', type: '04', stat: '3', output: '200' }),
      evItem({ statId: 'ME1', chgerId: '03', type: '02', stat: '2', output: '7' }),
    ]);
    expect(station).toMatchObject({ id: 'ME1', fast: ['01', '02'], slow: ['03'], stat: '232', maxKw: 200 });
    expect(tileStation(station)).toMatchObject({ fast: { total: 2, available: 1 }, slow: { total: 1, available: 1 } });
  });

  it('지운 충전기와 버스 전용은 빼고, 이용자 제한 충전소는 통째로 뺀다', () => {
    const stations = build([
      evItem({ statId: 'ME1', chgerId: '01' }),
      evItem({ statId: 'ME1', chgerId: '02', delYn: 'Y' }),
      evItem({ statId: 'ME1', chgerId: '03', type: '11', output: '200' }),
      evItem({ statId: 'APT', chgerId: '01', type: '02' }),
      evItem({ statId: 'APT', chgerId: '02', type: '02', limitYn: 'Y' }),
      evItem({ statId: 'BUS', type: '11' }),
    ]);
    expect(stations.map((it) => [it.id, it.fast, it.slow])).toEqual([['ME1', ['01'], []]]);
  });

  it('시험용·비개방 충전소는 빼고, 뺀 까닭별로 센다', () => {
    const builder = new InventoryBuilder();
    builder.addItems([
      evItem({ statId: 'OK', name: '역삼 공영주차장' }),
      evItem({ statId: 'EXAM', name: '운전면허시험장 주차장' }), // '시험'만 있으면 남긴다
      evItem({ statId: 'TEST1', name: '(테스트) 개발시험용(GS차지비)' }),
      evItem({ statId: 'TEST2', name: '충전기 테스트 1' }),
      { ...evItem({ statId: 'CLOSED' }), useTime: '비개방' },
      { ...evItem({ statId: 'CLOSED2' }), useTime: '미개방 (관리실 문의)' },
      evItem({ statId: 'APT', limitYn: 'Y' }),
      evItem({ statId: 'FAR', lat: 0, lng: 0 }),
    ]);
    expect(builder.build().map((it) => it.id)).toEqual(['OK', 'EXAM']);
    expect(builder.excluded).toEqual({ limited: 1, closed: 4, badPoint: 1 });
  });

  it('지운 충전기에만 이용자 제한이 붙어 있으면 충전소는 남긴다 (폰과 같다)', () => {
    const stations = build([evItem({ statId: 'ME1' }), evItem({ statId: 'ME1', chgerId: '02', delYn: 'Y', limitYn: 'Y' })]);
    expect(stations).toHaveLength(1);
  });

  it('처음 보는 타입은 30kW 이상이면 급속으로 본다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', type: '12', output: '50' }),
      evItem({ statId: 'ME1', chgerId: '02', type: '12', output: '11' }),
      evItem({ statId: 'ME1', chgerId: '03', type: '12', output: '50+50' }),
    ]);
    expect([station.fast, station.slow, station.maxKw]).toEqual([['01'], ['02', '03'], 50]);
  });

  it('출력 범위를 벗어난 값은 최대 출력에 넣지 않는다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', output: '0' }),
      evItem({ statId: 'ME1', chgerId: '02', output: '5000' }),
    ]);
    expect(station.maxKw).toBeUndefined();
  });

  it('타입을 커넥터로 바꿔 정해진 순서로 모은다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', type: '10' }),
      evItem({ statId: 'ME1', chgerId: '02', type: '06' }),
      evItem({ statId: 'ME1', chgerId: '03', type: '2' }),
    ]);
    expect(station.plugs).toEqual(['chademo', 'ac-slow', 'dc-combo', 'ac3', 'nacs']);
  });

  it('좌표가 이상한 충전기는 건너뛰고 처음 나온 바른 좌표를 소수 5자리로 쓴다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', lat: 0, lng: 0 }),
      evItem({ statId: 'ME1', chgerId: '02', lat: 37.5547123, lng: 126.9706987 }),
    ]);
    expect([station.lat, station.lng]).toEqual([37.55471, 126.9707]);
    expect(build([evItem({ statId: 'ME1', lat: 126.9707, lng: 37.5547 })])).toEqual([]);
  });

  it('충전소 정보는 첫 충전기에서 가져와 다듬는다', () => {
    const [station] = build([
      { ...evItem({ statId: 'ME1', name: ` 서울역\n공영주차장 ${'가'.repeat(80)}` }), busiNm: '', bnm: '환경부 ' },
      { ...evItem({ statId: 'ME1', chgerId: '02', name: '다른 이름' }), addr: '다른 주소' },
    ]);
    expect(station.name).toHaveLength(80);
    expect(station.name.startsWith('서울역 공영주차장 가')).toBe(true);
    expect(station.name.endsWith('…')).toBe(true);
    expect([station.address, station.operator, station.hours]).toEqual([
      '서울특별시 중구 한강대로 405',
      '환경부',
      '24시간 이용가능',
    ]);
  });

  it('쪽이 밀려 같은 충전기가 두 번 와도 한 번만 센다', () => {
    const builder = new InventoryBuilder();
    builder.addItems([evItem({ statId: 'ME1' }), evItem({ statId: 'ME1', chgerId: '02' })]);
    builder.addItems([evItem({ statId: 'ME1', chgerId: '02', stat: '3' }), { statNm: 'id 없음' }]);
    expect([builder.items, builder.uniqueChargers]).toEqual([4, 2]);
    expect(builder.build()[0]).toMatchObject({ fast: ['01', '02'], stat: '22' });
  });

  it('두 글자 이상이거나 빈 상태는 상태미확인(9)으로 둔다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', stat: '' }),
      evItem({ statId: 'ME1', chgerId: '02', stat: '12' }),
    ]);
    expect(station.stat).toBe('99');
  });
});

describe('applyStatus', () => {
  it('바뀐 상태를 충전기 자리에 반영하고 목록에 없는 것은 센다', () => {
    const [station] = build([
      evItem({ statId: 'ME1', chgerId: '01', type: '04', stat: '3' }),
      evItem({ statId: 'ME1', chgerId: '02', type: '02', stat: '3' }),
    ]);
    const updates = [
      statusItem('ME1', '02', '2'),
      statusItem('ME1', '09', '2'),
      statusItem('NEW', '01', '2'),
      statusItem('ME1', '01', '5'),
      { statId: 'ME1' },
    ].map(statusUpdate);
    const result = applyStatus(new Map([[station.id, station]]), updates.filter((it) => it !== null));
    expect(result).toEqual({ applied: 2, unknown: 2 });
    expect(station.stat).toBe('52');
    expect(tileStation(station)).toMatchObject({ fast: { total: 1, available: 0 }, slow: { total: 1, available: 1 } });
  });
});

describe('tileStation', () => {
  it('칸 파일 모양으로 바꾼다 (값이 없는 필드는 JSON 에서 빠진다)', () => {
    const [station] = build([{ ...evItem({ statId: 'ME174001', name: '서울역 공영주차장' }), useTime: ' ' }]);
    expect(JSON.parse(JSON.stringify(tileStation(station)))).toEqual({
      id: 'ME174001',
      name: '서울역 공영주차장',
      lat: 37.5547,
      lng: 126.9707,
      address: '서울특별시 중구 한강대로 405',
      operator: '환경부',
      fast: { total: 1, available: 1 },
      slow: { total: 0, available: 0 },
      maxKw: 100,
      plugs: ['dc-combo'],
    });
  });
});
