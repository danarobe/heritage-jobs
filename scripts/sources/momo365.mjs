// 모모365(문화사업지원플랫폼) 채용공고 게시판 — 문화예술·문화재단 쪽 공고가 많음
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, textWithBreaks, extractPeriod, extractQualifications, excerpt } from '../lib.mjs';
import { classify } from './khs.mjs';

export const name = '모모365';
export const key = 'momo365';
const BASE = 'https://www.momo365.net';

export async function crawl({ log, limit = 100 }) {
  const out = new Map();
  const html = await fetchText(`${BASE}/Recruit?ViewType=list&lstNum=${limit}`);
  const $ = cheerio.load(html);
  $('table.qx_bid_info_content tr').each((_, tr) => {
    const a = $(tr).find('a[href*="ViewType=view&seq="]').first();
    const m = (a.attr('href') || '').match(/seq=(\d+)/);
    if (!m) return;
    const id = m[1];
    if (out.has(id)) return;
    const tds = $(tr).find('td');
    const title = oneLine(a.text());
    const company = oneLine($(tds[3]).text());
    const employmentType = oneLine($(tds[4]).text());
    const region = oneLine($(tds[5]).text());
    const start = parseDate(oneLine($(tds[6]).text()));
    const deadline = parseDate(oneLine($(tds[7]).text()));
    out.set(id, {
      id: `momo365:${id}`,
      source: key,
      sourceName: name,
      url: `${BASE}/Recruit?ViewType=view&seq=${id}`,
      title,
      company,
      region,
      experience: '',
      education: '',
      employmentType,
      salary: '',
      sector: '',
      postedAt: start,
      startAt: start,
      deadline,
      deadlineText: '',
      summary: [company, region, employmentType].filter(Boolean).join(' · '),
      qualifications: '',
      kind: classify(title),
      official: false,
      needsDetail: true,
    });
  });
  log(`모모365: ${out.size}건`);
  await sleep(500);
  return [...out.values()];
}

export async function enrich(job) {
  const html = await fetchText(job.url);
  const $ = cheerio.load(html);
  const applyUrl = $('.detail_view_table a.goToLinkBtn').attr('href') || '';
  const files = $('#view_files a')
    .map((_, a) => ({ name: oneLine($(a).text()).replace(/^\d{14}_/, ''), url: job.url }))
    .get()
    .filter((f) => f.name);
  const body = textWithBreaks($, $('.detail_view_bid_text').first()).replace(/☞ 자사 채용페이지 바로가기/g, '').trim();
  const period = extractPeriod(body);
  Object.assign(job, {
    applyUrl,
    attachments: files,
    summary: body.length > 40 ? excerpt(body, 320) : job.summary,
    qualifications: extractQualifications(body),
    startAt: job.startAt || period?.start || null,
    deadline: job.deadline || period?.end || null,
    needsDetail: false,
  });
  return job;
}
