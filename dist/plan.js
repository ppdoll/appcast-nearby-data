import { INVENTORY_PAGE_SIZE, REGIONS } from './settings.js';
export const MODES = ['auto', 'full', 'status'];
const MINUTE = 60_000;
const KST_OFFSET_MS = 9 * 60 * MINUTE;
/** 저장된 목록이 없을 때 전체 갱신 호출 수 어림 (2026-10 기준 약 53쪽 + 시도 19곳 + 전국 수 1회) */
const FIRST_FULL_RUN_COST = 90;
/** 상태 변경분 한 번에 드는 호출 수 어림 (보통 1~2쪽) */
const STATUS_RUN_COST = 2;
/** 한국 시간 날짜 YYYY-MM-DD */
export function kstDay(ms) {
    return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}
/** 한국 시간 게시 시각 YYYYMMDD-HHmmss */
export function dataVersionAt(ms) {
    const iso = new Date(ms + KST_OFFSET_MS).toISOString(); // 2026-10-28T12:05:31.000Z
    return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}
/** 게시마다 바뀌는 값 (폰이 칸 파일 주소에 ?v= 로 붙인다). 같은 초에 다시 게시하면 -2, -3 … 을 붙인다 */
export function nextDataVersion(ms, previous) {
    const stamp = dataVersionAt(ms);
    if (!previous?.startsWith(stamp))
        return stamp;
    const count = Number(previous.slice(stamp.length + 1)) || 1;
    return `${stamp}-${count + 1}`;
}
/** 날이 바뀌었으면 예산을 새로 센다 */
export function ledgerFor(previous, now) {
    const day = kstDay(now);
    if (previous?.day === day)
        return { ...previous };
    return {
        version: 1,
        day,
        chargerCalls: 0,
        fullRuns: 0,
        lastFullAttemptAt: previous?.lastFullAttemptAt,
        lastRestAreaAttemptAt: previous?.lastRestAreaAttemptAt,
        lastDataVersion: previous?.lastDataVersion,
    };
}
/**
 * 전체 갱신 한 번에 드는 호출 수 어림: 전국 수 1회 + 쪽 수 + 시도마다 끝 쪽 하나씩.
 * 다시 부르는 것은 넣지 않는다 (예산을 넘기 전에 MeteredPortal 이 멈춘다)
 */
export function fullRunCost(rows) {
    return rows === undefined ? FIRST_FULL_RUN_COST : 1 + Math.ceil(rows / INVENTORY_PAGE_SIZE) + REGIONS.length;
}
/**
 * 이번 실행에서 할 일 (docs/nearby-server.md 4.3).
 * 전체 갱신이 필요해도 하루 횟수·재시도 간격·예산에 걸리면 변경분만 받고, 빠진 구간이 있으면 incomplete 로 둔다.
 */
export function decide(input, settings) {
    const { now, ledger, chargers, mode } = input;
    const restAreas = restAreasDue(input, settings);
    const remaining = settings.dailyChargerCalls - ledger.chargerCalls;
    const gap = chargers !== null && now - chargers.statusAt > settings.statusGapMs;
    const incomplete = chargers !== null && (gap || !chargers.statusComplete);
    const affordable = remaining >= fullRunCost(chargers?.rows);
    const budgetText = `오늘 예산 ${ledger.chargerCalls}/${settings.dailyChargerCalls}회`;
    const full = (reason) => ({ chargers: 'full', incomplete: false, restAreas, reason });
    const none = (reason) => ({ chargers: 'none', incomplete: false, restAreas, reason });
    const status = (reason) => {
        if (chargers === null)
            return none(`${reason}. 저장된 충전소 목록이 없어 상태만 받을 수는 없어요`);
        if (remaining < STATUS_RUN_COST)
            return none(`${reason}. 호출 예산을 다 썼어요 (${budgetText})`);
        return { chargers: 'status', incomplete, restAreas, reason };
    };
    if (mode === 'status')
        return status('손으로 고른 변경분만');
    if (mode === 'full')
        return affordable ? full('손으로 고른 전체 갱신') : none(`전체 갱신을 하기에는 예산이 모자라요 (${budgetText})`);
    const why = fullReason(input, settings, gap);
    if (why === undefined)
        return status('변경분만');
    const wait = fullWait(input, settings);
    if (wait !== undefined)
        return status(`${why}. 하지만 ${wait}`);
    if (!affordable)
        return status(`${why}. 하지만 전체 갱신을 하기에는 예산이 모자라요 (${budgetText})`);
    return full(why);
}
function fullReason({ now, chargers }, settings, gap) {
    if (chargers === null)
        return '저장된 충전소 목록이 없어요';
    if (now - chargers.inventoryAt >= settings.inventoryMaxAgeMs) {
        return `전국 목록을 받은 지 ${Math.floor((now - chargers.inventoryAt) / (60 * MINUTE))}시간이 지났어요`;
    }
    if (gap)
        return `마지막 상태 갱신이 ${Math.floor((now - chargers.statusAt) / MINUTE)}분 전이라 변경분 창이 끊겼어요`;
    if (!chargers.statusComplete)
        return '상태에 빠진 구간이 남아 있어요';
    return undefined;
}
/** 전체 갱신을 지금 다시 하면 안 되는 이유 */
function fullWait({ now, ledger }, settings) {
    if (ledger.fullRuns >= settings.maxFullRunsPerDay)
        return `오늘 전체 갱신을 ${ledger.fullRuns}번 했어요`;
    if (ledger.lastFullAttemptAt !== undefined && now - ledger.lastFullAttemptAt < settings.fullRetryMs) {
        return `지난 전체 갱신 시도가 ${Math.floor((now - ledger.lastFullAttemptAt) / MINUTE)}분 전이에요`;
    }
    return undefined;
}
function restAreasDue({ now, ledger, restAreasAt }, settings) {
    if (restAreasAt !== null && now - restAreasAt < settings.restAreaMaxAgeMs)
        return false;
    return ledger.lastRestAreaAttemptAt === undefined || now - ledger.lastRestAreaAttemptAt >= settings.restAreaRetryMs;
}
