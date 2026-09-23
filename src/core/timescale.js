/**
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
   * @param {{from:string,to:string,scale:number}[]} bands
   */
  constructor(origin, totalDays, ppd, bands = []) {
    this.origin = origin;
    this.totalDays = totalDays;
    this.ppd = ppd;

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
