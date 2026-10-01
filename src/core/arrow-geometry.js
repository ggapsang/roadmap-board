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

/* ── 경로 찾기 ──────────────────────────────────────────────
   화살표가 다른 카드를 가로지르면 글씨를 덮는다. 그래서 후보 경로를 여러 개
   만들어 보고 **카드를 가장 적게 지나는** 것을 고른다.
   그래도 못 피하는 구간은 카드 뒤로 지나간다 (렌더 레이어가 카드보다 아래).   */

/** 축에 평행한 선분이 사각형 안에 잠긴 길이 */
function overlapLength(p1, p2, box) {
  const loX = Math.min(p1.x, p2.x), hiX = Math.max(p1.x, p2.x);
  const loY = Math.min(p1.y, p2.y), hiY = Math.max(p1.y, p2.y);
  const x = Math.max(0, Math.min(hiX, box.x + box.w) - Math.max(loX, box.x));
  const y = Math.max(0, Math.min(hiY, box.y + box.h) - Math.max(loY, box.y));
  // 세로선이면 x가 0에 가깝고, 가로선이면 y가 0에 가깝다
  if (hiX - loX < 0.5) return x > 0 || (loX >= box.x && loX <= box.x + box.w) ? y : 0;
  if (hiY - loY < 0.5) return y > 0 || (loY >= box.y && loY <= box.y + box.h) ? x : 0;
  return 0;
}

/** 경로가 장애물을 지나는 총 길이 + 전체 길이 */
function scorePath(points, obstacles) {
  let blocked = 0;
  let length = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (const box of obstacles) blocked += overlapLength(a, b, box);
  }
  return { blocked, length, bends: points.length - 2 };
}

const between = (v, lo, hi) => v > Math.min(lo, hi) && v < Math.max(lo, hi);

/**
 * 두 카드를 잇는 경로를 고른다.
 *
 * 세로(같은 트랙)든 가로(다른 트랙)든 후보를 여러 개 만들어 점수를 매긴다.
 * 점수는 "장애물을 지나는 길이"가 1순위, 그다음이 꺾임 수와 전체 길이다.
 * 가운데에서만 출발하지 않고 카드 가장자리 쪽 지점도 후보로 넣어, 겹치면
 * 옆으로 비껴갈 수 있게 한다.
 *
 * @param {{x,y,w,h}} from 선행 카드
 * @param {{x,y,w,h}} to   후행 카드
 * @param {boolean} sameTrack
 * @param {number} bite 0보다 크면 그만큼 카드 안쪽에서 시작/끝난다
 * @param {{x,y,w,h}[]} obstacles 피해야 할 다른 카드들
 */
export function routeBetween(from, to, sameTrack, bite = 0, obstacles = []) {
  const biteV = (box) => Math.min(Math.max(bite, 0), box.h * 0.4);
  const biteH = (box) => Math.min(Math.max(bite, 0), box.w * 0.4);

  // 카드 가장자리에서 조금 안쪽인 지점들 — 가운데가 막히면 옆으로 비껴간다
  const spread = (lo, size) => {
    const inset = Math.min(24, size * 0.3);
    return [lo + size / 2, lo + inset, lo + size - inset];
  };

  const candidates = [];
  const downward = to.y >= from.y + from.h - 1;

  // ── 세로 경로 (위 -> 아래) ───────────────────────────────
  if (downward) {
    const y1 = from.y + from.h - biteV(from);
    const y2 = to.y + biteV(to);
    const mid = (from.y + from.h + to.y) / 2;
    for (const sx of spread(from.x, from.w)) {
      for (const tx of spread(to.x, to.w)) {
        if (Math.abs(sx - tx) < 1) {
          candidates.push([{ x: sx, y: y1 }, { x: tx, y: y2 }]);
        } else {
          candidates.push([
            { x: sx, y: y1 }, { x: sx, y: mid }, { x: tx, y: mid }, { x: tx, y: y2 },
          ]);
        }
      }
    }
  }

  // ── 가로 경로 (옆면 -> 옆면) ─────────────────────────────
  const goRight = to.x + to.w / 2 >= from.x + from.w / 2;
  const sx = goRight ? from.x + from.w - biteH(from) : from.x + biteH(from);
  const tx = goRight ? to.x + biteH(to) : to.x + to.w - biteH(to);
  const sideOut = goRight ? from.x + from.w : from.x;
  const sideIn = goRight ? to.x : to.x + to.w;

  // 세로로 꺾을 x 후보: 두 카드 사이의 빈 곳 + 장애물 가장자리 바깥
  const turnXs = new Set([(sideOut + sideIn) / 2]);
  for (const box of obstacles) {
    if (between(box.x - 6, sideOut, sideIn)) turnXs.add(box.x - 6);
    if (between(box.x + box.w + 6, sideOut, sideIn)) turnXs.add(box.x + box.w + 6);
  }

  for (const sy of spread(from.y, from.h)) {
    for (const ty of spread(to.y, to.h)) {
      if (Math.abs(sy - ty) < 1) {
        candidates.push([{ x: sx, y: sy }, { x: tx, y: ty }]);
        continue;
      }
      for (const cx of turnXs) {
        candidates.push([
          { x: sx, y: sy }, { x: cx, y: sy }, { x: cx, y: ty }, { x: tx, y: ty },
        ]);
      }
    }
  }

  // 가로로 꺾을 y 후보 — 카드 사이 빈 줄로 지나간다
  const turnYs = new Set();
  for (const box of obstacles) {
    turnYs.add(box.y - 7);
    turnYs.add(box.y + box.h + 7);
  }
  for (const cy of turnYs) {
    if (!between(cy, from.y, to.y + to.h) && !between(cy, to.y, from.y + from.h)) continue;
    candidates.push([
      { x: from.x + from.w / 2, y: from.y + from.h - biteV(from) },
      { x: from.x + from.w / 2, y: cy },
      { x: to.x + to.w / 2, y: cy },
      { x: to.x + to.w / 2, y: to.y + biteV(to) },
    ]);
  }

  let best = null;
  let bestScore = null;
  for (const path of candidates) {
    const points = simplify(path);
    if (points.length < 2) continue;
    const score = scorePath(points, obstacles);
    if (
      !bestScore ||
      score.blocked < bestScore.blocked - 0.5 ||
      (Math.abs(score.blocked - bestScore.blocked) <= 0.5 &&
        (score.bends < bestScore.bends ||
          (score.bends === bestScore.bends && score.length < bestScore.length)))
    ) {
      best = points;
      bestScore = score;
    }
  }

  return best ?? [
    { x: from.x + from.w / 2, y: from.y + from.h },
    { x: to.x + to.w / 2, y: to.y },
  ];
}

/* ── 사용자가 고친 화살표 (꺾은선 연결선) ─────────────────────
   파워포인트의 꺾은선 화살표처럼: 양 끝은 카드 테두리 위의 한 점(어느 변 · 변 위 비율), 가운데 구간의 위치는
   조절 손잡이로 옮긴다. 값은 카드에 대한 비율이라 카드가 움직이거나 커져도 모양이 따라간다(보드 표시 값,
   doc.meta.arrows). 고친 적 없는 화살표는 위의 routeBetween이 자동으로 잡는다.                         */

const NORMAL = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * 카드 테두리 위의 점 — 변(side)과 그 변 위 비율(t: 위·아래 변은 왼→오, 왼·오른 변은 위→아래)
 * @returns {{x:number, y:number, side:string, n:{x:number,y:number}}} n = 바깥쪽 법선
 */
export function anchorPoint(box, a) {
  const t = clamp01(Number(a?.t) || 0);
  const side = NORMAL[a?.side] ? a.side : 'bottom';
  const p = side === 'top' ? { x: box.x + box.w * t, y: box.y }
    : side === 'bottom' ? { x: box.x + box.w * t, y: box.y + box.h }
      : side === 'left' ? { x: box.x, y: box.y + box.h * t } : { x: box.x + box.w, y: box.y + box.h * t };
  return { ...p, side, n: NORMAL[side] };
}

/** 점 p에서 가장 가까운 카드 테두리 위치 → {side, t} (끝점 손잡이를 끌 때) */
export function anchorFromPoint(box, p) {
  const tx = clamp01((p.x - box.x) / (box.w || 1));
  const ty = clamp01((p.y - box.y) / (box.h || 1));
  const cand = [
    { side: 'top', t: tx, d: Math.abs(p.y - box.y) + Math.max(0, box.x - p.x, p.x - box.x - box.w) },
    { side: 'bottom', t: tx, d: Math.abs(p.y - box.y - box.h) + Math.max(0, box.x - p.x, p.x - box.x - box.w) },
    { side: 'left', t: ty, d: Math.abs(p.x - box.x) + Math.max(0, box.y - p.y, p.y - box.y - box.h) },
    { side: 'right', t: ty, d: Math.abs(p.x - box.x - box.w) + Math.max(0, box.y - p.y, p.y - box.y - box.h) },
  ];
  const best = cand.sort((a, b) => a.d - b.d)[0];
  return { side: best.side, t: Math.round(best.t * 1000) / 1000 };
}

/**
 * 가운데 구간을 옮길 수 있는 축 — 두 끝의 법선이 나란하면(둘 다 가로 또는 둘 다 세로) 가운데 구간이 하나 생겨
 * 그 위치(m)를 옮긴다: 'x'면 세로 구간의 x, 'y'면 가로 구간의 y. 법선이 엇갈리면(한 번 꺾임) 옮길 구간이 없다(null).
 */
export function adjustAxis(A, B) {
  const ah = A.n.x !== 0, bh = B.n.x !== 0;
  if (ah && bh) return 'x';
  if (!ah && !bh) return 'y';
  return null;
}

const STUB = 16;   // 변에서 곧게 빠져나오는 최소 길이(꺾기 전에)

const sgn = (v) => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);

/** 선분 p→q가 상자 안쪽을 지나는가(테두리에 닿는 것은 괜찮다) */
function crosses(p, q, box) {
  const e = 0.5;
  const loX = Math.min(p.x, q.x), hiX = Math.max(p.x, q.x), loY = Math.min(p.y, q.y), hiY = Math.max(p.y, q.y);
  return hiX > box.x + e && loX < box.x + box.w - e && hiY > box.y + e && loY < box.y + box.h - e;
}

/**
 * 후보 경로가 연결선으로 맞는가 — 시작은 A의 바깥쪽(법선)으로 나가고, 끝은 B의 바깥쪽에서 들어온다(머리가 카드를 향한다).
 * 중간에 되돌아가지 않고(180° 꺾임 없음), 두 카드 안쪽을 지나지 않는다.
 */
function validRoute(pts, A, B, boxes) {
  const q = simplify(pts);
  if (q.length < 2) return false;
  const d0 = { x: sgn(q[1].x - q[0].x), y: sgn(q[1].y - q[0].y) };
  const dl = { x: sgn(q[q.length - 1].x - q[q.length - 2].x), y: sgn(q[q.length - 1].y - q[q.length - 2].y) };
  if (d0.x !== A.n.x || d0.y !== A.n.y) return false;
  if (dl.x !== -B.n.x || dl.y !== -B.n.y) return false;
  for (let i = 1; i < q.length - 1; i += 1) {
    const a = { x: sgn(q[i].x - q[i - 1].x), y: sgn(q[i].y - q[i - 1].y) };
    const b = { x: sgn(q[i + 1].x - q[i].x), y: sgn(q[i + 1].y - q[i].y) };
    if (a.x === -b.x && a.y === -b.y) return false;                       // 되돌아감
  }
  for (let i = 0; i < q.length - 1; i += 1) for (const box of boxes) if (box && crosses(q[i], q[i + 1], box)) return false;
  return true;
}

/**
 * 꺾은선 경로 — A(시작 테두리 점) → B(끝 테두리 점). 파워포인트 꺾은선 연결선처럼 A의 변에서 바깥으로 나가 B의 변으로
 * 바깥에서 들어온다. 후보(한 번 꺾임 → 가운데 구간 하나 → 짧게 빠져나간 뒤 꺾임)를 차례로 보고 맞는 첫 경로를 쓴다.
 * m은 가운데 구간 위치(그 구간 양끝 기준 비율, 0.5 = 한가운데). boxes는 두 카드 상자(가로지르는지 본다).
 * @returns {{points, axis:'x'|'y'|null, mid:{x,y}|null, adj:{axis,from,to}|null, valid:boolean}}
 *   adj — 가운데 손잡이를 끌 때 m = (좌표 − from) / (to − from)
 */
export function elbowRoute(A, B, m = 0.5, boxes = []) {
  const k = Number.isFinite(Number(m)) ? Number(m) : 0.5;
  const P = ({ x, y }) => ({ x, y });
  const ah = A.n.x !== 0, bh = B.n.x !== 0;
  const lerp = (a, b) => a + (b - a) * k;
  const cand = [];
  // 곧은 선 — 마주 보는 두 변이 한 줄 위에 있으면
  cand.push({ points: [P(A), P(B)], axis: null });
  // 한 번 꺾임 — A의 법선 방향으로 먼저
  cand.push({ points: [P(A), ah ? { x: B.x, y: A.y } : { x: A.x, y: B.y }, P(B)], axis: null });
  // 가운데 구간 하나(두 번 꺾임) — 나란한 법선
  if (ah && bh) { const mx = lerp(A.x, B.x); cand.push({ points: [P(A), { x: mx, y: A.y }, { x: mx, y: B.y }, P(B)], axis: 'x', adj: { axis: 'x', from: A.x, to: B.x }, mid: { x: mx, y: (A.y + B.y) / 2 } }); }
  if (!ah && !bh) { const my = lerp(A.y, B.y); cand.push({ points: [P(A), { x: A.x, y: my }, { x: B.x, y: my }, P(B)], axis: 'y', adj: { axis: 'y', from: A.y, to: B.y }, mid: { x: (A.x + B.x) / 2, y: my } }); }
  // 변에서 짧게 곧게 빠져나간 뒤 — 카드 사이가 좁으면 더 짧게(16 → 8 → 4px)
  for (const st of [STUB, STUB / 2, STUB / 4]) {
    const A1 = { x: A.x + A.n.x * st, y: A.y + A.n.y * st };
    const B1 = { x: B.x + B.n.x * st, y: B.y + B.n.y * st };
    // 한 번 꺾어 들어가기(엇갈린 법선) — 두 모서리 다
    cand.push({ points: [P(A), A1, { x: B1.x, y: A1.y }, B1, P(B)], axis: null });
    cand.push({ points: [P(A), A1, { x: A1.x, y: B1.y }, B1, P(B)], axis: null });
    // 가운데 가로 구간 또는 세로 구간
    { const my = lerp(A1.y, B1.y); cand.push({ points: [P(A), A1, { x: A1.x, y: my }, { x: B1.x, y: my }, B1, P(B)], axis: 'y', adj: { axis: 'y', from: A1.y, to: B1.y }, mid: { x: (A1.x + B1.x) / 2, y: my } }); }
    { const mx = lerp(A1.x, B1.x); cand.push({ points: [P(A), A1, { x: mx, y: A1.y }, { x: mx, y: B1.y }, B1, P(B)], axis: 'x', adj: { axis: 'x', from: A1.x, to: B1.x }, mid: { x: mx, y: (A1.y + B1.y) / 2 } }); }
  }
  for (const c of cand) {
    if (validRoute(c.points, A, B, boxes)) {
      const pts = simplify(c.points);
      // 가운데 구간이 접혀 사라졌으면(곧은 선이 됐으면) 손잡이도 없다
      const hasMid = c.axis && pts.length >= 4;
      return { points: pts, axis: hasMid ? c.axis : null, mid: hasMid ? c.mid : null, adj: hasMid ? c.adj : null, valid: true };
    }
  }
  // 맞는 것이 없으면(카드가 겹쳐 있는 등) 한 번 꺾임으로 그린다
  return { points: simplify(cand[1].points), axis: null, mid: null, adj: null, valid: false };
}

/**
 * 자동 경로(routeBetween의 점열)를 고칠 수 있는 꼴로 옮긴다 — 편집을 시작할 때 모양이 튀지 않게.
 * @returns {{a:{side,t}, b:{side,t}, m:number}}
 */
export function overrideFromRoute(points, from, to) {
  const pts = simplify(points);
  const first = pts[0], last = pts[pts.length - 1];
  const a = anchorFromPoint(from, first);
  const b = anchorFromPoint(to, last);
  const A = anchorPoint(from, a), B = anchorPoint(to, b);
  // 자동 경로의 가운데 구간 좌표를 같은 꼴의 m으로 — 기본(0.5)으로 그려 본 꼴의 adj 기준
  let m = 0.5;
  const r = elbowRoute(A, B, 0.5, [from, to]);
  if (r.adj && pts.length >= 4) {
    const v = r.adj.axis === 'x' ? pts[1].x : pts[1].y;
    if (Math.abs(r.adj.to - r.adj.from) > 0.5) m = (v - r.adj.from) / (r.adj.to - r.adj.from);
  }
  return { a, b, m: Math.round(m * 1000) / 1000 };
}
