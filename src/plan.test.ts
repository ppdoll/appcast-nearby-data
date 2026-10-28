import { describe, expect, it } from 'vitest';
import {
  dataVersionAt,
  decide,
  fullRunCost,
  kstDay,
  ledgerFor,
  nextDataVersion,
  type ChargerSummary,
  type Ledger,
  type PlanInput,
} from './plan.js';
import { DEFAULT_SETTINGS } from './settings.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 2026-10-28 12:00 KST */
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);
const fresh: ChargerSummary = { inventoryAt: NOW - 2 * HOUR, statusAt: NOW - 5 * MINUTE, statusComplete: true, rows: 520_000 };

function plan(overrides: Partial<PlanInput> = {}, ledger: Partial<Ledger> = {}) {
  const input: PlanInput = {
    now: NOW,
    ledger: { ...ledgerFor(null, NOW), ...ledger },
    chargers: fresh,
    restAreasAt: NOW - HOUR,
    mode: 'auto',
    ...overrides,
  };
  return decide(input, DEFAULT_SETTINGS);
}

describe('decide', () => {
  it('저장된 목록이 없으면 전체 갱신', () => {
    expect(plan({ chargers: null })).toMatchObject({ chargers: 'full', reason: '저장된 충전소 목록이 없어요' });
  });

  it('평소에는 변경분만', () => {
    expect(plan()).toMatchObject({ chargers: 'status', incomplete: false, restAreas: false });
  });

  it('전국 목록을 받은 지 24시간이 지나면 전체 갱신', () => {
    expect(plan({ chargers: { ...fresh, inventoryAt: NOW - DAY } })).toMatchObject({ chargers: 'full' });
  });

  it('마지막 상태가 9분보다 오래면 변경분 창이 끊긴 것으로 보고 전체 갱신으로 회복한다', () => {
    expect(plan({ chargers: { ...fresh, statusAt: NOW - 9 * MINUTE } })).toMatchObject({ chargers: 'status', incomplete: false });
    expect(plan({ chargers: { ...fresh, statusAt: NOW - 9 * MINUTE - 1 } })).toMatchObject({ chargers: 'full' });
  });

  it('오늘 전체 갱신을 4번 했으면 변경분만 받고 빠진 구간을 표시한다', () => {
    expect(plan({ chargers: { ...fresh, statusAt: NOW - 30 * MINUTE } }, { fullRuns: 4 })).toMatchObject({
      chargers: 'status',
      incomplete: true,
    });
  });

  it('지난 전체 갱신 시도가 1시간 안이면 다시 하지 않는다', () => {
    const late = { chargers: { ...fresh, statusAt: NOW - 30 * MINUTE } };
    expect(plan(late, { fullRuns: 1, lastFullAttemptAt: NOW - 59 * MINUTE })).toMatchObject({ chargers: 'status', incomplete: true });
    expect(plan(late, { fullRuns: 1, lastFullAttemptAt: NOW - HOUR })).toMatchObject({ chargers: 'full' });
  });

  it('빠진 구간이 남아 있으면 다음 기회에 전체 갱신으로 회복한다', () => {
    const missing = { chargers: { ...fresh, statusComplete: false } };
    expect(plan(missing)).toMatchObject({ chargers: 'full' });
    expect(plan(missing, { lastFullAttemptAt: NOW - 10 * MINUTE })).toMatchObject({ chargers: 'status', incomplete: true });
  });

  it('목록이 없는데 전체 갱신에 실패했으면 1시간 동안 부르지 않는다', () => {
    expect(plan({ chargers: null }, { fullRuns: 1, lastFullAttemptAt: NOW - 10 * MINUTE })).toMatchObject({ chargers: 'none' });
  });

  it('전체 갱신 예산(전국 수 1회 + 쪽 수 + 시도 수)이 모자라면 변경분만', () => {
    expect(fullRunCost(520_000)).toBe(1 + 53 + 19);
    expect(fullRunCost(520_000, 1)).toBe(1 + 53 + 19 + 1); // 찾아낸 시도 코드
    expect(fullRunCost(undefined)).toBe(90);
    const old = { chargers: { ...fresh, inventoryAt: NOW - 25 * HOUR } };
    expect(plan(old, { chargerCalls: 900 - 72 })).toMatchObject({ chargers: 'status' });
    expect(plan(old, { chargerCalls: 900 - 73 })).toMatchObject({ chargers: 'full' });
  });

  it('예산을 다 쓰면 아무것도 받지 않는다', () => {
    expect(plan({}, { chargerCalls: 898 })).toMatchObject({ chargers: 'status' });
    expect(plan({}, { chargerCalls: 899 })).toMatchObject({ chargers: 'none' });
  });

  it('손으로 고른 전체 갱신은 하루 횟수·간격과 상관없이 하지만 예산은 지킨다', () => {
    expect(plan({ mode: 'full' }, { fullRuns: 4, lastFullAttemptAt: NOW - MINUTE })).toMatchObject({ chargers: 'full' });
    expect(plan({ mode: 'full' }, { chargerCalls: 850 })).toMatchObject({ chargers: 'none' });
  });

  it('손으로 고른 변경분만은 목록이 있어야 한다', () => {
    expect(plan({ mode: 'status', chargers: { ...fresh, inventoryAt: NOW - 30 * HOUR } })).toMatchObject({ chargers: 'status' });
    expect(plan({ mode: 'status', chargers: null })).toMatchObject({ chargers: 'none' });
  });

  it('휴게소는 7일마다 받고, 실패하면 1시간 뒤에 다시 해 본다', () => {
    expect(plan({ restAreasAt: null }).restAreas).toBe(true);
    expect(plan({ restAreasAt: NOW - 7 * DAY }).restAreas).toBe(true);
    expect(plan({ restAreasAt: NOW - 6 * DAY }).restAreas).toBe(false);
    expect(plan({ restAreasAt: null }, { lastRestAreaAttemptAt: NOW - 30 * MINUTE }).restAreas).toBe(false);
  });
});

describe('ledgerFor', () => {
  it('한국 시간 자정에 예산을 새로 세고 지난 시도 시각은 남긴다', () => {
    const before = Date.UTC(2026, 9, 27, 14, 59, 59); // 2026-10-27 23:59:59 KST
    const after = Date.UTC(2026, 9, 27, 15, 0, 0); // 2026-10-28 00:00:00 KST
    const ledger: Ledger = { ...ledgerFor(null, before), chargerCalls: 500, fullRuns: 2, lastFullAttemptAt: before - HOUR };
    expect(ledger.day).toBe('2026-10-27');
    expect(ledgerFor(ledger, before)).toEqual(ledger);
    expect(ledgerFor(ledger, after)).toEqual({
      version: 1,
      day: '2026-10-28',
      chargerCalls: 0,
      fullRuns: 0,
      lastFullAttemptAt: before - HOUR,
    });
  });
});

describe('한국 시간 글자', () => {
  it('날짜와 dataVersion', () => {
    expect(kstDay(Date.UTC(2026, 9, 27, 15, 0, 0))).toBe('2026-10-28');
    expect(dataVersionAt(Date.UTC(2026, 9, 28, 3, 5, 31))).toBe('20261028-120531');
  });

  it('같은 초에 다시 게시해도 dataVersion 이 바뀐다', () => {
    const at = Date.UTC(2026, 9, 28, 3, 5, 31);
    expect(nextDataVersion(at, undefined)).toBe('20261028-120531');
    expect(nextDataVersion(at, '20261028-120500')).toBe('20261028-120531');
    expect(nextDataVersion(at, '20261028-120531')).toBe('20261028-120531-2');
    expect(nextDataVersion(at, '20261028-120531-2')).toBe('20261028-120531-3');
  });
});
