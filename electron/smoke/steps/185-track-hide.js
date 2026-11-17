// 스모크 단계 'track-hide' — 트랙 머리 고르기·숨기기(구글 스프레드시트의 열처럼, 2026-11-17 사용자)와 함께 넣은 보드 조작:
//   Ctrl+클릭으로 여러 트랙 고르기 → 우클릭 '트랙 N개 숨기기' → 칸이 0 폭으로 접히고 그 트랙 카드·메모가 빠진다(문서·구성은 그대로) →
//   저장하고 다시 읽어도 숨김(보드 meta_json) → 경계 화살표로 다시 보이기 · 되돌리기 → 숨긴 트랙을 사이에 둔 걸침 카드는 한 장 ·
//   모두 숨기기는 막는다 · 머리를 끌어 가장자리에 대면 저절로 스크롤 · 가운데 버튼으로 보드 옮기기 · 축 끝 '+'로 기간 늘리기
export default {
  name: 'track-hide',
  areas: ['board', 'memo', 'ctxmenu', 'db'],
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
        const o = {};
        const doc0 = JSON.parse(JSON.stringify(r.store.doc));
        const ids = r.store.tracks.map((t) => t.id);
        if (ids.length < 4) return { error: '트랙이 4개보다 적다' };
        const th = (id) => document.querySelector('.head .th[data-t="' + id + '"]');
        const col = (id) => document.querySelector('.body .col[data-t="' + id + '"]');
        const cardsIn = (id) => col(id)?.querySelectorAll('.ev').length ?? 0;
        const [A, B, C, D] = ids;

        // 1. 고르기 — 클릭은 하나만, Ctrl+클릭으로 더하기
        th(B).click(); await sleep(150);
        th(C).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await sleep(80);
        o.picked = [...r.view.pickedTracks].sort().join() === [B, C].sort().join()
          && th(B).classList.contains('picked') && th(C).classList.contains('picked');
        const hadCards = cardsIn(B) + cardsIn(C);

        // 2. 우클릭 → '트랙 2개 숨기기'
        const rc = th(C).getBoundingClientRect();
        th(C).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: rc.left + 10, clientY: rc.top + 10 }));
        await sleep(80);
        const btns = [...document.querySelectorAll('.ctx-menu button')];
        o.menu = btns.map((b) => b.textContent);
        btns.find((b) => b.textContent === '트랙 2개 숨기기')?.click();
        await sleep(250);
        o.hidden = (r.store.meta.hiddenTracks ?? []).join() === [B, C].join()
          && col(B).offsetWidth === 0 && col(C).offsetWidth === 0
          && th(B).classList.contains('th-hidden') && cardsIn(B) + cardsIn(C) === 0
          && r.store.tracks.length === ids.length;                     // 트랙(구성)은 그대로
        o.hadCards = hadCards;
        o.arrows = document.querySelectorAll('.head .unhide').length === 2;   // 앞뒤로 보이는 트랙이 있다 — ◀ ▶ 한 쌍

        // 3. 저장하고 다시 읽어도 숨김
        await r.store.flush();
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = (r.store.meta.hiddenTracks ?? []).join() === [B, C].join() && col(B)?.offsetWidth === 0;

        // 4. 경계 화살표로 다시 보이기 → 되돌리기면 다시 숨는다
        document.querySelector('.head .unhide')?.click(); await sleep(200);
        o.unhidden = !(r.store.meta.hiddenTracks ?? []).length && col(B).offsetWidth > 0 && cardsIn(B) + cardsIn(C) === hadCards;
        r.store.undo(); await sleep(200);
        o.undo = (r.store.meta.hiddenTracks ?? []).length === 2;
        r.store.redo(); await sleep(150);

        // 5. 숨긴 트랙을 사이에 둔 걸침 카드 — 한 장으로, 양쪽 칸 폭만큼
        const probe = 'e-hide-probe';
        r.store.commit('스모크 걸침', (doc) => {
          doc.items.push({ id: probe, ti: '걸침 점검', s: doc.meta.start, e: doc.meta.start, ty: 'bar', st: 'plan', og: '', pg: 0, note: '',
            place: { t: A, tracks: [A, B, C], sp: 3, align: 'middle', showNote: false, hd: null, x: null, w: null, slot: null } });
          doc.meta.hiddenTracks = [B];
        });
        await sleep(200);
        const nodes = [...document.querySelectorAll('.body .ev[data-id="' + probe + '"]')];
        const w = nodes[0]?.getBoundingClientRect().width ?? 0;
        const want = (col(A).getBoundingClientRect().width + col(C).getBoundingClientRect().width);
        o.span = { n: nodes.length, w: Math.round(w), want: Math.round(want) };
        o.spanOk = nodes.length === 1 && Math.abs(w - want) < 12;

        // 6. 모두 숨기기는 막는다
        o.allBlocked = r.board.hideTracks(ids) === false && (r.store.meta.hiddenTracks ?? []).length === 1;

        // 6b. 너비 맞추기 — 고른 트랙 중 하나의 경계를 끌면 고른 것 모두 같은 너비 · 우클릭 '너비 같게' · '너비 자동'
        r.store.commit('스모크 원복', (doc) => { doc.meta.hiddenTracks = []; doc.items = doc.items.filter((i) => i.id !== probe); });
        await sleep(150);
        const wB0 = r.store.track(B).w ?? null;
        th(A).click(); await sleep(150);
        th(C).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); await sleep(80);
        const grip = th(A).querySelector('.th-resize'), gr = grip.getBoundingClientRect();
        const pd = (x) => ({ bubbles: true, clientX: x, clientY: gr.top + 5, button: 0, pointerId: 2 });
        grip.dispatchEvent(new PointerEvent('pointerdown', pd(gr.left + 2)));
        window.dispatchEvent(new PointerEvent('pointermove', pd(gr.left + 82)));
        window.dispatchEvent(new PointerEvent('pointerup', pd(gr.left + 82)));
        await sleep(150);
        o.widthDrag = { A: r.store.track(A).w, C: r.store.track(C).w, B: r.store.track(B).w ?? null };
        o.widthDragOk = o.widthDrag.A != null && o.widthDrag.A === o.widthDrag.C && o.widthDrag.B === wB0;
        r.board.setTrackWidths([A], 160); await sleep(150);
        const menuAt = (id) => { const b = th(id).getBoundingClientRect();
          th(id).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 10 })); };
        menuAt(C); await sleep(80);
        const wBtns = [...document.querySelectorAll('.ctx-menu button')];
        o.widthMenu = wBtns.map((b) => b.textContent).filter((t) => t.includes('너비'));
        wBtns.find((b) => b.textContent.startsWith('트랙 2개 너비 같게'))?.click(); await sleep(150);
        o.widthSame = r.store.track(A).w === r.store.track(C).w && r.store.track(A).w === o.widthDrag.C;
        // 6c. 고르게 나누기 — 지금 두 폭의 합을 반씩(전체 폭 그대로)
        r.board.setTrackWidths([A], 160); await sleep(150);
        const sum = col(A).offsetWidth + col(C).offsetWidth;
        menuAt(C); await sleep(80);
        [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent.startsWith('트랙 2개 너비 고르게 나누기'))?.click(); await sleep(150);
        o.widthSplit = { sum, A: r.store.track(A).w, C: r.store.track(C).w };
        o.widthSplitOk = sum > 0 && o.widthSplit.A === o.widthSplit.C && Math.abs(o.widthSplit.A * 2 - sum) <= 1;
        menuAt(C); await sleep(80);
        [...document.querySelectorAll('.ctx-menu button')].find((b) => b.textContent === '트랙 2개 너비 자동')?.click(); await sleep(150);
        o.widthAuto = r.store.track(A).w == null && r.store.track(C).w == null;

        // 7. 머리를 끌어 오른쪽 가장자리에 대면 저절로 스크롤 — 트랙을 넓혀 보드가 화면보다 넓게
        r.store.commit('스모크 원복', (doc) => { doc.meta.hiddenTracks = []; doc.items = doc.items.filter((i) => i.id !== probe); });
        r.store.commit('스모크 넓히기', (doc) => { for (const t of doc.tracks) t.w = 700; });
        // 함께 끌기 — 고른 A·C를 끌면 둘이 순서대로 붙어 옮겨진다(트랙 하나 끌기는 아래 7)
        {
          const hc = th(C).getBoundingClientRect(), hb = th(B).getBoundingClientRect(), h0 = th(A).getBoundingClientRect();
          const mv = (x) => ({ bubbles: true, clientX: x, clientY: h0.top + h0.height / 2, button: 0, pointerId: 3 });
          th(A).dispatchEvent(new PointerEvent('pointerdown', mv(h0.left + 20)));
          window.dispatchEvent(new PointerEvent('pointermove', mv(hb.left + 10)));
          window.dispatchEvent(new PointerEvent('pointerup', mv(hb.left + 10)));
          await sleep(150);
          const ord = r.store.tracks.map((t) => t.id);
          o.multiDrag = ord.indexOf(C) === ord.indexOf(A) + 1;
          r.store.commit('스모크 원복', (doc) => { doc.tracks.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)); });
          r.board.clearPickedTracks();
          await sleep(150);
        }
        await sleep(250);
        const sc = document.getElementById('scroll');
        sc.scrollLeft = 0;
        const cell = th(A), c0 = cell.getBoundingClientRect(), sr = sc.getBoundingClientRect();
        const at = (x) => ({ bubbles: true, clientX: x, clientY: c0.top + c0.height / 2, button: 0, pointerId: 1 });
        cell.dispatchEvent(new PointerEvent('pointerdown', at(c0.left + 30)));
        const edge = sr.left + sc.clientWidth - 6;
        window.dispatchEvent(new PointerEvent('pointermove', at(edge)));
        await sleep(2000);
        o.autoScrolled = sc.scrollLeft > 100;
        window.dispatchEvent(new PointerEvent('pointerup', at(edge)));
        await sleep(200);
        o.movedFar = r.store.tracks.map((t) => t.id).indexOf(A) >= 2;

        // 8. 가운데 버튼으로 끌면 보드가 따라 움직인다(가로·세로)
        sc.scrollLeft = 300; sc.scrollTop = 300; await sleep(50);
        const g = document.getElementById('grid').getBoundingClientRect();
        const mx = g.left + 400, my = g.top + 400;
        const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1, buttons: 4, clientX: mx, clientY: my });
        document.getElementById('grid').dispatchEvent(md);
        o.panDefault = md.defaultPrevented;                       // 자동 스크롤(원형 커서)을 막았다
        window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 4, clientX: mx - 120, clientY: my - 80 }));
        window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 1, clientX: mx - 120, clientY: my - 80 }));
        o.pan = { x: sc.scrollLeft, y: sc.scrollTop };
        o.panned = sc.scrollLeft === 420 && sc.scrollTop === 380 && !document.body.classList.contains('panning');

        // 9. 축 끝 '+' — 가장 큰 눈금 하나만큼 기간을 늘린다(월-주면 다음 달 말일까지)
        const end0 = r.store.meta.end;
        const more = document.querySelector('.axis-more');
        o.moreShown = !!more && !more.hidden;
        more?.querySelector('.axis-add')?.click(); await sleep(150);
        o.extended = { from: end0, to: r.store.meta.end, label: more?.querySelector('.axis-add')?.textContent };
        o.extendOk = r.store.meta.end > end0;

        // 원복
        r.store.replace ? r.store.replace(doc0, '스모크 원복') : r.store.commit('스모크 원복', (doc) => { Object.assign(doc, JSON.parse(JSON.stringify(doc0))); });
        await r.store.flush(); await sleep(150);
        o.restored = r.store.tracks.map((t) => t.id).join() === ids.join() && !(r.store.meta.hiddenTracks ?? []).length
          && r.store.meta.end === doc0.meta.end && r.store.tracks.every((t) => (t.w ?? null) === (doc0.tracks.find((x) => x.id === t.id)?.w ?? null));
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    // 저장된 값 — 보드 meta_json에만(4대상엔 없다)
    console.log('[smoke] track-hide ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o && !o.error && o.picked && o.hidden && o.arrows && o.reloaded && o.unhidden && o.undo && o.spanOk
    && o.allBlocked && o.widthDragOk && o.widthSame && o.widthSplitOk && o.widthAuto && o.multiDrag && o.autoScrolled && o.movedFar && o.panDefault && o.panned && o.moreShown && o.extendOk && o.restored,
};
