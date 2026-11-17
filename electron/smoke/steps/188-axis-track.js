// 스모크 단계 'axis-track' — 축 표시 트랙(2026-11-17 사용자 「축 표시 트랙 개발 요청서」). 요청서 5장 완료 판정 9문항을 그대로 묻는다:
//   1 축을 켜고 꺼도 이벤트·포함·관계가 그대로 · 2 같은 트랙 이벤트가 한 보드에선 축, 다른 보드에선 열 · 3 모든 트랙에 걸친 일반 카드는
//   축으로 빠지지 않는다 · 4 담긴 카드는 원래 트랙에도 보이고 한 이벤트 · 5 축 카드를 빼도 담긴 카드는 남는다 · 6 날짜 없는 보드에서도
//   띠가 그려진다 · 7 축 카드↔담긴 카드 강조 · 8 왼쪽·오른쪽이 같은 결과 · 9 전용 객체·스키마·테이블이 없다.
//   더해서: 축으로 처음 바꿀 때 날짜 겹침 포함 제안(확인한 것만) · 축 카드를 끌어도 트랙이 바뀌지 않는다 · 저장하고 다시 읽기.
export default {
  name: 'axis-track',
  areas: ['board', 'panel', 'db', 'drag'],
  async run({ target, db, wrote, root }) {
    if (!wrote) return null;
    const js = (body) => target.webContents.executeJavaScript(`(async () => {
      const run = (async () => { const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms)), T = window.__axisT ?? (window.__axisT = {}); ${body} })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    const dump = () => JSON.stringify([
      db.prepare('SELECT id, title, status, start_date, end_date FROM event ORDER BY id').all(),
      db.prepare('SELECT parent_id, child_id, ordered, compose FROM containment ORDER BY parent_id, child_id').all(),
      db.prepare('SELECT id, type, from_id, to_id FROM rel ORDER BY id').all(),
    ]);
    const o = {};

    // 준비 — 시험 보드: 트랙 A·B·C + '월별 흐름' M(아직 열). M의 카드 둘(12월·1월), 다른 트랙 카드들, 모든 트랙에 걸친 카드 하나
    const a = await js(`
      T.b0 = r.adapter.projectId;
      const doc = { version: 26, meta: { name: '축 점검', start: '2026-12-01', end: '2027-02-28' }, orgs: ['A'],
        tracks: [{ id: 'tAx_A', name: 'A' }, { id: 'tAx_B', name: 'B' }, { id: 'tAx_C', name: 'C' }, { id: 'tAx_M', name: '월별 흐름' }],
        items: [
          { id: 'eAx_m1', ti: '분석·설계', s: '2026-12-01', e: '2026-12-31', place: { t: 'tAx_M' } },
          { id: 'eAx_m2', ti: '1차 개발', s: '2027-01-01', e: '2027-01-31', place: { t: 'tAx_M' } },
          { id: 'eAx_x1', ti: '설계 A', s: '2026-12-03', e: '2026-12-20', place: { t: 'tAx_A' } },
          { id: 'eAx_x2', ti: '개발 B', s: '2027-01-05', e: '2027-01-25', place: { t: 'tAx_B' } },
          { id: 'eAx_out', ti: '조사 C', s: '2026-11-20', e: '2026-12-05', place: { t: 'tAx_C' } },
          { id: 'eAx_all', ti: '전 트랙 점검', s: '2027-02-10', e: '2027-02-12', place: { t: 'tAx_A', tracks: ['tAx_A', 'tAx_B', 'tAx_C', 'tAx_M'] } },
        ], relations: [{ id: 'rAx_1', type: 'dep', from: 'eAx_x1', to: 'eAx_x2' }] };
      T.b = await r.adapter.createProject(doc, '축 점검');
      await r.tabs.openBoard(T.b); await sleep(400);
      const id = (title) => r.store.items.find((i) => i.ti === title)?.id;
      T.M = r.store.tracks.find((t) => t.name === '월별 흐름').id;
      T.m1 = id('분석·설계'); T.m2 = id('1차 개발'); T.x1 = id('설계 A'); T.x2 = id('개발 B'); T.out = id('조사 C'); T.all = id('전 트랙 점검');
      return { ok: !!(T.M && T.m1 && T.x1), root: r.store.doc.meta?.root };
    `);
    o.setup = a;
    const ids = await js('return T;');
    const snap1 = dump();

    // 1 — 축으로(오른쪽). 포함 제안은 취소 → 데이터 그대로
    o.toAxis = await js(`
      const p = r.board.setTrackAxis(T.M, 'right');
      await sleep(300);
      const dlg = document.querySelector('.dlg');
      const offered = [...document.querySelectorAll('.dlg-tree-row')].filter((x) => x.querySelector('input:checked')).map((x) => x.dataset.id);
      [...document.querySelectorAll('.dlg .btn')].find((b) => b.textContent === '취소')?.click();
      await p; await sleep(200); await r.store.flush();
      const strip = document.querySelector('.axis-strip[data-t="' + T.M + '"]');
      return {
        dialog: !!dlg && /포함 제안/.test(dlg.textContent), offered,
        strip: !!strip && strip.dataset.side === 'right',
        bandsInStrip: !!strip?.querySelector('.ev[data-id="' + T.m1 + '"]') && !!strip?.querySelector('.ev[data-id="' + T.m2 + '"]'),
        colZero: document.querySelector('.col[data-t="' + T.M + '"]')?.offsetWidth === 0,
        allInCols: !!document.querySelector('.col .ev[data-id="' + T.all + '"]') && !strip?.querySelector('.ev[data-id="' + T.all + '"]'),   // 3
        noContains: !(r.store.doc.contains ?? []).length,
      };
    `);
    const snap2 = dump();
    const dispOf = () => db.prepare('SELECT d.axis FROM disp d JOIN board b ON b.root_event_id = d.parent_id WHERE b.id = ? AND d.child_id = ?').get(ids.b, ids.M)?.axis ?? null;
    o.q1on = snap2 === snap1 && dispOf() === 'right';
    // 제안: 12월 카드엔 '설계 A', 1월 카드엔 '개발 B'·'전 트랙 점검'. '조사 C'(11.20–12.05)는 절반 넘게 겹치지 않아 빠진다
    const off = new Set(o.toAxis?.offered ?? []);
    o.offerOk = off.has(`${ids.m1}\u0001${ids.x1}`) && off.has(`${ids.m2}\u0001${ids.x2}`) && ![...off].some((k) => k.endsWith(`\u0001${ids.out}`));

    // 1 — 열로 되돌려도 그대로
    await js(`await r.board.setTrackAxis(T.M, null); await sleep(150); await r.store.flush(); return true;`);
    o.q1off = dump() === snap1 && dispOf() === null;

    // 8·7 — 왼쪽으로, 이번엔 제안을 받아들인다(확인한 것만 담는다)
    o.left = await js(`
      const p = r.board.setTrackAxis(T.M, 'left');
      await sleep(300);
      // '전 트랙 점검'은 체크를 풀고 적용 — 확정은 사용자
      const row = document.querySelector('.dlg-tree-row[data-id="' + T.m2 + '\\u0001' + T.all + '"] input');
      if (row?.checked) row.click();
      [...document.querySelectorAll('.dlg .btn')].find((b) => b.textContent === '적용')?.click();
      await p; await sleep(250); await r.store.flush();
      const c = r.store.doc.contains ?? [];
      const has = (pa, ch) => c.some((x) => x.parent === pa && x.child === ch);
      const strip = document.querySelector('.axis-strip[data-t="' + T.M + '"]');
      const node = (id) => document.querySelector('.ev[data-id="' + id + '"]');
      const over = (id) => node(id).dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      over(T.m1); await sleep(30);
      const lit1 = node(T.x1).classList.contains('band-lit') && node(T.x2).classList.contains('band-dim') && node(T.m1).classList.contains('band-lit');
      over(T.x2); await sleep(30);
      const lit2 = node(T.m2).classList.contains('band-lit') && !node(T.m1).classList.contains('band-lit');
      document.getElementById('grid').dispatchEvent(new PointerEvent('pointerleave'));
      return { side: strip?.dataset.side, contains: has(T.m1, T.x1) && has(T.m2, T.x2) && !has(T.m2, T.all), lit1, lit2,
        x1InCol: !!document.querySelector('.col[data-t="' + r.store.item(T.x1).place.t + '"] .ev[data-id="' + T.x1 + '"]') };
    `);

    // 8 — 오른쪽으로 바꿔도 같다
    o.right = await js(`
      await r.board.setTrackAxis(T.M, 'right'); await sleep(200);
      const node = (id) => document.querySelector('.ev[data-id="' + id + '"]');
      node(T.m1).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await sleep(30);
      const lit = node(T.x1).classList.contains('band-lit') && node(T.x2).classList.contains('band-dim');
      document.getElementById('grid').dispatchEvent(new PointerEvent('pointerleave'));
      return { side: document.querySelector('.axis-strip[data-t="' + T.M + '"]')?.dataset.side, lit, contains: (r.store.doc.contains ?? []).length };
    `);

    // 4 — 담긴 카드는 한 이벤트: 상태를 바꾸면 그 하나가 바뀐다(원래 트랙 포함·축 카드 포함 둘 다 남는다)
    await js(`r.store.commit('스모크 상태', () => { r.store.item(T.x1).st = 'done'; }); await r.store.flush(); return true;`);
    const x1Parents = db.prepare('SELECT parent_id FROM containment WHERE child_id = ? AND ordered = 1').all(ids.x1).map((x) => x.parent_id);
    o.q4 = db.prepare('SELECT status FROM event WHERE id = ?').get(ids.x1)?.status === 'done' && x1Parents.includes(ids.m1) && x1Parents.length === 2;

    // 축 카드를 끌어도 트랙이 바뀌지 않는다(세로만)
    o.drag = await js(`
      const node = document.querySelector('.axis-strip .ev[data-id="' + T.m2 + '"]');
      const b = node.getBoundingClientRect(), grid = document.getElementById('grid');
      const s0 = r.store.item(T.m2).s;
      const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0 });
      node.dispatchEvent(new PointerEvent('pointerdown', at(b.left + 10, b.top + 10)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(b.left - 500, b.top + 10 + 3 * r.view.ppd * 7)));
      await sleep(80);
      grid.dispatchEvent(new PointerEvent('pointerup', at(b.left - 500, b.top + 10 + 3 * r.view.ppd * 7)));
      await sleep(150);
      const it = r.store.item(T.m2);
      const moved = it.s !== s0, track = it.place.t === T.M;
      r.store.undo(); await sleep(100);
      return { moved, track };
    `);

    // 저장하고 다시 읽기 — 축·포함이 남는다
    o.reload = await js(`
      await r.store.flush(); r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(350);
      return r.store.track(T.M)?.axis === 'right' && (r.store.doc.contains ?? []).length === 2 && !!document.querySelector('.axis-strip .ev[data-id="' + T.m1 + '"]');
    `);

    // 2 — 같은 트랙 이벤트를 다른 보드에 열로: 새 보드의 트랙과 합치기(남기는 쪽 = M) → 배치는 보드마다
    o.q2 = await js(`
      const b2 = await r.adapter.createProject({ version: 26, meta: { name: '축 점검 2', start: '2026-12-01', end: '2027-02-28' }, orgs: ['A'],
        tracks: [{ id: 'tAx2_N', name: '흐름 사본' }, { id: 'tAx2_O', name: '기타' }], items: [] }, '축 점검 2');
      T.b2 = b2;
      await r.tabs.openBoard(b2); await sleep(300);
      const N = r.store.tracks.find((t) => t.name === '흐름 사본').id;
      const m = await r.adapter.mergeEvents(T.M, N);
      r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
      const inB2 = r.store.tracks.find((t) => t.id === T.M);
      return { merged: m?.ok === true, column: !!inB2 && !inB2.axis && document.querySelector('.col[data-t="' + T.M + '"]')?.offsetWidth > 0
        && !document.querySelector('.axis-strip') };
    `);
    const b2 = await js('return T.b2;');
    const disps = db.prepare('SELECT axis FROM disp WHERE child_id = ? AND parent_id IN (SELECT root_event_id FROM board WHERE id IN (?, ?))').all(ids.M, ids.b, b2);
    o.disps = disps;
    o.q2ok = o.q2?.merged && o.q2?.column && disps.length === 2 && disps.some((d) => d.axis === 'right') && disps.some((d) => d.axis == null);

    // 5 — 축 카드를 보드에서 빼도 담긴 카드는 원래 트랙에 남는다
    o.q5 = await js(`
      await r.tabs.openBoard(T.b); await sleep(300);
      r.store.commit('스모크 빼기', (doc) => { doc.items = doc.items.filter((i) => i.id !== T.m1); });
      await r.store.flush(); await sleep(150);
      return !!r.store.item(T.x1) && !!document.querySelector('.col .ev[data-id="' + T.x1 + '"]');
    `);
    o.q5db = !!db.prepare('SELECT 1 FROM event WHERE id = ?').get(ids.x1)
      && db.prepare('SELECT COUNT(*) n FROM containment WHERE child_id = ? AND parent_id != ?').get(ids.x1, ids.m1).n >= 1;

    // 6 — 날짜 없는 보드에서도 띠가 그려진다(칸 위치로)
    o.q6 = await js(`
      const b3 = await r.adapter.createProject({ version: 26, meta: { name: '축 칸 보드', start: '2026-12-01', end: '2027-02-28',
        display: { scale: 'none', dated: false, slotUnit: null } }, orgs: ['A'],
        tracks: [{ id: 'tAx3_A', name: 'A' }, { id: 'tAx3_S', name: '단계', axis: 'right' }],
        items: [
          { id: 'eAx3_s', ti: '1단계', s: null, e: null, place: { t: 'tAx3_S', slot: { s: 0, len: 3 } } },
          { id: 'eAx3_a', ti: '일 하나', s: null, e: null, place: { t: 'tAx3_A', slot: { s: 1, len: 1 } } },
        ], contains: [{ parent: 'eAx3_s', child: 'eAx3_a' }] }, '축 칸 보드');
      T.b3 = b3;
      await r.tabs.openBoard(b3); await sleep(350);
      const strip = document.querySelector('.axis-strip');
      const band = strip?.querySelector('.ev');
      return { dated: r.board.dated, strip: !!strip, band: !!band && band.offsetHeight > 20, contains: (r.store.doc.contains ?? []).length === 1 };
    `);

    // 9 — 전용 객체·스키마·테이블이 없다: 이벤트 표에 축 칸이 없고, 새 표가 없다. 축은 배치(disp) 칸 하나
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    const evCols = db.prepare('PRAGMA table_info(event)').all().map((c) => c.name);
    const dispCols = db.prepare('PRAGMA table_info(disp)').all().map((c) => c.name);
    o.q9 = !tables.some((t) => /axis|period|strip/i.test(t)) && !evCols.includes('axis') && dispCols.includes('axis');

    // 정리 — 시험 보드 지우고 처음 보드로
    await js(`
      for (const id of [T.b3, T.b2, T.b]) { if (id) { await r.adapter.deleteProject(id); r.tabs.boardClosed?.(id); } }
      await r.tabs.openBoard(T.b0); await sleep(300); window.__axisT = null; return true;
    `);
    console.log('[smoke] axis-track ' + JSON.stringify(o));
    return o;
  },
  check: (o) => o && o.setup?.ok && o.toAxis?.dialog && o.toAxis?.strip && o.toAxis?.bandsInStrip && o.toAxis?.colZero && o.toAxis?.allInCols
    && o.toAxis?.noContains && o.q1on && o.offerOk && o.q1off && o.left?.side === 'left' && o.left?.contains && o.left?.lit1 && o.left?.lit2
    && o.left?.x1InCol && o.right?.side === 'right' && o.right?.lit && o.q4 && o.drag?.moved && o.drag?.track && o.reload
    && o.q2ok && o.q5 && o.q5db && o.q6?.strip && o.q6?.band && o.q6?.contains && o.q6?.dated === false && o.q9,
};
