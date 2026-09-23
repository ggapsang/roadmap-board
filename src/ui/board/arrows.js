/**
 * 선후행 화살표 — 렌더 직후 실제 좌표로 직교 라우팅한다 (기획안 §8).
 * 표시 전용. 자동 일정 재계산은 하지 않는다 (D-4).
 */
const NS = 'http://www.w3.org/2000/svg';

export function createArrowLayer() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'arrows');
  svg.innerHTML =
    '<defs><marker id="ah" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">' +
    '<path d="M0 1l6 3-6 3z" fill="var(--text-tertiary)"/></marker></defs><g></g>';
  return svg;
}

/**
 * @param {SVGElement} layer createArrowLayer()가 만든 svg
 * @param {HTMLElement} grid  .ev 카드들을 품은 컨테이너
 * @param {object[]} items
 */
export function drawArrows(layer, grid, items) {
  const group = layer.querySelector('g');
  if (!group) return;
  group.textContent = '';

  const pos = new Map();
  for (const card of grid.querySelectorAll('.ev')) {
    const col = card.parentElement;
    pos.set(card.dataset.id, {
      x: col.offsetLeft + card.offsetLeft,
      w: card.offsetWidth,
      y: card.offsetTop,
      h: card.offsetHeight,
    });
  }

  for (const item of items) {
    for (const depId of item.dp ?? []) {
      const from = pos.get(depId);
      const to = pos.get(item.id);
      if (!from || !to) continue;   // 필터로 숨겨진 경우

      const x1 = from.x + from.w / 2;
      const y1 = from.y + from.h;
      const x2 = to.x + to.w / 2;
      const y2 = to.y;
      const mid = y1 + Math.max(8, (y2 - y1) / 2);

      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', y2 >= y1
        ? `M${x1},${y1} V${mid} H${x2} V${y2 - 6}`
        : `M${x1},${y1} V${y1 + 10} H${(x1 + x2) / 2} V${y2 - 14} H${x2} V${y2 - 6}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--text-tertiary)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-dasharray', '3 3');
      path.setAttribute('marker-end', 'url(#ah)');
      path.setAttribute('opacity', '.75');
      group.append(path);
    }
  }
}
