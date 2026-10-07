// 스모크 단계 'memo' — 메모(포스트잇). 이벤트가 아니다(보드 표시 meta.memos). 빈 곳 우클릭으로 붙이고, 마크다운으로 보이고,
// 행 높이·트랙 폭이 바뀌어도 붙인 자리(날짜·트랙 비율)를 따라가고, 끌어 옮기기·크기·Delete·되돌리기·저장·내보내기(메모 빼기).
export default {
  name: 'memo',
  areas: ['memo', 'board', 'data', 'note'],
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const o = {};
        const items0 = r.store.items.length, rels0 = r.store.relations.length;
        const memos = () => r.store.meta.memos ?? [];
        const nodeOf = (id) => document.querySelector('.memo[data-memo="' + id + '"]');
        // 빈 곳 우클릭 → '메모 붙이기' — 두 번째 트랙의 빈 자리
        const col = document.querySelectorAll('.body > .col')[1];
        const cr = col.getBoundingClientRect();
        let cx = cr.left + cr.width * 0.4, cy = cr.top + 40;
        for (let y = cr.top + 40; y < cr.top + 2000; y += 12) {     // 카드가 없는 자리
          const hit = document.elementFromPoint(cx, y);
          if (hit && hit.closest('.col') === col && !hit.closest('.ev')) { cy = y; break; }
        }
        col.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: cx, clientY: cy }));
        await sleep(80);
        const item = [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.trim() === '메모 붙이기');
        o.menu = !!item;
        item?.click();
        await sleep(200);
        const m0 = memos()[0];
        o.created = memos().length === 1 && !!m0?.date && m0.track === col.dataset.t && m0.x > 0.3 && m0.x < 0.5;
        o.editing = r.board.memos.editing && !!nodeOf(m0.id)?.querySelector('.cm-editor');
        // 마크다운 — 쓰고 Esc로 마치면 바로 서식으로 보인다
        r.board.memos.edit.ed.setValue('# 메모 제목\\n**굵게** 쓴 글', { resetHistory: false });
        await sleep(50);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(200);
        const n = () => nodeOf(m0.id);
        o.markdown = !r.board.memos.editing && n()?.querySelector('.memo-body strong')?.textContent === '굵게'
          && memos()[0].text.startsWith('# 메모 제목');
        o.notEvent = r.store.items.length === items0 && r.store.relations.length === rels0;
        // 붙이기 + 쓰기 = 되돌리기 한 단계
        r.store.undo(); await sleep(150);
        o.undoOne = memos().length === 0;
        r.store.redo(); await sleep(150);
        o.redo = memos().length === 1 && memos()[0].text.startsWith('# 메모');
        // 놓인 자리 = 그 칸 + 비율 · 그 날짜
        const expect = () => r.board.memos.box(memos()[0]);
        const at = () => ({ left: n().offsetLeft, top: n().offsetTop });
        o.placed = Math.abs(at().left - expect().left) < 1 && Math.abs(at().top - expect().top) < 1;
        // 행 높이를 바꾸면 그 날짜 자리를 따라간다(px 그대로가 아니다)
        const top0 = at().top;
        const zoomBtns = [...document.querySelectorAll('#zoom button')];
        const cur = zoomBtns.find((b) => b.getAttribute('aria-pressed') === 'true');
        const other = zoomBtns.find((b) => b !== cur && Number(b.dataset.zoom) > Number(cur.dataset.zoom)) ?? zoomBtns.find((b) => b !== cur);
        other.click(); await sleep(250);
        o.followRows = Math.abs(at().top - expect().top) < 1 && Math.abs(at().top - top0) > 2;
        cur.click(); await sleep(250);
        // 트랙 폭을 바꾸면 그 칸 안 비율 자리를 따라간다
        const tid = memos()[0].track;
        const w0 = r.store.track(tid).w ?? null;
        r.store.commit('스모크 트랙 폭', (doc) => { doc.tracks.find((t) => t.id === tid).w = 480; });
        await sleep(200);
        const c2 = r.board.columns.get(tid);
        o.followWidth = Math.abs(at().left - (c2.offsetLeft + memos()[0].x * c2.offsetWidth)) < 1;
        r.store.commit('스모크 트랙 폭 원복', (doc) => { doc.tracks.find((t) => t.id === tid).w = w0; });
        await sleep(200);
        // 끌어 옮기기 — 놓을 때 한 번 저장(자리 = 새 날짜·비율). 보드 확대 배율을 나눈다
        const z = r.board.zoom || 1;
        const pe = (type, x, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 9 });
        let b = n().getBoundingClientRect();
        const date0 = memos()[0].date;
        n().querySelector('.memo-body').dispatchEvent(pe('pointerdown', b.left + 20, b.top + 10));
        for (let k = 1; k <= 4; k++) window.dispatchEvent(pe('pointermove', b.left + 20 + k * 5, b.top + 10 + k * 40));
        window.dispatchEvent(pe('pointerup', b.left + 40, b.top + 170));
        await sleep(200);
        o.moved = memos()[0].date !== date0 && Math.abs(at().top - expect().top) < 1 && r.view.selectedMemo === m0.id;
        // 크기 — 오른쪽 아래 손잡이
        b = n().getBoundingClientRect();
        const w0m = memos()[0].w, h0m = memos()[0].h;
        n().querySelector('.memo-grip').dispatchEvent(pe('pointerdown', b.right - 3, b.bottom - 3));
        window.dispatchEvent(pe('pointermove', b.right - 3 + 30 * z, b.bottom - 3 + 20 * z));
        window.dispatchEvent(pe('pointerup', b.right - 3 + 60 * z, b.bottom - 3 + 40 * z));
        await sleep(200);
        o.resized = memos()[0].w === Math.round(w0m + 60) && memos()[0].h === Math.round(h0m + 40);
        // 내보내기 — 메모 빼기를 고르면 JSON에 meta.memos가 없고, 인쇄·PDF·PNG용 표식이 붙는다
        const ex = await import('./src/ui/export.js');
        const was = ex.exportMemos.get();
        ex.exportMemos.set(false);
        o.jsonNoMemos = !('memos' in JSON.parse(ex.exportJsonText(r.store)).meta)
          && document.body.classList.contains('no-memo-export')
          && document.getElementById('ex-memos').getAttribute('aria-checked') === 'false';
        ex.exportMemos.set(true);
        o.jsonMemos = JSON.parse(ex.exportJsonText(r.store)).meta.memos?.length === 1 && !document.body.classList.contains('no-memo-export');
        ex.exportMemos.set(was);
        // 저장 → 다시 읽어도 남는다
        await r.store.flush();
        o.id = m0.id;
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = memos().length === 1 && memos()[0].id === m0.id && !!nodeOf(m0.id);
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 25000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    try {
      const row = db.prepare('SELECT meta_json FROM board WHERE id = (SELECT MAX(id) FROM board)').get();
      const all = db.prepare('SELECT meta_json FROM board').all().map((x) => x.meta_json ?? '');
      out.db = all.some((j) => j.includes(out?.id ?? '__none__'));
      out.notInEvents = !db.prepare('SELECT 1 FROM event WHERE id = ?').get(out?.id ?? '');
      void row;
      // 고르고 Delete → 지운다(휴지통 없이). 되돌리기로 살아난다. 끝에 지워 둔다
      out.del = await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = ${JSON.stringify(out?.id ?? '')};
        r.board.memos.select(id);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        await sleep(150);
        const gone = !(r.store.meta.memos ?? []).length && !document.querySelector('.memo');
        r.store.undo(); await sleep(150);
        const back = (r.store.meta.memos ?? []).length === 1;
        r.board.memos.remove(id); await sleep(100);
        await r.store.flush();
        return { gone, back };
      })()`);
    } catch (err) { out.db = { error: String(err) }; }
    console.log('[smoke] memo ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.menu === true
    && o?.created === true
    && o?.editing === true
    && o?.markdown === true
    && o?.notEvent === true
    && o?.undoOne === true
    && o?.redo === true
    && o?.placed === true
    && o?.followRows === true
    && o?.followWidth === true
    && o?.moved === true
    && o?.resized === true
    && o?.jsonNoMemos === true
    && o?.jsonMemos === true
    && o?.reloaded === true
    && o?.db === true
    && o?.notInEvents === true
    && o?.del?.gone === true
    && o?.del?.back === true,
};
