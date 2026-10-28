import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { collect } from './collector.js';
import { MODES, type Mode } from './plan.js';
import { FixturePortal, HttpPortal, PortalError, type Portal } from './portal.js';
import { DEFAULT_SETTINGS, FIXTURE_SETTINGS } from './settings.js';

export const USAGE =
  '사용법: npm run collect -- --state <상태 폴더> --out <사이트 폴더> [--mode auto|full|status] [--fixtures <견본 응답 폴더>]';
/** 공공데이터포털 인증키는 이 환경 변수로만 받는다 (GitHub Actions 시크릿) */
export const KEY_ENV = 'DATA_GO_KR_SERVICE_KEY';

export interface CliIo {
  env: Readonly<Record<string, string | undefined>>;
  log: (line: string) => void;
  now?: () => number;
}

/**
 * 명령줄 실행. 돌려주는 값은 종료 코드다:
 * 0 끝남 (게시할 것이 없었어도), 1 받지 못했거나 검사에 걸림, 2 사용법·설정 오류.
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let values: { state?: string; out?: string; mode?: string; fixtures?: string };
  try {
    values = parseArgs({
      args: [...argv],
      options: {
        state: { type: 'string' },
        out: { type: 'string' },
        mode: { type: 'string', default: 'auto' },
        fixtures: { type: 'string' },
      },
    }).values;
  } catch {
    io.log(USAGE);
    return 2;
  }
  const mode = values.mode as Mode;
  if (!values.state || !values.out || !MODES.includes(mode)) {
    io.log(USAGE);
    return 2;
  }

  let portal: Portal;
  if (values.fixtures) {
    portal = new FixturePortal(resolve(values.fixtures));
    io.log('견본 응답을 읽어요 (공공데이터포털을 부르지 않아요).');
  } else {
    const key = io.env[KEY_ENV]?.trim();
    if (!key) {
      io.log(`환경 변수 ${KEY_ENV} 에 공공데이터포털 인증키를 넣어 주세요.`);
      return 2;
    }
    try {
      portal = new HttpPortal(key);
    } catch (e) {
      if (!(e instanceof PortalError)) throw e;
      io.log(e.message);
      return 2;
    }
  }

  const clock = io.now ?? Date.now;
  const startedAt = clock();
  const result = await collect({
    stateDir: resolve(values.state),
    outDir: resolve(values.out),
    portal,
    mode,
    settings: values.fixtures ? FIXTURE_SETTINGS : DEFAULT_SETTINGS,
    now: io.now,
    log: io.log,
  });
  const github = io.env.GITHUB_ACTIONS === 'true';
  // GitHub Actions 에서는 실행 요약에 보이게 오류 표시(::error::)로 남긴다
  for (const problem of result.problems) io.log(github ? `::error::${escapeCommand(problem)}` : `문제: ${problem}`);
  const seconds = Math.round((clock() - startedAt) / 1000);
  io.log(
    result.published
      ? `게시할 사이트를 만들었어요 (dataVersion ${result.dataVersion}, ${seconds}초).`
      : `게시할 것이 없어요 (${seconds}초).`,
  );
  return result.problems.length > 0 ? 1 : 0;
}

/** GitHub Actions 워크플로 명령의 값 이스케이프 */
function escapeCommand(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
