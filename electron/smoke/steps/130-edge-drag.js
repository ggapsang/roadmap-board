// 스모크 단계 'edge-drag' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'edge-drag',
  areas: ["drag"],
  async run({ target, withTimeout }) {
    let edgeDrag = null;
    // 위 가장자리 드래그 = 시작일, 아래 = 종료일
    edgeDrag = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e };
      const ppd = r.view.ppd;

      const pull = async (selector, dyDays) => {
        const el = document.querySelector('[data-id="' + id + '"]');
        const g = el.querySelector(selector);
        if (!g) return '손잡이 없음: ' + selector;
        const b = g.getBoundingClientRect();
        const at = (y) => ({ bubbles: true, clientX: b.left + b.width / 2, clientY: y, button: 0 });
        g.dispatchEvent(new PointerEvent('pointerdown', at(b.top + 2)));
        grid.dispatchEvent(new PointerEvent('pointermove', at(b.top + 2 + dyDays * ppd)));
        await new Promise((res) => setTimeout(res, 100));
        grid.dispatchEvent(new PointerEvent('pointerup', at(b.top + 2 + dyDays * ppd)));
        await new Promise((res) => setTimeout(res, 150));
        return null;
      };

      await pull('.grip-top', 4);        // 시작일을 4일 뒤로
      const afterTop = { s: it().s, e: it().e };
      await pull('.grip', 5);            // 종료일을 5일 뒤로
      const afterBottom = { s: it().s, e: it().e };

      r.store.commit('원복', () => { it().s = before.s; it().e = before.e; });
      return { before, afterTop, afterBottom,
               startMoved: afterTop.s !== before.s && afterTop.e === before.e,
               endMoved: afterBottom.e !== afterTop.e && afterBottom.s === afterTop.s };
    })()`), 20000, 'edge-drag');
    console.log('[smoke] edge-drag ' + JSON.stringify(edgeDrag));
    return edgeDrag;
  },
  check: (edgeDrag) => edgeDrag?.startMoved === true
    && edgeDrag?.endMoved === true,
};
