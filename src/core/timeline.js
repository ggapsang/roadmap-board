/**
 * 세로축 위치 — 보드 코드는 달력인지 칸인지 모르고 **위치 인덱스**만 다룬다 (docs/SCALE.md §5).
 *
 *   날짜 있는 보드 (DateTimeline)  위치 = 보드 시작일부터의 일 인덱스. 근거는 이벤트 날짜(s·e).
 *   날짜 없는 보드 (SlotTimeline)  위치 = 칸 인덱스. 근거는 이 보드 배치의 칸(place.slot).
 *
 * 둘 다 같은 인터페이스를 낸다:
 *   pos(item)          → { s, e } 위치(e 포함). 없으면 null
 *   set(item, s, e)    위치를 이벤트에 되쓴다(날짜 또는 칸)
 *   snap(p)            정밀도 단위(step)의 시작으로 맞춘다
 *   add(p, n)          step n개만큼 옮긴 위치(월은 달력 산술 — 말일 보정)
 *   steps(p0, p1)      p0 → p1 사이의 step 개수
 *   newEnd(s)          새 일정 기본 길이의 끝(포함)
 *   isPoint(item)      점 마일스톤인가(시작 = 끝)
 *   label(item)        카드에 쓰는 위치 글자('10.05 – 10.20' 또는 '칸 3–5')
 * 순수 계산이다. DOM을 모른다.
 */
import { dayIndex, dateAt, shortMD, parseDate, formatDate } from './dates.js';
import { SCALE_MODES } from '../config/index.js';

// ── 달력 단위 산술 (로컬 날짜) ─────────────────────────────

/** 그 단위의 시작 날짜 — 주는 월요일 시작 */
export function unitStart(date, unit) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (unit === 'week') { const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); }
  else if (unit === 'month') d.setDate(1);
  else if (unit === 'quarter') { d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1); }
  return d;
}

/** date + n단위. 월·분기는 같은 날짜로, 없으면 그 달 말일로(1.31 + 1개월 = 2.28) */
export function addUnits(date, unit, n) {
  if (unit === 'day') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
  if (unit === 'week') return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * n);
  const months = unit === 'quarter' ? 3 * n : n;
  const y = date.getFullYear(), m = date.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), last));
}

/** a → b 사이의 단위 개수(단위 시작끼리 비교, 음수 가능) */
export function unitsBetween(a, b, unit) {
  const sa = unitStart(a, unit), sb = unitStart(b, unit);
  if (unit === 'day') return Math.round((sb - sa) / 86400000);
  if (unit === 'week') return Math.round((sb - sa) / (7 * 86400000));
  const mm = (sb.getFullYear() - sa.getFullYear()) * 12 + (sb.getMonth() - sa.getMonth());
  return unit === 'quarter' ? Math.round(mm / 3) : mm;
}

/** 모드 정의 — 모르는 모드면 월-주 */
export function modeOf(display) {
  return SCALE_MODES[display?.scale] ?? SCALE_MODES['month-week'];
}

// ── 날짜 있는 보드 ─────────────────────────────────────────

export class DateTimeline {
  /**
   * @param {Date} origin 보드 시작일(일 인덱스 0)
   * @param {object} display meta.display — scale·slotUnit
   */
  constructor(origin, display) {
    this.dated = true;
    this.origin = origin;
    this.mode = modeOf(display);
    // '눈금 없음' 보기: 한 칸 = 전환 전 안쪽 단위(slotUnit). 정밀도·새 일정도 그 단위.
    const slot = this.mode.key === 'none' ? (display?.slotUnit ?? 'week') : null;
    this.slotUnit = slot;
    this.step = slot ?? this.mode.step;
    this.newUnit = slot ?? this.mode.newUnit;
  }

  #date(p) { return new Date(this.origin.getFullYear(), this.origin.getMonth(), this.origin.getDate() + p); }
  #idx(d) { return Math.round((d - this.origin) / 86400000); }

  pos(item) {
    if (!item?.s) return null;
    return { s: dayIndex(item.s, this.origin), e: dayIndex(item.e || item.s, this.origin) };
  }

  set(item, s, e) { item.s = dateAt(this.origin, s); item.e = dateAt(this.origin, Math.max(s, e)); }

  snap(p) { return this.step === 'day' ? p : this.#idx(unitStart(this.#date(p), this.step)); }

  add(p, n) { return this.#idx(addUnits(this.#date(p), this.step, n)); }

  steps(p0, p1) { return unitsBetween(this.#date(p0), this.#date(p1), this.step); }

  /** 새 일정: s부터 기본 길이(newUnit 하나) — 끝은 포함 */
  newEnd(s) { return this.#idx(addUnits(this.#date(s), this.newUnit, 1)) - 1; }

  isPoint(item) { return item.ty === 'ms' && item.s === item.e; }

  /** 칸 번호(1부터) — 눈금 없음 보기에서 날짜 대신 */
  slotNo(p) { return unitsBetween(this.origin, this.#date(p), this.slotUnit ?? 'day') + 1; }

  label(item) {
    if (!item.s) return '';
    if (this.slotUnit) {
      const p = this.pos(item);
      const a = this.slotNo(p.s), b = this.slotNo(p.e);
      return a === b ? `칸 ${a}` : `칸 ${a}–${b}`;
    }
    return item.s === item.e ? shortMD(item.s) : `${shortMD(item.s)} – ${shortMD(item.e)}`;
  }
}

// ── 날짜 없는 보드 ─────────────────────────────────────────

export class SlotTimeline {
  constructor() {
    this.dated = false;
    this.mode = SCALE_MODES.none;
    this.step = 'slot';
    this.newUnit = 'slot';
    this.slotUnit = 'slot';
  }

  pos(item) {
    const sl = item?.place?.slot;
    if (!sl) return null;
    return { s: sl.s, e: sl.s + Math.max(1, sl.len) - 1 };
  }

  set(item, s, e) {
    const a = Math.max(0, Math.round(s));
    item.place.slot = { s: a, len: Math.max(1, Math.round(e) - a + 1) };
  }

  snap(p) { return Math.max(0, Math.floor(p)); }
  add(p, n) { return p + n; }
  steps(p0, p1) { return Math.round(p1) - Math.round(p0); }
  newEnd(s) { return s; }
  isPoint(item) { return item.ty === 'ms' && (item.place?.slot?.len ?? 1) === 1; }
  slotNo(p) { return p + 1; }

  label(item) {
    const p = this.pos(item);
    if (!p) return '';
    return p.s === p.e ? `칸 ${p.s + 1}` : `칸 ${p.s + 1}–${p.e + 1}`;
  }
}

/**
 * 날짜 없는 보드에 눈금을 입힌다(일괄 설정, docs/SCALE.md §2). 칸 k = start + k단위.
 * 문서를 고친다 — Store.commit 안에서 부른다. 끝나면 날짜 있는 보드다.
 * @param {object} doc
 * @param {'day'|'week'|'month'|'quarter'} unit 한 칸의 단위
 * @param {string} startIso 1번 칸이 시작하는 날짜
 */
export function applyCalendar(doc, unit, startIso) {
  const start = unitStart(parseDate(startIso), unit);
  let min = null, max = null;
  for (const it of doc.items) {
    const sl = it.place?.slot ?? { s: 0, len: 1 };
    const s = addUnits(start, unit, sl.s);
    const e = addUnits(addUnits(start, unit, sl.s + Math.max(1, sl.len)), 'day', -1);   // 끝은 포함
    it.s = formatDate(s);
    it.e = formatDate(e);
    it.place.slot = null;
    if (!min || it.s < min) min = it.s;
    if (!max || it.e > max) max = it.e;
  }
  const scale = unit === 'day' ? 'week-day' : unit === 'week' ? 'month-week' : 'quarter-month';
  doc.meta.display = { ...doc.meta.display, dated: true, scale, slotUnit: null };
  doc.meta.start = min ?? formatDate(start);
  doc.meta.end = max ?? formatDate(addUnits(start, unit, 12));
}
