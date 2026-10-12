// 스모크 단계 'harvest' — 호스팅 거두기(docs/SHARE.md §5). 사본(호스팅 창)과 원래 보드를 각자 고친 뒤 첫 화면의 '거두기'로
// 원래 보드에 3방향 합치기: 한쪽만 바뀐 것은 그대로, 양쪽이 다르게 바꾼 칸·한쪽은 지우고 한쪽은 고친 것만 고른다.
// 합치기는 되돌리기 1단계, 쓰기 전에 DB 백업. 독립된 보드로 거두면 새 id(원래 보드와 남).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 80) {
  const t0 = Date.now();
  for (;;) {
    let v; try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

export default {
  name: 'harvest',
  areas: ['hosting', 'db'],
  async run({ target, wrote, hosting, hostWindow, db, fs, BoardRepository, capture, shotDir }) {
    if (!wrote) return null;
    const out = {};
    const js = (w, code) => w.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const start = await js(target, `
      const r = window.__roadmap;
      const top = r.store.items.filter((x) => !x.parent);
      const ids = top.slice(0, 5).map((x) => x.id);
      window.__harvestSnap = JSON.stringify(r.store.doc);
      const res = await window.roadmapDB.hosting.start({ boardId: r.adapter.projectId, name: r.store.meta.name, doc: JSON.parse(JSON.stringify(r.store.doc)), ext: [] });
      return { id: res.id, ids, board: r.adapter.projectId, base: Object.fromEntries(top.slice(0, 5).map((x) => [x.id, { ti: x.ti, st: x.st }])) };`);
    const [A, B, C, D] = start.ids;
    const host = await until(() => hostWindow(start.id));
    await until(() => js(host, 'return !!window.__roadmap?.sessionUi && window.__roadmap.store.items.length > 0'), 10000);
    // 사본 쪽(호스팅 창)
    await js(host, `
      const r = window.__roadmap;
      r.store.commit('사본', (doc) => {
        doc.items.find((x) => x.id === ${JSON.stringify(A)}).ti = '사본 제목';
        doc.items.find((x) => x.id === ${JSON.stringify(B)}).st = 'done';
        doc.items = doc.items.filter((x) => x.id !== ${JSON.stringify(C)} && x.parent !== ${JSON.stringify(C)});
        const src = doc.items.find((x) => x.id === ${JSON.stringify(D)});
        doc.items.push({ ...JSON.parse(JSON.stringify(src)), id: 'hv-new', ti: '사본에서 만든 일정', tasks: [] });
        doc.meta.memos = [...(doc.meta.memos ?? []), { id: 'hv-memo', text: '사본 메모', date: doc.meta.start, dy: 0, slot: null, track: doc.tracks[0].id, x: 0.1, w: 200, h: 100 }];
      });
      await r.store.flush(); return true;`);
    await until(() => hosting().state(start.id).doc.items.some((x) => x.id === 'hv-new'));
    // 원래 보드 쪽(메인 창) — 호스팅하는 동안 따로 운영된다
    await js(target, `
      const r = window.__roadmap;
      r.store.commit('보드', (doc) => {
        doc.items.find((x) => x.id === ${JSON.stringify(D)}).ti = '보드 제목';
        doc.items.find((x) => x.id === ${JSON.stringify(B)}).st = 'late';
        doc.items.find((x) => x.id === ${JSON.stringify(C)}).note = '보드에서 쓴 비고';
      });
      await r.store.flush(); return true;`);
    out.independentRun = (await js(target, `return window.__roadmap.store.item(${JSON.stringify(A)}).ti`)) === start.base[A].ti;

    // 첫 화면 › 호스팅 › 거두기 › 원래 보드에 합치기
    if (shotDir()) {
      await js(target, `window.__roadmap.tabs.newLauncherTab(); await new Promise((r) => setTimeout(r, 600)); document.getElementById('l-hosting').scrollIntoView(); return true;`);
      await capture(target, 'hosting-list');
      await js(target, `window.__roadmap.tabs.closeTab(window.__roadmap.tabs.active); await new Promise((r) => setTimeout(r, 300)); return true;`);
    }
    const res = await js(target, `
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const wait = async (sel, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const n = document.querySelector(sel); if (n) return n; await sleep(60); } return null; };
      r.tabs.newLauncherTab();
      const rowEl = await wait('#l-hosting .hrow[data-id="${start.id}"]');
      if (!rowEl) return { error: '목록에 없음' };
      const listed = !document.getElementById('l-hosting').hidden;
      [...rowEl.querySelectorAll('button')].find((b) => b.textContent === '거두기').click();
      await sleep(400);
      const choice = [...document.querySelectorAll('.dlg-choice')].find((b) => b.textContent.includes('원래 보드에 합치기'));
      if (!choice) return { error: '선택 없음', listed };
      choice.click();
      const sheet = await wait('.harvest', 5000);
      if (!sheet) return { error: '거두기 창 없음', listed };
      const rows = [...document.querySelectorAll('.harvest-row')];
      return { listed, n: rows.length };`);
    if (shotDir()) await capture(target, 'hosting-harvest');
    const res2 = await js(target, `
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const listed = ${JSON.stringify(!!res?.listed)};
      if (${JSON.stringify(res?.error ?? null)}) return ${JSON.stringify(res ?? {})};
      const rows = [...document.querySelectorAll('.harvest-row')];
      const texts = rows.map((x) => x.querySelector('.harvest-what').textContent);
      // B 상태 충돌은 보드 쪽, C(사본에서 지움 vs 보드에서 고침)는 사본 쪽(지움)
      for (const row of rows) {
        if (row.querySelector('.harvest-what').textContent.includes('상태')) row.querySelector('input[value="ours"]').click();
      }
      [...document.querySelectorAll('.dlg-actions .btn')].find((b) => b.textContent === '합치기').click();
      const t0 = Date.now();
      while (Date.now() - t0 < 6000 && r.store.item(${JSON.stringify(A)})?.ti !== '사본 제목') await sleep(80);
      await r.store.flush();
      await sleep(300);
      const it = (id) => r.store.item(id);
      return {
        listed, conflicts: rows.length, texts,
        theirsOnly: it(${JSON.stringify(A)})?.ti === '사본 제목',
        oursOnly: it(${JSON.stringify(D)})?.ti === '보드 제목',
        pickedOurs: it(${JSON.stringify(B)})?.st === 'late',
        deleted: !it(${JSON.stringify(C)}),
        added: !!it('hv-new') && (r.store.meta.memos ?? []).some((m) => m.id === 'hv-memo'),
        board: r.adapter.projectId,
      };`);
    Object.assign(out, res2);
    const hrow = db.prepare('SELECT status, result_json FROM hosting WHERE id = ?').get(start.id);
    out.harvested = hrow?.status === 'harvested';
    const result = hrow?.result_json ? JSON.parse(hrow.result_json) : {};
    out.backup = !!result.backup && fs.existsSync(result.backup);
    out.dbTitle = db.prepare('SELECT title FROM event WHERE id = ?').get(A)?.title === '사본 제목';
    out.hostClosed = !!(await until(() => !hostWindow(start.id) || hostWindow(start.id).isDestroyed?.()));
    // 되돌리기 1단계
    out.undo = await js(target, `
      const r = window.__roadmap;
      r.store.undo();
      await new Promise((res) => setTimeout(res, 200));
      return r.store.item(${JSON.stringify(A)})?.ti === ${JSON.stringify(start.base[A].ti)} && !r.store.item('hv-new');`);

    // 독립된 보드로 — 새 id
    const ind = await js(target, `
      const r = window.__roadmap;
      const h = await window.roadmapDB.hosting.start({ boardId: r.adapter.projectId, name: '독립 시험', doc: JSON.parse(JSON.stringify(r.store.doc)), ext: [] });
      const boardId = await window.roadmapDB.hosting.independent(h.id, '독립 시험 보드');
      const list = await r.adapter.listProjects();
      return { boardId, hid: h.id, made: list.some((p) => p.id === boardId && p.name === '독립 시험 보드') };`);
    out.independentMade = ind.made;
    // 메인 창의 저장 대상을 건드리지 않게 따로 읽는다(project:open은 그 창의 보드를 바꾼다)
    const newDoc = new BoardRepository(db).openView(ind.boardId);
    const ourIds = new Set(JSON.parse(await js(target, 'return window.__harvestSnap')).items.map((x) => x.id));
    out.independentIds = newDoc.items.length > 0 && newDoc.items.every((x) => !ourIds.has(x.id));
    // 원래대로
    await js(target, `
      const r = window.__roadmap;
      await r.tabs.openBoard(${start.board});
      await r.adapter.deleteProject(${ind.boardId});
      r.store.replace(JSON.parse(window.__harvestSnap), '스모크 원복');
      await r.store.flush();
      return true;`);
    hosting().remove(start.id);
    hosting().remove(ind.hid);
    return out;
  },
  check: (o) => o?.independentRun === true && o?.listed === true && o?.conflicts === 2 && o?.theirsOnly === true && o?.oursOnly === true
    && o?.pickedOurs === true && o?.deleted === true && o?.added === true && o?.harvested === true && o?.backup === true
    && o?.dbTitle === true && o?.hostClosed === true && o?.undo === true && o?.independentMade === true && o?.independentIds === true,
};
