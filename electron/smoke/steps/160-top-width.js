// 스모크 단계 'top-width' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'top-width',
  areas: ["drag","board"],
  async run({ target, withTimeout }) {
    let topWidth = null;
    // 가로폭 드래그는 '크기 강제' 모드에서만. 강제 아니면 sp=1 최상위는 걸침 손잡이만.
    topWidth = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      // 강제 아님 → 폭 손잡이 없고 걸침 손잡이만 있어야 한다
      r.store.commit('자동', () => { const it = r.store.item(id); it.place.sp = 1; it.place.hd = null; it.place.x = null; it.place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const autoHasSpan = !!document.querySelector('[data-id="' + id + '"] .grip-span');
      const autoHasHe = !!document.querySelector('[data-id="' + id + '"] .grip-he');
      // 강제 켜기 → 좌우 폭 손잡이 등장
      r.store.commit('강제', () => { r.store.item(id).place.hd = 20; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grip = el().querySelector('.grip-he');
      if (!grip) return { error: 'grip-he 없음(강제 폭 손잡이)', autoHasSpan, autoHasHe };
      const before = Math.round(el().getBoundingClientRect().width);
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + 10, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left + 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.left - 90)));   // 왼쪽으로 90px
      await new Promise((res) => setTimeout(res, 120));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.left - 90)));
      await new Promise((res) => setTimeout(res, 150));
      const w = r.store.item(id).place.w;
      const after = Math.round(el().getBoundingClientRect().width);
      r.store.commit('원복', () => { const it = r.store.item(id); it.place.hd = null; it.place.x = null; it.place.w = null; it.place.sp = 2; });
      r.board.render();
      return { autoHasSpan, autoHasHe, before, after, w, shrank: after < before, hasW: w != null && w < 1 };
    })()`), 20000, 'top-width');
    console.log('[smoke] top-width ' + JSON.stringify(topWidth));
    return topWidth;
  },
  check: (topWidth) => topWidth?.shrank === true
    && topWidth?.hasW === true
    && topWidth?.autoHasSpan === true
    && topWidth?.autoHasHe === false,
};
