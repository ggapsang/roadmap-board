// 스모크 단계 'ref-edit' — 참조관계: 어느 보드의 무엇이든(같은 보드 카드·다른 보드 자체) 잇는다. 보드엔 화살표 없는 선(양 끝
// 카드가 다 보일 때), 편집 창엔 목록 — 이름을 누르면 그쪽으로 간다. 선을 눌러 Delete로 지운다. 저장 왕복·DB.
export default {
  name: 'ref-edit',
  areas: ['panel', 'arrows', 'board', 'db', 'graph'],
  async run({ target, db }) {
    const r1 = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const b1 = r.adapter.projectId;
        const b2 = await r.adapter.duplicateProject(b1, '참조 대상 보드');
        await r.tabs.openBoard(b1); await sleep(300);
        const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
        const a = cards[0], c = cards[cards.length - 1];
        document.querySelector('[data-id="' + a.id + '"]').click(); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(250);
        document.querySelector('#i-refs > button.btn').click(); await sleep(400);
        // 트리 — 이 보드가 맨 위, 보드 자체도 고를 수 있다
        const boardRows = [...document.querySelectorAll('.dlg-tree-row')].filter((x) => x.querySelector('.dlg-tree-sub, em')?.textContent?.includes('보드'));
        const firstIsHere = /이 보드/.test(document.querySelector('.dlg-tree-row')?.textContent ?? '');
        const events = await r.adapter.listEvents();
        const b2root = events.find((e) => e.kind === 'board' && Number(e.boardId) === b2);
        const pick = (id) => document.querySelector('.dlg-tree-row[data-id="' + id + '"] input')?.click();
        pick(c.id); pick(b2root.id);
        await sleep(50);
        [...document.querySelectorAll('.dlg-actions .btn.cta')].pop().click(); await sleep(300);
        const refs = r.store.relations.filter((x) => x.type === 'ref' && x.from === a.id);
        const made = refs.length === 2 && refs.some((x) => x.to === c.id) && refs.some((x) => x.to === b2root.id);
        await sleep(200);
        // 보드 — 같은 보드 카드와는 화살표 없는 선, 보드 자체와는 선 없음(목록에만)
        const relC = refs.find((x) => x.to === c.id);
        const line = document.querySelector('.ref-line[data-rel="' + relC?.id + '"]');
        const noArrow = !!line && !document.querySelector('.arrow[data-rel="' + relC?.id + '"]');
        const onlyOneLine = document.querySelectorAll('.ref-line').length === 1;
        const chips = [...document.querySelectorAll('#i-refs .combine-chip')].map((x) => x.textContent);
        // 저장 왕복 — 다시 읽어도 남는다, DB엔 type ref
        await sleep(300);
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        const kept = r.store.relations.filter((x) => x.type === 'ref' && x.from === a.id).length === 2;
        // 그래프 — 참조는 점선, 화살촉 없음
        r.tabs.openGraph({ scope: null, name: '' }); await sleep(1200);
        const gl = [...document.querySelectorAll('#graphView .gv-link.gv-f-ref')];
        const graph = { n: gl.length, noHead: gl.every((l) => !l.getAttribute('marker-end')), dashed: gl.length > 0 && getComputedStyle(gl[0]).strokeDasharray !== 'none' };
        r.tabs.closeTab(r.tabs.tabs.findIndex((t) => t.kind === 'graph')); await sleep(300);
        await r.tabs.openBoard(b1); await sleep(300);
        // 그쪽으로 가기 — 다른 보드 자체를 누르면 그 보드가 열린다
        r.itemPanel.open(a.id); await sleep(200);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(300);
        document.querySelector('#i-refs .ref-go[data-id="' + b2root.id + '"]')?.click(); await sleep(600);
        const went = r.adapter.projectId === b2;
        // 돌아와서 같은 보드 카드로 가기 — 그 카드 편집이 열린다
        await r.tabs.openBoard(b1); await sleep(300);
        r.itemPanel.open(a.id); await sleep(200);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(300);
        document.querySelector('#i-refs .ref-go[data-id="' + c.id + '"]')?.click(); await sleep(300);
        const wentCard = r.view.selectedItem === c.id;
        // 선을 눌러 Delete
        document.querySelector('#pItem [data-close]')?.click(); await sleep(100);
        const hit = document.querySelector('.ref-hit[data-rel="' + relC.id + '"]');
        hit?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(100);
        const selected = r.view.selectedRel === relC.id && document.querySelector('.ref-line[data-rel="' + relC.id + '"]')?.classList.contains('selected');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await sleep(250);
        const deleted = !r.store.relations.some((x) => x.id === relC.id) && !document.querySelector('.ref-line');
        // 원복 — 남은 참조(보드 자체)도 지우고 대상 보드 삭제
        r.store.commit('스모크 원복', (doc) => { doc.relations = doc.relations.filter((x) => x.type !== 'ref'); });
        await sleep(300);
        const ids = { a: a.id, c: c.id, b2root: b2root.id, b2 };
        return { graph, firstIsHere, made, noArrow, onlyOneLine, chips, kept, went, wentCard, selected, deleted, ids };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    if (r1 && !r1.error) {
      r1.dbLeft = db.prepare("SELECT COUNT(*) AS n FROM rel WHERE type = 'ref' AND from_id = ?").get(r1.ids.a).n;
      await target.webContents.executeJavaScript(`window.__roadmap.adapter.deleteProject(${Number(r1.ids.b2) || 0})`);
    }
    console.log('[smoke] ref-edit ' + JSON.stringify(r1));
    return r1;
  },
  check: (x) => x?.firstIsHere === true && x?.made === true && x?.noArrow === true && x?.onlyOneLine === true
    && x?.chips?.length === 2 && x?.kept === true && x?.went === true && x?.wentCard === true
    && x?.selected === true && x?.deleted === true && x?.dbLeft === 0
    && x?.graph?.n >= 2 && x?.graph?.noHead === true && x?.graph?.dashed === true,
};
