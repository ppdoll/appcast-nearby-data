import { applyStatus, InventoryBuilder, statusUpdate } from './chargers.js';
import { decide, ledgerFor, nextDataVersion } from './plan.js';
import { MeteredPortal, PortalError } from './portal.js';
import { parseRestAreas } from './rest-areas.js';
import { DEFAULT_SETTINGS, INVENTORY_PAGE_SIZE, MAX_INVENTORY_PAGES, MAX_REST_AREA_PAGES, MAX_STATUS_PAGES, REGIONS, REST_AREA_PAGE_SIZE, STATUS_PAGE_SIZE, STATUS_PERIOD_MINUTES, } from './settings.js';
import { buildSite, checkSite, largestTile, writeSite } from './site.js';
import { loadState, saveState } from './state.js';
/** 받은 데이터가 게시 전 검사(docs/nearby-server.md 4.5)를 통과하지 못했다 */
export class CheckError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CheckError';
    }
}
const TASK_LABEL = { full: '전체 갱신', status: '변경분만', none: '받지 않음' };
/**
 * 한 번 돈다: 상태 복원 → 할 일 정하기 → 공공데이터 받기 → 게시 전 검사 → 상태 저장·사이트 쓰기 (docs/nearby-server.md 4.2).
 * 받지 못했거나 검사에 걸리면 지난 상태를 그대로 두고 사이트도 쓰지 않는다. 호출 예산(장부)은 언제나 저장한다.
 */
export async function collect(options) {
    const settings = options.settings ?? DEFAULT_SETTINGS;
    const now = options.now ?? Date.now;
    const log = options.log ?? (() => undefined);
    const mode = options.mode ?? 'auto';
    const startedAt = now();
    const state = await loadState(options.stateDir, log);
    const ledger = ledgerFor(state.ledger, startedAt);
    const plan = decide({ now: startedAt, ledger, chargers: state.chargers, restAreasAt: state.restAreas?.updatedAt ?? null, mode }, settings);
    const incompleteNote = plan.chargers === 'status' && plan.incomplete ? ' (빠진 구간이 있어 statusComplete=false)' : '';
    log(`할 일: 충전소 ${TASK_LABEL[plan.chargers]}${incompleteNote}, 휴게소 ${plan.restAreas ? '받기' : '그대로'} — ${plan.reason}`);
    const portal = new MeteredPortal(options.portal, {
        chargerCallBudget: settings.dailyChargerCalls - ledger.chargerCalls,
        sleep: options.sleep,
        log,
    });
    const problems = mode !== 'auto' && plan.chargers === 'none' ? [plan.reason] : [];
    let chargers = state.chargers;
    let restAreas = state.restAreas;
    let chargersChanged = false;
    let restAreasChanged = false;
    let dataVersion;
    try {
        if (plan.chargers === 'full') {
            ledger.fullRuns++;
            ledger.lastFullAttemptAt = startedAt;
            const fresh = await attempt(() => fetchInventory(portal, state.chargers, startedAt, settings, log), problems);
            if (fresh)
                [chargers, chargersChanged] = [fresh, true];
        }
        else if (plan.chargers === 'status' && state.chargers) {
            const current = state.chargers;
            const fresh = await attempt(() => fetchStatus(portal, current, startedAt, plan.incomplete, log), problems);
            if (fresh)
                [chargers, chargersChanged] = [fresh, true];
        }
        if (plan.restAreas) {
            ledger.lastRestAreaAttemptAt = startedAt;
            const fresh = await attempt(() => fetchRestAreas(portal, startedAt, settings, log), problems);
            if (fresh)
                [restAreas, restAreasChanged] = [fresh, true];
        }
        if (chargers && (chargersChanged || restAreasChanged)) {
            const version = nextDataVersion(now(), ledger.lastDataVersion);
            const site = buildSite(chargers, restAreas, version);
            const largest = largestTile(site);
            log(`사이트: 충전소 ${site.meta.stations}곳, 충전기 ${site.meta.chargers}대, 칸 ${site.meta.tiles}개` +
                (largest ? `, 가장 큰 칸 ${largest.tile} (충전소 ${largest.stations}곳, ${Math.round(largest.bytes / 1024)}KB)` : ''));
            const siteProblems = checkSite(site, settings);
            if (siteProblems.length > 0) {
                problems.push(...siteProblems);
            }
            else {
                await saveState(options.stateDir, {
                    chargers: chargersChanged ? chargers : undefined,
                    restAreas: restAreasChanged ? restAreas : undefined,
                });
                await writeSite(options.outDir, site.files);
                ledger.lastDataVersion = dataVersion = version;
            }
        }
        else if (restAreasChanged) {
            // 충전소 목록이 아직 없으면 휴게소만 저장해 두고, 게시는 충전소를 받은 뒤에 한다
            await saveState(options.stateDir, { restAreas });
        }
    }
    finally {
        ledger.chargerCalls += portal.chargerCalls;
        await saveState(options.stateDir, { ledger });
    }
    log(`호출: 충전소 API ${portal.chargerCalls}회 (오늘 ${ledger.chargerCalls}/${settings.dailyChargerCalls}회), ` +
        `휴게소 API ${portal.restAreaCalls}회`);
    return {
        plan,
        published: dataVersion !== undefined,
        dataVersion,
        chargerCalls: portal.chargerCalls,
        restAreaCalls: portal.restAreaCalls,
        problems,
    };
}
/** 공공데이터·검사 문제는 기록하고 넘어간다. 그 밖의 오류(버그)는 그대로 던진다 */
async function attempt(work, problems) {
    try {
        return await work();
    }
    catch (e) {
        if (!(e instanceof PortalError) && !(e instanceof CheckError))
            throw e;
        problems.push(e.message);
        return undefined;
    }
}
/**
 * 전국 목록을 모두 받아 충전소 목록을 새로 만든다. 전국 수를 먼저 1대만 받아 알아낸 뒤, 시도(zcode)마다 나눠 받는다.
 * 시도별로 받은 합계가 전국 수와 맞아야 쓴다 (시도 코드가 바뀌어 빠진 곳이 있으면 알린다).
 */
async function fetchInventory(portal, previous, startedAt, settings, log) {
    const national = await portal.page({ api: 'chargerInfo', params: { pageNo: 1, numOfRows: 1, dataType: 'JSON' } });
    if (national.totalCount === null)
        throw new PortalError('충전기 정보 응답에 전체 수(totalCount)가 없어요.');
    const total = national.totalCount;
    const pages = Math.ceil(total / INVENTORY_PAGE_SIZE);
    if (pages > MAX_INVENTORY_PAGES) {
        throw new CheckError(`충전기가 ${total}대라 ${pages}쪽을 받아야 해요 (${MAX_INVENTORY_PAGES}쪽까지만 받아요).`);
    }
    const needed = pages + REGIONS.length;
    if (needed > portal.remainingChargerCalls) {
        throw new PortalError(`전국 목록(약 ${needed}회)을 받기에는 오늘 남은 호출 예산(${portal.remainingChargerCalls}회)이 모자라요.`);
    }
    log(`전국 충전기 ${total}대: 시도 ${REGIONS.length}곳으로 나눠 받아요 (약 ${needed}회)`);
    const builder = new InventoryBuilder();
    let pageCount = 0;
    for (const [code, name] of REGIONS)
        pageCount += await fetchRegion(portal, builder, code, name, log);
    log(`전국 목록 ${pageCount}쪽: 항목 ${builder.items}개, 겹치지 않는 충전기 ${builder.uniqueChargers}대 (전국 ${total}대)`);
    if (Math.abs(builder.uniqueChargers - total) > total * settings.countTolerance) {
        throw new CheckError(`시도별로 받은 충전기 ${builder.uniqueChargers}대가 전국 ${total}대와 맞지 않아요. ` +
            '받는 사이 목록이 크게 바뀌었거나, 개편으로 시도 코드가 바뀌었을 수 있어요.');
    }
    const stations = builder.build();
    if (stations.length === 0)
        throw new CheckError('쓸 수 있는 충전소가 하나도 없어요.');
    if (previous && stations.length < previous.stations.length * (1 - settings.maxStationDrop)) {
        throw new CheckError(`충전소가 ${previous.stations.length}곳에서 ${stations.length}곳으로 줄었어요 ` +
            `(${Math.round(settings.maxStationDrop * 100)}% 넘게 줄면 게시하지 않아요).`);
    }
    log(`충전소 ${stations.length}곳 (이용자 제한·삭제·버스 전용·좌표 이상은 뺐어요)`);
    return { version: 1, inventoryAt: startedAt, statusAt: startedAt, statusComplete: true, rows: total, stations };
}
/** 한 시도의 목록을 쪽마다 받아 [builder] 에 넣고, 쪽마다 진행을 남긴다. 받은 쪽 수를 돌려준다 */
async function fetchRegion(portal, builder, code, name, log) {
    for (let page = 1;; page++) {
        const started = performance.now();
        const result = await portal.page({
            api: 'chargerInfo',
            params: { pageNo: page, numOfRows: INVENTORY_PAGE_SIZE, zcode: code, dataType: 'JSON' },
        });
        builder.addItems(result.items);
        const total = result.totalCount ?? 0;
        const pages = Math.max(1, Math.ceil(total / INVENTORY_PAGE_SIZE));
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        log(`전국 목록 ${name}(${code}) ${page}/${pages}쪽: ${result.items.length}대, ${seconds}초`);
        if (result.items.length < INVENTORY_PAGE_SIZE || page * INVENTORY_PAGE_SIZE >= total)
            return page;
        if (page >= MAX_INVENTORY_PAGES)
            throw new CheckError(`${name}(${code}) 목록이 ${MAX_INVENTORY_PAGES}쪽을 넘어요.`);
    }
}
/** 최근 10분 동안 바뀐 충전기 상태를 받아 반영한다. 모든 쪽을 받은 뒤에야 고친다 */
async function fetchStatus(portal, current, startedAt, incomplete, log) {
    const updates = [];
    let truncated = false;
    for (let page = 1;; page++) {
        const result = await portal.page({
            api: 'chargerStatus',
            params: { pageNo: page, numOfRows: STATUS_PAGE_SIZE, period: STATUS_PERIOD_MINUTES, dataType: 'JSON' },
        });
        for (const item of result.items) {
            const update = statusUpdate(item);
            if (update)
                updates.push(update);
        }
        const total = result.totalCount ?? 0;
        if (result.items.length < STATUS_PAGE_SIZE || page * STATUS_PAGE_SIZE >= total)
            break;
        if (page >= MAX_STATUS_PAGES) {
            truncated = true; // 받지 못한 변경분이 남았다
            break;
        }
    }
    const stations = new Map(current.stations.map((station) => [station.id, station]));
    const { applied, unknown } = applyStatus(stations, updates);
    log(`상태 변경분 ${updates.length}건: 반영 ${applied}, 목록에 없음 ${unknown}` +
        (truncated ? ` (${MAX_STATUS_PAGES}쪽까지만 받았어요)` : ''));
    return { ...current, statusAt: startedAt, statusComplete: !incomplete && !truncated };
}
async function fetchRestAreas(portal, startedAt, settings, log) {
    const items = [];
    for (let page = 1; page <= MAX_REST_AREA_PAGES; page++) {
        const result = await portal.page({
            api: 'restAreas',
            params: { pageNo: page, numOfRows: REST_AREA_PAGE_SIZE, type: 'json' },
        });
        items.push(...result.items);
        const total = result.totalCount;
        if (total === null || result.items.length < REST_AREA_PAGE_SIZE || page * REST_AREA_PAGE_SIZE >= total)
            break;
    }
    const restAreas = parseRestAreas(items);
    log(`휴게소 ${restAreas.length}곳 (항목 ${items.length}개)`);
    if (restAreas.length < settings.minRestAreas) {
        throw new CheckError(`휴게소가 ${restAreas.length}곳뿐이라 쓰지 않아요 (${settings.minRestAreas}곳 이상이어야 해요).`);
    }
    return { version: 1, updatedAt: startedAt, restAreas };
}
