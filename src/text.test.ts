import { describe, expect, it } from 'vitest';
import { cleanText, javaHashCode, optionalText } from './text.js';

const BELL = String.fromCharCode(7);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('cleanText', () => {
  it('제어 문자·줄바꿈은 공백 하나로 바꾸고 앞뒤 공백을 지운다', () => {
    expect(cleanText(`  서울역\t\n공영${BELL}주차장 `, 80)).toBe('서울역 공영 주차장');
    expect(cleanText(`가${LINE_SEPARATOR}나`, 80)).toBe('가 나');
  });

  it('길면 UTF-16 기준으로 줄이고 말줄임표를 붙인다', () => {
    expect(cleanText('가'.repeat(80), 80)).toBe('가'.repeat(80));
    expect(cleanText('가'.repeat(100), 80)).toBe('가'.repeat(79) + '…');
    expect(cleanText('가나다 라마바', 5)).toBe('가나다…'); // 자른 끝의 공백은 지운다
  });

  it('서로게이트 쌍(이모지)을 가르지 않는다', () => {
    expect(cleanText('a'.repeat(8) + '😀b', 10)).toBe('a'.repeat(8) + '…');
  });

  it('없거나 공백뿐이면 빈 글자', () => {
    expect(cleanText(null, 80)).toBe('');
    expect(cleanText(undefined, 80)).toBe('');
    expect(optionalText(' \t ')).toBeUndefined();
    expect(optionalText('환경부')).toBe('환경부');
  });
});

describe('javaHashCode', () => {
  it('Java 의 String.hashCode 와 같다 (int 넘침 포함)', () => {
    expect(javaHashCode('')).toBe(0);
    expect(javaHashCode('hello')).toBe(99162322);
    expect(javaHashCode('Hello World')).toBe(-862545276);
  });
});
