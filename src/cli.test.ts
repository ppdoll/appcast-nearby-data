import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEY_ENV, runCli, USAGE } from './cli.js';

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));

let root = '';
let lines: string[] = [];
const io = (env: Record<string, string | undefined> = {}) => ({ env, log: (line: string) => lines.push(line) });
const readJson = async (...path: string[]) => JSON.parse(await readFile(join(...path), 'utf8'));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nearby-cli-'));
  lines = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('runCli', () => {
  it('폴더를 주지 않거나 모르는 값을 주면 사용법을 알린다', async () => {
    expect(await runCli([], io())).toBe(2);
    expect(await runCli(['--state', 's', '--out', 'o', '--mode', 'fast'], io())).toBe(2);
    expect(await runCli(['--state', 's', '--out', 'o', '--force'], io())).toBe(2);
    expect(lines).toEqual([USAGE, USAGE, USAGE]);
  });

  it('인증키 환경 변수가 없으면 부르지 않는다', async () => {
    expect(await runCli(['--state', join(root, 's'), '--out', join(root, 'o')], io({ [KEY_ENV]: ' ' }))).toBe(2);
    expect(lines).toEqual([`환경 변수 ${KEY_ENV} 에 공공데이터포털 인증키를 넣어 주세요.`]);
  });

  it('견본 응답으로 전체 갱신과 변경분을 차례로 돈다', async () => {
    const args = ['--state', join(root, 'state'), '--out', join(root, 'site'), '--fixtures', FIXTURES];
    expect(await runCli(args, io())).toBe(0);
    const first = await readJson(root, 'site', 'v1', 'meta.json');
    // 입주민 전용 충전소, 지운 충전기, 버스 전용 충전기는 빠진다
    expect(first).toMatchObject({ stations: 5, chargers: 19, tiles: 3, statusComplete: true });
    const tile = await readJson(root, 'site', 'v1', 'chargers', '751_2539.json');
    expect(tile.stations.map((station: { name: string }) => station.name)).toEqual(['데모 공영주차장', '데모 급속 충전소']);
    expect(tile.stations[0]).toMatchObject({ fast: { total: 2, available: 1 }, slow: { total: 2, available: 1 }, maxKw: 100 });
    expect((await readJson(root, 'site', 'v1', 'rest-areas.json')).restAreas).toHaveLength(3);

    expect(await runCli(args, io())).toBe(0);
    expect(lines).toContain('상태 변경분 4건: 반영 2, 목록에 없음 2');
    const after = await readJson(root, 'site', 'v1', 'chargers', '751_2539.json');
    expect(after.stations[0].fast).toEqual({ total: 2, available: 2 });
    expect(after.stations[1].fast).toEqual({ total: 6, available: 4 });
  });

  it('GitHub Actions 에서는 문제를 오류 표시로 남기고 1 로 끝난다', async () => {
    const fixtures = join(root, 'fixtures');
    await mkdir(fixtures);
    await copyFile(join(FIXTURES, 'chargerInfo-1.json'), join(fixtures, 'chargerInfo-1.json'));
    const args = ['--state', join(root, 'state'), '--out', join(root, 'site'), '--fixtures', fixtures];
    expect(await runCli(args, io({ GITHUB_ACTIONS: 'true' }))).toBe(1);
    expect(lines).toContain('::error::견본 응답 restAreas-1.json 이 없어요.');
    expect(lines.at(-1)).toMatch(/^게시할 사이트를 만들었어요 \(dataVersion \d{8}-\d{6}, \d+초\)\.$/);
  });
});
