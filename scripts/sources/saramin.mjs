// 사람인 검색 결과 수집
import * as cheerio from 'cheerio';
import { fetchText, sleep, parseDate, oneLine, decodeEntities } from '../lib.mjs';

export const name = '사람인';
export const key = 'saramin';

export async function crawl({ keywords, log }) {
  const out = new Map();
  for (const kw of keywords) {
    for (let page = 1; page <= 3; page++) {
      const url =
        `https://www.saramin.co.kr/zf_user/search/recruit?searchType=search&searchword=${encodeURIComponent(kw)}` +
        `&recruitPage=${page}&recruitSort=reg_dt&recruitPageCount=40`;
      const html = await fetchText(url);
      const $ = cheerio.load(html);
      const items = $('.item_recruit');
      items.each((_, el) => {
        const $el = $(el);
        const id = $el.attr('value');
        if (!id) return;
        const a = $el.find('.job_tit a').first();
        const title = oneLine(decodeEntities(a.attr('title') || a.text()));
        const company = oneLine($el.find('.corp_name').first().text());
        const dateText = oneLine($el.find('.job_date .date').first().text());
        const cond = $el
          .find('.job_condition span')
          .map((_, s) => oneLine($(s).text()))
          .get()
          .filter(Boolean);
        const sector = $el
          .find('.job_sector a')
          .map((_, s) => oneLine($(s).text()))
          .get()
          .filter(Boolean);
        const dayText = oneLine($el.find('.job_sector .job_day').first().text()); // 등록일 26/10/16
        const posted = parseDate(dayText.replace(/^(등록일|수정일)/, ''));
        let deadline = null;
        let deadlineText = '';
        if (/상시|채용시|수시/.test(dateText)) deadlineText = dateText.replace(/^~\s*/, '');
        else deadline = parseDate(dateText);
        const [region, experience, education, employmentType, salary] = [
          cond[0] || '',
          cond.find((c) => /경력|신입/.test(c)) || '',
          cond.find((c) => /졸|학력/.test(c)) || '',
          cond.find((c) => /정규직|계약직|인턴|파견|프리랜서|위촉|아르바이트|공무직/.test(c)) || '',
          cond.find((c) => /만원|원|연봉|월급|시급/.test(c) && /\d/.test(c)) || '',
        ];
        const summary = [region, employmentType, experience, education, salary].filter(Boolean).join(' · ');
        out.set(id, {
          id: `saramin:${id}`,
          source: key,
          sourceName: name,
          url: `https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=${id}`,
          title,
          company,
          region,
          experience,
          education,
          employmentType,
          salary,
          sector: sector.join(', '),
          postedAt: posted,
          startAt: posted,
          deadline,
          deadlineText,
          summary,
          qualifications: [experience && `경력: ${experience}`, education && `학력: ${education}`].filter(Boolean).join('\n'),
          kind: 'job',
          official: false,
          foundBy: kw,
        });
      });
      log(`사람인 "${kw}" ${page}페이지: ${items.length}건`);
      if (items.length < 40) break;
      await sleep(800);
    }
    await sleep(800);
  }
  return [...out.values()];
}
