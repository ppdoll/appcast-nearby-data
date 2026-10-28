import { describe, expect, it } from 'vitest';
import { parseRestAreas, restAreaHours } from './rest-areas.js';
import { javaHashCode } from './text.js';
import { restAreaItem } from './test-samples.js';

describe('parseRestAreas', () => {
  it('표준데이터 항목을 휴게소로 읽는다', () => {
    const [area] = parseRestAreas([
      restAreaItem('안성휴게소', 37.004234, 127.196512, { flags: { nrsgYn: 'Y', elctyYn: 'y', oltYn: 'Y', rstrtYn: 'N' } }),
    ]);
    expect(area).toEqual({
      id: 'ra-' + (javaHashCode('안성휴게소|경부선|부산방향') >>> 0).toString(16),
      name: '안성휴게소',
      lat: 37.00423,
      lng: 127.19651,
      route: '경부선',
      direction: '부산방향',
      hours: '24시간',
      facilities: ['ev', 'gas', 'nursing'],
      food: '국밥',
      phone: '031-000-0000',
    });
  });

  it('id 는 폰과 같다: 노선·방향이 없으면 "null" 을 넣어 Java hashCode 를 16진수로', () => {
    const [area] = parseRestAreas([{ ...restAreaItem('간이휴게소', 37, 127), roadRouteNm: '', roadRouteDrc: ' ' }]);
    expect(area.id).toBe('ra-' + (javaHashCode('간이휴게소|null|null') >>> 0).toString(16));
    expect(area.route).toBeUndefined();
  });

  it('이름·좌표가 없거나 대한민국 밖이면 빼고, 같은 id 는 하나만 둔다', () => {
    const areas = parseRestAreas([
      restAreaItem('안성휴게소', 37.0042, 127.1965),
      restAreaItem('안성휴게소', 37.0043, 127.1966),
      restAreaItem('안성휴게소', 37.0042, 127.1965, { direction: '서울방향' }),
      restAreaItem(' ', 37, 127),
      restAreaItem('바다', 0, 0),
      { ...restAreaItem('좌표 없음', 37, 127), latitude: '' },
    ]);
    expect(areas.map((it) => it.direction)).toEqual(['부산방향', '서울방향']);
  });
});

describe('restAreaHours', () => {
  it.each([
    ['00:00', '24:00', '24시간'],
    ['00:00', '23:59', '24시간'],
    ['07:00', '07:00', '24시간'],
    ['07:00', '22:00', '07:00~22:00'],
    ['700', '2200', '07:00~22:00'],
    ['25:00', '22:00', undefined],
    ['24:30', '22:00', undefined],
    ['', '22:00', undefined],
    [undefined, '22:00', undefined],
  ])('%s ~ %s → %s', (open, close, expected) => {
    expect(restAreaHours(open, close)).toBe(expected);
  });
});
