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
 * 안쪽 칸 한 행(월-주의 한 주 등)도 따로 배율을 가질 수 있다(rows, display.rowScales — 두 번째 칸 손잡이,
 * 2026-10-26 사용자). 겹치면 곱한다 — 늘린 달 안에서 한 주를 더 늘리면 그 주는 둘을 곱한 만큼.
 *
 * 순수 계산이다. DOM을 모른다.
 */
import { dayIndex } from './dates.js';

/** 카드 윗변의 여백(위치 단위) — 크기 강제 카드만(place.oy). 시작 칸·날짜 안에서 윗변이 내려온 만큼 */
export function topOffset(item) {
  return item?.place?.hd != null ? Math.max(0, Number(item.place.oy) || 0) : 0;
}

export class TimeScale {
  /**
   * @param {Date} origin 보드 시작일
   * @param {number} totalDays
   * @param {number} ppd 기본 일당 픽셀
   * @param {{from:string,to:string,scale:number}[]} bands  이 모드의 구간만
   * @param {object} [timeline] 위치 읽기(DateTimeline). 없으면 날짜로 읽는다.
   * @param {{from:number,to:number,scale:number}[]} [rows]  이 모드의 안쪽 칸 행 배율(일 인덱스, to 미포함)
   */
  constructor(origin, totalDays, ppd, bands = [], timeline = null, rows = []) {
    this.origin = origin;
    this.totalDays = totalDays;
    this.ppd = ppd;
    this.timeline = timeline;

    // 구간·행을 일 인덱스 범위로 바꾸고, 경계마다 잘라 겹친 배율을 곱한다
    const clip = (r) => ({ from: Math.max(0, r.from), to: Math.min(totalDays, r.to), scale: r.scale ?? 1 });
    const ranges = [
      ...bands.map((b) => clip({ from: dayIndex(b.from, origin), to: dayIndex(b.to, origin) + 1, scale: b.scale })),
      ...rows.map(clip),
    ].filter((r) => r.to > r.from && r.scale !== 1);
    const cuts = [...new Set([0, totalDays, ...ranges.flatMap((r) => [r.from, r.to])])].sort((a, b) => a - b);

    this.segments = [];
    let y = 0;
    for (let k = 0; k + 1 < cuts.length; k += 1) {
      const from = cuts[k], to = cuts[k + 1];
      let scale = 1;
      for (const r of ranges) if (r.from <= from && r.to >= to) scale *= r.scale;
      const last = this.segments[this.segments.length - 1];
      if (last && last.scale === scale) last.to = to;     // 배율이 같은 이웃은 한 토막으로
      else this.segments.push({ from, to, scale, y });
      y += (to - from) * ppd * scale;
    }
    if (!this.segments.length) this.segments.push({ from: 0, to: totalDays, scale: 1, y: 0 });
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
  /** 이벤트의 top(px) — 시작 위치(크기 강제 카드는 + 위쪽 여백) */
  topOf(item) { return this.y(this.#pos(item).s + topOffset(item)); }
  /** 이벤트의 높이(px) — 기간(끝 포함) */
  heightOf(item) {
    const p = this.#pos(item);
    return Math.max(0, this.y(p.e) + this.dayHeight(p.e) - this.y(p.s));
  }

  /**
   * 위치 p부터 n칸(일)의 픽셀 높이 — 접히거나 늘린 구간의 배율을 탄다. 축 끝을 넘는 몫은 기본 일당 픽셀로 센다
   * (크기 강제 카드가 축 끝 너머까지 내려갈 수 있다).
   */
  extent(p, n) {
    const end = p + Math.max(0, n);
    const inAxis = Math.min(end, this.totalDays);
    const h = inAxis > p ? this.y(inAxis) - this.y(p) : 0;
    return h + Math.max(0, end - Math.max(p, this.totalDays)) * this.ppd;
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
 * 칸 스케일 — 날짜 없는 보드. 한 칸 = 한 행(rowH) × 그 칸의 높이 배율(display.slotRows — 왼쪽 칸 아래 가장자리를 끌어 정한다).
 * 구간 묶기는 없다(바깥 칸이 없다).
 */
export class SlotScale {
  /**
   * @param {number} total 칸 수
   * @param {number} rowH 한 칸 기본 픽셀(확대 배율의 한 행 높이)
   * @param {object} timeline SlotTimeline
   * @param {Object<string,number>} [rows] 칸 번호(0부터) → 높이 배율
   */
  constructor(total, rowH, timeline, rows = {}) {
    this.totalDays = total;       // 인터페이스 이름을 맞춘다 — 여기선 칸 수
    this.ppd = rowH;              // 위치 하나(칸)당 기본 픽셀
    this.timeline = timeline;
    this.rows = rows ?? {};
    // 칸마다 높이와 누적 위치
    this.h = new Array(total);
    this.top = new Array(total + 1);
    this.top[0] = 0;
    for (let i = 0; i < total; i += 1) {
      this.h[i] = rowH * (Number(this.rows[i]) || 1);
      this.top[i + 1] = this.top[i] + this.h[i];
    }
    this.height = this.top[total] ?? 0;
    this.segments = [{ from: 0, to: total, scale: 1, y: 0 }];
  }
  y(p) {
    const q = Math.max(0, Math.min(this.totalDays, p));
    const i = Math.floor(q);
    if (i >= this.totalDays) return this.height;
    return this.top[i] + (q - i) * this.h[i];
  }
  dayHeight(p = 0) { return this.h[Math.floor(p)] ?? this.ppd; }
  /** 칸 p부터 n칸의 픽셀 — 칸마다 높이를 탄다. 축 끝을 넘는 몫은 기본 높이로 */
  extent(p, n) {
    const end = p + Math.max(0, n);
    const inAxis = Math.min(end, this.totalDays);
    const h = inAxis > p ? this.y(inAxis) - this.y(p) : 0;
    return h + Math.max(0, end - Math.max(p, this.totalDays)) * this.ppd;
  }
  dayAt(py) {
    if (py <= 0) return 0;
    if (py >= this.height) return this.totalDays + (py - this.height) / this.ppd;
    let lo = 0, hi = this.totalDays - 1;
    while (lo < hi) {                       // top[i] <= py < top[i+1] 인 칸
      const mid = (lo + hi + 1) >> 1;
      if (this.top[mid] <= py) lo = mid; else hi = mid - 1;
    }
    return lo + (py - this.top[lo]) / (this.h[lo] || this.ppd);
  }
  topOf(item) { return this.y((this.timeline.pos(item)?.s ?? 0) + topOffset(item)); }
  heightOf(item) {
    const p = this.timeline.pos(item) ?? { s: 0, e: 0 };
    return (p.e - p.s + 1) * this.ppd;
  }
  get compressed() { return false; }
}
