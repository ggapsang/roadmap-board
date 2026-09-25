/**
 * 선후행 화살표.
 *
 * 표시 전용이다. 자동 일정 재계산은 하지 않는다 (기획안 D-4).
 * 렌더 직후 실제 DOM 좌표를 읽어 경로를 잡는다 (기획안 §8).
 *
 * 파워포인트 화살표 도형처럼 보이도록 선이 아니라 다각형으로 그린다.
 * 굵기와 머리 크기는 문서의 표시 설정(meta.display)에서 온다.
 */
import { blockArrowPath, routeBetween } from '../../core/arrow-geometry.js';

const NS = 'http://www.w3.org/2000/svg';

export function createArrowLayer() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'arrows');
  svg.append(document.createElementNS(NS, 'g'));
  return svg;
}

/**
 * @param {SVGElement} layer createArrowLayer()가 만든 svg
 * @param {HTMLElement} grid .ev 카드들을 품은 컨테이너
 * @param {object[]} items
 * @param {{arrowWidth:number, arrowHead:number}} display
 */
export function drawArrows(layer, grid, items, display) {
  const group = layer.querySelector('g');
  if (!group) return;
  group.replaceChildren();

  const width = display?.arrowWidth ?? 7;
  const head = display?.arrowHead ?? 2;
  const bite = display?.arrowBite ?? 22;

  // 카드는 컬럼 안에, 중첩 카드는 상위 카드 안에 들어 있다.
  // offsetLeft/offsetTop은 부모 기준이므로 grid 기준 절대 좌표로 환산한다.
  const box = new Map();
  for (const card of grid.querySelectorAll('.ev')) {
    let x = 0, y = 0;
    for (let node = card; node && node !== grid; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    box.set(card.dataset.id, { x, y, w: card.offsetWidth, h: card.offsetHeight });
  }

  const trackOf = new Map(items.map((i) => [i.id, i.place.t]));
  // 상위 일정(컨테이너) 몸통은 배경이 비어 있어 가로질러도 글씨를 가리지 않는다.
  // 장애물로 치면 피할 곳이 없어지므로 제외한다.
  const container = new Set(items.map((i) => i.parent).filter(Boolean));

  // 다만 컨테이너의 '제목 바'는 z:8·불투명이라 그 위를 지나는 화살표를 덮는다.
  // 제목 바만 장애물로 넣어 화살표가 그 띠를 피해 돌게 한다 (몸통은 그대로 통과).
  const titleObstacles = [];
  for (const cont of grid.querySelectorAll('.ev.container')) {
    const t = cont.querySelector(':scope > .t');
    if (!t) continue;
    let x = 0, y = 0;
    for (let node = t; node && node !== grid; node = node.offsetParent) {
      x += node.offsetLeft;
      y += node.offsetTop;
    }
    titleObstacles.push({ x, y, w: t.offsetWidth, h: t.offsetHeight });
  }

  for (const item of items) {
    for (const depId of item.dp ?? []) {
      const from = box.get(depId);
      const to = box.get(item.id);
      if (!from || !to) continue;             // 필터로 숨겨진 경우

      const obstacles = [...titleObstacles];
      for (const [id, rect] of box) {
        if (id === depId || id === item.id || container.has(id)) continue;
        obstacles.push(rect);
      }

      const sameTrack = trackOf.get(depId) === item.place.t;
      const d = blockArrowPath(routeBetween(from, to, sameTrack, bite, obstacles), width, head);
      if (!d) continue;

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', 'arrow');
      path.append(makeTitle(depId, item, items));
      group.append(path);
    }
  }
}

function makeTitle(depId, item, items) {
  const title = document.createElementNS(NS, 'title');
  const dep = items.find((i) => i.id === depId);
  title.textContent = `${dep?.ti ?? depId} → ${item.ti}`;
  return title;
}
