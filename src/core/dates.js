/**
 * 날짜 유틸 — 전부 **로컬 타임존** 기준.
 * 기획안 §8: "UTC 혼용 금지(하루 밀림 발생)".
 * 보드 좌표계의 단위는 START로부터의 '일 단위 정수 인덱스'다 (기획안 D-2).
 */

export const DAY = 86400000;

/** 'YYYY-MM-DD' → 로컬 Date(00:00). Date 생성자의 UTC 파싱을 우회한다. */
export function parseDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → 'YYYY-MM-DD' (로컬) */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * origin 기준 일 인덱스. DST 경계에서 23/25시간 차가 나므로 반드시 round.
 * @param {string|Date} iso
 * @param {Date} origin
 */
export function dayIndex(iso, origin) {
  const d = typeof iso === 'string' ? parseDate(iso) : iso;
  return Math.round((d - origin) / DAY);
}

/** origin + i일 → 'YYYY-MM-DD' */
export function dateAt(origin, i) {
  return formatDate(new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + i));
}

/** 'YYYY-MM-DD' + n일 */
export function addDays(iso, n) {
  const d = parseDate(iso);
  return formatDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** 'YYYY-MM-DD' → '10.05' */
export function shortMD(iso) {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
}

/** 오늘 00:00 (로컬) */
export function today() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/** a..b 포함 일수 (종료일 inclusive — 기획안 D-3) */
export function inclusiveDays(sIso, eIso) {
  return Math.max(1, dayIndex(eIso, parseDate(sIso)) + 1);
}
