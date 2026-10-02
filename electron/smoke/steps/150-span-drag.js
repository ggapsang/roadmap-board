// 스모크 단계 'span-drag' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'span-drag',
  areas: ["drag"],
  async run({ target, withTimeout }) {
    let spanDrag = null;
    // 트랙 걸침 드래그 — 여러 칸에 걸친 막대(sp≥2)의 오른쪽 가장자리를 끌면 칸 단위로 붙는가.
    // (sp=1 막대의 오른쪽 가장자리는 폭 조절용이라 걸침 손잡이가 없다 — 아래 top-width 참고)
    spanDrag = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      r.store.commit('초기화', () => { const it = r.store.item(id); it.place.sp = 2; it.place.x = null; it.place.w = null; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const grip = el().querySelector('.grip-span');
      if (!grip) return { error: 'grip-span 없음' };
      const box = grip.getBoundingClientRect();
      const cols = [...document.querySelectorAll('.col')].map((c) => c.getBoundingClientRect());
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + 20, button: 0 });
      const grid = document.getElementById('grid');
      // pointerdown은 손잡이에 쏴야 한다 — 핸들러가 ev.target으로 모드를 가른다
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left + 2)));
      // 세 번째 트랙 한가운데로 끈다
      grid.dispatchEvent(new PointerEvent('pointermove', at(cols[2].left + cols[2].width / 2)));
      await new Promise((res) => setTimeout(res, 120));
      grid.dispatchEvent(new PointerEvent('pointerup', at(cols[2].left + cols[2].width / 2)));
      await new Promise((res) => setTimeout(res, 150));
      const sp = r.store.item(id).place.sp;
      const px = Math.round(el().getBoundingClientRect().width);
      r.store.commit('원복', () => { r.store.item(id).place.sp = 2; });
      return { sp, px, colW: Math.round(cols[0].width) };
    })()`), 20000, 'span-drag');
    console.log('[smoke] span-drag ' + JSON.stringify(spanDrag));
    return spanDrag;
  },
  check: (spanDrag) => spanDrag?.sp === 3,
};
