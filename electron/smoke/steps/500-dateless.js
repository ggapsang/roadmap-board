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
          // 왼쪽 칸 — 칸마다 번호 칸(높이 손잡이). 달력의 바깥 칸(월 등)은 없다
          const out = { b2, dated: r.board.dated, gutNumbers: document.querySelector('.gut-m b.slot u')?.textContent === '1',
            outer: document.querySelectorAll('.gut-m b:not(.slot)').length, slotCells: document.querySelectorAll('.gut-m b.slot').length === r.board.totalDays,
            now: !!document.querySelector('.now') };
          const t0 = r.store.tracks[0].id;
          const a = r.board.createItem(t0, 2);              // 3번 칸에 한 칸
          const b = r.board.createItem(t0, 4, 6);           // 5~7번 칸
          await sleep(500);
          out.aSlot = JSON.stringify(a.place.slot); out.aDate = a.s;
          out.label = document.querySelector('.ev[data-id="' + b.id + '"] .dt')?.textContent ?? '';
          out.noSlotText = !/칸/.test(document.querySelector('.ev[data-id="' + b.id + '"]')?.textContent ?? '칸');
          out.forced = JSON.stringify([a.place.hd, a.place.x, a.place.w, b.place.hd]);
          out.forcedBtn = document.getElementById('i-fixedh').getAttribute('aria-pressed');
          // 칸 높이 — 3번 칸 아래 가장자리를 한 칸만큼 끌면 그 칸만 두 배, 그 칸의 카드도 커진다. 되돌리기 · 다시 읽기 · 더블클릭 원복
          {
            document.querySelector('#pItem [data-close]')?.click(); await sleep(80);
            const card = () => document.querySelector('.ev[data-id="' + a.id + '"]');
            const h0 = card().getBoundingClientRect().height;
            const cell = () => document.querySelector('.gut-m b.slot[data-slot="2"]');
            const c0 = cell().getBoundingClientRect().height;
            const hd = cell().querySelector('.band-resize'); const hb = hd.getBoundingClientRect();
            const at = (y) => ({ bubbles: true, clientX: hb.left + hb.width / 2, clientY: y, button: 0, pointerId: 7 });
            const gutM = document.getElementById('gutM');
            hd.dispatchEvent(new PointerEvent('pointerdown', at(hb.top + 2)));
            gutM.dispatchEvent(new PointerEvent('pointermove', at(hb.top + 2 + 10)));
            gutM.dispatchEvent(new PointerEvent('pointermove', at(hb.top + 2 + c0)));
            gutM.dispatchEvent(new PointerEvent('pointerup', at(hb.top + 2 + c0)));
            await sleep(200);
            const rows = r.store.meta.display.slotRows ?? {};
            out.slotRow = { scale: rows['2'], only: Object.keys(rows).join(','), cell: Math.round(cell().getBoundingClientRect().height / c0 * 10) / 10,
              cardGrew: card().getBoundingClientRect().height > h0 + c0 * 0.6,
              otherSame: Math.round(document.querySelector('.gut-m b.slot[data-slot="5"]').getBoundingClientRect().height) === Math.round(c0) };
            r.store.undo(); await sleep(150);
            out.slotRow.undone = !r.store.meta.display.slotRows?.['2'];
            r.store.redo(); await sleep(300);
            r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
            out.slotRow.reloaded = r.store.meta.display.slotRows?.['2'];
            cell().querySelector('.band-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            await sleep(150);
            out.slotRow.reset = !r.store.meta.display.slotRows?.['2'] && Math.round(cell().getBoundingClientRect().height) === Math.round(c0);
            r.itemPanel.open(a.id); await sleep(150);
          }
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
  check: (dateless) => (dateless?.dated === false && dateless?.gutNumbers === true && dateless?.outer === 0 && dateless?.slotCells === true
      && dateless?.slotRow?.scale >= 1.8 && dateless?.slotRow?.scale <= 2.2 && dateless?.slotRow?.only === '2'
      && dateless?.slotRow?.cell >= 1.8 && dateless?.slotRow?.cardGrew === true && dateless?.slotRow?.otherSame === true
      && dateless?.slotRow?.undone === true && dateless?.slotRow?.reloaded === dateless?.slotRow?.scale && dateless?.slotRow?.reset === true && dateless?.now === false
      && dateless?.aSlot === '{"s":2,"len":1}' && dateless?.aDate == null && dateless?.label === '' && dateless?.noSlotText === true
      && dateless?.forced === '[1,0,1,3]' && dateless?.forcedBtn === 'true'
      && dateless?.slotsHidden === true && dateless?.reloaded === '{"s":4,"len":3}'
      && dateless?.cal?.dated === true && dateless?.cal?.scale === 'month-week'
      && dateless?.cal?.s === '2026-11-02' && dateless?.cal?.e === '2026-11-22' && dateless?.undone === true
      && dateless?.db?.nullDates === true && dateless?.db?.slot?.[0] === 4 && dateless?.db?.slot?.[1] === 3),
};
