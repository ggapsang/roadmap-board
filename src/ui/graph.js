/**
 * 그래프 뷰 — 모든 이벤트를 노드로, 모든 포함·관계를 엣지로 그리는 힘 기반 그래프(표현 층, 읽기 전용).
 * refs/WOLFPACK_그래프뷰_개발요청서.md. 계산은 core/graph.js, 여기는 화면만.
 *
 * 지키는 것
 *   - 데이터는 열 때·바뀔 때마다 저장소에서 그대로 받는다(G-02). 무엇을 해도 쓰지 않는다(G-01·G-26).
 *   - 좌표·중력·배율은 어디에도 저장하지 않는다(G-03·G-05). 중력 세기·필터만 이 PC의 사용자 설정으로 기억한다.
 *   - SVG 요소는 데이터가 바뀔 때만 만들고, 틱마다 좌표 속성만 고친다(G-24).
 *   - 호버·선택은 색·불투명도만 바꾼다(G-28). 라벨은 호버·선택한 노드에 이어진 엣지에만(G-16).
 *   - 역할 이름(보드·트랙·카드·태스크)으로 나누지 않는다 — 모든 노드는 같은 원, 크기만 다르다(G-07·G-08).
 */
import { GRAPH } from '../config/index.js';
import { buildGraph, initialLayout, createSimulation, settle } from '../core/graph.js';
import { $, el, clear } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const PREF_KEY = 'wolfpack:graph-view';        // 중력 세기·필터 — 사용자 설정(협업 문서 아님, G-05)
const FAMILIES = ['contain', 'flow', 'cause', 'ref'];
const FAMILY_LABEL = { contain: '포함', flow: '흐름(선행·합류)', cause: '원인', ref: '참조' };
const CURVE = 26;                              // 겹친 관계를 벌리는 곡률(px) — G-17
const ARROW_GAP = 3;                           // 화살촉과 원 사이 여백

export class GraphView {
  constructor({ adapter, store }) {
    this.adapter = adapter;
    this.store = store;
    this.root = $('graphView');
    this.prefs = { ...GRAPH.sliders, hideIsolated: false, ...this.#loadPrefs() };
    this.sliders = { structure: this.prefs.structure, flow: this.prefs.flow };
    this.view = { k: 1, x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    this.#build();
    // 다른 화면에서 이벤트·관계가 바뀌면 그래프도 — 보던 좌표는 유지하고 낮은 온도로 다시 가열(4.6)
    let t = null;
    store.on('change', () => {
      if (!this.visible) return;
      clearTimeout(t);
      t = setTimeout(() => this.load({ keepPositions: true }), 400);
    });
  }

  get visible() { return !this.root.hidden; }

  #loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') ?? {}; } catch { return {}; }
  }

  #savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...this.sliders, hideIsolated: this.prefs.hideIsolated })); } catch { /* 이번 실행엔 적용 */ }
  }

  // ── 골격 (한 번) ───────────────────────────────────────

  #build() {
    const slider = (key, label) => {
      const input = el('input', { type: 'range', attrs: { min: '0', max: '1', step: '0.05', 'aria-label': label }, value: String(this.sliders[key]) });
      const out = el('output', { text: this.sliders[key].toFixed(2) });
      input.addEventListener('input', () => {
        this.sliders[key] = Number(input.value);        // 0이면 그 방향 중력은 완전히 꺼진다(G-27)
        out.textContent = this.sliders[key].toFixed(2);
        this.#savePrefs();
        this.#reheat(0.4);
      });
      return el('label.gv-slider', {}, [el('span', { text: label }), input, out]);
    };
    const hide = el('input', { type: 'checkbox', checked: this.prefs.hideIsolated });
    hide.addEventListener('change', () => { this.prefs.hideIsolated = hide.checked; this.#savePrefs(); this.load({ keepPositions: true }); });

    this.legend = el('div.gv-legend', {}, FAMILIES.map((f) => el('span.gv-key', { dataset: { family: f } }, [
      el('i.gv-swatch', { dataset: { family: f } }), document.createTextNode(FAMILY_LABEL[f]),
    ])));
    this.count = el('span.gv-count');
    this.info = el('aside.gv-info', { hidden: true });
    this.svg = svg('svg', { class: 'gv-svg', role: 'img', 'aria-label': '이벤트 그래프' });
    const defs = svg('defs');
    for (const f of [...FAMILIES, 'hl']) {
      const m = svg('marker', { id: `gv-arrow-${f}`, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      m.append(svg('path', { d: 'M0 1 L10 5 L0 9 z', class: `gv-arrowhead gv-f-${f}` }));
      defs.append(m);
    }
    this.vp = svg('g', { class: 'gv-vp' });
    this.gLinks = svg('g', { class: 'gv-links' });
    this.gNodes = svg('g', { class: 'gv-nodes' });
    this.gLabels = svg('g', { class: 'gv-labels' });
    this.gEdgeLabels = svg('g', { class: 'gv-edge-labels' });
    this.vp.append(this.gLinks, this.gNodes, this.gLabels, this.gEdgeLabels);
    this.svg.append(defs, this.vp);

    const bar = el('div.gv-bar', {}, [
      el('h2', { text: '그래프' }),
      this.count,
      el('div.gv-controls', {}, [
        slider('structure', '구조 중력'),
        slider('flow', '흐름 중력'),
        el('label.gv-check', {}, [hide, document.createTextNode('관계 없는 이벤트 숨기기')]),
        el('button.btn.outline.sm', { type: 'button', text: '맞춤', title: '전체가 보이게', on: { click: () => this.fit() } }),
      ]),
    ]);
    const note = el('p.gv-note', { text: '읽기 전용 — 끌기·확대는 보기만 바꿉니다. 세로는 소속의 깊이, 가로는 순서입니다. 두 중력을 0으로 두면 방향 없는 배치가 됩니다.' });
    this.stage = el('div.gv-stage', {}, [this.svg, this.info]);
    this.root.replaceChildren(bar, el('div.gv-sub', {}, [this.legend, note]), this.stage);
    this.#bindView();
  }

  // ── 열기·닫기·데이터 ─────────────────────────────────────

  /**
   * 그래프 탭을 보인다 — 보드와 무관한 독립 탭(BoardTabs가 부른다). 처음이면 결정적 배치로 새로 그리고,
   * 탭을 오가다 돌아오면 보던 배치·확대는 그대로 두고 데이터만 새로 받는다(4.6).
   */
  async show() {
    this.root.hidden = false;
    this.hover = null;                                     // 지난번 호버가 남아 처음부터 흐려지지 않게
    if (!this.graph) { this.selected = null; await this.load({ keepPositions: false, fit: true }); }
    else await this.load({ keepPositions: true });
  }

  /** 가린다. reset이면(탭을 닫음) 다음에 열 때 처음부터 — 같은 데이터면 같은 배치(G-22) */
  hide({ reset = false } = {}) {
    this.root.hidden = true;
    this.sim?.stop();
    if (reset) { this.graph = null; this.selected = null; this.view = { k: 1, x: 0, y: 0 }; }
  }

  /**
   * 저장소에서 받아 그래프를 다시 만든다. keepPositions면 보던 노드는 그 자리, 새 노드만 이웃 근처(4.6).
   * 처음 열 때는 수렴까지 한 번에 계산해 그린 뒤 맞춘다(결정적, G-22·4.3).
   */
  async load({ keepPositions = true, fit = false } = {}) {
    let data = null;
    try { data = await this.adapter.graphData?.(); } catch { data = null; }
    if (!data) { this.#empty('그래프는 SQLite(데스크톱 앱)에서만 볼 수 있습니다.'); return; }
    const keep = keepPositions && this.graph ? new Map(this.graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : null;
    let g = buildGraph(data);
    if (this.prefs.hideIsolated) {                         // 4.8 — 포함도 관계도 없는 이벤트 숨기기
      const nodes = g.nodes.filter((n) => n.degree > 0);
      g = { nodes, links: g.links, byId: new Map(nodes.map((n) => [n.id, n])) };
    }
    initialLayout(g, GRAPH, keep);
    this.sim?.stop();
    this.graph = g;
    this.sim = createSimulation(g, this.sliders);
    this.sim.on('tick', () => this.#draw());
    this.#elements();
    this.count.textContent = `이벤트 ${g.nodes.length} · 포함·관계 ${g.links.length}`;
    if (!keep) { settle(this.sim); this.#draw(); if (fit) this.fit(); } else this.#reheat(0.3);
    if (this.selected && !g.byId.has(this.selected)) this.selected = null;
    this.#emphasis();
    this.#showInfo();
  }

  #empty(text) {
    for (const g of [this.gLinks, this.gNodes, this.gLabels, this.gEdgeLabels]) clear(g);
    this.count.textContent = text;
  }

  /** 다시 가열 — 끌기·중력 조절·데이터 변경 때만(G-23). 수렴하면 d3가 스스로 멈춘다. */
  #reheat(alpha) {
    if (!this.sim) return;
    this.sim.alpha(Math.max(this.sim.alpha(), alpha)).restart();
  }

  // ── 요소 (데이터가 바뀔 때만) ───────────────────────────

  #elements() {
    const { nodes, links } = this.graph;
    const vis = new Set(nodes.map((n) => n.id));
    this.linkEls = new Map();
    this.nodeEls = new Map();
    this.labelEls = new Map();
    clear(this.gLinks); clear(this.gNodes); clear(this.gLabels); clear(this.gEdgeLabels);
    for (const l of links) {
      if (!vis.has(l.from) || !vis.has(l.to)) continue;
      const p = svg('path', { class: `gv-link gv-f-${l.family}${l.inCycle ? ' gv-cycle' : ''}`, 'marker-end': `url(#gv-arrow-${l.family})` });
      this.gLinks.append(p);
      this.linkEls.set(l.id, p);
    }
    for (const n of nodes) {
      const c = svg('circle', { class: 'gv-node', r: n.r.toFixed(2) });
      c.dataset.id = n.id;
      const title = svg('title');
      title.textContent = n.title || '(제목 없음)';
      c.append(title);
      this.gNodes.append(c);
      this.nodeEls.set(n.id, c);
      const t = svg('text', { class: 'gv-label', 'text-anchor': 'middle' });
      t.textContent = n.title || '(제목 없음)';
      this.gLabels.append(t);
      this.labelEls.set(n.id, t);
    }
  }

  /** 틱마다 — 좌표 속성만 고친다(G-24) */
  #draw() {
    const { nodes, links, byId } = this.graph;
    for (const n of nodes) {
      const c = this.nodeEls.get(n.id);
      c.setAttribute('cx', n.x.toFixed(1)); c.setAttribute('cy', n.y.toFixed(1));
      const t = this.labelEls.get(n.id);
      t.setAttribute('x', n.x.toFixed(1)); t.setAttribute('y', (n.y + n.r + 12).toFixed(1));
    }
    for (const l of links) {
      const p = this.linkEls.get(l.id);
      if (!p) continue;
      p.setAttribute('d', linkPath(byId.get(l.from), byId.get(l.to), l.curve));
    }
    this.#drawEdgeLabels();
  }

  // ── 강조 (색·불투명도만, G-28) ──────────────────────────

  #focus() { return this.hover ?? this.selected; }

  #emphasis() {
    if (!this.graph) return;
    const f = this.#focus();
    const near = new Set(f ? [f] : []);
    const hot = new Set();
    if (f) {
      for (const l of this.graph.links) {
        if (l.from === f || l.to === f) { near.add(l.from); near.add(l.to); hot.add(l.id); }
      }
    }
    for (const [id, c] of this.nodeEls) {
      c.classList.toggle('dim', !!f && !near.has(id));
      c.classList.toggle('near', !!f && near.has(id) && id !== f);
      c.classList.toggle('focus', id === f);
      c.classList.toggle('sel', id === this.selected);
    }
    for (const l of this.graph.links) {
      const p = this.linkEls.get(l.id);
      if (!p) continue;
      p.classList.toggle('dim', !!f && !hot.has(l.id));
      p.classList.toggle('hl', hot.has(l.id));
      p.setAttribute('marker-end', `url(#gv-arrow-${hot.has(l.id) ? 'hl' : l.family})`);
    }
    this.hot = hot;
    this.#labels(near);
    this.#buildEdgeLabels();
  }

  /** 노드 라벨 — 멀리서는 큰 노드만, 호버·선택과 그 이웃은 늘(4.5) */
  #labels(near = new Set()) {
    const min = GRAPH.labelMinScreenRadius;
    for (const n of this.graph?.nodes ?? []) {
      const show = near.has(n.id) || n.r * this.view.k >= min;
      this.labelEls.get(n.id)?.classList.toggle('show', show);
      this.labelEls.get(n.id)?.classList.toggle('dim', !!this.#focus() && !near.has(n.id));
    }
  }

  /** 엣지 라벨 — 호버·선택한 노드에 이어진 엣지에만(G-16). 강조가 바뀔 때만 만든다 */
  #buildEdgeLabels() {
    clear(this.gEdgeLabels);
    this.edgeLabelEls = new Map();
    for (const id of this.hot ?? []) {
      const l = this.graph.links.find((x) => x.id === id);
      const t = svg('text', { class: 'gv-edge-label', 'text-anchor': 'middle' });
      t.textContent = l.label + (l.inCycle ? ' · 순환 구간' : '');
      this.gEdgeLabels.append(t);
      this.edgeLabelEls.set(id, t);
    }
    this.#drawEdgeLabels();
  }

  /** 라벨은 강조한 노드에서 이웃 쪽으로 70% 지점 — 한 노드에 엣지가 몰려도 라벨이 방사형으로 흩어진다 */
  #drawEdgeLabels() {
    if (!this.edgeLabelEls?.size) return;
    const { byId } = this.graph;
    const f = this.#focus();
    for (const [id, t] of this.edgeLabelEls) {
      const l = this.graph.links.find((x) => x.id === id);
      const m = linkPoint(byId.get(l.from), byId.get(l.to), l.curve, l.from === f ? 0.7 : 0.3);
      t.setAttribute('x', m.x.toFixed(1)); t.setAttribute('y', (m.y - 4).toFixed(1));
    }
  }

  /** 선택한 노드의 정보(읽기 전용) — 하위 이벤트 수와 이어진 포함·관계 */
  #showInfo() {
    const id = this.selected;
    const n = id ? this.graph?.byId.get(id) : null;
    if (!n) { this.info.hidden = true; return; }
    const name = (x) => this.graph.byId.get(x)?.title || '(제목 없음)';
    const rows = [];
    for (const l of this.graph.links) {
      if (l.to === id) rows.push({ dir: '←', other: l.from, label: l.label, cyc: l.inCycle });
      else if (l.from === id) rows.push({ dir: '→', other: l.to, label: l.label, cyc: l.inCycle });
    }
    this.info.replaceChildren(
      el('div.gv-info-title', { text: n.title || '(제목 없음)' }),
      el('div.gv-info-sub', { text: `하위 이벤트 ${n.desc} · 포함·관계 ${rows.length}` }),
      el('div.gv-info-list', {}, rows.length ? rows.map((r) => el('div.gv-info-row', {}, [
        el('span.gv-info-dir', { text: r.dir }),
        el('button.linklike', { type: 'button', text: name(r.other), on: { click: () => { this.selected = r.other; this.#emphasis(); this.#showInfo(); } } }),
        el('em', { text: r.label + (r.cyc ? ' · 순환' : '') }),
      ])) : [el('div.empty', { text: '이어진 포함·관계가 없습니다.' })]),
    );
    this.info.hidden = false;
  }

  // ── 보기 조작 (확대·이동·끌기) — 데이터는 바뀌지 않는다 ──

  #applyView() {
    const { k, x, y } = this.view;
    this.vp.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${k.toFixed(4)})`);
    this.#labels(this.#nearSet());
  }

  #nearSet() {
    const f = this.#focus();
    const s = new Set(f ? [f] : []);
    if (f) for (const l of this.graph?.links ?? []) if (l.from === f || l.to === f) { s.add(l.from); s.add(l.to); }
    return s;
  }

  /** 전체 맞춤 — 수렴 후 한 번, 또는 '맞춤' 버튼(4.3) */
  fit() {
    const nodes = this.graph?.nodes ?? [];
    if (!nodes.length) return;
    const box = this.svg.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r + 16); }
    const pad = 40;
    const k = Math.max(0.05, Math.min(2, Math.min((box.width - pad * 2) / Math.max(1, x1 - x0), (box.height - pad * 2) / Math.max(1, y1 - y0))));
    this.view = { k, x: box.width / 2 - k * (x0 + x1) / 2, y: box.height / 2 - k * (y0 + y1) / 2 };
    this.#applyView();
  }

  #toGraph(clientX, clientY) {
    const r = this.svg.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.x) / this.view.k, y: (clientY - r.top - this.view.y) / this.view.k };
  }

  #bindView() {
    // 확대 — 휠, 커서 자리 기준
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.svg.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const k0 = this.view.k;
      const k = Math.max(0.05, Math.min(6, k0 * Math.exp(-e.deltaY * 0.0015)));
      this.view = { k, x: px - (px - this.view.x) * (k / k0), y: py - (py - this.view.y) * (k / k0) };
      this.#applyView();
    }, { passive: false });

    // 호버 — 이웃 강조(색·불투명도만)
    this.svg.addEventListener('pointerover', (e) => {
      const c = e.target.closest?.('.gv-node');
      const id = c?.dataset.id ?? null;
      if (id === this.hover || this.dragging) return;
      this.hover = id;
      this.#emphasis();
    });
    this.svg.addEventListener('pointerleave', () => { if (this.hover && !this.dragging) { this.hover = null; this.#emphasis(); } });

    // 끌기 — 노드면 그 노드를 잠시 고정해 움직이고(놓으면 풀림, G-26), 빈 곳이면 화면 이동.
    // 리스너는 window에(끄는 중 포인터가 svg 밖으로 나가도 이어지게).
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const c = e.target.closest?.('.gv-node');
      const node = c ? this.graph.byId.get(c.dataset.id) : null;
      const sx = e.clientX, sy = e.clientY;
      const v0 = { ...this.view };
      let moved = false;
      if (node) { this.dragging = node.id; }
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        if (node) {
          const p = this.#toGraph(ev.clientX, ev.clientY);
          node.fx = p.x; node.fy = p.y;
          this.sim.alphaTarget(0.3).restart();
        } else {
          this.view = { ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy };
          this.#applyView();
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        this.svg.classList.remove('panning');
        if (node) {
          node.fx = null; node.fy = null;                     // 일시적 고정만 — 놓으면 풀린다
          this.sim.alphaTarget(0);
          this.dragging = null;
        }
        if (!moved) {                                        // 클릭 — 선택/해제 (데이터 아님, 화면 상태)
          this.selected = node && this.selected !== node.id ? node.id : null;
          this.#emphasis();
          this.#showInfo();
        }
      };
      if (!node) this.svg.classList.add('panning');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }
}

/** 원 가장자리에서 원 가장자리까지 — 곡선이면 이차 베지어(G-17). 화살촉이 원에 가리지 않게 도착 쪽을 줄인다 */
function linkPath(a, b, curve) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  if (!curve) {
    const sx = a.x + ux * a.r, sy = a.y + uy * a.r;
    const ex = b.x - ux * (b.r + ARROW_GAP), ey = b.y - uy * (b.r + ARROW_GAP);
    return `M${sx.toFixed(1)},${sy.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`;
  }
  const cx = (a.x + b.x) / 2 - uy * curve * CURVE, cy = (a.y + b.y) / 2 + ux * curve * CURVE;
  const d1 = Math.hypot(cx - a.x, cy - a.y) || 1, d2 = Math.hypot(b.x - cx, b.y - cy) || 1;
  const sx = a.x + (cx - a.x) / d1 * a.r, sy = a.y + (cy - a.y) / d1 * a.r;
  const ex = b.x - (b.x - cx) / d2 * (b.r + ARROW_GAP), ey = b.y - (b.y - cy) / d2 * (b.r + ARROW_GAP);
  return `M${sx.toFixed(1)},${sy.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
}

/** 엣지 위의 한 점(t: 0=출발, 1=도착) — 곡선이면 이차 베지어 위 */
function linkPoint(a, b, curve, t) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const cx = (a.x + b.x) / 2 - dy / len * curve * CURVE, cy = (a.y + b.y) / 2 + dx / len * curve * CURVE;
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y };
}
