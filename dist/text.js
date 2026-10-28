/** 차량 화면에 보일 글자 길이 상한 (UTF-16). packages/protocol 의 MAX_PLACE_TEXT_LENGTH 와 같다 */
export const MAX_TEXT_LENGTH = 80;
/** 장소 id 길이 상한. packages/protocol 의 MAX_PLACE_ID_LENGTH 와 같다 */
export const MAX_ID_LENGTH = 64;
const ELLIPSIS = '…';
// 폰(Kotlin)의 isISOControl 과 줄·문단 구분 문자
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// 폰(Kotlin)의 \s 와 같은 ASCII 공백
const SPACES = /[ \t\n\v\f\r]+/g;
/**
 * 폰의 DisplayText.clean 과 같은 규칙으로 다듬는다.
 * 제어 문자·줄바꿈은 공백으로 바꾸고, 이어진 공백은 하나로, 앞뒤 공백은 지운다.
 * max 자(UTF-16)를 넘으면 말줄임표로 줄인다. 남는 글자가 없으면 빈 문자열.
 */
export function cleanText(raw, max) {
    if (raw == null)
        return '';
    const cleaned = raw.replace(CONTROL, ' ').replace(SPACES, ' ').trim();
    if (cleaned.length <= max)
        return cleaned;
    let end = max - ELLIPSIS.length;
    if (isHighSurrogate(cleaned.charCodeAt(end - 1)))
        end--; // 서로게이트 쌍(이모지 등)을 가르지 않는다
    return cleaned.slice(0, end).trimEnd() + ELLIPSIS;
}
/** 다듬고 남는 글자가 없으면 undefined (JSON 에서 빠진다) */
export function optionalText(raw, max = MAX_TEXT_LENGTH) {
    return cleanText(raw, max) || undefined;
}
/** Java 의 String.hashCode. 폰이 만들던 휴게소 id 와 같은 값을 만든다 */
export function javaHashCode(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++)
        hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
    return hash;
}
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
