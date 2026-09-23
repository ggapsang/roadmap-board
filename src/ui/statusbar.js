/**
 * 상태 요약 바 — "상태 우선" 원칙. 보드를 보기 전에 지연 건수부터 읽히게 한다.
 * 상태 칩과 조직 칩은 토글 필터를 겸한다 (기획안 §5).
 */
import { DAY, parseDate, today } from '../core/dates.js';
import { STATUSES, UPCOMING_DAYS } from '../config/index.js';
import { el, clear } from './dom.js';

export function renderStatusBar(bar, { store, view, onChange }) {
  clear(bar);

  const counts = new Map(STATUSES.map((s) => [s.key, 0]));
  for (const item of store.items) counts.set(item.st, (counts.get(item.st) ?? 0) + 1);

  for (const status of STATUSES) {
    bar.append(el('button', {
      className: 'stat s-' + status.key,
      type: 'button',
      attrs: { 'aria-pressed': String(view.statusFilter.has(status.key)) },
      title: `${status.label} 필터`,
      on: { click: () => { view.toggleStatus(status.key); onChange(); } },
    }, [
      el('span.dot'),
      document.createTextNode(' ' + status.label + ' '),
      el('b', { text: String(counts.get(status.key) ?? 0) }),
    ]));
  }

  bar.append(el('span.divider'));

  const from = today();
  const to = new Date(from.getTime() + UPCOMING_DAYS * DAY);
  const upcoming = store.items.filter((i) => {
    if (i.ty !== 'ms') return false;
    const d = parseDate(i.s);
    return d >= from && d <= to;
  }).length;

  bar.append(el('span.stat', {
    style: { cursor: 'default' },
    title: `오늘부터 ${UPCOMING_DAYS}일 안의 마일스톤`,
  }, [
    document.createTextNode(`향후 ${Math.round(UPCOMING_DAYS / 7)}주 마일스톤 `),
    el('b', { text: String(upcoming) }),
  ]));

  bar.append(el('span.divider'));

  // 실제로 쓰이고 있는 조직만 칩으로 보여 준다. 순서는 문서의 조직 목록을 따른다.
  const used = new Set(store.items.map((i) => i.og));
  const orgs = store.orgs.filter((o) => used.has(o));

  const wrap = el('span.orgs');
  for (const org of orgs) {
    wrap.append(el('button.org', {
      type: 'button',
      text: org,
      attrs: { 'aria-pressed': String(view.orgFilter.has(org)) },
      on: { click: () => { view.toggleOrg(org); onChange(); } },
    }));
  }
  bar.append(wrap);
}
