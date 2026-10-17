// 국가유산청 시험/채용 게시판 (소속기관·연구소 공고까지 포함)
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, textWithBreaks, extractPeriod, extractQualifications, excerpt } from '../lib.mjs';

export const name = '국가유산청';
export const key = 'khs';
const BASE = 'https://www.khs.go.kr';

export function classify(title) {
  return /(합격자|결과\s*(발표|공고|안내)|면접\s*(시험\s*)?일정|전형\s*결과|최종\s*합격|정정\s*공고|취소\s*공고|재공고\s*안내)/.test(title)
    ? 'result'
    : 'job';
}

export async function crawl({ log, pages = 3 }) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const url = `${BASE}/multiBbz/selectMultiBbzList.do?bbzId=newexam&mn=NS_01_06&pageIndex=${page}&pageUnit=10`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const rows = $('table tbody tr');
    rows.each((_, tr) => {
      const a = $(tr).find('td[data-column="제목"] a').first();
      let href = a.attr('href') || '';
      if (!href) return;
      href = href.replace(/;jsessionid=[^?]*/, '');
      const m = href.match(/[?&]no=(\d+)/);
      const no = m ? m[1] : null;
      if (!no) return;
      const title = oneLine(a.attr('title') || a.text());
      const posted = parseDate($(tr).find('td[data-column="등록일"]').text());
      const deadline = parseDate($(tr).find('td[data-column="마감일"]').text());
      const author = oneLine($(tr).find('td[data-column="작성자"]').text());
      // 제목 앞쪽의 기관명 추출 (예: "국립경주문화유산연구소 기간제근로자 ...")
      const cm = title.match(/^((?:국립|국가|궁능|한국|문화유산|무형)[^\s(]*)/);
      out.push({
        id: `khs:${no}`,
        source: key,
        sourceName: name,
        url: `${BASE}${href}`,
        title,
        company: cm ? cm[1] : '국가유산청',
        region: '',
        experience: '',
        education: '',
        employmentType: (title.match(/(공무직|기간제|임기제|무기계약|계약직|청년인턴|연구원)/) || [''])[0],
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
        author,
        needsDetail: true,
      });
    });
    log(`국가유산청 ${page}페이지: ${rows.length}건`);
    await sleep(700);
  }
  return out;
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const body = textWithBreaks($, $('.board-view-content').first());
  const files = $('.board-view-info a[href*="FileDown"]')
    .map((_, a) => ({ name: oneLine($(a).text()).replace(/^(다운로드|미리보기)\s*/, '').replace(/\s*파일 (다운로드|새 창 미리보기)$/, ''), url: BASE + $(a).attr('href') }))
    .get()
    .filter((f, i, arr) => f.name && arr.findIndex((x) => x.name === f.name) === i);
  const period = extractPeriod(body);
  Object.assign(job, {
    summary: excerpt(body, 320),
    qualifications: extractQualifications(body),
    attachments: files,
    startAt: period?.start || job.startAt,
    deadline: job.deadline || period?.end || null,
    needsDetail: false,
  });
  return job;
}
