// 스모크 단계 'graph' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'graph',
  areas: ["graph","db"],
  async run({ target, ROOT, db, fs, path, wrote }) {
    // 그래프 뷰 — 개발요청서 5장 완료 판정 1~9. 합성 데이터(메인, 순수 계산) + 실제 화면(렌더러).
    let graphCheck = null;
    if (wrote) {
      try {
        const G = await import('../../../src/core/graph.js');
        const { GRAPH } = await import('../../../src/config/index.js');
        // 합성: 루트 둘·3단 포함(구성·순서 있음·순서 없음)·다중 소속·선행 사슬·흐름 교차 순환(선행+원인)·참조 순환
        const events = []; const contain = []; const rels = [];
        const E = (id) => events.push({ id, title: id });
        const C = (pp, c, o = 1, k = 0) => contain.push({ parent_id: pp, child_id: c, ordered: o, compose: k });
        const R = (t, a, b) => rels.push({ id: `${t}${a}${b}`, type: t, from_id: a, to_id: b });
        for (const r of ['B1', 'B2']) { E(r); for (let t = 0; t < 3; t++) { E(`${r}t${t}`); C(r, `${r}t${t}`, 0, 1);
          for (let c = 0; c < 4; c++) { const id = `${r}t${t}c${c}`; E(id); C(`${r}t${t}`, id); if (c) R('dep', `${r}t${t}c${c - 1}`, id);
            for (let k = 0; k < 2; k++) { E(`${id}k${k}`); C(id, `${id}k${k}`, 0); } } } }
        C('B2t0', 'B1t1c1');
        R('cause', 'B1t0c3', 'B1t0c2');
        R('ref', 'B1t2c0', 'B2t2c0'); R('ref', 'B2t2c0', 'B1t2c0');
        const run = (sliders, cfg = GRAPH, data = { events, contain, rels }) => {
          const g = G.buildGraph(data, cfg); G.initialLayout(g, cfg); const sim = G.createSimulation(g, sliders, cfg);
          const ticks = G.settle(sim, 3000); return { g, ticks };
        };
        const pos = (g) => g.nodes.map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`).join(';');
        const frac = (g, fam, axis) => { const ls = g.links.filter((l) => l.family === fam && !l.inCycle); return ls.filter((l) => l.target[axis] > l.source[axis]).length / ls.length; };
        const mid = run({ structure: 0.5, flow: 0.5 });
        const c1 = { one: mid.g.nodes.filter((n) => n.id === 'B1t1c1').length === 1,
          twoIn: mid.g.links.filter((l) => l.family === 'contain' && l.to === 'B1t1c1').length === 2 };
        // 2: 두 중력 0 = 방향 중력이 없는 시뮬레이션과 똑같다
        const noDir = structuredClone(GRAPH); for (const f of Object.values(noDir.families)) f.u = null;
        const zero = run({ structure: 0, flow: 0 });
        const c2 = pos(zero.g) === pos(run({ structure: 0, flow: 0 }, noDir).g);
        // 3: 구조만 → 부모가 위, 흐름만 → 앞이 왼쪽
        const c3 = { structure: frac(run({ structure: 1, flow: 0 }).g, 'contain', 'y'), flow: frac(run({ structure: 0, flow: 1 }).g, 'flow', 'x') };
        // 4: 참조는 어느 중력에서도 방향이 없다 — 참조만 있는 그래프는 중력 세기와 무관하게 같은 배치
        const refOnly = { events: events.slice(0, 6), contain: [], rels: [{ id: 'x1', type: 'ref', from_id: events[1].id, to_id: events[2].id }, { id: 'x2', type: 'ref', from_id: events[2].id, to_id: events[1].id }] };
        const c4 = pos(run({ structure: 1, flow: 1 }, GRAPH, refOnly).g) === pos(run({ structure: 0, flow: 0 }, GRAPH, refOnly).g);
        // 5: 흐름 교차 순환이 있어도 수렴하고, 그 엣지는 순환 표시
        const cyc = mid.g.links.filter((l) => l.inCycle).map((l) => l.id).sort();
        const c5 = { converged: mid.ticks < 3000, finite: mid.g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), cyc };
        // 6: 가장 큰 노드 = 하위가 가장 많은 이벤트, 트랙(한 단계 아래)이 보드보다 크지 않다 + 3.1 예시 그대로
        const big = [...mid.g.nodes].sort((a, b) => b.desc - a.desc)[0];
        const ex = G.buildGraph({ events: ['Y1', 'R1', 'R2', 'AT', 'SET', 'VER', 'MON', 'DWG', 'DEL'].map((id) => ({ id })),
          contain: [['Y1', 'R1'], ['Y1', 'R2'], ['R1', 'SET'], ['R1', 'VER'], ['AT', 'SET'], ['SET', 'DWG'], ['SET', 'DEL'], ['R2', 'MON']].map(([a, b]) => ({ parent_id: a, child_id: b, ordered: 1, compose: 0 })), rels: [] });
        const exD = Object.fromEntries(ex.nodes.map((n) => [n.id, [n.desc, Number(n.r.toFixed(1))]]));
        const c6 = { biggest: big.id, boardGeTrack: mid.g.byId.get('B1').r >= mid.g.byId.get('B1t0').r,
          example: JSON.stringify([exD.Y1, exD.R1, exD.AT, exD.SET, exD.R2, exD.VER]) === JSON.stringify([[7, 12.9], [4, 11], [3, 10.2], [2, 9.2], [1, 8], [0, 5]]) };
        // 7: 같은 데이터 → 같은 배치
        const c7 = pos(mid.g) === pos(run({ structure: 0.5, flow: 0.5 }).g);
        // 9: 그래프 코드에 역할 이름 분기가 없다(주석·문자열 빼고)
        const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""');
        const code = ['src/core/graph.js', 'src/ui/graph.js'].map((f) => strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))).join('\n');
        const c9 = !/\b(track|board|card|task)s?\b|트랙|보드|카드|태스크/i.test(code);
        // 10: 범위(펼친 이벤트에서 연 그래프) — 품은 것 + 한 걸음, 크기는 전체에서 센 그대로
        const full = G.buildGraph({ events, contain, rels });
        const sc = G.scopeGraph(G.buildGraph({ events, contain, rels }), 'B1');
        const c10 = { inside: sc?.inside, outside: sc?.nodes.filter((n) => n.outside).map((n) => n.id).sort(),
          noB2: !sc?.byId.has('B2'), sizeKept: sc?.byId.get('B2t0')?.r === full.byId.get('B2t0').r,
          linksTouchInside: !!sc && sc.links.every((l) => !sc.byId.get(l.from).outside || !sc.byId.get(l.to).outside),
          missing: G.scopeGraph(full, 'nope') === null };
        graphCheck = { c1, c2, c3, c4, c5, c6, c7, c9, c10 };
      } catch (err) { graphCheck = { error: String(err?.stack ?? err) }; }

      // 실제 화면 — 열기·노드 수·재현성·끌기/호버/중력 조절 후 데이터 불변(8)
      const fingerprint = () => JSON.stringify([
        db.prepare('SELECT * FROM event ORDER BY id').all(), db.prepare('SELECT * FROM containment ORDER BY parent_id, child_id').all(),
        db.prepare('SELECT * FROM disp ORDER BY parent_id, child_id').all(), db.prepare('SELECT * FROM rel ORDER BY id').all(),
      ]);
      const before = fingerprint();
      const eventCount = db.prepare('SELECT count(*) n FROM event').get().n;
      const ui = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const savedPref = localStorage.getItem('wolfpack:graph-view');   // 사용자 설정 — 끝나고 되돌린다
          await r.tabs.openGraph();                             // 전체 — 첫 화면의 그래프 버튼과 같은 길
          const gv = r.graphView;
          for (let i = 0; i < 40 && !gv.graph; i += 1) await sleep(100);
          if (!gv.graph) return { error: 'graph not ready', tabs: JSON.stringify(r.tabs.tabs), active: r.tabs.active, hidden: gv.root.hidden, launcher: r.launcher.visible, count: gv.count.textContent };
          const circles = document.querySelectorAll('#graphView .gv-node').length;
          const ids = [...document.querySelectorAll('#graphView .gv-node')].map((c) => c.dataset.id);
          const uniq = new Set(ids).size === ids.length;
          const posA = gv.graph.nodes.map((n) => n.x.toFixed(3) + ',' + n.y.toFixed(3)).join(';');
          const edgeLabelsIdle = document.querySelectorAll('#graphView .gv-edge-label').length;
          const arrows = [...document.querySelectorAll('#graphView .gv-link')].every((p) => /url\\(#gv-arrow-/.test(p.getAttribute('marker-end')));
          // 호버 — 이어진 엣지에만 라벨, 배치는 그대로
          const big = [...gv.graph.nodes].sort((a, b) => b.degree - a.degree)[0];
          const bx = big.x, by = big.y;
          const el = document.querySelector('#graphView .gv-node[data-id="' + big.id + '"]');
          el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          await sleep(80);
          const hoverLabels = document.querySelectorAll('#graphView .gv-edge-label').length;
          const hoverKeptLayout = big.x === bx && big.y === by;
          // 끌기 — 놓으면 고정이 풀린다
          const b = el.getBoundingClientRect();
          const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 11 });
          el.dispatchEvent(new PointerEvent('pointerdown', at(b.left + b.width / 2, b.top + b.height / 2)));
          window.dispatchEvent(new PointerEvent('pointermove', at(b.left + 120, b.top + 60)));
          await sleep(100);
          const pinned = big.fx != null;
          window.dispatchEvent(new PointerEvent('pointerup', at(b.left + 120, b.top + 60)));
          const released = big.fx == null && big.fy == null;
          // 중력 조절
          const slider = document.querySelector('#graphView .gv-slider input');
          const slider0 = slider.value;                        // 사용자가 정해 둔 값일 수 있다 — 그대로 되돌린다
          slider.value = '0'; slider.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(300);
          slider.value = slider0; slider.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(200);
          // 다시 열면 같은 배치(결정적)
          r.tabs.closeTab(r.tabs.tabs.findIndex((t) => t.kind === 'graph')); await sleep(150);
          await r.tabs.openGraph();
          for (let i = 0; i < 40 && !gv.graph; i += 1) await sleep(100);
          const posB = gv.graph.nodes.map((n) => n.x.toFixed(3) + ',' + n.y.toFixed(3)).join(';');
          const hasStorage = !!localStorage.getItem('wolfpack:graph-view');
          if (savedPref == null) localStorage.removeItem('wolfpack:graph-view'); else localStorage.setItem('wolfpack:graph-view', savedPref);
          const nodeCount = gv.graph.nodes.length;             // 탭을 닫으면 그래프가 비워진다(다음엔 처음부터)
          // 보드의 그래프 버튼 — 그 보드가 품은 것 + 한 걸음, 전체와 다른 탭
          const b1 = r.adapter.projectId;
          await r.tabs.openBoard(b1); await sleep(250);
          const cardIds = r.store.items.map((i) => i.id);
          document.getElementById('btnGraph').click();
          for (let i = 0; i < 40 && !(gv.graph && gv.scope === b1); i += 1) await sleep(100);
          const graphTabs = r.tabs.tabs.filter((t) => t.kind === 'graph');
          const sg = gv.graph;
          // 기대값 — 같은 저장소 데이터를 범위로 잘라 센 수(합성 c10이 규칙을, 여기는 화면이 그 결과를 그리는지)
          const G2 = await import('./src/core/graph.js');
          const raw = await r.adapter.graphData(b1);
          const want = G2.scopeGraph(G2.buildGraph(raw), raw.root);
          const scoped = {
            tabs: graphTabs.length, tabName: document.querySelector('#tabbar .tab.active .tab-name')?.textContent ?? '',
            title: gv.title.textContent, count: sg.nodes.length === want.nodes.length && sg.nodes.length <= nodeCount,
            allCards: cardIds.every((id) => sg.byId.has(id) && !sg.byId.get(id).outside),
            outsideDrawn: document.querySelectorAll('#graphView .gv-node.outside').length === sg.nodes.filter((n) => n.outside).length,
          };
          // 전체 탭으로 돌아가면 전체, 다시 보드 그래프 탭으로 오면 그 범위(보던 모습 그대로)
          await r.tabs.activate(r.tabs.tabs.findIndex((t) => t.kind === 'graph' && t.scope == null)); await sleep(250);
          scoped.backToAll = gv.scope === null && gv.graph.nodes.length === nodeCount;
          await r.tabs.activate(r.tabs.tabs.findIndex((t) => t.kind === 'graph' && t.scope === b1)); await sleep(250);
          scoped.backToScoped = gv.scope === b1 && gv.graph.nodes.length === sg.nodes.length && gv.title.textContent === scoped.title;
          for (let k = r.tabs.tabs.length - 1; k >= 0; k -= 1) if (r.tabs.tabs[k].kind === 'graph') r.tabs.closeTab(k);
          await r.tabs.openBoard(b1);
          await sleep(150);
          return { scoped, nodes: nodeCount, circles, uniq, edgeLabelsIdle, arrows, hoverLabels, hoverKeptLayout, pinned, released, sameReopen: posA === posB, closed: document.getElementById('graphView').hidden, hasStorage };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      await new Promise((res) => setTimeout(res, 300));
      graphCheck = { ...graphCheck, ui: { ...ui, eventCount, c8unchanged: fingerprint() === before } };
      console.log('[smoke] graph ' + JSON.stringify(graphCheck));
    }
    return graphCheck;
  },
  check: (graphCheck) => graphCheck?.c1?.one === true
    && graphCheck?.c1?.twoIn === true
    && graphCheck?.c2 === true
    && graphCheck?.c3?.structure >= 0.95
    && graphCheck?.c3?.flow >= 0.95
    && graphCheck?.c4 === true
    && graphCheck?.c5?.converged === true
    && graphCheck?.c5?.finite === true
    && graphCheck?.c5?.cyc?.length === 2
    && graphCheck?.c6?.biggest?.startsWith('B')
    && graphCheck?.c6?.biggest?.length === 2
    && graphCheck?.c6?.boardGeTrack === true
    && graphCheck?.c6?.example === true
    && graphCheck?.c7 === true
    && graphCheck?.c9 === true
    && graphCheck?.ui?.nodes === graphCheck?.ui?.eventCount
    && graphCheck?.ui?.circles === graphCheck?.ui?.nodes
    && graphCheck?.ui?.uniq === true
    && graphCheck?.ui?.edgeLabelsIdle === 0
    && graphCheck?.ui?.arrows === true
    && graphCheck?.ui?.hoverLabels > 0
    && graphCheck?.ui?.hoverKeptLayout === true
    && graphCheck?.ui?.pinned === true
    && graphCheck?.ui?.released === true
    && graphCheck?.ui?.sameReopen === true
    && graphCheck?.ui?.closed === true
    && graphCheck?.ui?.c8unchanged === true
    && graphCheck?.c10?.inside === 40
    && JSON.stringify(graphCheck?.c10?.outside) === JSON.stringify(['B2t0', 'B2t2c0'])
    && graphCheck?.c10?.noB2 === true
    && graphCheck?.c10?.sizeKept === true
    && graphCheck?.c10?.linksTouchInside === true
    && graphCheck?.c10?.missing === true
    && graphCheck?.ui?.scoped?.tabs === 2
    && /^그래프 · /.test(graphCheck?.ui?.scoped?.tabName ?? '')
    && graphCheck?.ui?.scoped?.count === true
    && graphCheck?.ui?.scoped?.allCards === true
    && graphCheck?.ui?.scoped?.outsideDrawn === true
    && graphCheck?.ui?.scoped?.backToAll === true
    && graphCheck?.ui?.scoped?.backToScoped === true,
};
