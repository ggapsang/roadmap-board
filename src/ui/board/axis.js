/**
 * 시간축 — 주 단위 행선, 월 밴드, 오늘 기준선.
 * 세로축 1주 = 1행. 월 경계는 굵은 실선 (기획안 §4).
 */
import { DAY, dateAt, formatDate, shortMD, today } from '../../core/dates.js';
import { el, clear } from '../dom.js';

/**
 * @param {object} ctx {lines, gutM, gutW, grid, origin, totalDays, ppd}
 */
export function renderAxis({ lines, gutM, gutW, grid, origin, endDate, totalDays, ppd }) {
  grid.style.height = totalDays * ppd + 'px';
  clear(lines); clear(gutM); clear(gutW);

  // 주 행선 + 주 시작일 라벨
  for (let i = 0; i < totalDays; i += 7) {
    const date = new Date(origin.getTime() + i * DAY);
    const isMonthHead = date.getDate() <= 7;
    lines.append(el('i', { className: isMonthHead ? 'm' : '', style: { top: i * ppd + 'px' } }));
    gutW.append(el('s', { text: shortMD(formatDate(date)), style: { top: i * ppd + 'px' } }));
  }

  // 월 밴드
  let month = new Date(origin.getFullYear(), origin.getMonth(), 1);
  while (month < endDate) {
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const from = Math.max(0, Math.round((month - origin) / DAY));
    const to = Math.min(totalDays, Math.round((next - origin) / DAY));
    if (to > from) {
      gutM.append(el('b', {
        style: { top: from * ppd + 'px', height: (to - from) * ppd + 'px' },
        html: `<u>${month.getMonth() + 1}월<em>${month.getFullYear()}</em></u>`,
      }));
    }
    month = next;
  }
}

/** 오늘 기준선. 범위 밖이면 null. */
export function makeTodayLine(origin, totalDays, ppd) {
  const t = today();
  const i = Math.round((t - origin) / DAY);
  if (i < 0 || i > totalDays) return null;
  return el('div.now', {
    style: { top: i * ppd + 'px' },
    html: `<span>오늘 ${shortMD(formatDate(t))}</span>`,
  });
}
