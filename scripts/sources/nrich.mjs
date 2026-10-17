// 국립문화유산연구원 채용정보 게시판
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, textWithBreaks, extractPeriod, extractQualifications, excerpt } from '../lib.mjs';
import { classify } from './khs.mjs';

export const name = '국립문화유산연구원';
export const key = 'nrich';
const BASE = 'https://www.nrich.go.kr';

export async function crawl({ log, pages = 2 }) {
  const out = new Map();
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE}/kor/boardList.do?menuIdx=285&bbscd=40&pageIndex=${page}`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    let n = 0;
    $('ul.list-body > li').each((_, li) => {
      const a = $(li).find('.col2 a.cont-link').first();
      const href = a.attr('href') || '';
      const m = href.match(/bbs_idx=(\d+)/);
      if (!m) return;
      const id = m[1];
      if (out.has(id)) return;
      const title = oneLine(a.text());
      const dept = oneLine($(li).find('.col3 .cont-txt').text());
      const posted = parseDate($(li).find('.col5 .cont-txt').text());
      n++;
      const cm = title.match(/^((?:국립|문화유산)[^\s(]*)/);
      out.set(id, {
        id: `nrich:${id}`,
        source: key,
        sourceName: name,
        url: `${BASE}/kor/boardView.do?menuIdx=285&bbscd=40&bbs_idx=${id}`,
        title,
        company: cm ? cm[1] : '국립문화유산연구원',
        region: '',
        experience: '',
        education: '',
        employmentType: (title.match(/(공무직|기간제|임기제|무기계약|계약직|청년인턴|연구원)/) || [''])[0],
        salary: '',
        sector: dept,
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
    log(`국립문화유산연구원 ${page}페이지: ${n}건`);
    if (n === 0) break;
    await sleep(700);
  }
  return [...out.values()];
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const body = textWithBreaks($, $('.view-content').first());
  const files = $('.board-file a, .file-container a')
    .map((_, a) => ({ name: oneLine($(a).text()), url: new URL($(a).attr('href') || '', job.url).href }))
    .get()
    .filter((f) => /\.(hwp|pdf|hwpx|docx?|xlsx?|zip)/i.test(f.name));
  const period = extractPeriod(body);
  Object.assign(job, {
    summary: excerpt(body, 320),
    qualifications: extractQualifications(body),
    attachments: files,
    startAt: period?.start || job.startAt,
    deadline: period?.end || job.deadline,
    needsDetail: false,
  });
  return job;
}
