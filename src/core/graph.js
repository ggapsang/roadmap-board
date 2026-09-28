/**
 * 그래프 뷰 계산 — 순수 로직(DOM 모름). refs/WOLFPACK_그래프뷰_개발요청서.md 3장.
 *
 * 입력은 저장소에서 매번 받은 이벤트·포함·관계 그대로다(G-02 — 사본·별도 스키마 없음). 여기서 만드는
 * 좌표·하위 수는 전부 파생값이고 어디에도 저장하지 않는다(G-03·G-04).
 *
 * 역할 이름(보드·트랙·카드·태스크)으로 나누는 분기는 없다(G-07). 노드는 이벤트, 엣지는 포함 또는 관계일 뿐이다.
 * 포함은 세 종류(순서 있음·순서 없음·구성)를 모두 'contain' 계열로 다룬다 — 구성(조합)도 포함이다(SYSTEM.md).
 */
import { forceSimulation, forceManyBody, forceLink, forceCollide, forceX, forceY } from 'd3-force';
import { GRAPH } from '../config/index.js';

/** 포함 간선의 세부 종류 */
const containKind = (c) => (c.compose ? 'compose' : c.ordered ? 'ordered' : 'unordered');

/**
 * 저장소 데이터 → 노드·엣지. 끝점 이벤트가 없는 간선은 버린다.
 * @param {{events:{id,title,status}[], contain:{parent_id,child_id,ordered,compose}[], rels:{id,type,from_id,to_id}[]}} data
 * @returns {{nodes: object[], links: object[], byId: Map}}
 */
export function buildGraph(data, cfg = GRAPH) {
  const nodes = (data.events ?? []).map((e, index) => ({ id: e.id, title: e.title ?? '', status: e.status ?? 'plan', index }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  for (const c of (data.contain ?? [])) {
    if (!byId.has(c.parent_id) || !byId.has(c.child_id) || c.parent_id === c.child_id) continue;
    const kind = containKind(c);
    links.push({ id: `c:${c.parent_id}>${c.child_id}`, type: 'contain', kind, family: 'contain', from: c.parent_id, to: c.child_id, label: cfg.labels[`contain:${kind}`] });
  }
  for (const r of (data.rels ?? [])) {
    if (!byId.has(r.from_id) || !byId.has(r.to_id) || r.from_id === r.to_id) continue;
    const family = cfg.typeFamily[r.type];
    if (!family) continue;                                   // 모르는 관계 종류는 그리지 않는다
    links.push({ id: `r:${r.id}`, type: r.type, kind: r.type, family, from: r.from_id, to: r.to_id, label: cfg.labels[r.type] ?? r.type });
  }
  markCycles(nodes, links, cfg);
  sizeNodes(nodes, links, cfg);
  markParallel(links);
  for (const n of nodes) n.degree = 0;
  for (const l of links) { byId.get(l.from).degree += 1; byId.get(l.to).degree += 1; }
  return { nodes, links, byId };
}

/**
 * 범위 — 한 이벤트(rootId)가 품은 것 + 한 걸음 (2026-09-28 사용자 결정: 펼친 이벤트에서 연 그래프).
 *   안쪽  rootId와, 포함을 부모 → 자식으로 끝까지 따라 닿는 이벤트(포함 세 종류 모두 — 구성도 포함이다)
 *   바깥  안쪽과 엣지 하나로 바로 이어진 이벤트(포함·관계, 방향 무관). n.outside = true — 흐리게 그린다
 * 엣지는 한쪽 끝이라도 안쪽인 것만 남긴다. 크기(desc·r)·순환은 **전체**에서 계산한 값을 그대로 둔다 —
 * 잘라 낸 뒤 다시 세면 바깥 이벤트가 실제보다 작아 보인다(G-12). 차수만 이 범위 안에서 다시 센다.
 * 역할(무엇이 보드인지)을 보지 않는다 — 출발 이벤트 하나와 포함·관계만 본다(G-07).
 * @returns {{nodes, links, byId, inside:number, outside:number}|null} rootId가 그래프에 없으면 null
 */
export function scopeGraph(graph, rootId) {
  if (rootId == null || !graph.byId.has(rootId)) return null;
  const kids = new Map();
  for (const l of graph.links) {
    if (l.family !== 'contain') continue;
    if (!kids.has(l.from)) kids.set(l.from, []);
    kids.get(l.from).push(l.to);
  }
  const inside = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const v = stack.pop();
    for (const c of kids.get(v) ?? []) if (!inside.has(c)) { inside.add(c); stack.push(c); }
  }
  const links = graph.links.filter((l) => inside.has(l.from) || inside.has(l.to));
  const keep = new Set(inside);
  for (const l of links) { keep.add(l.from); keep.add(l.to); }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));   // 원래 순서 그대로 — 같은 데이터면 같은 배치(G-22)
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) { n.outside = !inside.has(n.id); n.degree = 0; }
  for (const l of links) { byId.get(l.from).degree += 1; byId.get(l.to).degree += 1; }
  return { nodes, links, byId, inside: inside.size, outside: nodes.length - inside.size };
}

/**
 * 순환 표시(G-19, 4.1) — 방향 중력이 걸리는 계열마다가 아니라, 같은 방향으로 미는 엣지들을 **합친** 그래프에서
 * 강결합 요소(Tarjan)를 찾는다. 흐름 쪽은 선행·합류·원인을 합친다(각자는 순환 금지여도 합치면 순환일 수 있다).
 * 크기 2 이상 요소 안의 엣지는 inCycle — 방향 중력에서 뺀다.
 */
export function markCycles(nodes, links, cfg = GRAPH) {
  const groups = new Map();                                  // 방향(u) 기준 묶음: 'contain' | 'flow'
  for (const l of links) {
    l.inCycle = false;
    const f = cfg.families[l.family];
    if (!f?.u) continue;                                     // 참조: 방향 중력 없음
    const g = f.slider;                                      // 같은 슬라이더(같은 방향) = 한 묶음
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(l);
  }
  for (const group of groups.values()) {
    const comp = tarjan(nodes.map((n) => n.id), group);
    const size = new Map();
    for (const c of comp.values()) size.set(c, (size.get(c) ?? 0) + 1);
    for (const l of group) {
      const c = comp.get(l.from);
      if (c === comp.get(l.to) && size.get(c) >= 2) l.inCycle = true;
    }
  }
}

/** Tarjan 강결합 요소 — 반복형(깊은 사슬에서도 스택이 넘치지 않게). @returns Map<노드, 요소 번호> */
export function tarjan(ids, edges) {
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of edges) adj.get(e.from)?.push(e.to);
  let index = 0; let compN = 0;
  const idx = new Map(); const low = new Map(); const on = new Set(); const st = []; const comp = new Map();
  for (const root of ids) {
    if (idx.has(root)) continue;
    const work = [[root, 0]];
    idx.set(root, index); low.set(root, index); index += 1; st.push(root); on.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const next = adj.get(v) ?? [];
      if (i < next.length) {
        top[1] += 1;
        const w = next[i];
        if (!idx.has(w)) {
          idx.set(w, index); low.set(w, index); index += 1; st.push(w); on.add(w);
          work.push([w, 0]);
        } else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === idx.get(v)) {
          let w;
          do { w = st.pop(); on.delete(w); comp.set(w, compN); } while (w !== v);
          compN += 1;
        }
      }
    }
  }
  return comp;
}

/**
 * 노드 크기(3.1) — 포함을 부모 → 자식으로 끝까지 따라 도달하는 **중복 없는** 하위 이벤트 수 d(e) (자신 제외,
 * 포함 세 종류 모두, G-10~G-12). 자식이 먼저 오는 순서로 한 번 훑으며 비트셋을 합친다.
 * r = min(rMax, rMin + k·√d) (G-13). 계산값은 노드에만 둔다(G-04).
 */
export function sizeNodes(nodes, links, cfg = GRAPH) {
  const n = nodes.length;
  const at = new Map(nodes.map((x, i) => [x.id, i]));
  const kids = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (const l of links) {
    if (l.family !== 'contain') continue;
    const p = at.get(l.from), c = at.get(l.to);
    kids[p].push(c); indeg[c] += 1;
  }
  const words = Math.ceil(n / 32) || 1;
  const desc = new Array(n).fill(null);
  // 위상 순서(부모 먼저) → 거꾸로(자식 먼저)
  const order = [];
  const q = [];
  const deg = indeg.slice();
  for (let i = 0; i < n; i += 1) if (!deg[i]) q.push(i);
  while (q.length) { const v = q.shift(); order.push(v); for (const c of kids[v]) if (--deg[c] === 0) q.push(c); }
  const visitAll = (i) => {                                   // 순환에 든 노드(있어선 안 되지만) — 직접 따라간다
    const bits = new Uint32Array(words);
    const seen = new Set([i]); const stack = [...kids[i]];
    while (stack.length) { const v = stack.pop(); if (seen.has(v)) continue; seen.add(v); bits[v >>> 5] |= 1 << (v & 31); stack.push(...kids[v]); }
    return bits;
  };
  const done = new Set(order);
  for (let k = order.length - 1; k >= 0; k -= 1) {
    const v = order[k];
    const bits = new Uint32Array(words);
    for (const c of kids[v]) {
      bits[c >>> 5] |= 1 << (c & 31);
      const dc = desc[c] ?? visitAll(c);
      for (let w = 0; w < words; w += 1) bits[w] |= dc[w];
    }
    desc[v] = bits;
  }
  for (let i = 0; i < n; i += 1) if (!done.has(i)) desc[i] = visitAll(i);
  const { rMin, k, rMax } = cfg.node;
  nodes.forEach((x, i) => {
    let d = 0;
    for (const w of desc[i]) d += popcount(w);
    x.desc = d;
    x.r = Math.min(rMax, rMin + k * Math.sqrt(d));
  });
}

function popcount(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * 같은 두 이벤트 사이의 여러 관계 — 선 하나로 합치지 않고 곡선으로 벌린다(G-17).
 * curve = 가운데를 0으로 한 벌림 순번(선 2개면 ±0.5, 3개면 -1·0·+1). 방향이 반대인 선도 같은 기준으로
 * 벌리도록 정렬된 끝점 쪽을 기준 방향으로 삼는다. 하나뿐이면 0(직선).
 */
function markParallel(links) {
  const groups = new Map();
  for (const l of links) {
    const key = [l.from, l.to].sort().join('\u0001');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  for (const g of groups.values()) {
    g.forEach((l, i) => {
      const offset = i - (g.length - 1) / 2;
      l.curve = offset * (l.from > l.to ? -1 : 1);
    });
  }
}

/** id를 시드로 한 고정 난수(G-22) — 같은 이벤트는 늘 같은 흔들림 */
function seeded(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {                                             // mulberry32
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 결정적 초기 배치(3.3, G-22).
 *   y = 포함 깊이(부모 없는 이벤트에서의 **최장** 경로) × dy
 *   x = 흐름 순위(흐름 계열 최장 경로) × dx. 흐름 관계가 없으면 부모들의 x 평균.
 *   + id 시드 흔들림. 순환 표시된 엣지는 깊이·순위 계산에서 뺀다.
 * keep(id → {x,y})를 주면 그 노드는 좌표를 유지하고(4.6), 새 노드만 부모·흐름 이웃·중심 근처에 둔다.
 */
export function initialLayout(graph, cfg = GRAPH, keep = null) {
  const { nodes, links } = graph;
  const { dy, dx, jitter } = cfg.init;
  const longest = (family) => {
    const kids = new Map(nodes.map((n) => [n.id, []]));
    const deg = new Map(nodes.map((n) => [n.id, 0]));
    for (const l of links) {
      if (l.inCycle || !(family === 'contain' ? l.family === 'contain' : cfg.families[l.family]?.slider === 'flow')) continue;
      kids.get(l.from).push(l.to); deg.set(l.to, deg.get(l.to) + 1);
    }
    const depth = new Map(nodes.map((n) => [n.id, 0]));
    const q = nodes.filter((n) => !deg.get(n.id)).map((n) => n.id);
    while (q.length) {
      const v = q.shift();
      for (const c of kids.get(v)) {
        depth.set(c, Math.max(depth.get(c), depth.get(v) + 1));
        deg.set(c, deg.get(c) - 1);
        if (!deg.get(c)) q.push(c);
      }
    }
    return { depth, kids };
  };
  const { depth: level } = longest('contain');
  const { depth: rank } = longest('flow');
  const inFlow = new Set();
  const parents = new Map(nodes.map((n) => [n.id, []]));
  for (const l of links) {
    if (cfg.families[l.family]?.slider === 'flow') { inFlow.add(l.from); inFlow.add(l.to); }
    if (l.family === 'contain') parents.get(l.to).push(l.from);
  }
  // x: 흐름 순위, 없으면 부모 평균 — 부모가 먼저 정해지도록 포함 깊이 순으로
  const x = new Map();
  const byLevel = [...nodes].sort((a, b) => level.get(a.id) - level.get(b.id) || a.index - b.index);
  for (const n of byLevel) {
    if (inFlow.has(n.id)) { x.set(n.id, rank.get(n.id) * dx); continue; }
    const ps = parents.get(n.id).filter((p) => x.has(p));
    x.set(n.id, ps.length ? ps.reduce((s, p) => s + x.get(p), 0) / ps.length : 0);
  }
  for (const n of nodes) {
    const kept = keep?.get(n.id);
    if (kept) { n.x = kept.x; n.y = kept.y; n.vx = 0; n.vy = 0; continue; }
    const rnd = seeded(n.id);
    let bx = x.get(n.id); let by = level.get(n.id) * dy;
    if (keep) {                                              // 새로 생긴 노드 — 이미 있는 이웃 근처에서 태어난다
      const anchor = parents.get(n.id).map((p) => keep.get(p)).find(Boolean)
        ?? links.filter((l) => l.from === n.id || l.to === n.id).map((l) => keep.get(l.from === n.id ? l.to : l.from)).find(Boolean);
      if (anchor) { bx = anchor.x; by = anchor.y + dy * 0.6; } else { bx = 0; by = 0; }
    }
    n.x = bx + (rnd() - 0.5) * jitter * 2;
    n.y = by + (rnd() - 0.5) * jitter * 2;
    n.vx = 0; n.vy = 0;
  }
  // 중심을 원점 근처로(약한 중심력이 끌어당기는 자리와 맞춘다)
  if (!keep && nodes.length) {
    const mx = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
    const my = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
    for (const n of nodes) { n.x -= mx; n.y -= my; }
  }
}

/**
 * 방향 중력(3.2) — 엣지 출발→도착 변위를 u로 사영한 값이 gap에 못 미칠 때만 u 방향으로 벌린다(G-20).
 * 참조(u 없음)·순환 엣지는 제외(G-18·G-19). 슬라이더 0이면 그 계열은 완전히 꺼진다(G-27).
 * sliders는 바깥이 들고 있는 객체 — 값을 바꾸면 다음 틱부터 적용된다.
 */
export function forceDirectional(links, cfg, sliders) {
  function force(alpha) {
    for (const l of links) {
      const c = cfg.families[l.family];
      if (!c?.u || l.inCycle) continue;
      const g = sliders[c.slider] ?? 0;
      if (g === 0) continue;
      const a = l.source; const b = l.target;
      const along = (b.x - a.x) * c.u[0] + (b.y - a.y) * c.u[1];
      if (along >= c.gap) continue;
      const p = (c.gap - along) * c.strength * g * alpha * 0.5;
      a.vx -= c.u[0] * p; a.vy -= c.u[1] * p;
      b.vx += c.u[0] * p; b.vy += c.u[1] * p;
    }
  }
  force.initialize = () => {};
  return force;
}

/**
 * 시뮬레이션 — 반발(Barnes-Hut, G-25)·스프링(참조는 약하게)·충돌·약한 중심·방향 중력.
 * 자동으로 돌지 않는다(stop 상태로 만든다) — 화면이 tick()을 부르거나 restart한다. 수렴(alpha<alphaMin)하면
 * 멈춘다(G-23). d3의 난수원은 고정 시드라 같은 입력이면 같은 결과다(G-22).
 */
export function createSimulation(graph, sliders, cfg = GRAPH) {
  const { nodes, links } = graph;
  for (const l of links) { l.source = l.from; l.target = l.to; }
  const s = cfg.sim;
  return forceSimulation(nodes)
    .stop()
    .force('charge', forceManyBody().strength(s.charge).theta(s.theta))
    .force('link', forceLink(links).id((d) => d.id).distance(s.linkDistance)
      .strength((l) => cfg.families[l.family]?.spring ?? 0.2))
    .force('collide', forceCollide((d) => d.r + s.collidePad))
    .force('x', forceX(0).strength(s.center))
    .force('y', forceY(0).strength(s.center))
    .force('directional', forceDirectional(links, cfg, sliders));
}

/** 수렴할 때까지(또는 최대 max틱) 동기로 돌린다 — 검증·초기 맞춤용. @returns 돈 틱 수 */
export function settle(sim, max = 1000) {
  let n = 0;
  while (sim.alpha() >= sim.alphaMin() && n < max) { sim.tick(); n += 1; }
  return n;
}
