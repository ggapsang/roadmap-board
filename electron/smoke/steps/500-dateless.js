// 스모크 단계 'dateless' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'dateless',
  areas: ["axis","db","board","config"],
  async run({ target, capture, db, shotDir, wrote }) {
    let dateless = null;
    // 날짜 없는 보드 (docs/SCALE.md §2) — 처음부터 눈금 없이 만든다. 일정은 날짜 없이 칸만 갖고(DB NULL),
    // 눈금 설정(일괄)으로 칸마다 날짜를 얻는다.
    if (wrote) {
      // 찍기: 렌더러가 멈춰 기다리는 동안 메인이 캡처한다(한 executeJavaScript 안에서 끊지 않고)
      if (shotDir()) {
        await target.webContents.executeJavaScript(`window.__datelessShot = () => new Promise((res) => { window.__datelessGo = res; }); true`);
        const poll = setInterval(async () => {
          const waiting = await target.webContents.executeJavaScript('typeof window.__datelessGo === "function"').catch(() => false);
          if (!waiting) return;
          clearInterval(poll);
          await capture(target, 'dateless');
          await target.webContents.executeJavaScript('window.__datelessGo(); window.__datelessGo = null; window.__datelessShot = null; true');
        }, 200);
      }
      dateless = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const b1 = r.adapter.projectId;
          const doc = { version: 18, meta: { start: '2026-10-01', end: '2027-03-31', name: '칸 보드',
            display: { scale: 'none', dated: false, slotUnit: null } },
            orgs: ['A'], tracks: [{ id: 't0', lab: '', name: '트랙 1' }], items: [] };
          const b2 = await r.adapter.createProject(doc, '칸 보드');
          await r.tabs.openBoard(b2); await sleep(300);
          const out = { b2, dated: r.board.dated, gutNumbers: document.querySelector('.gut-w s')?.textContent === '1',
            outer: document.querySelectorAll('.gut-m b').length, now: !!document.querySelector('.now') };
          const t0 = r.store.tracks[0].id;
          const a = r.board.createItem(t0, 2);              // 3번 칸에 한 칸
          const b = r.board.createItem(t0, 4, 6);           // 5~7번 칸
          await sleep(500);
          out.aSlot = JSON.stringify(a.place.slot); out.aDate = a.s;
          out.label = document.querySelector('.ev[data-id="' + b.id + '"] .dt')?.textContent ?? '';
          out.slotsHidden = document.getElementById('i-dates').hidden && !document.getElementById('i-slots').hidden;
          out.a = a.id; out.b = b.id;
          window.__datelessShot = window.__datelessShot ?? null;
          if (window.__datelessShot) await window.__datelessShot();
          // 다시 읽어도 칸이 남는다
          r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
          out.reloaded = JSON.stringify(r.store.item(b.id)?.place?.slot);
          // 눈금 설정 — 1칸 = 1주, 1번 칸 = 2026-10-05(월)
          const { applyCalendar } = await import('./src/core/timeline.js');
          r.store.commit('눈금 설정', (d) => { applyCalendar(d, 'week', '2026-10-05'); });
          await sleep(400);
          const ib = r.store.item(b.id);
          out.cal = { dated: r.store.meta.display.dated, scale: r.store.meta.display.scale, s: ib.s, e: ib.e };
          r.store.undo(); await sleep(400);
          out.undone = r.store.meta.display.dated === false && r.store.item(b.id)?.s == null;
          r.tabs.boardClosed(b2);
          await r.tabs.openBoard(b1); await sleep(200);
          return out;
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 25000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      try {
        const row = db.prepare('SELECT start_date, end_date FROM event WHERE id = ?').get(dateless?.a ?? '');
        const disp = db.prepare('SELECT slot_start, slot_len FROM disp WHERE child_id = ?').get(dateless?.b ?? '');
        dateless.db = { nullDates: !!row && row.start_date == null && row.end_date == null, slot: disp ? [disp.slot_start, disp.slot_len] : null };
        await target.webContents.executeJavaScript(`window.__roadmap.adapter.deleteProject(${Number(dateless?.b2) || 0})`);
      } catch (err) { dateless.db = { error: String(err) }; }
      console.log('[smoke] dateless ' + JSON.stringify(dateless));
    }
    return dateless;
  },
  check: (dateless) => (dateless?.dated === false && dateless?.gutNumbers === true && dateless?.outer === 0 && dateless?.now === false
      && dateless?.aSlot === '{"s":2,"len":1}' && dateless?.aDate == null && dateless?.label === '칸 5–7'
      && dateless?.slotsHidden === true && dateless?.reloaded === '{"s":4,"len":3}'
      && dateless?.cal?.dated === true && dateless?.cal?.scale === 'month-week'
      && dateless?.cal?.s === '2026-11-02' && dateless?.cal?.e === '2026-11-22' && dateless?.undone === true
      && dateless?.db?.nullDates === true && dateless?.db?.slot?.[0] === 4 && dateless?.db?.slot?.[1] === 3),
};
