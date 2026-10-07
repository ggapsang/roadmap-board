/**
 * 시간축 — 안쪽 칸 행선, 왼쪽 바깥 칸(구간), 오늘 기준선. 눈금 모드마다 다르다 (docs/SCALE.md §3).
 *
 *   모드        안쪽 칸(행선·오른쪽 라벨)   바깥 칸(왼쪽 칸)
 *   주-일       일                          주
 *   월-주       주                          월
 *   분기-월     월                          분기
 *   눈금 없음   칸 번호                     없음
 *
 * 바깥 칸은 사용자가 끌어 여러 개를 하나로 묶을 수 있다(doc.bands, 모드마다 따로). 2027년 1~3월을
 * "1Q"로 보는 식이다. 묶인 구간은 바깥 칸을 대체한다.
 */
import { DAY, formatDate, shortMD, today, dayIndex } from '../../core/dates.js';
import { unitStart, addUnits } from '../../core/timeline.js';
import { el, clear } from '../dom.js';

const WEEKDAY = '일월화수목금토';

/** 바깥 칸 하나의 이름 — 주: '10월 2주', 월: '10월', 분기: '4분기'. 아래 작은 글씨는 연도. */
export function outerLabel(date, unit) {
  if (unit === 'week') return `${date.getMonth() + 1}월 ${Math.ceil(date.getDate() / 7)}주`;
  if (unit === 'quarter') return `${Math.floor(date.getMonth() / 3) + 1}분기`;
  return `${date.getMonth() + 1}월`;
}

/**
 * 왼쪽 칸에 들어갈 구간 목록을 만든다.
 * 사용자가 묶은 구간을 먼저 배치하고, 남는 기간은 바깥 칸 단위로 채운다.
 * @param {'week'|'month'|'quarter'} outer
 * @returns {{from:number, to:number, label:string, sub:string, bandId:string|null}[]}
 */
export function buildBands(origin, endDate, totalDays, userBands = [], outer = 'month') {
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

  let cell = unitStart(origin, outer);
  while (cell < endDate) {
    const next = addUnits(cell, outer, 1);
    const from = Math.max(0, Math.round((cell - origin) / DAY));
    const to = Math.min(totalDays, Math.round((next - origin) / DAY));
    if (to > from && !overlaps(from, to)) {
      out.push({ from, to, label: outerLabel(cell, outer), sub: String(cell.getFullYear()), bandId: null });
    }
    cell = next;
  }

  return out.sort((a, b) => a.from - b.from);
}

/**
 * @param {object} ctx {lines, gutM, gutW, grid, origin, endDate, totalDays, bands, scale, timeline}
 */
export function renderAxis({ lines, gutM, gutW, grid, origin, endDate, totalDays, bands = [], scale, timeline }) {
  grid.style.height = scale.height + 'px';
  clear(lines); clear(gutM); clear(gutW);

  // 라벨이 겹치지 않게 솎아낸다 — 접힌 구간·작은 배율에서는 줄이 촘촘하다
  let lastLabelY = -Infinity;
  const line = (y, strong, text) => {
    lines.append(el('i', { className: strong ? 'm' : '', style: { top: y + 'px' } }));
    gutW.append(el('i', { className: strong ? 'm' : '', style: { top: y + 'px' } }));   // 날짜 칸 안의 행선(가로로 넘겨도 제자리)
    if (text != null && y - lastLabelY >= 14) {
      gutW.append(el('s', { text, style: { top: y + 'px' } }));
      lastLabelY = y;
    }
  };

  // ── 날짜 없는 보드 — 바깥 칸이 없다. 왼쪽 칸에 칸 번호를 칸마다 두고, 아래 가장자리를 끌면 그 칸의 높이가 바뀐다
  //    (달력 보드의 월 칸과 같은 손잡이 — bands.js). 묶기는 없다.
  if (!timeline.dated) {
    for (let p = 0; p < totalDays; p += 1) {
      line(scale.y(p), false, null);
      const top = scale.y(p);
      const changed = scale.rows?.[p] != null;
      gutM.append(el('b', {
        className: changed ? 'slot sized' : 'slot',
        style: { top: top + 'px', height: (scale.y(p + 1) - top) + 'px' },
        dataset: { from: String(p), to: String(p + 1), slot: String(p), label: String(p + 1) },
        title: '아래 가장자리를 끌면 이 칸의 높이를 조절합니다 · 더블클릭하면 원래대로',
      }, [
        el('u', { text: String(p + 1) }),
        el('div.band-resize', { title: `${p + 1}번 칸 높이 — 끌어서 조절 · 더블클릭하면 원래대로` }),
      ]));
    }
    return;
  }

  const mode = timeline.mode;

  // ── 날짜 있는 보드의 눈금 없음 — 한 칸 = 전환 전 안쪽 단위. 날짜 대신 칸 번호.
  if (mode.key === 'none') {
    const unit = timeline.slotUnit;
    for (let d = unitStart(origin, unit); ; d = addUnits(d, unit, 1)) {
      const p = Math.round((d - origin) / DAY);
      if (p >= totalDays) break;
      if (p >= 0) line(scale.y(p), false, String(timeline.slotNo(p)));
    }
    return;
  }

  // ── 안쪽 칸 행선 + 라벨. 바깥 칸 경계는 굵게.
  if (mode.inner === 'week') {
    // 월-주 — 보드 시작일부터 7일 간격(예전 그대로). 그 달의 첫 주가 굵다.
    for (let i = 0; i < totalDays; i += 7) {
      const date = new Date(origin.getTime() + i * DAY);
      line(scale.y(i), date.getDate() <= 7, shortMD(formatDate(date)));
    }
  } else {
    const inner = mode.inner;           // 'day' | 'month'
    for (let d = unitStart(origin, inner); ; d = addUnits(d, inner, 1)) {
      const p = Math.round((d - origin) / DAY);
      if (p >= totalDays) break;
      if (p < 0) continue;
      const strong = unitStart(d, mode.outer).getTime() === d.getTime();
      const text = inner === 'day'
        ? `${(d.getDay() === 1 || d.getDate() === 1) ? shortMD(formatDate(d)) : d.getDate()} ${WEEKDAY[d.getDay()]}`
        : `${d.getMonth() + 1}월`;
      line(scale.y(p), strong, text);
    }
  }

  // ── 왼쪽 바깥 칸
  const unitName = { week: '주', month: '달', quarter: '분기' }[mode.outer];
  const unitObj = { week: '주를', month: '달을', quarter: '분기를' }[mode.outer];
  for (const band of buildBands(origin, endDate, totalDays, bands, mode.outer)) {
    const top = scale.y(band.from);
    const cell = el('b', {
      style: { top: top + 'px', height: (scale.y(band.to) - top) + 'px' },
      dataset: { from: String(band.from), to: String(band.to), band: band.bandId ?? '', label: band.label },
      className: band.bandId ? 'merged' : '',
      title: band.bandId
        ? '아래 가장자리를 끌면 높이를 줄입니다 · 더블클릭 이름 변경 · 우클릭 해제'
        : `아래 가장자리를 끌면 이 ${unitName}의 높이를 조절합니다 · 끌어서 여러 ${unitObj} 묶기`,
    }, [
      el('u', {}, [
        document.createTextNode(band.label),
        band.sub ? el('em', { text: band.sub }) : null,
      ]),
      // 아래 가장자리 손잡이 — 묶은 구간이든 낱개 칸이든 세로 높이를 조절한다
      el('div.band-resize', { title: `${band.label} 높이 — 끌어서 조절 · 더블클릭하면 원래대로` }),
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
