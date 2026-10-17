// 잡코리아 검색 결과 수집 (+ 관심도 높은 공고는 상세 페이지에서 시작일·마감일·모집요강 보강)
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, decodeEntities, excerpt } from '../lib.mjs';

export const name = '잡코리아';
export const key = 'jobkorea';

export async function crawl({ keywords, log }) {
  const out = new Map();
  for (const kw of keywords) {
    for (let page = 1; page <= 3; page++) {
      const url = `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(kw)}&Ord=RegDtDesc&Page_No=${page}`;
      const html = await fetchText(url);
      const $ = cheerio.load(html);
      const cards = $('[data-sentry-component="CardJob"]');
      cards.each((_, el) => {
        const $el = $(el);
        const href = decodeEntities($el.find('a[href*="/Recruit/GI_Read/"]').first().attr('href') || '');
        const m = href.match(/GI_Read\/(\d+)(\/Ext)?/);
        if (!m) return;
        const id = m[1];
        // 고용24(워크넷)에서 넘어온 공고는 /Ext?siteCode=WN 형식의 주소를 써야 열림
        const url = m[2] ? `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}/Ext?siteCode=WN` : `https://www.jobkorea.co.kr/Recruit/GI_Read/${id}`;
        const title = oneLine($el.find('[data-sentry-component="Title"]').first().text());
        const company = oneLine($el.find('span.text-typo-b2-16').first().text());
        const chips = $el
          .find('[data-sentry-component="GrayChip"] span.text-typo-b4-14')
          .map((_, s) => oneLine($(s).text()))
          .get();
        const region = chips[0] || '';
        const sector = chips[1] || '';
        const salary = chips.find((c) => /연봉|월급|시급|만원/.test(c)) || '';
        const experience = oneLine($el.find('span.text-typo-c1-13').first().text());
        out.set(id, {
          id: `jobkorea:${id}`,
          source: key,
          sourceName: name,
          url,
          title,
          company,
          region,
          experience,
          education: '',
          employmentType: '',
          salary,
          sector,
          postedAt: null,
          startAt: null,
          deadline: null,
          deadlineText: '',
          summary: [region, experience, sector, salary].filter(Boolean).join(' · '),
          qualifications: experience ? `경력: ${experience}` : '',
          kind: 'job',
          official: false,
          foundBy: kw,
          needsDetail: true,
        });
      });
      log(`잡코리아 "${kw}" ${page}페이지: ${cards.length}건`);
      if (cards.length < 20) break;
      await sleep(900);
    }
    await sleep(900);
  }
  return [...out.values()];
}

/** 상세 페이지에서 시작일/마감일/모집요강을 읽어 job에 채워 넣음 */
export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const tokens = oneLine($('body').html().replace(/<[^>]+>/g, '|'))
    .split('|')
    .map((t) => decodeEntities(t).trim())
    .filter(Boolean);
  const after = (label, n = 1) => {
    const i = tokens.findIndex((t) => t === label);
    return i >= 0 ? tokens[i + n] || '' : '';
  };
  const start = parseDate(after('시작일'));
  const deadlineRaw = after('마감일');
  const deadline = parseDate(deadlineRaw);
  const deadlineText = deadline ? '' : /상시|수시|채용시/.test(deadlineRaw) ? deadlineRaw : '';
  const fieldOf = (label) => {
    const i = tokens.findIndex((t) => t === label);
    if (i < 0) return '';
    const v = tokens[i + 1] || '';
    return v.length > 80 ? '' : v;
  };
  const 모집분야 = fieldOf('모집분야');
  const 고용형태 = fieldOf('고용형태');
  let 급여 = fieldOf('급여');
  if (/^(연봉|월급|시급|일급|주급)$/.test(급여)) 급여 = `${급여} ${after('급여', 2)}`;
  const 근무지 = fieldOf('근무지주소') || fieldOf('지역').replace(/\s*>\s*/g, ' ');
  const 근무시간 = fieldOf('근무시간');
  // 지원자격 블록: "지원자격 | 경력 | 경력 | (2년이상) | 학력 | 학력무관"
  let experience = job.experience;
  let education = '';
  const qi = tokens.findIndex((t) => t === '지원자격');
  if (qi >= 0) {
    const seg = tokens.slice(qi + 1, qi + 12);
    const ei = seg.findIndex((t) => t === '경력');
    if (ei >= 0) experience = oneLine(seg.slice(ei + 1, ei + 3).filter((t) => t !== '경력').join(' ')) || experience;
    const li = seg.findIndex((t) => t === '학력');
    if (li >= 0) education = seg[li + 1] || '';
  }
  const og = $('meta[property="og:description"]').attr('content') || '';
  const summaryParts = [
    모집분야 && `모집분야: ${모집분야}`,
    고용형태 && `고용형태: ${고용형태}`,
    급여 && `급여: ${급여}`,
    근무지 && `근무지: ${근무지}`,
    근무시간 && `근무시간: ${근무시간}`,
  ].filter(Boolean);
  Object.assign(job, {
    startAt: start || job.startAt,
    postedAt: start || job.postedAt,
    deadline: deadline || job.deadline,
    deadlineText: deadlineText || job.deadlineText,
    employmentType: 고용형태 || job.employmentType,
    salary: 급여 || job.salary,
    experience,
    education,
    summary: summaryParts.length ? summaryParts.join('\n') : job.summary || excerpt(og),
    qualifications: [experience && `경력: ${experience}`, education && `학력: ${education}`].filter(Boolean).join('\n'),
    needsDetail: false,
  });
  return job;
}
