// 스모크 단계 'arrow-edit' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'arrow-edit',
  areas: ["arrows"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target }) {
    let arrowEdit = null;
  // 화살표 모양 고치기 — 더블클릭하면 손잡이, 끝 손잡이를 끌면 연결된 카드 테두리를 따라(가장 가까운 테두리 점),
  // 가운데 손잡이는 꺾이는 위치. 되돌리기·저장 왕복·Esc·자동 경로로 되돌리기.
  arrowEdit = await target.webContents.executeJavaScript(`(async () => {
    const run = (async () => {
      const r = window.__roadmap, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const path = [...document.querySelectorAll('.arrows .arrow')].find((p) => p.dataset.rel);
      const id = path.dataset.rel, toId = path.dataset.to;
      const before = path.getAttribute('d');
      path.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(80);
      const handles = document.querySelectorAll('#grid .arrow-handles .ah-end').length;
      const noChangeYet = !r.store.meta.arrows?.[id];                              // 편집만 시작 — 아직 안 바뀐다
      // 끝 손잡이를 후행 카드 오른쪽 변 가운데로
      const toCard = document.querySelector('#grid .ev[data-id="' + toId + '"]').getBoundingClientRect();
      const hb = document.querySelector('#grid .arrow-handles .ah-end[data-part="b"]');
      const hr = hb.getBoundingClientRect();
      const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 31 });
      hb.dispatchEvent(new PointerEvent('pointerdown', at(hr.left + 5, hr.top + 5)));
      window.dispatchEvent(new PointerEvent('pointermove', at(toCard.right + 3, toCard.top + toCard.height / 2)));
      window.dispatchEvent(new PointerEvent('pointerup', at(toCard.right + 3, toCard.top + toCard.height / 2)));
      await sleep(120);
      const o = r.store.meta.arrows?.[id];
      const endOk = o?.b?.side === 'right' && Math.abs(o.b.t - 0.5) < 0.05;
      const after = document.querySelector('.arrows .arrow[data-rel="' + id + '"]')?.getAttribute('d');
      const redrawn = after !== before && !!document.querySelector('.arrows .arrow.custom[data-rel="' + id + '"]');
      const stillEditing = !!document.querySelector('#grid .arrow-handles');
      // 되돌리기 한 번 = 끌기 전체
      r.store.undo(); await sleep(80);
      const undone = !r.store.meta.arrows?.[id];
      r.store.redo(); await sleep(80);
      // 가운데 손잡이 — 양 끝이 오른쪽 변 → 왼쪽 변이면 가운데 세로 구간이 생겨 그 위치를 옮긴다
      r.store.commit('시험', (doc) => { doc.meta.arrows = { ...doc.meta.arrows, [id]: { a: { side: 'right', t: 0.5 }, b: { side: 'left', t: 0.5 }, m: 0.5 } }; });
      await sleep(80);
      let midOk = null;
      // 손잡이가 늘 있어야 한다 — 이 끝점들로 맞는 가운데 위치가 없으면(키 큰 카드 바로 아래 카드) 맞는 자리를 찾아 그린다.
      // 옮길 곳은 두 카드를 가로지르지 않는 데만 받으므로 몇 군데 끌어 본다(카드 배치에 따라 어느 쪽이 비어 있는지 다르다).
      const m0 = r.store.meta.arrows[id].m;
      for (const d of [15, 60, -15, -60]) {
        const hm = document.querySelector('#grid .arrow-handles .ah-mid');
        if (!hm) { midOk = false; break; }
        const mr = hm.getBoundingClientRect();
        const horizontal = hm.classList.contains('ah-x');
        const to = at(mr.left + 4 + (horizontal ? d : 0), mr.top + 4 + (horizontal ? 0 : d));
        hm.dispatchEvent(new PointerEvent('pointerdown', at(mr.left + 4, mr.top + 4)));
        window.dispatchEvent(new PointerEvent('pointermove', to));
        window.dispatchEvent(new PointerEvent('pointerup', to));
        await sleep(100);
        midOk = r.store.meta.arrows[id].m !== m0;
        if (midOk) break;
      }
      // Esc로 끝
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(50);
      const ended = !document.querySelector('#grid .arrow-handles');
      // 저장 왕복 — 다시 읽어도 모양이 남는다
      await sleep(300);
      r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(250);
      const persisted = r.store.meta.arrows?.[id]?.b?.side === 'left' && r.store.meta.arrows?.[id]?.a?.side === 'right';
      // 보드 확대·축소로 크기만 바뀌면 꺾임 모양(나가는 방향 순서)이 그대로 — 고친 것·자동 모두
      const sig = () => {
        const out = {};
        for (const [rid, g] of r.board.arrowLayer._geom ?? []) {
          const p = g.points, dirs = [];
          for (let i = 1; i < p.length; i += 1) { const dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y; dirs.push(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U')); }
          out[rid] = dirs.join('');
        }
        return out;
      };
      const cal = document.querySelector('.cal'), z0 = r.view.boardZoom ?? 1;
      const zoomTo = async (z) => { r.view.boardZoom = z; cal.style.zoom = z === 1 ? '' : String(z); r.board.rebuild(); await sleep(120); };
      const s0 = sig(), moved = [];
      for (const z of [0.8, 1.25]) { await zoomTo(z); const s = sig(); for (const k of Object.keys(s0)) if (s[k] !== s0[k]) moved.push(z + ':' + k); }
      await zoomTo(z0);
      const zoomStable = Object.keys(s0).length > 0 && moved.length === 0 && sig()[id] === s0[id];
      // 우클릭 '자동 경로로 되돌리기'
      r.board.resetArrow(id); await sleep(80);
      const reset = !r.store.meta.arrows?.[id] && !document.querySelector('.arrows .arrow.custom[data-rel="' + id + '"]');
      return { handles, noChangeYet, endOk, redrawn, stillEditing, undone, midOk, ended, persisted, zoomStable, moved, reset };
    })();
    const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
    return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
  })()`);
  console.log('[smoke] arrow-edit ' + JSON.stringify(arrowEdit));
    return arrowEdit;
  },
  check: (arrowEdit) => arrowEdit?.handles === 2
    && arrowEdit?.noChangeYet === true
    && arrowEdit?.endOk === true
    && arrowEdit?.redrawn === true
    && arrowEdit?.stillEditing === true
    && arrowEdit?.undone === true
    && arrowEdit?.midOk === true
    && arrowEdit?.ended === true
    && arrowEdit?.persisted === true
    && arrowEdit?.zoomStable === true
    && arrowEdit?.reset === true,
};
