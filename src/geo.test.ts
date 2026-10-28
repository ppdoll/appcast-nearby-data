import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inKorea, roundCoordinate, tileId } from './geo.js';

interface TileSample {
  lat: number;
  lng: number;
  tile: string;
  note: string;
}

// 폰(android/core)의 칸 테스트도 같은 파일을 읽는다
const { samples } = JSON.parse(readFileSync(new URL('../fixtures/tile-samples.json', import.meta.url), 'utf8')) as {
  samples: TileSample[];
};

describe('tileId', () => {
  it.each(samples)('$note ($lat, $lng) → $tile', ({ lat, lng, tile }) => {
    expect(tileId(lat, lng)).toBe(tile);
  });
});

describe('roundCoordinate', () => {
  it('소수 5자리로 줄인다', () => {
    expect(roundCoordinate(37.5547123)).toBe(37.55471);
    expect(roundCoordinate(126.970694)).toBe(126.97069);
  });
});

describe('inKorea', () => {
  it('대한민국 근처만 받는다', () => {
    expect(inKorea(37.5547, 126.9707)).toBe(true);
    expect(inKorea(0, 0)).toBe(false);
    expect(inKorea(126.9707, 37.5547)).toBe(false); // 위도·경도를 바꿔 쓴 값
    expect(inKorea(Number.NaN, 126.9707)).toBe(false);
  });
});
