import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
const FILES = { ledger: 'ledger.json', chargers: 'chargers.json', restAreas: 'rest-areas.json' };
/** 없거나 읽을 수 없는 파일은 null (처음부터 다시 받는다) */
export async function loadState(dir, log) {
    return {
        ledger: await load(join(dir, FILES.ledger), isLedger, log),
        chargers: await load(join(dir, FILES.chargers), isChargerState, log),
        restAreas: await load(join(dir, FILES.restAreas), isRestAreaState, log),
    };
}
/** 넘긴 것만 저장한다. 장부는 맨 뒤에 쓴다 */
export async function saveState(dir, state) {
    await mkdir(dir, { recursive: true });
    if (state.chargers)
        await writeJsonAtomic(join(dir, FILES.chargers), state.chargers);
    if (state.restAreas)
        await writeJsonAtomic(join(dir, FILES.restAreas), state.restAreas);
    if (state.ledger)
        await writeJsonAtomic(join(dir, FILES.ledger), state.ledger);
}
async function load(path, valid, log) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (e) {
        if (e.code === 'ENOENT')
            return null;
        throw e;
    }
    try {
        const value = JSON.parse(text);
        if (valid(value))
            return value;
    }
    catch {
        // 아래에서 알린다
    }
    log(`상태 파일 ${basename(path)} 을 읽지 못해 없는 셈 쳐요.`);
    return null;
}
/** 쓰다가 멈춰도 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 바꾼다 */
async function writeJsonAtomic(path, value) {
    const temp = `${path}.tmp`;
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, path);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isTime = (value) => Number.isSafeInteger(value) && value >= 0;
const isOptionalTime = (value) => value === undefined || isTime(value);
const isOptionalText = (value) => value === undefined || typeof value === 'string';
const isTextList = (value) => Array.isArray(value) && value.every((it) => typeof it === 'string');
function isLedger(value) {
    return (isRecord(value) &&
        value.version === 1 &&
        typeof value.day === 'string' &&
        isTime(value.chargerCalls) &&
        isTime(value.fullRuns) &&
        isOptionalTime(value.lastFullAttemptAt) &&
        isOptionalTime(value.lastRestAreaAttemptAt) &&
        isOptionalText(value.lastDataVersion));
}
function isChargerState(value) {
    return (isRecord(value) &&
        value.version === 1 &&
        isTime(value.inventoryAt) &&
        isTime(value.statusAt) &&
        typeof value.statusComplete === 'boolean' &&
        isTime(value.rows) &&
        Array.isArray(value.stations) &&
        value.stations.every(isStoredStation));
}
function isStoredStation(value) {
    return (isRecord(value) &&
        typeof value.id === 'string' &&
        value.id.length > 0 &&
        typeof value.name === 'string' &&
        Number.isFinite(value.lat) &&
        Number.isFinite(value.lng) &&
        isOptionalText(value.address) &&
        isOptionalText(value.operator) &&
        isOptionalText(value.hours) &&
        (value.maxKw === undefined || Number.isInteger(value.maxKw)) &&
        isTextList(value.plugs) &&
        isTextList(value.fast) &&
        isTextList(value.slow) &&
        typeof value.stat === 'string' &&
        value.stat.length === value.fast.length + value.slow.length);
}
function isRestAreaState(value) {
    return (isRecord(value) &&
        value.version === 1 &&
        isTime(value.updatedAt) &&
        Array.isArray(value.restAreas) &&
        value.restAreas.every((area) => isRecord(area) &&
            typeof area.id === 'string' &&
            typeof area.name === 'string' &&
            Number.isFinite(area.lat) &&
            Number.isFinite(area.lng) &&
            isTextList(area.facilities)));
}
