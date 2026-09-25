/**
 * 레인(겹침) 배치 계산 — 순수 함수. DOM을 모른다.
 *
 * 기획안 §4 겹침 처리:
 *   같은 트랙 안에서 기간이 겹치는 일정끼리만 *클러스터*로 묶어 좌우로 분할한다.
 *   겹치지 않는 구간의 일정은 전체 폭을 쓴다. (트랙 전체를 일괄 분할하면 빈 열이 생겨 폐기)
 *
 * 일정은 다른 일정을 품을 수 있다 (item.parent). 상위 일정이 트랙에서 자리를
 * 잡고, 자식들은 그 안에서 다시 같은 규칙으로 나뉜다. 계산 단위만 "트랙"에서
 * "형제 묶음"으로 바뀔 뿐 알고리즘은 하나다.
 *
 * 마일스톤은 레인 계산에서 제외하고 폭 기준 오버레이로 그린다.
 */
import { dayIndex } from './dates.js';
import { LAYOUT } from '../config/index.js';

/**
 * 형제끼리 레인을 나눈다.
 *
 * 최상위에서는 마일스톤을 빼고 계산한다 — 트랙 폭 전체를 가로지르는 표식이라
 * 자리를 차지하면 안 된다 (기획안 §4).
 * 상위 일정 안에서는 반대로 넣고 계산한다. 좁은 상자 안에서 폭을 다 먹으면
 * 같이 든 막대의 제목을 덮어 버린다.
 *
 * @returns {number} 최대 레인 수
 */
function assignLanes(siblings, origin, placement, { includeMilestones = false } = {}) {
  // 최상위에서 레인 계산에서 빼는 건 '점' 마일스톤(s===e)뿐이다. 기간을 가진
  // 마일스톤(전시회 등)은 막대처럼 자리를 차지하므로 형제와 레인을 나눈다 —
  // 안 그러면 트랙 폭을 가로질러 그 기간의 막대들을 덮는다.
  const bars = siblings
    .filter((i) => includeMilestones || i.ty !== 'ms' || i.s !== i.e)
    .map((i) => ({ item: i, s: dayIndex(i.s, origin), e: dayIndex(i.e, origin) }))
    .sort((a, b) => a.s - b.s || a.e - b.e);

  let maxLanes = 1;
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];               // laneEnds[k] = k번 레인의 마지막 종료 인덱스
    for (const b of cluster) {
      let lane = laneEnds.findIndex((end) => end < b.s);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = b.e;
      placement.set(b.item.id, { lane, lanes: 1 });
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const b of cluster) placement.get(b.item.id).lanes = lanes;
    maxLanes = Math.max(maxLanes, lanes);
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const b of bars) {
    // 시작이 현재 클러스터의 최대 종료보다 뒤면 겹치지 않는다 → 클러스터를 끊는다
    if (cluster.length && b.s > clusterEnd) flush();
    cluster.push(b);
    clusterEnd = Math.max(clusterEnd, b.e);
  }
  flush();

  return maxLanes;
}

/**
 * @param {object[]} tracks
 * @param {object[]} items
 * @param {Date} origin  보드 시작일
 * @param {(item) => boolean} isVisible
 * @returns {{placement: Map, trackLanes: Map, childrenOf: Map, depthOf: Map}}
 */
export function computeLayout(tracks, items, origin, isVisible = () => true) {
  const placement = new Map();
  const trackLanes = new Map();

  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenOf = new Map();
  for (const item of items) {
    // 상위 일정이 필터로 숨겨졌으면 자식도 갈 곳이 없다
    const parent = item.parent && byId.has(item.parent) ? item.parent : null;
    if (!childrenOf.has(parent)) childrenOf.set(parent, []);
    childrenOf.get(parent).push(item);
  }

  // 트랙마다 최상위 일정들로 레인을 나눈다
  const roots = childrenOf.get(null) ?? [];
  for (const track of tracks) {
    const own = roots.filter((i) => i.place.t === track.id && isVisible(i));
    trackLanes.set(track.id, assignLanes(own, origin, placement));
  }

  // 상위 일정 안에서 자식들끼리 다시 나눈다
  for (const [parentId, kids] of childrenOf) {
    if (parentId === null) continue;
    assignLanes(kids.filter(isVisible), origin, placement, { includeMilestones: true });
  }

  // 렌더 순서를 정하기 위한 깊이
  const depthOf = new Map();
  const depth = (item, guard = 0) => {
    if (depthOf.has(item.id)) return depthOf.get(item.id);
    const parent = item.parent ? byId.get(item.parent) : null;
    const d = !parent || guard > 32 ? 0 : depth(parent, guard + 1) + 1;
    depthOf.set(item.id, d);
    return d;
  };
  for (const item of items) depth(item);

  return { placement, trackLanes, childrenOf, depthOf };
}

/** 레인 수 → 컬럼 폭 계수 (기획안 §4: 1 + 0.55×(n−1), 상한 2.4) */
export function laneWidthFactor(lanes) {
  return Math.min(LAYOUT.laneWidthMax, 1 + LAYOUT.laneGrowth * (Math.max(1, lanes) - 1));
}

/**
 * CSS grid-template-columns 문자열 생성.
 * track.w가 지정돼 있으면 그 폭을 쓰고, 없으면 레인 수에 비례해 자동으로 잡는다.
 */
export function gridTemplate(tracks, trackLanes) {
  const cols = tracks
    .map((t) => {
      if (t.w) return `${t.w}px`;
      const f = laneWidthFactor(trackLanes.get(t.id) ?? 1).toFixed(2);
      // 폭이 정해지지 않은 트랙은 남는 공간을 비율(f)로 나눠 채운다. 최소를 0으로 둬
      // 패널이 열려 폭이 줄면 가로 스크롤을 만들지 않고 함께 좁아진다. 폭이 꼭 필요하면
      // 트랙별 너비(t.w)를 지정한다 — 그때만 스크롤이 생긴다.
      return `minmax(0,${f}fr)`;
    })
    .join(' ');
  return `var(--gut-m) var(--gut-w) ${cols} var(--u10)`;
}
