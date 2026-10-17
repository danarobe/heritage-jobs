// 공통 유틸: HTTP 가져오기, 날짜 파싱, 텍스트 정리, 관심사 점수 계산
import iconv from 'iconv-lite';

export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 오늘 날짜(한국 시간) → 'YYYY-MM-DD' */
export function todayKST() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/** HTML 문서 가져오기 (재시도, 타임아웃, 인코딩 처리 포함) */
export async function fetchText(url, opts = {}) {
  const { method = 'GET', body, headers = {}, timeout = 25000, retries = 2, encoding } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
          ...headers,
        },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      let charset = encoding;
      if (!charset) {
        const ct = res.headers.get('content-type') || '';
        const m = ct.match(/charset=([\w-]+)/i);
        if (m) charset = m[1];
      }
      if (!charset) {
        const head = buf.subarray(0, 4096).toString('latin1');
        const m = head.match(/charset=["']?([\w-]+)/i);
        if (m) charset = m[1];
      }
      charset = (charset || 'utf-8').toLowerCase();
      if (charset === 'utf8') charset = 'utf-8';
      if (charset === 'utf-8') return buf.toString('utf-8');
      return iconv.decode(buf, charset);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 공백 정리 */
export function clean(s) {
  return (s || '')
    .replace(/ /g, ' ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/** 한 줄로 정리 */
export function oneLine(s) {
  return clean(s).replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** cheerio 요소의 텍스트를 줄바꿈 유지하며 추출 */
export function textWithBreaks($, el) {
  const html = $(el).html() || '';
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d|table)>/gi, '\n')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return clean(decodeEntities(t));
}

export function decodeEntities(s) {
  return (s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * 여러 형식의 날짜 문자열을 'YYYY-MM-DD'로.
 *  2026-10-13 / 2026.10.13 / 2026. 10. 13. / 26.10.30 / 26/10/16 / 10/19(월) / 2026년 10월 13일
 * 연도가 없으면 올해로 보고, 그 날짜가 60일 넘게 지났으면 내년으로 봅니다.
 */
export function parseDate(str, ref = todayKST()) {
  if (!str) return null;
  const s = String(str).replace(/\([^)]*\)/g, ' ').trim();
  let m;
  let y, mo, d;
  if ((m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/))) {
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  } else if ((m = s.match(/(?<!\d)(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})(?!\d)/))) {
    [y, mo, d] = [2000 + +m[1], +m[2], +m[3]];
  } else if ((m = s.match(/(?<!\d)(\d{1,2})\s*[.\/월]\s*(\d{1,2})(?!\d)/))) {
    [mo, d] = [+m[1], +m[2]];
    y = +ref.slice(0, 4);
    const cand = `${y}-${pad(mo)}-${pad(d)}`;
    if (daysBetween(cand, ref) < -60) y += 1;
  } else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** a - b 의 일수 (둘 다 'YYYY-MM-DD') */
export function daysBetween(a, b) {
  return Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
}

/**
 * 본문 텍스트에서 접수기간(시작~마감)을 찾아냅니다.
 * 예) "접수기간 : 2026. 10. 13.(월) ~ 2026. 10. 23.(목) 18:00"  / "2026.10.13 ~ 10.23"
 */
export function extractPeriod(text, ref = todayKST()) {
  if (!text) return null;
  const t = oneLine(text);
  const labels = /(접수\s*기간|접수\s*일시|접수일|원서\s*접수|공고\s*기간|채용\s*기간|지원\s*기간|모집\s*기간|서류\s*접수|응시원서\s*접수|신청\s*기간)/g;
  const full = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?\s*(?:\.|\([^)]*\))?/g;
  const short = /(?<![\d.])(\d{1,2})\s*[.\/월]\s*(\d{1,2})\s*일?\s*(?:\.|\([^)]*\))?/g;
  let m;
  const candidates = [];
  while ((m = labels.exec(t))) candidates.push(m.index);
  if (!candidates.length) candidates.push(0);
  for (const idx of candidates) {
    const win = t.slice(idx, idx + 160);
    const dates = [];
    let fm;
    full.lastIndex = 0;
    while ((fm = full.exec(win))) {
      dates.push({ at: fm.index, end: fm.index + fm[0].length, date: `${fm[1]}-${pad(+fm[2])}-${pad(+fm[3])}` });
    }
    if (dates.length >= 2) return { start: dates[0].date, end: dates[1].date };
    if (dates.length === 1) {
      // 뒤쪽에 연도 없는 날짜가 있는지 (예: 2026.10.13 ~ 10.23)
      const rest = win.slice(dates[0].end);
      short.lastIndex = 0;
      const sm = short.exec(rest);
      if (sm && /^[\s~\-–∼‐]*$/.test(rest.slice(0, sm.index))) {
        let y = +dates[0].date.slice(0, 4);
        let end = `${y}-${pad(+sm[1])}-${pad(+sm[2])}`;
        if (end < dates[0].date) end = `${y + 1}-${pad(+sm[1])}-${pad(+sm[2])}`;
        return { start: dates[0].date, end };
      }
      // 라벨 바로 뒤의 단일 날짜 = 마감일로 간주
      if (idx !== 0) return { start: null, end: dates[0].date };
    }
  }
  return null;
}

/** 본문에서 "자격" 관련 문단을 뽑아 요약 (최대 n자) */
export function extractQualifications(text, max = 600) {
  if (!text) return '';
  const lines = clean(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const startRe = /(응시\s*자격|지원\s*자격|자격\s*요건|자격\s*조건|지원\s*요건|응시\s*요건|자격\s*기준|응시자격)/;
  const stopRe = /(전형\s*절차|전형\s*방법|접수\s*방법|제출\s*서류|우대\s*사항|우대\s*조건|근무\s*조건|기타\s*사항|문의|결격\s*사유)/;
  let out = [];
  let on = false;
  for (const l of lines) {
    if (!on && startRe.test(l)) {
      on = true;
      out.push(l);
      continue;
    }
    if (on) {
      if (stopRe.test(l) && out.length > 1) break;
      out.push(l);
      if (out.join('\n').length > max) break;
    }
  }
  const s = out.join('\n');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 본문 앞부분을 요약용으로 잘라냄 */
export function excerpt(text, max = 300) {
  const s = oneLine(text);
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** 관심사 점수 계산 */
export function scoreJob(job, cfg) {
  const title = (job.title || '').toLowerCase();
  const company = (job.company || '').toLowerCase();
  const body = [job.sector, job.summary, job.qualifications, job.region, job.employmentType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  let score = 0;
  const tags = [];
  const hits = new Set();
  const count = (text, kws) => kws.filter((k) => text.includes(k.toLowerCase()));

  for (const cat of cfg.categories) {
    const inTitle = count(title, cat.keywords);
    const inCompany = count(company, cat.keywords);
    const inBody = count(body, cat.keywords);
    const s =
      cat.weight * (Math.min(inTitle.length, 2) * 3 + Math.min(inCompany.length, 1) * 2 + Math.min(inBody.length, 2));
    if (s > 0) {
      score += s;
      tags.push(cat.key);
      [...inTitle, ...inCompany, ...inBody].forEach((k) => hits.add(k));
    }
  }
  // '문화재단'(문화 재단)은 '문화재'가 아니므로 핵심 단어 매칭에서 제외
  const core = cfg.core;
  const noFoundation = (t) => t.replace(/문화재단/g, '문화x단');
  const ct = count(noFoundation(title), core.keywords);
  const cc = count(noFoundation(company), core.keywords);
  const cb = count(noFoundation(body), core.keywords);
  if (ct.length) score += core.weight * 2;
  if (cc.length) score += core.weight;
  if (cb.length) score += Math.min(cb.length, 2) * (core.weight / 2);
  [...ct, ...cc, ...cb].forEach((k) => hits.add(k));

  // 공식 기관 게시판은 기본적으로 관련도가 높음
  if (job.official) score += 4;

  // 제목에 관련 없는 직무/업종 단어가 있으면 크게 깎음 (검색어에만 걸린 공고)
  const noise = count(title, cfg.noise.keywords);
  if (noise.length) score = Math.floor(score / 4) - cfg.noise.penalty * noise.length;

  score = Math.max(0, Math.round(score));
  const tier = score >= cfg.tiers.high ? 'high' : score >= cfg.tiers.mid ? 'mid' : 'low';
  return { score, tier, tags, matched: [...hits] };
}

/** 제목+기관명으로 중복 판별용 키 */
export function dedupeKey(job) {
  const norm = (s) =>
    (s || '')
      .toLowerCase()
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^0-9a-z가-힣]+/g, '')
      .replace(/(직원)?(채용|모집|공개모집|신규채용|공개채용|공개경쟁채용)?(공고|안내|재공고)*$/, '');
  return `${norm(job.company).slice(0, 12)}|${norm(job.title).slice(0, 36)}`;
}
