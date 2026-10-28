/** 칸(타일) 한 변 (도). 서울 근처에서 남북 약 5.6km, 동서 약 4.4km */
export const TILE_DEGREES = 0.05;
const MICRO_DEGREES = 1_000_000;
const TILE_MICRO_DEGREES = 50_000;
/** 게시하는 좌표는 소수 5자리 (약 1m) */
const COORDINATE_SCALE = 100_000;
/** 대한민국 근처인지. 공공데이터에 섞인 0,0 이나 위도·경도를 바꿔 쓴 좌표를 거른다 (폰의 GeoPoint.inKorea) */
export function inKorea(lat, lng) {
    return lat >= 32 && lat <= 39.5 && lng >= 123 && lng <= 132.5;
}
export function roundCoordinate(degrees) {
    return Math.round(degrees * COORDINATE_SCALE) / COORDINATE_SCALE;
}
/**
 * 위도나 경도가 든 칸 번호. 0.05 로 바로 나누면 37.15 같은 경계에서 소수 오차로 한 칸 어긋나므로
 * 정수 마이크로도로 바꿔 나눈다. 폰(android/core)도 같은 식을 쓴다.
 */
export function tileIndex(degrees) {
    return Math.floor(Math.round(degrees * MICRO_DEGREES) / TILE_MICRO_DEGREES);
}
/** 칸 id "{y}_{x}". 서울역(37.5547, 126.9707) → "751_2539" */
export function tileId(lat, lng) {
    return `${tileIndex(lat)}_${tileIndex(lng)}`;
}
