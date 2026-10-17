// 잡알리오(공공기관 채용정보시스템) 제목 검색
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, textWithBreaks, excerpt } from '../lib.mjs';
import { classify } from './khs.mjs';

export const name = '잡알리오';
export const key = 'alio';
const BASE = 'https://job.alio.go.kr';

export async function crawl({ keywords, log }) {
  const out = new Map();
  for (const kw of keywords) {
    const url = `${BASE}/recruit.do?pageNo=1&keyword=${encodeURIComponent(kw)}&search_type=title&pageSet=50`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    let n = 0;
    $('table.tbl.type_03 tbody tr').each((_, tr) => {
      const tds = $(tr).find('td');
      const a = $(tr).find('a[href*="recruitview.do?idx="]').first();
      const m = (a.attr('href') || '').match(/idx=(\d+)/);
      if (!m) return;
      const id = m[1];
      const title = oneLine(a.text());
      const company = oneLine($(tds[3]).text());
      const region = oneLine($(tds[4]).text());
      const employmentType = oneLine($(tds[5]).text());
      const posted = parseDate(oneLine($(tds[6]).text()));
      const deadlineCell = ($(tds[7]).html() || '').split(/<br\s*\/?>/i)[0];
      const deadline = parseDate(oneLine(deadlineCell.replace(/<[^>]+>/g, ' ')));
      const status = oneLine($(tds[8]).text());
      n++;
      out.set(id, {
        id: `alio:${id}`,
        source: key,
        sourceName: name,
        url: `${BASE}/recruitview.do?idx=${id}`,
        title,
        company,
        region,
        experience: '',
        education: '',
        employmentType,
        salary: '',
        sector: '',
        postedAt: posted,
        startAt: posted,
        deadline,
        deadlineText: '',
        summary: [company, region, employmentType, status].filter(Boolean).join(' · '),
        qualifications: '',
        kind: classify(title),
        official: true,
        foundBy: kw,
        needsDetail: true,
      });
    });
    log(`잡알리오 "${kw}": ${n}건`);
    await sleep(700);
  }
  return [...out.values()];
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const field = (label) => {
    const th = $('th')
      .filter((_, el) => oneLine($(el).text()) === label)
      .first();
    if (!th.length) return '';
    return textWithBreaks($, th.next('td'));
  };
  const 채용기간 = oneLine(field('채용기간'));
  const dates = 채용기간.split(/[~∼]/).map((s) => parseDate(s.trim()));
  const 근무지 = oneLine(field('근무지'));
  const 고용형태 = oneLine(field('고용형태'));
  const 채용구분 = oneLine(field('채용구분'));
  const 채용인원 = oneLine(field('채용인원'));
  const 학력 = oneLine(field('학력정보'));
  const 근무분야 = oneLine(field('근무분야'));
  const 응시자격 = field('응시자격');
  const 우대 = field('우대내용') || oneLine(field('우대조건'));
  const summary = [
    채용구분 && `채용구분: ${채용구분}`,
    고용형태 && `고용형태: ${고용형태}`,
    채용인원 && `채용인원: ${채용인원}`,
    근무지 && `근무지: ${근무지}`,
    근무분야 && `근무분야: ${excerpt(근무분야, 80)}`,
    학력 && `학력: ${학력}`,
  ].filter(Boolean);
  const quals = [응시자격 && excerpt(응시자격, 700), 우대 && `우대: ${excerpt(우대, 200)}`].filter(Boolean).join('\n');
  Object.assign(job, {
    startAt: dates[0] || job.startAt,
    deadline: dates[1] || job.deadline,
    region: 근무지 || job.region,
    employmentType: 고용형태 || job.employmentType,
    education: 학력,
    sector: 근무분야,
    summary: summary.length ? summary.join('\n') : job.summary,
    qualifications: quals,
    needsDetail: false,
  });
  return job;
}
