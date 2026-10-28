# AppCast 주변 정보 수집기

공공데이터포털의 전국 전기차 충전소·휴게소 정보를 모아, 전국을 약 5km 칸(타일)으로 나눈 정적 JSON 으로 만든다.
GitHub Actions 에서 5분마다 돌고 GitHub Pages 로 게시한다. Tesla AppCast 앱은 주변 칸 파일만 받아 거리를 직접 계산한다.
폰의 위치 좌표는 어디로도 보내지 않는다.

## 게시하는 파일 (`v1/`)

| 파일 | 내용 |
|---|---|
| `v1/meta.json` | `dataVersion`(게시마다 바뀜), 목록·상태·휴게소를 받은 시각, `statusComplete`, 충전소·충전기·칸 수, 출처 |
| `v1/chargers/{y}_{x}.json` | 그 칸의 충전소: 이름, 좌표(소수 5자리), 주소, 운영기관, 이용 시간, 급속·완속 충전기 수와 충전대기 수, 최대 출력, 커넥터 |
| `v1/rest-areas.json` | 전국 휴게소: 노선·방향, 운영 시간, 편의시설, 대표 음식, 전화 |

- 칸 번호: `y = floor(round(위도 × 1,000,000) / 50,000)`, `x = floor(round(경도 × 1,000,000) / 50,000)`. 한 칸은 0.05도다.
  견본: [fixtures/tile-samples.json](fixtures/tile-samples.json) (서울역 37.5547, 126.9707 → `751_2539`).
- 충전소가 없는 칸은 파일이 없다(404).
- 칸 파일은 `?v=<dataVersion>` 을 붙여 받으면 새 게시를 바로 받는다.
- 빼는 것: 이용자 제한(입주민 전용 등) 충전소, 시험용(이름에 '테스트'·'시험용')·비개방(이용 시간에 '비개방' 등) 충전소,
  지운 충전기, 버스 전용 충전기, 대한민국 밖 좌표.

## 실행

```bash
npm install
npm test
npm run build
DATA_GO_KR_SERVICE_KEY=… npm run collect -- --state state --out site            # 공공데이터포털을 부른다
npm run collect -- --state state --out site --fixtures fixtures                 # 견본 응답으로 오프라인 실행
```

- `fixtures/` 의 `<api>-<쪽>.json` 은 견본 응답이고, `fixtures/site/` 는 그 응답으로 처음 돌린 결과(2026-10-28 12:00 KST 게시로 고정)다.
  앱 테스트와 PC 데모가 이 사이트를 읽는다. `src/golden-site.test.ts` 가 지금 출력과 같은지 보고,
  출력이 바뀌면 `UPDATE_GOLDEN=1` 로 그 테스트를 돌려 다시 만든다.

- `--state`: 실행 사이에 남기는 상태 폴더 (`ledger.json` 호출 예산·지난 시도, `chargers.json`, `rest-areas.json`).
  `ledger.json` 은 실패한 실행에서도 저장한다.
- `--out`: 게시할 사이트 폴더. 게시할 것이 생기면 `v1/` 을 통째로 바꾼다.
- `--mode auto|full|status`: 기본 `auto` 는 아래 규칙을 따른다. 손으로 실행할 때 `full`(전국 목록 다시 받기)을 고를 수 있다.
- 종료 코드: 0 끝남(게시할 것이 없었어도), 1 받지 못했거나 검사에 걸림, 2 사용법·인증키 설정 오류.

### 할 일 규칙 (`auto`)

- 평소에는 최근 10분 동안 바뀐 충전기 상태만 받는다 (`getChargerStatus`, 1~2회 호출).
- 전국 목록(`getChargerInfo`)은 처음, 24시간마다, 그리고 상태 변경분이 끊겼을 때(지난 상태가 9분보다 오래됨) 다시 받는다.
  전국 수를 먼저 알아낸 뒤 시도 19곳(`zcode`)마다 9,999대씩 나눠 받고(약 70쪽, 쪽마다 진행을 남긴다), 합계가 전국 수와 맞아야 쓴다.
  504·시간 초과는 5초·20초·60초 기다렸다 다시 부른다.
  하루 4번, 시도 사이 1시간 간격까지만 한다.
- 충전소 API 는 한국 시간 하루 900회까지만 부른다. 휴게소는 7일마다 받는다.
- 게시 전 검사: 받은 충전기 수가 포털의 `totalCount` 와 맞는지, 충전소가 20% 넘게 줄지 않았는지, 휴게소가 100곳 이상인지, 칸 파일이 앱이 읽는 한도(충전소 5,000곳·1MB) 안인지.
  걸리면 지난 상태와 사이트를 그대로 둔다.

## GitHub 에서 돌리기

[.github/workflows/nearby-data.yml](.github/workflows/nearby-data.yml) 이 5분마다(3분부터) 수집해 GitHub Pages 로 게시한다.

- 저장소 시크릿 `DATA_GO_KR_SERVICE_KEY` 에 공공데이터포털 인증키를 넣고, Settings → Pages 의 Source 를 GitHub Actions 로 고른다.
- 처음에는 Actions 탭에서 `nearby-data` 를 `full` 로 손으로 한 번 돌린다.
- 시크릿을 쓰는 잡은 npm 패키지를 설치하지 않고 저장소의 `dist/` 만 `node` 로 돌린다. 그래서 빌드한 `dist/` 도 저장소에 함께 둔다.
- 게시 권한은 시크릿이 없는 deploy 잡에만 있다. 액션은 커밋 SHA 로 고정했다.
- 상태 폴더는 `actions/cache` 로 실행 사이에 넘기고 최근 5개만 남긴다.
- 공개 저장소의 파일은 AppCast 모노레포의 내보내기 스크립트가 만든다. 고칠 때는 원본을 고치고 다시 내보낸다.

## 보안

- 인증키는 환경 변수 `DATA_GO_KR_SERVICE_KEY`(GitHub Actions 시크릿)로만 받는다. 코드·게시 파일·로그에 넣지 않는다.
- 요청 주소(인증키가 들어 있다)는 로그·오류 메시지에 남기지 않는다.

## 출처

한국환경공단 전기자동차 충전소 정보, 전국휴게소정보표준데이터 (공공데이터포털, 공공누리 제1유형).
게시 파일은 이를 가공한 것이며, `meta.json` 과 사이트 첫 화면에 출처를 적는다.
