// 스모크 단계 'graph-style' — 그래프 오른쪽 패널(정보·스타일)과 노드 검색(2026-10-19 사용자).
//   기본 노드 색은 회색이 아니다 · 범위 밖 노드는 숨지 않고 흐리게(같은 색) · 스타일: 전체 기본 + 고른 노드만, 계열별 선 색·화살촉 ·
//   이 PC 설정에만(localStorage) · 정보: 누르면 상태·기간·비고(마크다운) · 검색: 걸린 것만 또렷, Enter로 고른다 · 데이터는 그대로(G-01)
export default {
  name: 'graph-style',
  areas: ['graph'],
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const fingerprint = () => JSON.stringify([
      db.prepare('SELECT * FROM event ORDER BY id').all(), db.prepare('SELECT * FROM containment ORDER BY parent_id, child_id').all(),
      db.prepare('SELECT * FROM disp ORDER BY parent_id, child_id').all(), db.prepare('SELECT * FROM rel ORDER BY id').all(),
    ]);
    // 비고가 있는 카드 하나 — 정보 탭이 마크다운으로 보이는지 본다(끝나고 되돌린다)
    const prep = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
      const keep = it.note;
      r.store.commit('스모크 비고', () => { it.note = '**그래프 비고** 내용'; });
      await r.store.flush();
      return { id: it.id, ti: it.ti, keep, board: r.adapter.projectId };
    })()`);
    const before = fingerprint();
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const keepStyle = localStorage.getItem('wolfpack:graph-style');
        const keepView = localStorage.getItem('wolfpack:graph-view');
        localStorage.removeItem('wolfpack:graph-style');
        localStorage.removeItem('wolfpack:graph-view');
        const gv = r.graphView;
        const o = {};
        await r.tabs.openGraph({ scope: ${JSON.stringify(prep.board)}, name: '스모크' });
        for (let i = 0; i < 40 && !gv.graph; i += 1) await sleep(100);
        const pane = (k) => document.querySelector('#graphView .gv-pane[data-pane="' + k + '"]');
        const tab = (k) => document.querySelector('#graphView .gv-tab:nth-child(' + (k === 'info' ? 1 : 2) + ')');
        tab('style').click(); await sleep(80);
        [...pane('style').querySelectorAll('.gv-style-foot button')][0].click(); await sleep(80);   // 모두 기본으로
        const root = document.getElementById('graphView');
        const fillOf = (n) => getComputedStyle(n).fill;
        const nodes = () => [...document.querySelectorAll('#graphView .gv-node')];
        const probe = document.createElement('i'); root.append(probe);
        const tokenColor = (v) => { probe.style.color = v; return getComputedStyle(probe).color; };
        // 기본 노드 색 — 회색이 아니다(청록)
        o.notGray = fillOf(nodes()[0]) === tokenColor('var(--graph-c-teal)') && fillOf(nodes()[0]) !== tokenColor('var(--neutral-400)');
        // 범위 밖 — 숨지 않고 흐리게: 안쪽과 같은 색, 보일 만큼의 불투명도
        const outs = nodes().filter((n) => n.classList.contains('outside'));
        o.outside = outs.length === 0 ? 'none' : outs.every((n) => fillOf(n) === fillOf(nodes().find((x) => !x.classList.contains('outside'))) && Number(getComputedStyle(n).opacity) >= 0.3);
        // 전체 기본 — 보라로
        pane('style').querySelector('.gv-style-sec .gv-sw[data-color="purple"]').click(); await sleep(80);
        o.allPurple = nodes().every((n) => fillOf(n) === tokenColor('var(--graph-c-purple)'));
        // 고른 노드만 — 사각형·빨강, 다른 노드는 그대로
        const target = gv.graph.nodes.find((n) => n.id === ${JSON.stringify(prep.id)});
        const tn = () => document.querySelector('#graphView .gv-node[data-id="' + CSS.escape(target.id) + '"]');
        const b = tn().getBoundingClientRect();
        const at = { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0, pointerId: 7 };
        tn().dispatchEvent(new PointerEvent('pointerdown', at));
        window.dispatchEvent(new PointerEvent('pointerup', at));
        await sleep(150);
        o.selected = gv.selected === target.id;
        const mine = () => pane('style').querySelectorAll('.gv-style-sec')[1];
        mine().querySelector('[data-shape="square"]').click(); await sleep(60);
        mine().querySelector('.gv-sw[data-color="red"]').click(); await sleep(60);
        const others = nodes().filter((n) => n !== tn());
        o.ownStyle = tn().dataset.shape === 'square' && fillOf(tn()) === tokenColor('var(--graph-c-red)')
          && others.every((n) => n.dataset.shape === 'circle' && fillOf(n) === tokenColor('var(--graph-c-purple)'));
        const saved = JSON.parse(localStorage.getItem('wolfpack:graph-style') ?? '{}');
        o.savedLocal = saved.node?.color === 'purple' && saved.nodes?.[target.id]?.shape === 'square';
        mine().querySelector('[data-reset="shape"]').click(); await sleep(60);
        o.ownReset = tn().dataset.shape === 'circle' && fillOf(tn()) === tokenColor('var(--graph-c-red)');
        // 계열별 화살촉 — 포함 '없음'이면 화살촉이 빠지고, '점'이면 점 화살촉
        const fam = (f) => pane('style').querySelector('.gv-style-fam[data-family="' + f + '"]');
        fam('contain').querySelector('[data-head="none"]').click(); await sleep(60);
        const cl = () => [...document.querySelectorAll('#graphView .gv-link.gv-f-contain:not(.hl)')];
        o.headNone = cl().length > 0 && cl().every((p) => !p.getAttribute('marker-end'));
        fam('contain').querySelector('[data-head="dot"]').click(); await sleep(60);
        o.headDot = cl().every((p) => /gv-arrow-contain/.test(p.getAttribute('marker-end') ?? '')) && !!document.querySelector('#gv-arrow-contain circle');
        fam('flow').querySelector('.gv-sw[data-color="green"]').click(); await sleep(60);
        const fl = document.querySelector('#graphView .gv-link.gv-f-flow:not(.hl)');
        o.flowColor = !fl || getComputedStyle(fl).stroke === tokenColor('var(--graph-c-green)');
        // 정보 — 상태·기간과 비고(마크다운)
        tab('info').click(); await sleep(80);
        for (let i = 0; i < 20 && !pane('info').querySelector('.gv-fact'); i += 1) await sleep(50);
        o.info = pane('info').querySelector('.gv-info-title')?.textContent === ${JSON.stringify(prep.ti)}
          && pane('info').querySelectorAll('.gv-fact').length >= 2
          && pane('info').querySelector('.gv-note-box .md-body strong')?.textContent === '그래프 비고';
        // 검색 — 걸린 것만 또렷, Enter로 그 노드를 고른다
        gv.selected = null; gv.hover = null;
        const inp = document.querySelector('#graphView .gv-search-input');
        inp.focus(); inp.value = ${JSON.stringify(prep.ti)}; inp.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(80);
        o.searchHit = gv.matches?.has(target.id) && tn().classList.contains('hit') && !tn().classList.contains('dim')
          && nodes().some((n) => n.classList.contains('dim')) && document.querySelectorAll('#graphView .gv-result').length >= 1;
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(80);
        o.searchEnter = gv.selected != null && gv.matches.has(gv.selected);
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(60);
        o.searchClear = gv.matches === null && !nodes().some((n) => n.classList.contains('hit'));
        // 원복 — 스타일·보기 설정
        tab('style').click(); await sleep(60);
        [...pane('style').querySelectorAll('.gv-style-foot button')][0].click(); await sleep(60);
        tab('info').click();
        probe.remove();
        if (keepStyle == null) localStorage.removeItem('wolfpack:graph-style'); else localStorage.setItem('wolfpack:graph-style', keepStyle);
        if (keepView == null) localStorage.removeItem('wolfpack:graph-view'); else localStorage.setItem('wolfpack:graph-view', keepView);
        for (let k = r.tabs.tabs.length - 1; k >= 0; k -= 1) if (r.tabs.tabs[k].kind === 'graph') r.tabs.closeTab(k);
        await r.tabs.openBoard(${JSON.stringify(prep.board)}); await sleep(150);
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    out.unchanged = fingerprint() === before;
    await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = r.store.item(${JSON.stringify(prep.id)});
      if (it) r.store.commit('스모크 비고 원복', () => { it.note = ${JSON.stringify(prep.keep ?? '')}; });
      await r.store.flush();
    })()`);
    console.log('[smoke] graph-style ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.notGray === true && (o?.outside === true || o?.outside === 'none') && o?.allPurple === true && o?.selected === true
    && o?.ownStyle === true && o?.savedLocal === true && o?.ownReset === true && o?.headNone === true && o?.headDot === true
    && o?.flowColor === true && o?.info === true && o?.searchHit === true && o?.searchEnter === true && o?.searchClear === true
    && o?.unchanged === true,
};
