/**
 * 일정 카드 렌더.
 * top = 시작일 인덱스 × 일당픽셀, height = 기간 × 일당픽셀 로 절대 배치 (기획안 §4).
 */
import { dayIndex, shortMD } from '../../core/dates.js';
import { LAYOUT } from '../../config/index.js';
import { el } from '../dom.js';

/**
 * @param {object} item
 * @param {object} ctx {origin, ppd, placement, selectedId, match}
 *   match: true=검색 매칭, false=비매칭, null=검색 없음
 * @returns {HTMLElement}
 */
export function renderCard(item, { origin, ppd, placement, selectedId, match }) {
  const top = dayIndex(item.s, origin) * ppd;
  const isMilestone = item.ty === 'ms';

  const node = el('div.ev', {
    dataset: { id: item.id },
    tabIndex: 0,
    style: { top: top + 'px' },
  });
  node.classList.add('st-' + item.st);
  if (isMilestone) node.classList.add('ms');
  if (item.id === selectedId) node.classList.add('sel');
  if (match === true) node.classList.add('hit');
  if (match === false) node.classList.add('dim');

  if (isMilestone) {
    // 마일스톤은 레인 계산에서 빠지고 컬럼 폭 기준 인셋 오버레이로 그린다
    node.style.left = 'var(--u3)';
    node.style.width = `calc(${item.sp * 100}% - var(--u6))`;
    node.append(
      el('span.dia'),
      el('span.t', { text: item.ti }),
      el('span.meta', { text: shortMD(item.s) }),
    );
    node.title = `${item.ti} · ${item.s} · ${item.og}`;
    return node;
  }

  const days = Math.max(1, dayIndex(item.e, origin) - dayIndex(item.s, origin) + 1);
  const height = Math.max(LAYOUT.minCardHeight, days * ppd - 4);
  const { lane = 0, lanes = 1 } = placement.get(item.id) ?? {};

  node.style.height = height + 'px';
  node.style.left = `calc(${(lane * 100) / lanes}% + var(--u1))`;
  node.style.width = `calc(${(item.sp * 100) / lanes}% - var(--u2))`;
  if (height >= LAYOUT.bigCardHeight || item.st === 'hold') node.classList.add('big');

  const meta = el('div.meta', {}, [
    el('span.dt', { text: `${shortMD(item.s)} – ${shortMD(item.e)}` }),
    el('span.tag', { text: item.og }),
  ]);
  if (height < LAYOUT.metaHideHeight || item.st === 'hold') meta.classList.add('hidden');

  node.append(el('div.t', { text: item.ti }), meta);
  if (item.pg) {
    node.append(el('div.pg', {}, [el('i', { style: { width: item.pg + '%' } })]));
  }
  node.append(el('div.grip', { attrs: { 'aria-hidden': 'true' } }));
  node.title = `${item.ti}\n${item.s} – ${item.e} · ${item.og}${item.pg ? ' · ' + item.pg + '%' : ''}`;
  return node;
}
