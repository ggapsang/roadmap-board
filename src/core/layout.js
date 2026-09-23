/**
 * 레인(겹침) 배치 계산 — 순수 함수. DOM을 모른다.
 *
 * 기획안 §4 겹침 처리:
 *   같은 트랙 안에서 기간이 겹치는 일정끼리만 *클러스터*로 묶어 좌우로 분할한다.
 *   겹치지 않는 구간의 일정은 전체 폭을 쓴다. (트랙 전체를 일괄 분할하면 빈 열이 생겨 폐기)
 *
 * 마일스톤은 레인 계산에서 제외하고 컬럼 폭 기준 오버레이로 그린다.
 */
import { dayIndex } from './dates.js';
import { LAYOUT } from '../config/index.js';

/**
 * @param {object[]} tracks
 * @param {object[]} items
 * @param {Date} origin  보드 시작일
 * @param {(item) => boolean} isVisible
 * @returns {{placement: Map<string,{lane:number,lanes:number}>, trackLanes: Map<string,number>}}
 */
export function computeLayout(tracks, items, origin, isVisible = () => true) {
  const placement = new Map();
  const trackLanes = new Map();

  for (const track of tracks) {
    const bars = items
      .filter((i) => i.t === track.id && i.ty !== 'ms' && isVisible(i))
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

    trackLanes.set(track.id, maxLanes);
  }

  return { placement, trackLanes };
}

/** 레인 수 → 컬럼 폭 계수 (기획안 §4: 1 + 0.55×(n−1), 상한 2.4) */
export function laneWidthFactor(lanes) {
  return Math.min(LAYOUT.laneWidthMax, 1 + LAYOUT.laneGrowth * (Math.max(1, lanes) - 1));
}

/** CSS grid-template-columns 문자열 생성 */
export function gridTemplate(tracks, trackLanes) {
  const cols = tracks
    .map((t) => {
      const f = laneWidthFactor(trackLanes.get(t.id) ?? 1).toFixed(2);
      return `minmax(calc(var(--colmin) * ${f}),${f}fr)`;
    })
    .join(' ');
  return `var(--gut-m) var(--gut-w) ${cols} var(--u10)`;
}
