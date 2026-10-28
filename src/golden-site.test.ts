import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collect } from './collector.js';
import { FixturePortal } from './portal.js';
import { FIXTURE_SETTINGS } from './settings.js';

/**
 * 견본 응답으로 만든 사이트(fixtures/site)가 지금 수집기의 출력과 같은지 본다.
 * 폰(android/core)의 칸 읽기 테스트와 PC 데모가 이 사이트를 그대로 읽으므로, 두 언어가 같은 파일로 맞춰진다.
 * 수집기 출력이 바뀌었으면 UPDATE_GOLDEN=1 로 이 테스트를 돌려 다시 만든다.
 */
const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const GOLDEN = join(FIXTURES, 'site');
/** 2026-10-28 12:00 KST. 폰 테스트·PC 데모는 이 시각 뒤라고 치고 읽는다 */
const GOLDEN_AT = Date.UTC(2026, 9, 28, 3, 0, 0);

async function files(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    result[relative(dir, path).split(sep).join('/')] = await readFile(path, 'utf8');
  }
  return result;
}

describe('견본 사이트', () => {
  it('견본 응답으로 처음 돌린 결과가 fixtures/site 와 같다', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nearby-golden-'));
    try {
      const out = join(root, 'site');
      const result = await collect({
        stateDir: join(root, 'state'),
        outDir: out,
        portal: new FixturePortal(FIXTURES),
        settings: FIXTURE_SETTINGS,
        now: () => GOLDEN_AT,
      });
      expect(result.problems).toEqual([]);
      if (process.env.UPDATE_GOLDEN) {
        await rm(GOLDEN, { recursive: true, force: true });
        await cp(out, GOLDEN, { recursive: true });
      }
      const golden = await files(GOLDEN);
      expect(Object.keys(golden).sort()).toEqual([
        'index.html',
        'v1/chargers/750_2539.json',
        'v1/chargers/751_2539.json',
        'v1/chargers/752_2540.json',
        'v1/meta.json',
        'v1/rest-areas.json',
      ]);
      expect(await files(out)).toEqual(golden);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
