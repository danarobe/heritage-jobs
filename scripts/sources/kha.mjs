// 국가유산진흥원 인재채용 게시판
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, decodeEntities, textWithBreaks, extractPeriod, extractQualifications, excerpt } from '../lib.mjs';
import { classify } from './khs.mjs';

export const name = '국가유산진흥원';
export const key = 'kha';
const BASE = 'https://www.kh.or.kr';
const LIST = `${BASE}/brd/board/721/L/CATEGORY/719/menu/377?brdCodeField=CATEGORY&brdCodeValue=719`;

export async function crawl({ log, pages = 2 }) {
  const out = new Map();
  for (let page = 1; page <= pages; page++) {
    const html = await fetchText(`${LIST}&thisPage=${page}`);
    const $ = cheerio.load(html);
    let n = 0;
    $('table tbody tr').each((_, tr) => {
      const a = $(tr).find('td.tit a').first();
      const href = decodeEntities(a.attr('href') || '');
      const m = href.match(/bbIdx=(\d+)/);
      if (!m) return;
      const id = m[1];
      if (out.has(id)) return;
      const title = oneLine(a.attr('title') || a.text());
      const posted = parseDate($(tr).find('td.date').text());
      n++;
      out.set(id, {
        id: `kha:${id}`,
        source: key,
        sourceName: name,
        url: `${BASE}/brd/board/721/L/CATEGORY/719/menu/377?brdType=R&bbIdx=${id}`,
        title,
        company: '국가유산진흥원',
        region: '',
        experience: '',
        education: '',
        employmentType: (title.match(/(정규직|공무직|기간제|임기제|무기계약|계약직|청년인턴|실무직)/) || [''])[0],
        salary: '',
        sector: '',
        postedAt: posted,
        startAt: posted,
        deadline: null,
        deadlineText: '',
        summary: '',
        qualifications: '',
        kind: classify(title),
        official: true,
        needsDetail: true,
      });
    });
    log(`국가유산진흥원 ${page}페이지: ${n}건`);
    if (n === 0) break;
    await sleep(700);
  }
  return [...out.values()];
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const body = textWithBreaks($, $('.view_con').first());
  const links = $('.view_con a[href^="http"]')
    .map((_, a) => $(a).attr('href'))
    .get();
  const files = $('.board_view a')
    .map((_, a) => oneLine($(a).text()))
    .get()
    .filter((t) => /\.(hwp|pdf|hwpx|docx?|xlsx?|zip)$/i.test(t))
    .map((t) => ({ name: t, url: job.url }));
  const period = extractPeriod(body);
  Object.assign(job, {
    summary: excerpt(body, 320),
    qualifications: extractQualifications(body),
    attachments: files,
    applyUrl: links.find((l) => /careerlink|recruit|apply|채용/.test(l)) || '',
    startAt: period?.start || job.startAt,
    deadline: period?.end || job.deadline,
    needsDetail: false,
  });
  return job;
}
