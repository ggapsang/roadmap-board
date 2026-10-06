/**
 * 선후행 화살표.
 *
 * 표시 전용이다. 자동 일정 재계산은 하지 않는다 (기획안 D-4).
 * 렌더 직후 실제 DOM 좌표를 읽어 경로를 잡는다 (기획안 §8).
 *
 * 파워포인트 화살표 도형처럼 보이도록 선이 아니라 다각형으로 그린다.
 * 굵기와 머리 크기는 문서의 표시 설정(meta.display)에서 온다.
 */
import { blockArrowPath, routeBetweenKeyed, anchorPoint, elbowRoute } from '../../core/arrow-geometry.js';

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
 * @param {Object<string,{a,b,m}>} [arrows] 사용자가 고친 화살표 모양(doc.meta.arrows) — 관계 id → 꺾은선 연결선
 * @param {Map} [forms] 관계 id → 처음 고른 경로 모양 — 화면 크기만 바뀐 그리기(확대·축소·행 높이·창 크기)에서 이어 쓴다. 문서나
 *   보이는 범위가 바뀌면 부르는 쪽이 비운다(그때만 새로 고른다). 자동 경로는 고른 후보의 이름(key — 어느 변 어느 지점, 어느
 *   카드 옆으로 꺾는가), 고친 화살표는 고른 꼴(f)을 기억한다. 크기가 바뀌어도 같은 꺾임으로 그려져 갑자기 튀지 않는다.
 * 그린 화살표의 기하는 layer._geom(관계 id → {from,to,points,box,form,route,A,B,custom})에 남긴다 — 편집 손잡이가 쓴다.
 *   form·route·A·B는 고친 화살표에만 있다.
 */
export function drawArrows(layer, grid, items, relations, display, arrows = {}, forms = null) {
  const group = layer.querySelector('g');
  if (!group) return;
  group.replaceChildren();
  const geom = new Map();
  layer._geom = geom;

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
    titleObstacles.push({ id: `title:${cont.dataset.id}`, x, y, w: t.offsetWidth, h: t.offsetHeight });
  }

  // 화살표는 '선행(dep)' 관계만 그린다 (from=선행 → to=후행).
  for (const rel of relations) {
    if (rel.type !== 'dep') continue;
    const from = box.get(rel.from);
    const to = box.get(rel.to);
    if (!from || !to) continue;             // 필터로 숨겨진 경우

    const obstacles = [...titleObstacles];
    for (const [id, rect] of box) {
      if (id === rel.from || id === rel.to || container.has(id)) continue;
      obstacles.push({ id, ...rect });
    }

    // 사용자가 고친 모양(doc.meta.arrows — 카드 테두리 위 양 끝, 가운데 위치, 꼴)이 있으면 그것, 없으면 자동 경로.
    // 둘 다 처음 고른 꼴을 forms에 두고 이어 쓴다 — 확대·축소에도 같은 꺾임.
    const o = arrows?.[rel.id];
    const kept = forms?.get(rel.id);
    let points, g;
    if (o) {
      const form = { ...o };
      if (!form.f && kept?.f) form.f = kept.f;           // 꼴을 기억하지 않은 옛 값은 처음 고른 꼴을 이어 쓴다
      const A = anchorPoint(from, form.a), B = anchorPoint(to, form.b);
      const route = elbowRoute(A, B, form.m, [from, to], form.f ?? null);
      form.f = route.form;
      forms?.set(rel.id, { f: form.f });
      points = route.points;
      g = { form, route, A, B };
    } else {
      const sameTrack = trackOf.get(rel.from) === trackOf.get(rel.to);
      const r = routeBetweenKeyed(from, to, sameTrack, bite, obstacles, kept?.key ?? null);
      forms?.set(rel.id, { key: r.key });
      points = r.points;
      g = {};
    }
    const d = blockArrowPath(points, width, head);
    if (!d) continue;
    geom.set(rel.id, { from: rel.from, to: rel.to, points, box: { from, to }, ...g, custom: !!o });

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'arrow');
    path.dataset.from = rel.from;       // 카드에 올렸을 때 이어진 화살표를 찾는다(Board#linkHighlight)
    path.dataset.to = rel.to;
    path.dataset.rel = rel.id;
    if (o) path.classList.add('custom');
    path.append(makeTitle(rel.from, rel.to, items));
    group.append(path);
  }

  // 참조 — 화살표 없는 선. 양 끝 카드가 이 보드에 다 그려졌을 때만(트랙·보드·다른 보드와의 참조는 편집 창 목록에서 본다).
  // 선행처럼 다른 카드를 피해 경로를 고른다(카드 가장자리에서 시작 — 머리가 없다). 가는 선이라 누르기 쉽게 넓은 투명 선을 겹친다.
  for (const rel of relations) {
    if (rel.type !== 'ref') continue;
    const from = box.get(rel.from);
    const to = box.get(rel.to);
    if (!from || !to) continue;
    const obstacles = [...titleObstacles];
    for (const [id, rect] of box) {
      if (id === rel.from || id === rel.to || container.has(id)) continue;
      obstacles.push({ id, ...rect });
    }
    const kept = forms?.get(rel.id);
    const sameTrack = trackOf.get(rel.from) === trackOf.get(rel.to);
    const r = routeBetweenKeyed(from, to, sameTrack, 0, obstacles, kept?.key ?? null);
    forms?.set(rel.id, { key: r.key });
    const d = 'M' + r.points.map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(' L');
    for (const cls of ['ref-hit', 'ref-line']) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', cls);
      path.dataset.from = rel.from;
      path.dataset.to = rel.to;
      path.dataset.rel = rel.id;
      if (cls === 'ref-hit') {
        const title = document.createElementNS(NS, 'title');
        const a = items.find((i) => i.id === rel.from), b = items.find((i) => i.id === rel.to);
        title.textContent = `참조 · ${a?.ti ?? rel.from} — ${b?.ti ?? rel.to}`;
        path.append(title);
      }
      group.append(path);
    }
  }
}

function makeTitle(fromId, toId, items) {
  const title = document.createElementNS(NS, 'title');
  const from = items.find((i) => i.id === fromId);
  const to = items.find((i) => i.id === toId);
  title.textContent = `${from?.ti ?? fromId} → ${to?.ti ?? toId}`;
  return title;
}
