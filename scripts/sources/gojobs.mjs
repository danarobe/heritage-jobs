// 나라일터(인사혁신처) 채용공고 검색 — 지자체·공공기관 문화재단 공고가 많이 올라옴
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, textWithBreaks, extractQualifications, excerpt } from '../lib.mjs';
import { classify } from './khs.mjs';

export const name = '나라일터';
export const key = 'gojobs';
const BASE = 'https://www.gojobs.go.kr';

export async function crawl({ keywords, log }) {
  const out = new Map();
  for (const kw of keywords) {
    const body = new URLSearchParams({ searchKeyword: kw, menuNo: '401' }).toString();
    const html = await fetchText(`${BASE}/apmList.do`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const $ = cheerio.load(html);
    let n = 0;
    $('table tbody tr').each((_, tr) => {
      const a = $(tr).find('a[href*="fn_apmView"]').first();
      const m = (a.attr('href') || '').match(/fn_apmView\('(\w+)',\s*'(\d+)'\)/);
      if (!m) return;
      const id = m[2];
      if (out.has(id)) return;
      const tds = $(tr).find('td');
      const title = oneLine(a.text());
      const company = oneLine($(tds[2]).text());
      const posted = parseDate(oneLine($(tds[3]).text()));
      const deadline = parseDate(oneLine($(tds[4]).text()));
      n++;
      out.set(id, {
        id: `gojobs:${id}`,
        source: key,
        sourceName: name,
        url: `${BASE}/apmView.do?empmnsn=${id}`,
        title,
        company,
        region: '',
        experience: '',
        education: '',
        employmentType: (title.match(/(정규직|공무직|기간제|임기제|무기계약|계약직|청년인턴|시간선택제|학예연구사|학예사)/) || [''])[0],
        salary: '',
        sector: '',
        postedAt: posted,
        startAt: posted,
        deadline,
        deadlineText: '',
        summary: '',
        qualifications: '',
        kind: classify(title),
        official: true,
        foundBy: kw,
        needsDetail: true,
      });
    });
    log(`나라일터 "${kw}": ${n}건`);
    await sleep(700);
  }
  return [...out.values()];
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const field = (label) => {
    const th = $('th, dt, .tit, strong')
      .filter((_, el) => oneLine($(el).text()) === label)
      .first();
    if (!th.length) return '';
    const sib = th.next();
    return textWithBreaks($, sib);
  };
  const start = parseDate(field('접수시작일'));
  const end = parseDate(field('접수마감일'));
  const grade = oneLine(field('채용직급'));
  const region = oneLine(field('근무지역'));
  // 본문은 숨겨진 textarea#content 안에 들어 있음
  const bodyText = textWithBreaks($, $('textarea#content').first());
  const files = $('p.download a')
    .map((_, a) => ({ name: oneLine($(a).text()), url: job.url }))
    .get()
    .filter((f) => f.name);
  const summary = [grade && `채용직급: ${grade}`, region && `근무지역: ${region}`, bodyText && excerpt(bodyText, 240)]
    .filter(Boolean)
    .join('\n');
  Object.assign(job, {
    startAt: start || job.startAt,
    deadline: end || job.deadline,
    region: region || job.region,
    summary: summary || job.summary,
    qualifications: extractQualifications(bodyText),
    attachments: files,
    needsDetail: false,
  });
  return job;
}
