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
 *   막대·자식 — 좌우 모두. 좌우 가장자리를 끌어 가로 위치·폭(x/w)을 잡는다.
 *               한 칸을 차지한 최상위 막대도 칸 안에서 폭을 줄일 수 있다.
 *               (트랙 걸침 sp는 편집 패널에서 정한다.)
 *   최상위 점 마일스톤 — 오른쪽만. 트랙 걸침을 칸 단위로 늘린다(표식이라 폭 개념이 없다).
 */
function addHorizontalGrips(node, { span = false } = {}) {
  if (span) {
    node.append(el('div.grip-span', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 트랙 걸침 조절' }));
  } else {
    node.append(el('div.grip-hw', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 왼쪽 가장자리 조절 · 더블클릭하면 자동' }));
    node.append(el('div.grip-he', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 오른쪽 가장자리 조절 · 더블클릭하면 자동' }));
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
  const { origin, ppd, scale, placement, selectedId, match, parent, hasChildren, spanBox } = ctx;
  const isMilestone = item.ty === 'ms';
  // 점 마일스톤(s===e)만 얇은 표식으로 그린다. 기간 마일스톤은 막대로 떨어진다.
  const msPoint = isMilestone && item.s === item.e;
  // 크기 강제 모드 — 가로(x/w)·세로(hd)를 드래그로 자유 조절. hd가 그 표식이다.
  const forced = item.place?.hd != null;

  // 자식은 상위 카드 기준으로, 최상위는 보드 기준으로 세로 위치를 잡는다.
  // 위치·높이는 스케일에 맡긴다 — 달력이면 날짜로, 순서면 rank로 (스케일이 안다).
  const base = parent ? scale.topOf(parent) : 0;
  const top = scale.topOf(item) - base;

  const node = el('div.ev', {
    dataset: { id: item.id },
    tabIndex: 0,
    style: { top: top + 'px' },
  });
  node.classList.add('st-' + item.st);
  if (isMilestone) node.classList.add('ms', msPoint ? 'point' : 'ranged');
  if (hasChildren) node.classList.add('container');
  if (parent) node.classList.add('child');
  if (item.alias != null) node.classList.add('alias');    // 다른 보드를 대신하는 포털 카드
  if (item.id === selectedId) node.classList.add('sel');
  if (match === true) node.classList.add('hit');
  if (match === false) node.classList.add('dim');

  const { lane = 0, lanes = 1 } = placement.get(item.id) ?? {};

  /**
   * 상위 일정 안에 든 카드는 트랙 걸침(sp)이 의미가 없다. 대신 상위 카드 안에서의
   * 가로 위치·폭을 비율(x, w)로 직접 잡을 수 있다. 값이 없으면 겹침 계산이 정한다.
   * 최상위 카드는 트랙 걸침으로 폭을 정하므로 이 비율을 쓰지 않는다.
   */
  // 가로 위치·폭(%) 결정. 좌표는 컬럼 기준 비율이라 w가 1을 넘으면 옆 트랙까지 넘나든다.
  let left, width;
  if (parent) {
    // 자식: 상위 카드 안에서의 비율(x/w). 없으면 겹침 계산(레인).
    const manual = item.place?.x != null || item.place?.w != null;
    left = (manual ? (item.place.x ?? 0) : lane / lanes) * 100;
    width = (manual ? (item.place.w ?? 1 / lanes) : 1 / lanes) * 100;
  } else if (forced) {
    // 크기 강제 최상위: 비율 x/w로 자유 조절. 폭 비율이 없으면 걸침 칸수(sp)만큼을 기본으로
    // 둬 강제해도 트랙 걸침이 무너지지 않는다. 드래그로 트랙 너머까지(w>1) 넓힐 수 있다.
    left = (item.place?.x ?? 0) * 100;
    width = (item.place?.w ?? (item.place?.sp ?? 1)) * 100;
  } else {
    // 자동 최상위: 레인 분할(걸침은 spanBox가 px로 처리).
    left = (lane * 100) / lanes;
    width = 100 / lanes;
  }

  /**
   * 여러 트랙에 걸치는 일정은 퍼센트로 잡을 수 없다.
   * 폭을 sp × 100 / lanes 로 계산하면 레인이 2개인 트랙에서 sp=2가 100%가 되어
   * 걸침이 그대로 상쇄된다. 트랙마다 너비가 다를 수 있으므로 "200%"가 실제
   * 두 칸 폭과 같지도 않다. 그래서 걸치는 카드만 실제 컬럼 너비로 px를 잡는다.
   */
  const setBox = (node) => {
    // 자동(강제 아님) 걸침 카드는 실제 컬럼 너비(px)로. 강제 모드는 비율 x/w로 잡아
    // 좌·우 가장자리를 자유롭게 끈다 — 이때 w는 컬럼 기준 비율이라 1을 넘으면(예 2.0)
    // 옆 트랙까지 넘나든다(자유롭게 트랙을 가로지른다).
    if (spanBox && !forced) {
      node.style.left = `${spanBox.left + 4}px`;
      node.style.width = `${Math.max(24, spanBox.width - 8)}px`;
    } else {
      node.style.left = `calc(${left}% + var(--u1))`;
      node.style.width = `calc(${width}% - var(--u2))`;
    }
  };

  if (msPoint) {
    // 상위 일정 안에 든 마일스톤은 형제와 레인을 나눠 갖는다.
    // 최상위 점 마일스톤만 트랙 폭을 가로지른다.
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
      el('span.t', { text: item.alias || item.ti }),
      el('span.meta', { text: shortMD(item.s) }),
    );
    node.title = `${item.alias || item.ti} · ${item.s} · ${item.og}`;
    // 최상위 점 마일스톤만 트랙 걸침 손잡이. 상위에 든 것은 폭 손잡이.
    addHorizontalGrips(node, { span: !parent });
    return node;
  }

  // 세로 크기 강제(hd, 일)면 날짜와 무관하게 그 길이로. 아니면 기간대로.
  const rawH = forced ? item.place.hd * ppd : scale.heightOf(item);
  const height = Math.max(LAYOUT.minCardHeight, rawH - LAYOUT.cardGap);

  node.style.height = height + 'px';
  setBox(node);

  // 너무 낮아 제목이 세로로 짤리는 카드. 마일스톤처럼 한 줄 row로 눕힌다.
  const isShort = !hasChildren && height < LAYOUT.compactCardHeight;

  if (hasChildren) {
    // 컨테이너 제목도 세로 정렬(align)을 따른다 — 위/가운데/아래.
    // c-* 클래스로 제목 바 모양(위·아래 붙는 바 / 가운데 칩)을 가른다.
    const al = item.place?.align ?? 'middle';
    node.style.justifyContent = ALIGN_CSS[al];
    node.classList.add('c-' + al);
  } else if (isShort) {
    // 제목은 왼쪽에서 넘치면 가로 …로 생략(전체는 title 툴팁), 기한은 오른쪽에.
    // 세로 정렬(justifyContent)은 row 배치라 건드리지 않는다.
    node.classList.add('short');
  } else {
    node.style.justifyContent = ALIGN_CSS[item.place?.align] ?? 'center';
    if (height >= LAYOUT.bigCardHeight || item.st === 'hold') node.classList.add('big');
  }

  const meta = el('div.meta', {}, [
    el('span.dt', { text: `${shortMD(item.s)} – ${shortMD(item.e)}` }),
    el('span.tag', { text: item.og }),
  ]);
  // 태스크가 있으면 완료/전체를 작은 칩으로. 순서 없는 할 일이라 카드엔 개수만 보인다.
  if (Array.isArray(item.tasks) && item.tasks.length) {
    const done = item.tasks.filter((t) => t.done).length;
    meta.append(el('span.tasks-chip', { text: `✓ ${done}/${item.tasks.length}` }));
  }
  // 낮은 카드라도 기한(날짜)은 오른쪽에 남긴다(조직 태그는 CSS로 숨김).
  // 보통 카드는 낮으면 메타를 통째로 숨기고, 보류는 항상 숨긴다.
  if ((height < LAYOUT.metaHideHeight && !isShort) || item.st === 'hold') meta.classList.add('hidden');

  // 별칭이 있으면 이 보드에선 그 이름으로 보인다(§3.5). 같은 이벤트라도 맥락별 이름.
  const label = item.alias || item.ti;
  node.append(el('div.t', { text: label }), meta);

  if (item.place?.showNote && item.note) {
    node.append(el('div.card-note', { text: item.note }));
  }
  if (item.pg) {
    node.append(el('div.pg', {}, [el('i', { style: { width: item.pg + '%' } })]));
  }

  // 위·아래 가장자리. 보통은 위=시작일·아래=종료일. 크기 강제면 위·아래 둘 다 잡아
  // 자유롭게 늘리고 줄인다(위로도, 아래로도).
  node.append(el('div.grip-top', { attrs: { 'aria-hidden': 'true' } }));
  node.append(el('div.grip', { attrs: { 'aria-hidden': 'true' } }));
  // 자식·강제 → 좌우 폭 손잡이(x/w). 강제 모드는 폭을 트랙 너머로도 끌 수 있다(w>1).
  // 강제 아닌 최상위 → 트랙 걸침 손잡이(칸 단위).
  const widthGrips = forced || !!parent;
  addHorizontalGrips(node, { span: !widthGrips });
  node.title = `${label}${item.alias ? ` (${item.ti})` : ''}\n${item.s} – ${item.e} · ${item.og}${item.pg ? ' · ' + item.pg + '%' : ''}`;
  return node;
}

/**
 * 제목이 카드를 넘치면 폰트(와 줄높이)를 줄여 잘리지 않게 한다.
 * 렌더가 끝나 카드가 DOM에 붙은 뒤(크기 확정) 호출해야 한다.
 * 세로(감싸는 제목)·가로(한 줄 제목) 넘침 둘 다 본다. 패널이 열려 컬럼이 좁아진
 * 상태에서도 제목이 짤리지 않도록 최소 6px까지 줄인다.
 */
export function fitTitle(node) {
  const t = node.querySelector(':scope > .t');
  if (!t) return;
  // 제목 자신의 넘침(고정 칸 안 클립)과 카드 전체 넘침(한 줄 배치에서 세로) 둘 다 본다.
  const overflow = () =>
    t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1
    || node.scrollHeight > node.clientHeight + 1;
  if (!overflow()) return;
  let size = parseFloat(getComputedStyle(t).fontSize);
  const MIN = 6;
  let guard = 0;
  while (guard++ < 24 && size > MIN && overflow()) {
    size = Math.max(MIN, size - 1);
    t.style.fontSize = `${size}px`;
    t.style.lineHeight = size <= 11 ? '1.15' : '1.3';
  }
}

