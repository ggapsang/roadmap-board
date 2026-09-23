/**
 * 일정 카드 렌더.
 * top = 시작일 인덱스 × 일당픽셀, height = 기간 × 일당픽셀 로 절대 배치 (기획안 §4).
 *
 * 카드는 다른 카드를 품을 수 있다. 자식은 상위 카드 엘리먼트 안에 들어가고,
 * 세로 위치는 상위 카드의 시작일을 기준으로 잡는다.
 */
import { dayIndex, shortMD } from '../../core/dates.js';
import { LAYOUT } from '../../config/index.js';
import { el } from '../dom.js';

const ALIGN_CSS = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

/**
 * 좌우 가장자리 손잡이.
 *   최상위 카드 — 오른쪽만. 트랙 걸침을 칸 단위로 늘린다.
 *   자식 카드   — 좌우 모두. 상위 카드 안에서의 가로 위치·폭을 잡는다.
 *                 트랙 걸침이 의미가 없는 자리라 다른 수단이 필요하다.
 */
function addHorizontalGrips(node, parent) {
  if (parent) {
    node.append(el('div.grip-hw', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 왼쪽 가장자리 조절 · 더블클릭하면 자동' }));
    node.append(el('div.grip-he', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 폭 조절 · 더블클릭하면 자동' }));
  } else {
    node.append(el('div.grip-span', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 트랙 걸침 조절' }));
  }
}

/**
 * @param {object} item
 * @param {object} ctx
 *   origin      보드 시작일
 *   ppd         일당 픽셀
 *   placement   레인 배치
 *   selectedId  선택된 일정
 *   match       true=검색 매칭 / false=비매칭 / null=검색 없음
 *   parent      상위 일정 (있으면 그 안에 놓인다)
 *   hasChildren 자식을 품는 카드인가
 */
export function renderCard(item, ctx) {
  const { origin, scale, placement, selectedId, match, parent, hasChildren, spanBox } = ctx;
  const isMilestone = item.ty === 'ms';

  // 자식은 상위 카드 기준으로, 최상위는 보드 기준으로 세로 위치를 잡는다.
  // 접힌 구간이 있으면 눈금이 균일하지 않으므로 TimeScale을 거친다.
  const base = parent ? scale.yOf(parent.s) : 0;
  const top = scale.yOf(item.s) - base;

  const node = el('div.ev', {
    dataset: { id: item.id },
    tabIndex: 0,
    style: { top: top + 'px' },
  });
  node.classList.add('st-' + item.st);
  if (isMilestone) node.classList.add('ms');
  if (hasChildren) node.classList.add('container');
  if (parent) node.classList.add('child');
  if (item.id === selectedId) node.classList.add('sel');
  if (match === true) node.classList.add('hit');
  if (match === false) node.classList.add('dim');

  const { lane = 0, lanes = 1 } = placement.get(item.id) ?? {};

  /**
   * 상위 일정 안에 든 카드는 트랙 걸침(sp)이 의미가 없다. 대신 상위 카드 안에서의
   * 가로 위치·폭을 비율(x, w)로 직접 잡을 수 있다. 값이 없으면 겹침 계산이 정한다.
   * 최상위 카드는 트랙 걸침으로 폭을 정하므로 이 비율을 쓰지 않는다.
   */
  const manual = !!parent && (item.x != null || item.w != null);
  const left = manual ? (item.x ?? 0) * 100 : (lane * 100) / lanes;
  const width = manual ? (item.w ?? 1 / lanes) * 100 : 100 / lanes;

  /**
   * 여러 트랙에 걸치는 일정은 퍼센트로 잡을 수 없다.
   * 폭을 sp × 100 / lanes 로 계산하면 레인이 2개인 트랙에서 sp=2가 100%가 되어
   * 걸침이 그대로 상쇄된다. 트랙마다 너비가 다를 수 있으므로 "200%"가 실제
   * 두 칸 폭과 같지도 않다. 그래서 걸치는 카드만 실제 컬럼 너비로 px를 잡는다.
   */
  const setBox = (node) => {
    if (spanBox) {
      node.style.left = `${spanBox.left + 4}px`;
      node.style.width = `${Math.max(24, spanBox.width - 8)}px`;
    } else {
      node.style.left = `calc(${left}% + var(--u1))`;
      node.style.width = `calc(${width}% - var(--u2))`;
    }
  };

  if (isMilestone) {
    // 상위 일정 안에 든 마일스톤은 형제와 레인을 나눠 갖는다.
    // 최상위 마일스톤만 트랙 폭을 가로지른다.
    const laned = placement.has(item.id);
    if (spanBox) {
      node.style.left = `${spanBox.left + 8}px`;
      node.style.width = `${Math.max(24, spanBox.width - 16)}px`;
    } else if (laned) {
      setBox(node);
    } else {
      node.style.left = 'var(--u3)';
      node.style.width = 'calc(100% - var(--u6))';
    }
    node.append(
      el('span.dia'),
      el('span.t', { text: item.ti }),
      el('span.meta', { text: shortMD(item.s) }),
    );
    node.title = `${item.ti} · ${item.s} · ${item.og}`;
    addHorizontalGrips(node, parent);
    return node;
  }

  const height = Math.max(LAYOUT.minCardHeight, scale.span(item.s, item.e) - LAYOUT.cardGap);

  node.style.height = height + 'px';
  setBox(node);
  node.style.justifyContent = ALIGN_CSS[item.align] ?? 'center';

  // 컨테이너는 제목을 위에 두고 아래를 자식에게 내준다
  if (hasChildren) node.style.justifyContent = 'flex-start';
  else if (height >= LAYOUT.bigCardHeight || item.st === 'hold') node.classList.add('big');

  const meta = el('div.meta', {}, [
    el('span.dt', { text: `${shortMD(item.s)} – ${shortMD(item.e)}` }),
    el('span.tag', { text: item.og }),
  ]);
  if (height < LAYOUT.metaHideHeight || item.st === 'hold') meta.classList.add('hidden');

  node.append(el('div.t', { text: item.ti }), meta);

  if (item.showNote && item.note) {
    node.append(el('div.card-note', { text: item.note }));
  }
  if (item.pg) {
    node.append(el('div.pg', {}, [el('i', { style: { width: item.pg + '%' } })]));
  }

  // 위·아래 가장자리 = 기간. 위를 끌면 시작일이, 아래를 끌면 종료일이 움직인다.
  node.append(el('div.grip-top', { attrs: { 'aria-hidden': 'true' } }));
  node.append(el('div.grip', { attrs: { 'aria-hidden': 'true' } }));
  addHorizontalGrips(node, parent);
  node.title = `${item.ti}\n${item.s} – ${item.e} · ${item.og}${item.pg ? ' · ' + item.pg + '%' : ''}`;
  return node;
}

