// 스모크 단계 'resize4' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'resize4',
  areas: ["drag","board"],
  async run({ target, withTimeout }) {
    let cornerCheck = null;
    // 크기 강제 — 가장자리 손잡이로 네 방향. 오른쪽=가로(w), 아래=세로(hd),
    // 위=위로 늘림(바닥 고정). 모서리 박스 없이 가장자리만으로 조절한다.
    cornerCheck = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      r.store.commit('강제', () => { it().place.sp = 1; it().place.hd = 20; it().place.x = null; it().place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      const drag = (grip, tx, ty) => {
        const box = grip.getBoundingClientRect();
        const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
        grip.dispatchEvent(new PointerEvent('pointerdown', at(cx, cy)));
        grid.dispatchEvent(new PointerEvent('pointermove', at(cx + tx, cy + ty)));
        grid.dispatchEvent(new PointerEvent('pointerup', at(cx + tx, cy + ty)));
      };
      // 오른쪽 가장자리 → 가로(w)
      const w0 = it().place.w;
      drag(el().querySelector('.grip-he'), -80, 0);
      await new Promise((res) => setTimeout(res, 120));
      const widthChanged = it().place.w != null && it().place.w !== w0;
      // 아래 가장자리 → 세로(hd)
      const hdMid = it().place.hd;
      drag(el().querySelector('.grip'), 0, ppd * 6);
      await new Promise((res) => setTimeout(res, 120));
      const heightChanged = it().place.hd !== hdMid;
      // 위 가장자리 → 위로 늘림(시작일 당겨지고 hd 커짐, 바닥 고정)
      const s0 = it().s, hd0 = it().place.hd;
      drag(el().querySelector('.grip-top'), 0, -ppd * 5);
      await new Promise((res) => setTimeout(res, 120));
      const topGrew = it().place.hd > hd0 && it().s < s0;
      r.store.commit('원복', () => { it().place.hd = null; it().place.x = null; it().place.w = null; it().place.sp = 2; });
      r.board.render();
      return { widthChanged, heightChanged, topGrew };
    })()`), 20000, 'corner');
    console.log('[smoke] resize4 ' + JSON.stringify(cornerCheck));
    return cornerCheck;
  },
  check: (cornerCheck) => cornerCheck?.widthChanged === true
    && cornerCheck?.heightChanged === true
    && cornerCheck?.topGrew === true,
};
