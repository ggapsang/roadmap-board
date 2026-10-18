/**
 * 그래프 뷰 — 모든 이벤트를 노드로, 모든 포함·관계를 엣지로 그리는 힘 기반 그래프(표현 층, 읽기 전용).
 * refs/WOLFPACK_그래프뷰_개발요청서.md. 계산은 core/graph.js, 여기는 화면만.
 *
 * 지키는 것
 *   - 데이터는 열 때·바뀔 때마다 저장소에서 그대로 받는다(G-02). 무엇을 해도 쓰지 않는다(G-01·G-26).
 *   - 좌표·중력·배율은 어디에도 저장하지 않는다(G-03·G-05). 중력 세기·필터·패널·스타일만 이 PC의 사용자 설정으로 기억한다.
 *   - SVG 요소는 데이터가 바뀔 때만 만들고, 틱마다 좌표 속성만 고친다(G-24).
 *   - 호버·선택·검색은 색·불투명도·테두리만 바꾼다(G-28). 라벨은 호버·선택한 노드에 이어진 엣지에만(G-16).
 *   - 역할 이름으로 나누지 않는다(G-07). 노드 색·모양은 **사용자가 스타일 탭에서 고른 것**만 — 그래프 전체 기본값 + 고른 노드만 따로
 *     (2026-10-19 사용자, 요청서 G-08의 '모두 원·한 색'을 사용자 선택으로 연다. 기본은 모두 원·한 색).
 *
 * 오른쪽 패널 — '정보'(누른 노드의 상태·기간·담당·진척·비고·이어진 것, 저장소에서 읽기만)와 '스타일'.
 * 위쪽 검색 — 제목으로 노드를 찾아 강조하고, 고르면 그 노드로 화면을 옮긴다.
 *
 * 범위(scope) — 첫 화면에서 열면 전체, 보드에서 열면 그 보드가 품은 것 + 한 걸음(core/graph.js scopeGraph).
 * 범위마다 탭이 따로라, 범위별로 보던 배치·확대·선택을 따로 기억한다(메모리에만). 한 걸음 바깥 노드는 흐리게 그린다.
 */
import { GRAPH, STATUSES } from '../config/index.js';
import { buildGraph, scopeGraph, initialLayout, createSimulation, settle } from '../core/graph.js';
import { $, el, clear } from './dom.js';
import { renderMarkdown } from './markdown.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const PREF_KEY = 'wolfpack:graph-view';        // 중력 세기·필터·패널 — 사용자 설정(협업 문서 아님, G-05)
const STYLE_KEY = 'wolfpack:graph-style';      // 노드·선 스타일 — 사용자 설정(G-03·G-05: 이벤트·배치·공유 문서에 넣지 않는다)
const FAMILIES = ['contain', 'flow', 'cause', 'ref'];
const FAMILY_LABEL = { contain: '포함', flow: '흐름(선행·합류)', cause: '원인', ref: '참조' };
const CURVE = 26;                              // 겹친 관계를 벌리는 곡률(px) — G-17
const ARROW_GAP = 3;                           // 화살촉과 노드 사이 여백
const SEARCH_MAX = 30;                         // 검색 결과 목록에 보이는 수

const PALETTE = GRAPH.style.palette.map((p) => p.key);
const SHAPES = GRAPH.style.shapes.map((p) => p.key);
const HEADS = GRAPH.style.heads.map((p) => p.key);
const colorVar = (key) => `var(--graph-c-${key})`;
const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

export class GraphView {
  constructor({ adapter, store }) {
    this.adapter = adapter;
    this.store = store;
    this.root = $('graphView');
    this.prefs = { ...GRAPH.sliders, hideIsolated: false, side: true, sideTab: 'info', ...this.#loadPrefs() };
    this.sliders = { structure: this.prefs.structure, flow: this.prefs.flow };
    this.style = this.#loadStyle();
    this.view = { k: 1, x: 0, y: 0 };
    this.hover = null;
    this.selected = null;
    this.query = '';
    this.matches = null;         // 검색에 걸린 노드 id 집합 — 검색어가 없으면 null
    this.scope = null;           // 펼친 범위의 저장소 id — null이면 전체
    this.scopeName = '';
    this.saved = new Map();      // 범위 → { graph, view, selected } (탭을 오갈 때 보던 모습)
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
    const keep = { ...this.sliders, hideIsolated: this.prefs.hideIsolated, side: this.prefs.side, sideTab: this.prefs.sideTab };
    try { localStorage.setItem(PREF_KEY, JSON.stringify(keep)); } catch { /* 이번 실행엔 적용 */ }
  }

  /** 스타일 — 저장된 값 중 팔레트·모양·화살촉 목록에 있는 것만 받는다(없는 key는 기본값) */
  #loadStyle() {
    const d = GRAPH.style.defaults;
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(STYLE_KEY) ?? '{}') ?? {}; } catch { raw = {}; }
    const pick = (v, list, def) => (list.includes(v) ? v : def);
    const node = { color: pick(raw.node?.color, PALETTE, d.node.color), shape: pick(raw.node?.shape, SHAPES, d.node.shape) };
    const families = {};
    for (const f of FAMILIES) {
      const r = raw.families?.[f] ?? {};
      families[f] = { color: pick(r.color, ['base', ...PALETTE], d.families[f].color), head: pick(r.head, HEADS, d.families[f].head) };
    }
    const nodes = {};
    for (const [id, o] of Object.entries(raw.nodes && typeof raw.nodes === 'object' ? raw.nodes : {})) {
      const x = {};
      if (PALETTE.includes(o?.color)) x.color = o.color;
      if (SHAPES.includes(o?.shape)) x.shape = o.shape;
      if (Object.keys(x).length) nodes[id] = x;
    }
    return { node, families, nodes };
  }

  #saveStyle() {
    try { localStorage.setItem(STYLE_KEY, JSON.stringify(this.style)); } catch { /* 이번 실행엔 적용 */ }
  }

  /** 한 노드의 색·모양 — 그 노드만 정한 것이 있으면 그것, 없으면 전체 기본값 */
  #nodeStyle(id) {
    const o = this.style.nodes[id] ?? {};
    return { color: o.color ?? this.style.node.color, shape: o.shape ?? this.style.node.shape };
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
    this.svg = svg('svg', { class: 'gv-svg', role: 'img', 'aria-label': '이벤트 그래프' });
    this.defs = svg('defs');
    this.vp = svg('g', { class: 'gv-vp' });
    this.gLinks = svg('g', { class: 'gv-links' });
    this.gNodes = svg('g', { class: 'gv-nodes' });
    this.gLabels = svg('g', { class: 'gv-labels' });
    this.gEdgeLabels = svg('g', { class: 'gv-edge-labels' });
    this.vp.append(this.gLinks, this.gNodes, this.gLabels, this.gEdgeLabels);
    this.svg.append(this.defs, this.vp);

    this.title = el('h2', { text: '그래프' });
    this.sideBtn = el('button.btn.outline.sm', { type: 'button', text: '패널', title: '오른쪽 패널(정보·스타일) 보이기/숨기기',
      attrs: { 'aria-pressed': String(this.prefs.side) }, on: { click: () => this.#setSide(!this.prefs.side) } });
    const bar = el('div.gv-bar', {}, [
      this.title,
      this.count,
      this.#buildSearch(),
      el('div.gv-controls', {}, [
        slider('structure', '구조 중력'),
        slider('flow', '흐름 중력'),
        el('label.gv-check', {}, [hide, document.createTextNode('관계 없는 이벤트 숨기기')]),
        el('button.btn.outline.sm', { type: 'button', text: '맞춤', title: '전체가 보이게', on: { click: () => this.fit() } }),
        this.sideBtn,
      ]),
    ]);
    const note = el('p.gv-note', { text: '읽기 전용 — 끌기·확대는 보기만 바꿉니다. 세로는 소속의 깊이, 가로는 순서입니다. 두 중력을 0으로 두면 방향 없는 배치가 됩니다.' });
    this.stage = el('div.gv-stage', {}, [this.svg]);
    this.#buildSide();
    this.root.replaceChildren(bar, el('div.gv-sub', {}, [this.legend, note]), el('div.gv-main', {}, [this.stage, this.side]));
    this.#applyStyle();
    this.#bindView();
  }

  // ── 오른쪽 패널 (정보·스타일) ───────────────────────────

  #buildSide() {
    this.sideTabs = {};
    const tab = (key, label) => {
      const b = el('button.gv-tab', { type: 'button', text: label, attrs: { role: 'tab' }, on: { click: () => this.#setSideTab(key) } });
      this.sideTabs[key] = b;
      return b;
    };
    this.infoBody = el('div.gv-pane', { dataset: { pane: 'info' } });
    this.styleBody = el('div.gv-pane', { dataset: { pane: 'style' } });
    this.side = el('aside.gv-side', { hidden: !this.prefs.side }, [
      el('div.gv-tabs', { attrs: { role: 'tablist' } }, [tab('info', '정보'), tab('style', '스타일')]),
      this.infoBody, this.styleBody,
    ]);
    this.#setSideTab(this.prefs.sideTab === 'style' ? 'style' : 'info', { save: false });
    this.#showInfo();
  }

  #setSide(on) {
    this.prefs.side = on;
    this.side.hidden = !on;
    this.sideBtn.setAttribute('aria-pressed', String(on));
    this.#savePrefs();
  }

  #setSideTab(key, { save = true } = {}) {
    this.prefs.sideTab = key;
    for (const [k, b] of Object.entries(this.sideTabs)) b.setAttribute('aria-selected', String(k === key));
    this.infoBody.hidden = key !== 'info';
    this.styleBody.hidden = key !== 'style';
    if (key === 'style') this.#renderStyle();
    if (save) this.#savePrefs();
  }

  /** 정보 — 누른 노드의 상태·기간·담당·진척·비고(저장소에서 읽기만)와 이어진 포함·관계 */
  #showInfo() {
    const id = this.selected;
    const n = id ? this.graph?.byId.get(id) : null;
    if (this.styleBody && !this.styleBody.hidden) this.#renderStyle();
    if (!n) {
      this.infoBody.replaceChildren(el('div.gv-hint', { text: '노드를 누르면 그 이벤트의 정보(상태·기간·담당·비고와 이어진 것)가 여기에 나옵니다.' }));
      return;
    }
    const name = (x) => this.graph.byId.get(x)?.title || '(제목 없음)';
    const rows = [];
    for (const l of this.graph.links) {
      if (l.to === id) rows.push({ dir: '←', other: l.from, label: l.label, cyc: l.inCycle });
      else if (l.from === id) rows.push({ dir: '→', other: l.to, label: l.label, cyc: l.inCycle });
    }
    const facts = el('div.gv-facts', {}, [el('span.muted', { text: '불러오는 중…' })]);
    const noteBox = el('div.gv-note-box');
    this.infoBody.replaceChildren(
      el('div.gv-info-title', { text: n.title || '(제목 없음)' }),
      el('div.gv-info-sub', { text: `하위 이벤트 ${n.desc} · 포함·관계 ${rows.length}${n.outside ? ' · 이 범위 바깥(한 걸음)' : ''}` }),
      facts,
      el('div.gv-info-head', { text: '비고' }),
      noteBox,
      el('div.gv-info-head', { text: '이어진 포함·관계' }),
      el('div.gv-info-list', {}, rows.length ? rows.map((r) => el('div.gv-info-row', {}, [
        el('span.gv-info-dir', { text: r.dir }),
        el('button.linklike', { type: 'button', text: name(r.other), on: { click: () => this.#goTo(r.other) } }),
        el('em', { text: r.label + (r.cyc ? ' · 순환' : '') }),
      ])) : [el('div.empty', { text: '이어진 포함·관계가 없습니다.' })]),
    );
    // 본질(상태·기간·담당·진척·비고)은 눌렀을 때만 읽는다 — 그래프 재료에 비고까지 싣지 않는다
    const ask = (this.infoAsk = Symbol('info'));
    Promise.resolve(this.adapter.eventsById?.([id])).then((list) => {
      if (ask !== this.infoAsk) return;
      const e = (list ?? []).find((x) => x.id === id);
      if (!e) { facts.replaceChildren(el('span.muted', { text: '세부 정보를 읽지 못했습니다.' })); return; }
      const chip = (label, value) => (value ? el('div.gv-fact', {}, [el('span', { text: label }), el('b', { text: value })]) : null);
      const when = e.s && e.e ? (e.s === e.e ? e.s : `${e.s} ~ ${e.e}`) : '';
      facts.replaceChildren(...[
        chip('상태', STATUS_LABEL[e.st] ?? e.st ?? ''),
        chip('기간', when),
        chip('담당', e.og ?? ''),
        chip('진척', e.pg ? `${e.pg}%` : ''),
      ].filter(Boolean));
      const note = (e.note ?? '').trim();
      noteBox.replaceChildren(note ? el('div.md-body', {}, renderMarkdown(note)) : el('div.empty', { text: '비고가 없습니다.' }));
    }).catch(() => { if (ask === this.infoAsk) facts.replaceChildren(el('span.muted', { text: '세부 정보를 읽지 못했습니다.' })); });
  }

  /** 스타일 — 전체 기본(노드 색·모양) · 고른 노드만 · 관계 계열별 선 색·화살촉. 이 PC에만 기억한다 */
  #renderStyle() {
    const s = this.style;
    const change = (fn) => { fn(); this.#saveStyle(); this.#applyStyle(); this.#renderStyle(); };
    const swatches = (cur, onPick, { base = null } = {}) => el('div.gv-sws', {}, [
      // 색은 CSS 변수로(토큰 경유) — el()의 style은 Object.assign이라 사용자 정의 속성(--*)을 못 넣어 style 속성으로 준다
      base ? el('button.gv-sw.base', { type: 'button', title: '계열 기본색', text: '기본',
        attrs: { style: `--sw:${base}`, 'aria-pressed': String(cur === 'base'), 'data-color': 'base' }, on: { click: () => onPick('base') } }) : null,
      ...GRAPH.style.palette.map((p) => el('button.gv-sw', {
        type: 'button', title: p.label,
        attrs: { style: `--sw:${colorVar(p.key)}`, 'aria-pressed': String(cur === p.key), 'aria-label': p.label, 'data-color': p.key }, on: { click: () => onPick(p.key) },
      })),
    ]);
    const seg = (list, cur, onPick, attr) => el('div.seg.gv-seg', {}, list.map((p) => el('button', {
      type: 'button', text: p.label, attrs: { 'aria-pressed': String(cur === p.key), [`data-${attr}`]: p.key }, on: { click: () => onPick(p.key) },
    })));
    const section = (head, ...kids) => el('section.gv-style-sec', {}, [el('div.gv-info-head', { text: head }), ...kids]);
    const row = (label, ctrl) => el('div.gv-style-row', {}, [el('span.gv-style-label', { text: label }), ctrl]);

    const n = this.selected ? this.graph?.byId.get(this.selected) : null;
    const own = n ? (s.nodes[n.id] ?? {}) : null;
    const setOwn = (k, v) => change(() => {
      const o = { ...(s.nodes[n.id] ?? {}) };
      if (v == null) delete o[k]; else o[k] = v;
      if (Object.keys(o).length) s.nodes[n.id] = o; else delete s.nodes[n.id];
    });
    const mine = n
      ? section(`고른 노드 — ${n.title || '(제목 없음)'}`,
        row('색', el('div', {}, [
          swatches(own.color ?? null, (k) => setOwn('color', k)),
          el('button.btn.outline.sm.gv-reset', { type: 'button', text: '전체 기본 따르기', attrs: { 'data-reset': 'color' }, disabled: !own.color, on: { click: () => setOwn('color', null) } }),
        ])),
        row('모양', el('div', {}, [
          seg(GRAPH.style.shapes, own.shape ?? null, (k) => setOwn('shape', k), 'shape'),
          el('button.btn.outline.sm.gv-reset', { type: 'button', text: '전체 기본 따르기', attrs: { 'data-reset': 'shape' }, disabled: !own.shape, on: { click: () => setOwn('shape', null) } }),
        ])))
      : section('고른 노드', el('div.gv-hint', { text: '노드를 누르면 그 노드만 따로 색·모양을 바꿀 수 있습니다.' }));

    this.styleBody.replaceChildren(
      el('div.gv-hint', { text: '보기 설정입니다 — 이 PC에만 기억하고, 일정·관계 데이터와 다른 사람 화면은 바뀌지 않습니다.' }),
      section('노드 — 전체 기본',
        row('색', swatches(s.node.color, (k) => change(() => { s.node.color = k; }))),
        row('모양', seg(GRAPH.style.shapes, s.node.shape, (k) => change(() => { s.node.shape = k; }), 'shape'))),
      mine,
      section('선 — 관계 계열별', ...FAMILIES.map((f) => el('div.gv-style-fam', { dataset: { family: f } }, [
        el('div.gv-style-famname', { text: FAMILY_LABEL[f] }),
        row('색', swatches(s.families[f].color, (k) => change(() => { s.families[f].color = k; }), { base: `var(--graph-${f})` })),
        row('화살촉', seg(GRAPH.style.heads, s.families[f].head, (k) => change(() => { s.families[f].head = k; }), 'head')),
      ]))),
      el('div.gv-style-foot', {}, [
        el('button.btn.outline.sm', { type: 'button', text: '스타일 모두 기본으로', on: { click: () => change(() => {
          const d = GRAPH.style.defaults;
          this.style = { node: { ...d.node }, families: Object.fromEntries(FAMILIES.map((f) => [f, { ...d.families[f] }])), nodes: {} };
        }) } }),
      ]),
    );
  }

  /** 스타일을 화면에 — 색은 CSS 변수(토큰 경유), 모양은 노드 path, 화살촉은 marker. 좌표·데이터는 그대로 */
  #applyStyle() {
    const s = this.style;
    this.root.style.setProperty('--gv-node', colorVar(s.node.color));
    for (const f of FAMILIES) {
      const c = s.families[f].color;
      this.root.style.setProperty(`--gv-${f}`, c === 'base' ? `var(--graph-${f})` : colorVar(c));
    }
    this.#markers();
    if (!this.graph || !this.nodeEls) return;
    for (const n of this.graph.nodes) this.#styleNode(n);
    for (const l of this.graph.links) this.#marker(l, this.hot?.has(l.id));
    this.#draw();
  }

  #styleNode(n) {
    const c = this.nodeEls.get(n.id);
    if (!c) return;
    const own = this.style.nodes[n.id];
    const st = this.#nodeStyle(n.id);
    n.shape = st.shape;                                   // 화면용(선 끝을 모양 테두리에 맞춘다) — 저장하지 않는다
    c.setAttribute('d', shapePath(st.shape, n.r));
    if (own?.color) c.style.setProperty('--n-fill', colorVar(own.color)); else c.style.removeProperty('--n-fill');
    c.dataset.shape = st.shape;
  }

  /** 화살촉 — 계열마다 보통·강조 두 벌. '없음'이면 만들지 않는다 */
  #markers() {
    clear(this.defs);
    for (const f of FAMILIES) {
      const head = this.style.families[f].head;
      if (head === 'none') continue;
      for (const hl of [false, true]) {
        const m = svg('marker', { id: `gv-arrow-${f}${hl ? '-hl' : ''}`, viewBox: '0 0 10 10', refX: head === 'dot' ? '5' : '9', refY: '5',
          markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
        const cls = `gv-arrowhead gv-f-${hl ? 'hl' : f}${head === 'open' ? ' open' : ''}`;
        m.append(head === 'dot' ? svg('circle', { cx: '5', cy: '5', r: '3.2', class: cls })
          : head === 'open' ? svg('path', { d: 'M1 1.5 L9 5 L1 8.5', class: cls })
            : svg('path', { d: 'M0 1 L10 5 L0 9 z', class: cls }));
        this.defs.append(m);
      }
    }
  }

  #marker(l, hot) {
    const p = this.linkEls?.get(l.id);
    if (!p) return;
    if (this.style.families[l.family]?.head === 'none') p.removeAttribute('marker-end');
    else p.setAttribute('marker-end', `url(#gv-arrow-${l.family}${hot ? '-hl' : ''})`);
  }

  // ── 검색 ────────────────────────────────────────────────

  #buildSearch() {
    this.searchInput = el('input.gv-search-input', { type: 'search', placeholder: '노드 검색', attrs: { 'aria-label': '노드 검색' } });
    this.results = el('div.gv-results', { hidden: true, attrs: { role: 'listbox' } });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value.trim(); this.#runSearch(); });
    this.searchInput.addEventListener('focus', () => { if (this.query) this.results.hidden = false; });
    this.searchInput.addEventListener('blur', () => setTimeout(() => { this.results.hidden = true; }, 150));
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.searchInput.value = ''; this.query = ''; this.#runSearch(); this.searchInput.blur(); }
      else if (e.key === 'Enter') {                       // 걸린 노드를 차례로
        e.preventDefault();
        const list = [...(this.matches ?? [])];
        if (!list.length) return;
        const i = list.indexOf(this.selected);
        this.#goTo(list[(i + 1) % list.length]);
      }
    });
    return el('div.gv-search', {}, [this.searchInput, this.results]);
  }

  #runSearch() {
    const q = this.query.toLowerCase();
    const nodes = this.graph?.nodes ?? [];
    this.matches = q ? new Set(nodes.filter((n) => (n.title || '').toLowerCase().includes(q)).map((n) => n.id)) : null;
    clear(this.results);
    if (q) {
      const hits = nodes.filter((n) => this.matches.has(n.id));
      this.results.append(el('div.gv-results-head', { text: hits.length ? `${hits.length}개 — Enter로 차례로` : '찾은 노드가 없습니다' }));
      for (const n of hits.slice(0, SEARCH_MAX)) {
        this.results.append(el('button.gv-result', {
          type: 'button', attrs: { role: 'option' },
          on: { pointerdown: (e) => e.preventDefault(), click: () => this.#goTo(n.id) },
        }, [el('span', { text: n.title || '(제목 없음)' }), n.outside ? el('em', { text: '바깥' }) : null]));
      }
      if (hits.length > SEARCH_MAX) this.results.append(el('div.gv-results-head', { text: `… ${hits.length - SEARCH_MAX}개 더 — 검색어를 늘려 보세요` }));
    }
    this.results.hidden = !q || document.activeElement !== this.searchInput;
    this.#emphasis();
  }

  /** 그 노드를 고르고 화면 가운데로(확대는 그대로, 너무 작으면 1배로) */
  #goTo(id) {
    const n = this.graph?.byId.get(id);
    if (!n) return;
    this.selected = id;
    const box = this.svg.getBoundingClientRect();
    const k = Math.max(this.view.k, 1);
    this.view = { k, x: box.width / 2 - k * n.x, y: box.height / 2 - k * n.y };
    this.#applyView();
    this.#emphasis();
    if (!this.prefs.side) this.#setSide(true);
    this.#showInfo();
  }

  // ── 열기·닫기·데이터 ─────────────────────────────────────

  /**
   * 그래프 탭을 보인다 — 보드와 무관한 독립 탭(BoardTabs가 부른다). 처음이면 결정적 배치로 새로 그리고,
   * 탭을 오가다 돌아오면 보던 배치·확대는 그대로 두고 데이터만 새로 받는다(4.6).
   */
  async show({ scope = null, name = '' } = {}) {
    this.root.hidden = false;
    this.hover = null;                                     // 지난번 호버가 남아 처음부터 흐려지지 않게
    if (scope !== this.scope) {                            // 다른 범위의 탭 — 보던 모습을 맡기고 그 범위 것을 꺼낸다
      this.sim?.stop();
      if (this.graph) this.saved.set(this.scope, { graph: this.graph, view: this.view, selected: this.selected });
      const s = this.saved.get(scope);
      this.scope = scope;
      this.graph = s?.graph ?? null;
      this.view = s?.view ?? { k: 1, x: 0, y: 0 };
      this.selected = s?.selected ?? null;
      this.#showInfo();
    }
    this.scopeName = name;
    this.title.textContent = scope == null ? '그래프 — 전체' : `그래프 — ${name || '이 범위'}`;
    if (!this.graph) { this.selected = null; await this.load({ keepPositions: false, fit: true }); }
    else { this.#applyView(); await this.load({ keepPositions: true }); }
  }

  /**
   * 가린다. reset이면(탭을 닫음) 그 범위는 다음에 열 때 처음부터 — 같은 데이터면 같은 배치(G-22).
   * scope를 주면 그 범위만 잊는다(다른 범위 탭은 보던 모습 그대로). 안 주면 지금 범위.
   */
  hide({ reset = false, scope } = {}) {
    this.root.hidden = true;
    this.sim?.stop();
    if (!reset) return;
    const which = scope === undefined ? this.scope : scope;
    this.saved.delete(which);
    if (which === this.scope) { this.graph = null; this.selected = null; this.view = { k: 1, x: 0, y: 0 }; }
  }

  /**
   * 저장소에서 받아 그래프를 다시 만든다. keepPositions면 보던 노드는 그 자리, 새 노드만 이웃 근처(4.6).
   * 처음 열 때는 수렴까지 한 번에 계산해 그린 뒤 맞춘다(결정적, G-22·4.3).
   */
  async load({ keepPositions = true, fit = false } = {}) {
    let data = null;
    const scope = this.scope;
    try { data = await this.adapter.graphData?.(scope); } catch { data = null; }
    if (scope !== this.scope) return;                      // 받는 사이 다른 범위 탭으로 옮겨 갔다
    if (!data) { this.#empty('그래프는 SQLite(데스크톱 앱)에서만 볼 수 있습니다.'); return; }
    const keep = keepPositions && this.graph ? new Map(this.graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : null;
    let g = buildGraph(data);
    if (scope != null) {
      g = scopeGraph(g, data.root);
      if (!g) { this.graph = null; this.#empty('이 범위의 출발 이벤트를 찾을 수 없습니다(지워졌을 수 있습니다).'); return; }
    }
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
    this.count.textContent = scope == null
      ? `이벤트 ${g.nodes.length} · 포함·관계 ${g.links.length}`
      : `안쪽 ${g.nodes.filter((n) => !n.outside).length} · 바깥(한 걸음) ${g.nodes.filter((n) => n.outside).length} · 포함·관계 ${g.links.length}`;
    if (!keep) { settle(this.sim); this.#draw(); if (fit) this.fit(); } else this.#reheat(0.3);
    if (this.selected && !g.byId.has(this.selected)) this.selected = null;
    if (this.query) this.#runSearch(); else this.#emphasis();
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
      const p = svg('path', { class: `gv-link gv-f-${l.family}${l.inCycle ? ' gv-cycle' : ''}` });
      this.gLinks.append(p);
      this.linkEls.set(l.id, p);
      this.#marker(l, false);
    }
    for (const n of nodes) {
      // 바깥(범위 밖, 한 걸음) — 같은 모양·색을 흐리게, 테두리는 점선. 크기는 전체에서 센 그대로
      const c = svg('path', { class: 'gv-node' + (n.outside ? ' outside' : '') });
      c.dataset.id = n.id;
      const title = svg('title');
      title.textContent = n.title || '(제목 없음)';
      c.append(title);
      this.gNodes.append(c);
      this.nodeEls.set(n.id, c);
      this.#styleNode(n);
      const t = svg('text', { class: 'gv-label' + (n.outside ? ' outside' : ''), 'text-anchor': 'middle' });
      t.textContent = n.title || '(제목 없음)';
      this.gLabels.append(t);
      this.labelEls.set(n.id, t);
    }
  }

  /** 틱마다 — 좌표 속성만 고친다(G-24) */
  #draw() {
    if (!this.graph || !this.nodeEls) return;
    const { nodes, links, byId } = this.graph;
    for (const n of nodes) {
      const c = this.nodeEls.get(n.id);
      c?.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
      const t = this.labelEls.get(n.id);
      t?.setAttribute('x', n.x.toFixed(1)); t?.setAttribute('y', (n.y + n.r + 12).toFixed(1));
    }
    for (const l of links) {
      const p = this.linkEls.get(l.id);
      if (!p) continue;
      p.setAttribute('d', linkPath(byId.get(l.from), byId.get(l.to), l.curve));
    }
    this.#drawEdgeLabels();
  }

  // ── 강조 (색·불투명도·테두리만, G-28) ───────────────────

  #focus() { return this.hover ?? this.selected; }

  #emphasis() {
    if (!this.graph || !this.nodeEls) return;
    const f = this.#focus();
    const q = this.matches;
    const near = new Set(f ? [f] : []);
    const hot = new Set();
    if (f) {
      for (const l of this.graph.links) {
        if (l.from === f || l.to === f) { near.add(l.from); near.add(l.to); hot.add(l.id); }
      }
    }
    // 흐리게 — 호버·선택이 있으면 그 이웃 밖, 없고 검색 중이면 걸리지 않은 것
    const dimNode = (id) => (f ? !near.has(id) : !!q && !q.has(id));
    for (const [id, c] of this.nodeEls) {
      c.classList.toggle('dim', dimNode(id));
      c.classList.toggle('near', !!f && near.has(id) && id !== f);
      c.classList.toggle('focus', id === f);
      c.classList.toggle('sel', id === this.selected);
      c.classList.toggle('hit', !!q && q.has(id));
    }
    for (const l of this.graph.links) {
      const p = this.linkEls.get(l.id);
      if (!p) continue;
      p.classList.toggle('dim', f ? !hot.has(l.id) : !!q && !q.has(l.from) && !q.has(l.to));
      p.classList.toggle('hl', hot.has(l.id));
      this.#marker(l, hot.has(l.id));
    }
    this.hot = hot;
    this.#labels(near);
    this.#buildEdgeLabels();
  }

  /** 노드 라벨 — 멀리서는 큰 노드만, 호버·선택과 그 이웃·검색에 걸린 것은 늘(4.5) */
  #labels(near = new Set()) {
    const min = GRAPH.labelMinScreenRadius;
    const f = this.#focus();
    const q = this.matches;
    for (const n of this.graph?.nodes ?? []) {
      const show = near.has(n.id) || (!!q && q.has(n.id)) || n.r * this.view.k >= min;
      this.labelEls.get(n.id)?.classList.toggle('show', show);
      this.labelEls.get(n.id)?.classList.toggle('dim', f ? !near.has(n.id) : !!q && !q.has(n.id));
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
          if (this.selected && !this.prefs.side) this.#setSide(true);   // 고르면 정보를 보여 준다(패널이 닫혀 있으면 연다)
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

// ── 노드 모양 — 반지름 r(크기 규칙 3.1)에 맞춘 꼴. 선 끝은 모양 테두리에서 멈춘다 ──

const POLY = {
  square: (r) => { const h = r * 0.9; return [[-h, -h], [h, -h], [h, h], [-h, h]]; },
  diamond: (r) => { const h = r * 1.2; return [[0, -h], [h, 0], [0, h], [-h, 0]]; },
  hexagon: (r) => { const R = r * 1.05; return [0, 1, 2, 3, 4, 5].map((i) => [R * Math.cos(Math.PI / 3 * i), R * Math.sin(Math.PI / 3 * i)]); },
  triangle: (r) => { const R = r * 1.3; return [[0, -R], [R * 0.866, R / 2], [-R * 0.866, R / 2]]; },
};

/** 노드 하나의 꼴(가운데 0,0) — 위치는 transform으로 옮긴다 */
function shapePath(shape, r) {
  const p = POLY[shape]?.(r);
  if (!p) return `M${(-r).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(2 * r).toFixed(2)},0a${r.toFixed(2)},${r.toFixed(2)} 0 1,0 ${(-2 * r).toFixed(2)},0Z`;
  return `M${p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join('L')}Z`;
}

/** 가운데에서 (ux,uy) 방향으로 모양 테두리까지의 거리 */
function edgeDist(n, ux, uy) {
  const p = POLY[n.shape]?.(n.r);
  if (!p) return n.r;
  let best = Infinity;
  for (let i = 0; i < p.length; i += 1) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % p.length];
    const ex = bx - ax, ey = by - ay;
    const den = ux * ey - uy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (ax * ey - ay * ex) / den;
    const s = (ax * uy - ay * ux) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : n.r;
}

/** 테두리에서 테두리까지 — 곡선이면 이차 베지어(G-17). 화살촉이 노드에 가리지 않게 도착 쪽을 줄인다 */
function linkPath(a, b, curve) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  if (!curve) {
    const ra = edgeDist(a, ux, uy), rb = edgeDist(b, -ux, -uy);
    const sx = a.x + ux * ra, sy = a.y + uy * ra;
    const ex = b.x - ux * (rb + ARROW_GAP), ey = b.y - uy * (rb + ARROW_GAP);
    return `M${sx.toFixed(1)},${sy.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}`;
  }
  const cx = (a.x + b.x) / 2 - uy * curve * CURVE, cy = (a.y + b.y) / 2 + ux * curve * CURVE;
  const d1 = Math.hypot(cx - a.x, cy - a.y) || 1, d2 = Math.hypot(b.x - cx, b.y - cy) || 1;
  const a1x = (cx - a.x) / d1, a1y = (cy - a.y) / d1, b1x = (b.x - cx) / d2, b1y = (b.y - cy) / d2;
  const ra = edgeDist(a, a1x, a1y), rb = edgeDist(b, -b1x, -b1y);
  const sx = a.x + a1x * ra, sy = a.y + a1y * ra;
  const ex = b.x - b1x * (rb + ARROW_GAP), ey = b.y - b1y * (rb + ARROW_GAP);
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
