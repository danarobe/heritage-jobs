// 전체 수집 실행: 각 출처에서 공고를 모아 점수를 매기고 data/jobs.json 으로 저장
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreJob, dedupeKey, todayKST, daysBetween, sleep } from './lib.mjs';
import * as saramin from './sources/saramin.mjs';
import * as jobkorea from './sources/jobkorea.mjs';
import * as khs from './sources/khs.mjs';
import * as nrich from './sources/nrich.mjs';
import * as kha from './sources/kha.mjs';
import * as alio from './sources/alio.mjs';
import * as gojobs from './sources/gojobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'jobs.json');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'interests.json'), 'utf-8'));
const only = process.argv.slice(2); // 예: node scripts/crawl.mjs saramin khs  (일부만 실행)

const today = todayKST();
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf-8')) : { jobs: [] };
const prevById = new Map(prev.jobs.map((j) => [j.id, j]));

const SOURCES = [
  { mod: saramin, keywords: cfg.searchKeywords.saramin },
  { mod: jobkorea, keywords: cfg.searchKeywords.jobkorea },
  { mod: khs },
  { mod: nrich },
  { mod: kha },
  { mod: alio, keywords: cfg.searchKeywords.alio },
  { mod: gojobs, keywords: cfg.searchKeywords.gojobs || cfg.searchKeywords.alio },
];

// 이번에 실행하지 않은 출처는 이전 상태를 그대로 유지
const status = {};
for (const { mod } of SOURCES) if (prev.sources?.[mod.key]) status[mod.key] = prev.sources[mod.key];
let collected = [];
for (const { mod, keywords } of SOURCES) {
  if (only.length && !only.includes(mod.key)) continue;
  const t0 = Date.now();
  try {
    const jobs = await mod.crawl({ keywords, log });
    collected.push(...jobs.map((j) => ({ ...j, _mod: mod })));
    status[mod.key] = { name: mod.name, ok: true, count: jobs.length, ms: Date.now() - t0 };
    log(`✔ ${mod.name}: ${jobs.length}건`);
  } catch (e) {
    status[mod.key] = { name: mod.name, ok: false, error: String(e.message || e), ms: Date.now() - t0 };
    log(`✘ ${mod.name} 실패: ${e.message}`);
  }
}

// 1차 점수 → 상세 보강 대상 결정 (이전에 보강한 적 있으면 그 내용을 재사용)
const DETAIL_TTL_DAYS = 5;
let enriched = 0;
for (const job of collected) {
  const old = prevById.get(job.id);
  if (old) {
    job.firstSeen = old.firstSeen || today;
    if (old.detailOk && old.detailAt && daysBetween(today, old.detailAt) <= DETAIL_TTL_DAYS) {
      // 이전 상세 내용 재사용 (목록에서 새로 얻은 값 중 비어있지 않은 것만 덮어씀)
      const keep = Object.fromEntries(Object.entries(job).filter(([, v]) => v !== null && v !== undefined && v !== ''));
      Object.assign(job, old, keep, { needsDetail: false, detailAt: old.detailAt });
    }
  } else job.firstSeen = today;
  job.lastSeen = today;

  const pre = scoreJob(job, cfg);
  const wantDetail = job.needsDetail && job._mod.enrich && (job.official ? job.kind === 'job' : pre.tier !== 'low');
  if (wantDetail) {
    try {
      await job._mod.enrich(job);
      job.detailAt = today;
      job.detailOk = true;
      enriched++;
      await sleep(600);
    } catch (e) {
      log(`상세 실패 ${job.id}: ${e.message}`);
      job.needsDetail = false;
    }
  }
  Object.assign(job, scoreJob(job, cfg));
  delete job._mod;
}
log(`상세 보강 ${enriched}건`);

// 이전 데이터 중 이번에 못 본 공고도 마감 전이면 유지 (출처 사이트가 잠깐 안 열렸을 때 대비)
const seen = new Set(collected.map((j) => j.id));
for (const old of prev.jobs) {
  if (seen.has(old.id)) continue;
  const srcOk = status[old.source]?.ok;
  const stale = daysBetween(today, old.lastSeen || old.firstSeen || today);
  const expired = old.deadline && daysBetween(old.deadline, today) < 0;
  if (!expired && srcOk && stale > 7) continue; // 출처는 멀쩡한데 7일째 안 보이면 내려간 공고
  if (stale > 30) continue;
  collected.push(old);
}

// 같은 공고가 여러 출처에 있으면 하나로 합치기 (공식 > 공공 > 취업포털 순으로 대표 선택)
const rank = (j) => (j.official ? 2 : 0) + (j.source === 'alio' || j.source === 'gojobs' ? 1 : 0) + (j.deadline ? 0.5 : 0);
const byKey = new Map();
for (const j of collected) {
  const k = dedupeKey(j);
  const cur = byKey.get(k);
  if (!cur) byKey.set(k, j);
  else {
    const [win, lose] = rank(j) > rank(cur) ? [j, cur] : [cur, j];
    win.alsoOn = [...(win.alsoOn || []), ...(lose.alsoOn || []), { source: lose.source, sourceName: lose.sourceName, url: lose.url }].filter(
      (v, i, a) => v.url !== win.url && a.findIndex((x) => x.url === v.url) === i
    );
    for (const f of ['deadline', 'startAt', 'postedAt', 'region', 'salary', 'employmentType', 'experience', 'education', 'qualifications', 'summary'])
      if (!win[f] && lose[f]) win[f] = lose[f];
    win.score = Math.max(win.score, lose.score);
    win.tier = win.score >= cfg.tiers.high ? 'high' : win.score >= cfg.tiers.mid ? 'mid' : 'low';
    win.tags = [...new Set([...(win.tags || []), ...(lose.tags || [])])];
    win.firstSeen = [win.firstSeen, lose.firstSeen].filter(Boolean).sort()[0];
    byKey.set(k, win);
  }
}

// 마감 30일 지난 공고, 취업포털에서 우연히 걸린 무관한 공고는 버림
const minPortal = cfg.minScore?.portal ?? 0;
const jobs = [...byKey.values()]
  .filter((j) => !(j.deadline && daysBetween(today, j.deadline) > 30))
  .filter((j) => j.official || j.score >= minPortal)
  .map((j) => {
    const { needsDetail, ...rest } = j;
    return rest;
  })
  .sort((a, b) => b.score - a.score || (b.firstSeen || '').localeCompare(a.firstSeen || ''));

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      today,
      count: jobs.length,
      newToday: jobs.filter((j) => j.firstSeen === today).length,
      sources: status,
      categories: cfg.categories.map(({ key, label }) => ({ key, label })),
      jobs,
    },
    null,
    1
  )
);
const tiers = jobs.reduce((a, j) => ((a[j.tier] = (a[j.tier] || 0) + 1), a), {});
log(`저장 완료: ${jobs.length}건 (높음 ${tiers.high || 0} / 보통 ${tiers.mid || 0} / 낮음 ${tiers.low || 0}) → ${path.relative(ROOT, OUT)}`);
