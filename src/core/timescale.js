/**
 * 세로 스케일 — 위치 인덱스 ↔ 세로 픽셀 (docs/SCALE.md §5).
 *   TimeScale  날짜 있는 보드. 위치 = 일 인덱스. 일당 픽셀(ppd)은 눈금 모드가 정한다.
 *   SlotScale  날짜 없는 보드. 위치 = 칸 인덱스. 한 칸 = 한 행.
 * 둘은 y/dayHeight/dayAt/topOf/heightOf/height/ppd 인터페이스를 공유한다 — 카드·드래그는 이것만 쓴다.
 * 위치를 어디서 읽는지(날짜냐 칸이냐)는 timeline(core/timeline.js)이 안다.
 *
 * 시간축 눈금 — 일 인덱스 ↔ 세로 픽셀.
 *
 * 기본은 "1일 = ppd 픽셀"로 균일하지만, 사용자가 묶은 구간(band)은 배율(scale)을
 * 따로 가질 수 있다. 2027년 1~3월을 "1Q"로 묶고 40%로 접으면, 그 구간 안의
 * 일정과 격자도 같은 비율로 눌려야 한다. 그러지 않으면 묶는 의미가 없다.
 *
 * 순수 계산이다. DOM을 모른다.
 */
import { dayIndex } from './dates.js';

export class TimeScale {
  /**
   * @param {Date} origin 보드 시작일
   * @param {number} totalDays
   * @param {number} ppd 기본 일당 픽셀
   * @param {{from:string,to:string,scale:number}[]} bands  이 모드의 구간만
   * @param {object} [timeline] 위치 읽기(DateTimeline). 없으면 날짜로 읽는다.
   */
  constructor(origin, totalDays, ppd, bands = [], timeline = null) {
    this.origin = origin;
    this.totalDays = totalDays;
    this.ppd = ppd;
    this.timeline = timeline;

    // 구간을 일 인덱스 범위로 바꾸고 겹치지 않게 정렬한다
    this.segments = [];
    const scaled = bands
      .map((b) => ({
        from: Math.max(0, dayIndex(b.from, origin)),
        to: Math.min(totalDays, dayIndex(b.to, origin) + 1),
        scale: b.scale ?? 1,
      }))
      .filter((b) => b.to > b.from && b.scale !== 1)
      .sort((a, b) => a.from - b.from);

    let cursor = 0;
    let y = 0;
    for (const band of scaled) {
      if (band.from > cursor) {
        this.segments.push({ from: cursor, to: band.from, scale: 1, y });
        y += (band.from - cursor) * ppd;
      }
      const start = Math.max(cursor, band.from);
      if (band.to > start) {
        this.segments.push({ from: start, to: band.to, scale: band.scale, y });
        y += (band.to - start) * ppd * band.scale;
        cursor = band.to;
      }
    }
    if (cursor < totalDays) {
      this.segments.push({ from: cursor, to: totalDays, scale: 1, y });
      y += (totalDays - cursor) * ppd;
    }
    this.height = y;
  }

  /** 일 인덱스 → 픽셀 */
  y(day) {
    const d = Math.max(0, Math.min(this.totalDays, day));
    for (const seg of this.segments) {
      if (d < seg.to || seg.to === this.totalDays) {
        return seg.y + Math.max(0, d - seg.from) * this.ppd * seg.scale;
      }
    }
    return this.height;
  }

  /** 'YYYY-MM-DD' → 픽셀 */
  yOf(iso) { return this.y(dayIndex(iso, this.origin)); }

  // ── 스케일 인터페이스 (달력이든 칸이든 카드는 이것만 쓴다) ──
  #pos(item) {
    return this.timeline?.pos(item)
      ?? { s: dayIndex(item.s, this.origin), e: dayIndex(item.e || item.s, this.origin) };
  }
  /** 이벤트의 top(px) — 시작 위치 */
  topOf(item) { return this.y(this.#pos(item).s); }
  /** 이벤트의 높이(px) — 기간(끝 포함) */
  heightOf(item) {
    const p = this.#pos(item);
    return Math.max(0, this.y(p.e) + this.dayHeight(p.e) - this.y(p.s));
  }

  /** 두 날짜 사이의 픽셀 높이 (종료일 inclusive) */
  span(fromIso, toIso) {
    return Math.max(0, this.yOf(toIso) + this.dayHeight(dayIndex(toIso, this.origin)) - this.yOf(fromIso));
  }

  /** 그 날 하루가 차지하는 픽셀 */
  dayHeight(day) {
    for (const seg of this.segments) {
      if (day >= seg.from && day < seg.to) return this.ppd * seg.scale;
    }
    return this.ppd;
  }

  /** 픽셀 → 일 인덱스 (드래그 판정용) */
  dayAt(py) {
    for (const seg of this.segments) {
      const segHeight = (seg.to - seg.from) * this.ppd * seg.scale;
      if (py < seg.y + segHeight || seg.to === this.totalDays) {
        return seg.from + (py - seg.y) / (this.ppd * seg.scale);
      }
    }
    return this.totalDays;
  }

  /** 구간이 접혀 있는가 */
  get compressed() { return this.segments.some((s) => s.scale !== 1); }
}

/**
 * 칸 스케일 — 날짜 없는 보드. 한 칸 = 한 행(rowH). 구간 묶기·접기는 없다(바깥 칸이 없다).
 */
export class SlotScale {
  /**
   * @param {number} total 칸 수
   * @param {number} rowH 한 칸 픽셀(확대 배율의 한 행 높이)
   * @param {object} timeline SlotTimeline
   */
  constructor(total, rowH, timeline) {
    this.totalDays = total;       // 인터페이스 이름을 맞춘다 — 여기선 칸 수
    this.ppd = rowH;              // 위치 하나(칸)당 픽셀
    this.timeline = timeline;
    this.height = total * rowH;
    this.segments = [{ from: 0, to: total, scale: 1, y: 0 }];
  }
  y(p) { return Math.max(0, Math.min(this.totalDays, p)) * this.ppd; }
  dayHeight() { return this.ppd; }
  dayAt(py) { return Math.max(0, py / this.ppd); }
  topOf(item) { return this.y(this.timeline.pos(item)?.s ?? 0); }
  heightOf(item) {
    const p = this.timeline.pos(item) ?? { s: 0, e: 0 };
    return (p.e - p.s + 1) * this.ppd;
  }
  get compressed() { return false; }
}
