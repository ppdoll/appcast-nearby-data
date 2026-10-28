import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tileStation } from './chargers.js';
import { TILE_DEGREES, tileId } from './geo.js';
/** 공공누리 제1유형(출처표시). meta.json 과 첫 화면에 적는다 */
export const SOURCE = '한국환경공단 전기자동차 충전소 정보, 전국휴게소정보표준데이터 (공공데이터포털, 공공누리 제1유형)';
/** 데이터 형식 버전 폴더. 형식을 바꾸면 v2 를 새로 만들고 한동안 함께 게시한다 */
export const SITE_DIR = 'v1';
/** 게시할 파일을 모두 만든다. Pages 는 게시마다 사이트를 통째로 바꾸므로 바뀌지 않은 칸도 다시 만든다 */
export function buildSite(chargers, restAreas, dataVersion) {
    const byTile = new Map();
    let chargerCount = 0;
    for (const station of chargers.stations) {
        const tile = tileId(station.lat, station.lng);
        let list = byTile.get(tile);
        if (!list)
            byTile.set(tile, (list = []));
        list.push(tileStation(station));
        chargerCount += station.fast.length + station.slow.length;
    }
    const files = [];
    const tiles = [];
    for (const tile of [...byTile.keys()].sort(compare)) {
        const stations = byTile.get(tile).sort((a, b) => compare(a.id, b.id));
        const file = { version: 1, tile, statusAt: chargers.statusAt, stations };
        const text = JSON.stringify(file);
        files.push({ path: `${SITE_DIR}/chargers/${tile}.json`, text });
        tiles.push({ tile, stations: stations.length, bytes: Buffer.byteLength(text) });
    }
    if (restAreas) {
        const file = { version: 1, updatedAt: restAreas.updatedAt, restAreas: restAreas.restAreas };
        files.push({ path: `${SITE_DIR}/rest-areas.json`, text: JSON.stringify(file) });
    }
    const meta = {
        version: 1,
        dataVersion,
        tileSize: TILE_DEGREES,
        inventoryAt: chargers.inventoryAt,
        statusAt: chargers.statusAt,
        statusComplete: chargers.statusComplete,
        restAreasAt: restAreas?.updatedAt ?? null,
        stations: chargers.stations.length,
        chargers: chargerCount,
        tiles: byTile.size,
        source: SOURCE,
    };
    files.push({ path: `${SITE_DIR}/meta.json`, text: JSON.stringify(meta, null, 2) });
    files.push({ path: 'index.html', text: INDEX_HTML });
    return { meta, files, tiles };
}
/** 폰이 읽을 수 있는 크기인지 (docs/nearby-server.md 5.1). 문제를 문장으로 돌려준다 */
export function checkSite(site, settings) {
    const problems = site.tiles
        .filter((tile) => tile.stations > settings.maxTileStations || tile.bytes > settings.maxTileBytes)
        .map((tile) => `칸 ${tile.tile} 이 폰이 읽는 한도를 넘어요 (충전소 ${tile.stations}곳, ${kilobytes(tile.bytes)}KB).`);
    const restAreas = site.files.find((file) => file.path === `${SITE_DIR}/rest-areas.json`);
    const restAreaBytes = restAreas ? Buffer.byteLength(restAreas.text) : 0;
    if (restAreaBytes > settings.maxRestAreaBytes) {
        problems.push(`rest-areas.json 이 폰이 읽는 한도를 넘어요 (${kilobytes(restAreaBytes)}KB).`);
    }
    return problems;
}
export function largestTile(site) {
    return site.tiles.reduce((max, tile) => (!max || tile.bytes > max.bytes ? tile : max), undefined);
}
/** outDir/v1 을 통째로 바꾼다. 지난 실행에서 남은 칸 파일이 섞이지 않게 옆에 다 쓴 뒤 이름을 바꾼다 */
export async function writeSite(outDir, files) {
    const staging = join(outDir, `${SITE_DIR}.next`);
    await rm(staging, { recursive: true, force: true });
    const made = new Set();
    for (const file of files) {
        const inData = file.path.startsWith(`${SITE_DIR}/`);
        const target = inData ? join(staging, file.path.slice(SITE_DIR.length + 1)) : join(outDir, file.path);
        const dir = dirname(target);
        if (!made.has(dir)) {
            await mkdir(dir, { recursive: true });
            made.add(dir);
        }
        await writeFile(target, file.text);
    }
    await rm(join(outDir, SITE_DIR), { recursive: true, force: true });
    await rename(staging, join(outDir, SITE_DIR));
}
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const kilobytes = (bytes) => Math.round(bytes / 1024);
const INDEX_HTML = `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AppCast 주변 정보 데이터</title>
<p>Tesla AppCast 앱이 읽는 전국 전기차 충전소·휴게소 데이터입니다. 형식과 갱신 시각은 <a href="${SITE_DIR}/meta.json">${SITE_DIR}/meta.json</a> 에 있습니다.</p>
<p>출처: ${SOURCE}</p>
`;
