# heritage-jobs — 문화유산 채용 보드

동생의 남자친구(문화재 분야 구직자)를 위한 채용공고 자동 수집 사이트. 사용자는 비개발자 → 쉬운 한국어로 설명.

## 구조
- `scripts/crawl.mjs` 수집 실행 → `data/jobs.json` (출처별 상태 `sources`, 공고 `jobs`)
- `scripts/sources/*.mjs` 출처별 수집기. 각 파일은 `crawl()` + (선택) `enrich(job)` 내보냄
  - saramin(사람인), jobkorea(잡코리아), khs(국가유산청 시험/채용), nrich(국립문화유산연구원), kha(국가유산진흥원), alio(잡알리오), gojobs(나라일터), momo365(모모365)
- `scripts/lib.mjs` 공통: fetchText, parseDate, extractPeriod(접수기간 추출), extractQualifications, scoreJob(관심도), dedupeKey
- `config/interests.json` 분야 키워드·가중치·노이즈 단어·검색어·점수 기준. 관심사 조정은 이 파일만.
- `index.html` 정적 UI (vanilla JS, localStorage: 관심★/숨기기/내 키워드/필터)
- `.github/workflows/crawl.yml` 하루 3회 자동 수집 후 data/jobs.json 커밋 → GitHub Pages 자동 반영

## 규칙
- 출처 사이트 구조가 바뀌면 해당 `sources/*.mjs` 만 고치면 됨. 실패해도 다른 출처는 계속 수집되고, 실패 사실은 jobs.json `sources[key].ok=false` 로 UI에 표시됨.
- 취업포털(사람인·잡코리아) 공고는 점수 `minScore.portal` 미만이면 저장 안 함. 공식 게시판은 전부 저장.
- 상세 페이지는 5일(DETAIL_TTL_DAYS)마다만 다시 읽음. 사이트에 부담 주지 않도록 요청 사이 0.6~0.9초 대기.
- `kind: 'result'` = 합격자 발표·면접 일정 등 공지. UI 기본값은 숨김.
- 모모365(momo365.net)는 문화예술 전반 공고라 official:false → 점수 minScore 미만은 저장 안 함. 상세 본문은 이미지라 목록 정보 위주.

## 로컬 실행
```bash
node scripts/crawl.mjs            # 전체
node scripts/crawl.mjs saramin    # 일부
node scripts/serve.mjs            # http://localhost:3005
```
