/**
 * 블록 화살표 기하 — DOM을 모르는 순수 계산.
 *
 * 직교 폴리라인(축에 평행한 꺾은선)을 받아 지정한 굵기의 **외곽선 다각형**으로
 * 바꾼다. 선을 굵게 그리는 것(stroke-width)과 달리 다각형이라 파워포인트
 * 화살표 도형처럼 테두리와 채움을 따로 줄 수 있고, 머리 크기도 몸통과
 * 독립적으로 정할 수 있다.
 */

/** 같은 지점이 연달아 있거나 일직선인 중간점을 없앤다 */
export function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push({ ...p });
  }
  // 일직선 위의 중간점 제거
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
      (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
    if (collinear) out.splice(i, 1);
  }
  return out;
}

const unit = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
};

/** 마지막 구간을 length만큼 줄인다 (머리가 들어갈 자리) */
function trimTail(points, length) {
  const pts = points.map((p) => ({ ...p }));
  const n = pts.length;
  const a = pts[n - 2], b = pts[n - 1];
  const seg = Math.hypot(b.x - a.x, b.y - a.y);
  const cut = Math.min(length, Math.max(0, seg - 0.5));
  const d = unit(a, b);
  pts[n - 1] = { x: b.x - d.x * cut, y: b.y - d.y * cut };
  return { pts, tip: b, dir: d };
}

/** 축 평행 두 직선의 교점. 평행이면 fallback을 돌려준다. */
function meet(p1, d1, p2, d2, fallback) {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-6) return fallback;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/** 폴리라인을 한쪽으로 offset한 점열 */
function offsetSide(pts, offset) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const d = unit(pts[i], pts[i + 1]);
    const n = { x: -d.y * offset, y: d.x * offset };   // 왼쪽 법선
    const a = { x: pts[i].x + n.x, y: pts[i].y + n.y };
    const b = { x: pts[i + 1].x + n.x, y: pts[i + 1].y + n.y };

    if (i === 0) out.push(a);
    else {
      const prev = out[out.length - 1];
      const prevDir = unit(pts[i - 1], pts[i]);
      out[out.length - 1] = meet(prev, prevDir, a, d, a);
    }
    out.push(b);
  }
  return out;
}

/**
 * 직교 폴리라인 → 블록 화살표 다각형의 SVG path.
 * @param {{x:number,y:number}[]} rawPoints 시작점 … 끝점(화살표 머리가 놓일 자리)
 * @param {number} width 몸통 굵기
 * @param {number} headScale 머리 크기 배율 (몸통 대비)
 * @returns {string|null} path의 d 속성
 */
export function blockArrowPath(rawPoints, width, headScale = 2) {
  const pts = simplify(rawPoints);
  if (pts.length < 2) return null;

  const headLen = width * headScale * 0.8;
  const headHalf = (width * headScale) / 2;

  const { pts: body, tip, dir } = trimTail(pts, headLen);
  if (simplify(body).length < 2) {
    // 몸통이 남지 않을 만큼 짧으면 머리만 그린다
    return trianglePath(tip, dir, headHalf, headLen);
  }

  const left = offsetSide(body, width / 2);
  const right = offsetSide(body, -width / 2);

  const base = body[body.length - 1];
  const perp = { x: -dir.y, y: dir.x };
  const shoulderL = { x: base.x + perp.x * headHalf, y: base.y + perp.y * headHalf };
  const shoulderR = { x: base.x - perp.x * headHalf, y: base.y - perp.y * headHalf };

  const ring = [
    ...left,
    shoulderL,
    tip,
    shoulderR,
    ...right.reverse(),
  ];

  return 'M' + ring.map((p) => `${round(p.x)},${round(p.y)}`).join(' L') + ' Z';
}

function trianglePath(tip, dir, half, len) {
  const perp = { x: -dir.y, y: dir.x };
  const base = { x: tip.x - dir.x * len, y: tip.y - dir.y * len };
  const a = { x: base.x + perp.x * half, y: base.y + perp.y * half };
  const b = { x: base.x - perp.x * half, y: base.y - perp.y * half };
  return `M${round(a.x)},${round(a.y)} L${round(tip.x)},${round(tip.y)} L${round(b.x)},${round(b.y)} Z`;
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * 두 카드 사이의 직교 경로를 만든다.
 *
 * 같은 트랙   : 아래 → 위 (세로 연결)
 * 다른 트랙   : 옆면 → 옆면 (가로 연결)
 *   PPT 시안처럼 트랙을 넘는 선후행은 카드 위가 아니라 측면에 붙는다.
 *
 * @param {{x,y,w,h}} from 선행 카드
 * @param {{x,y,w,h}} to   후행 카드
 * @param {boolean} sameTrack
 */
export function routeBetween(from, to, sameTrack) {
  const fromCx = from.x + from.w / 2;
  const toCx = to.x + to.w / 2;
  const fromCy = from.y + from.h / 2;
  const toCy = to.y + to.h / 2;

  // 같은 트랙이고 후행이 아래에 있으면 세로로 잇는다
  if (sameTrack && to.y >= from.y + from.h - 1) {
    const y1 = from.y + from.h;
    const y2 = to.y;
    if (Math.abs(fromCx - toCx) < 1) return [{ x: fromCx, y: y1 }, { x: toCx, y: y2 }];
    const mid = y1 + (y2 - y1) / 2;
    return [
      { x: fromCx, y: y1 },
      { x: fromCx, y: mid },
      { x: toCx, y: mid },
      { x: toCx, y: y2 },
    ];
  }

  // 그 외는 측면 연결
  const goRight = toCx >= fromCx;
  const sx = goRight ? from.x + from.w : from.x;
  const tx = goRight ? to.x : to.x + to.w;

  if (Math.abs(fromCy - toCy) < 1) {
    return [{ x: sx, y: fromCy }, { x: tx, y: toCy }];
  }

  // 두 카드 사이 빈 공간에서 방향을 튼다
  const gapMid = (sx + tx) / 2;
  const mx = goRight ? Math.max(sx + 8, gapMid) : Math.min(sx - 8, gapMid);
  return [
    { x: sx, y: fromCy },
    { x: mx, y: fromCy },
    { x: mx, y: toCy },
    { x: tx, y: toCy },
  ];
}
