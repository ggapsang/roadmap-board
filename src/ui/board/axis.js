/**
 * 시간축 — 주 단위 행선, 왼쪽 구간 칸, 오늘 기준선.
 * 세로축 1주 = 1행. 월 경계는 굵은 실선 (기획안 §4).
 *
 * 왼쪽 칸은 기본적으로 월 단위지만, 사용자가 여러 달을 끌어 하나로 묶을 수 있다
 * (doc.bands). 2027년 1~3월을 "1Q"로 보는 식이다. 묶인 구간은 월 칸을 대체한다.
 */
import { DAY, dateAt, formatDate, shortMD, today, parseDate, dayIndex } from '../../core/dates.js';
import { el, clear } from '../dom.js';

/**
 * 왼쪽 칸에 들어갈 구간 목록을 만든다.
 * 사용자가 묶은 구간을 먼저 배치하고, 남는 기간은 월 단위로 채운다.
 * @returns {{from:number, to:number, label:string, sub:string, bandId:string|null}[]}
 */
export function buildBands(origin, endDate, totalDays, userBands = []) {
  const covered = [];
  const out = [];

  for (const band of userBands) {
    const from = Math.max(0, dayIndex(band.from, origin));
    const to = Math.min(totalDays, dayIndex(band.to, origin) + 1);
    if (to <= from) continue;
    out.push({ from, to, label: band.label || '구간', sub: '', bandId: band.id });
    covered.push([from, to]);
  }

  const overlaps = (a, b) => covered.some(([s, e]) => a < e && b > s);

  let month = new Date(origin.getFullYear(), origin.getMonth(), 1);
  while (month < endDate) {
    const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const from = Math.max(0, Math.round((month - origin) / DAY));
    const to = Math.min(totalDays, Math.round((next - origin) / DAY));
    if (to > from && !overlaps(from, to)) {
      out.push({
        from, to,
        label: `${month.getMonth() + 1}월`,
        sub: String(month.getFullYear()),
        bandId: null,
      });
    }
    month = next;
  }

  return out.sort((a, b) => a.from - b.from);
}

/**
 * @param {object} ctx {lines, gutM, gutW, grid, origin, endDate, totalDays, ppd, bands}
 */
export function renderAxis({ lines, gutM, gutW, grid, origin, endDate, totalDays, ppd, bands = [], scale }) {
  grid.style.height = scale.height + 'px';
  clear(lines); clear(gutM); clear(gutW);

  // 주 행선 + 주 시작일 라벨. 접힌 구간에서는 줄이 촘촘해지므로 라벨을 솎아낸다.
  let lastLabelY = -Infinity;
  for (let i = 0; i < totalDays; i += 7) {
    const date = new Date(origin.getTime() + i * DAY);
    const y = scale.y(i);
    const isMonthHead = date.getDate() <= 7;
    lines.append(el('i', { className: isMonthHead ? 'm' : '', style: { top: y + 'px' } }));
    if (y - lastLabelY >= 14) {
      gutW.append(el('s', { text: shortMD(formatDate(date)), style: { top: y + 'px' } }));
      lastLabelY = y;
    }
  }

  // 왼쪽 구간 칸
  for (const band of buildBands(origin, endDate, totalDays, bands)) {
    const top = scale.y(band.from);
    const cell = el('b', {
      style: { top: top + 'px', height: (scale.y(band.to) - top) + 'px' },
      dataset: { from: String(band.from), to: String(band.to), band: band.bandId ?? '' },
      className: band.bandId ? 'merged' : '',
      title: band.bandId
        ? '아래 가장자리를 끌면 높이를 줄입니다 · 더블클릭 이름 변경 · 우클릭 해제'
        : '아래 가장자리를 끌면 이 달의 높이를 조절합니다 · 끌어서 여러 달을 묶기',
    }, [
      el('u', {}, [
        document.createTextNode(band.label),
        band.sub ? el('em', { text: band.sub }) : null,
      ]),
      // 아래 가장자리 손잡이 — 묶은 구간이든 낱개 월이든 세로 높이를 조절한다
      el('div.band-resize', { title: '끌어서 높이 조절 · 더블클릭하면 원래대로' }),
    ]);
    gutM.append(cell);
  }
}

/** 오늘 기준선. 범위 밖이면 null. */
export function makeTodayLine(origin, totalDays, scale) {
  const t = today();
  const i = Math.round((t - origin) / DAY);
  if (i < 0 || i > totalDays) return null;
  return el('div.now', {
    style: { top: scale.y(i) + 'px' },
    html: `<span>오늘 ${shortMD(formatDate(t))}</span>`,
  });
}
