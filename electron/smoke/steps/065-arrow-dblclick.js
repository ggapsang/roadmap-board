// 스모크 단계 'arrow-dblclick' — 실제 마우스 입력(sendInputEvent)으로 화살표를 더블클릭하면 편집(손잡이)이 열린다.
// 합성 dblclick 이벤트로는 안 잡히는 회귀: 첫 클릭(고르기)이 보드를 다시 그려 화살표 요소가 바뀌면 브라우저가 더블클릭으로 안 센다.
export default {
  name: 'arrow-dblclick',
  areas: ['arrows', 'board'],
  async run({ target }) {
    const wc = target.webContents;
    const pt = await wc.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      document.querySelector('#pItem [data-close]')?.click();
      r.board.endArrowEdit?.();
      await new Promise((s) => setTimeout(s, 150));
      // 화살표 몸통의 한 점 — 화면에서 그 점의 맨 위 요소가 그 화살표인 곳
      for (const p of document.querySelectorAll('.arrows .arrow')) {
        const len = p.getTotalLength?.() ?? 0;
        for (let k = 0.3; k <= 0.7; k += 0.1) {
          const q = p.getPointAtLength(len * k);
          const m = p.getScreenCTM();
          const x = q.x * m.a + m.e, y = q.y * m.d + m.f;
          if (document.elementFromPoint(x, y) === p) return { x: Math.round(x), y: Math.round(y), rel: p.dataset.rel };
        }
      }
      return null;
    })()`);
    if (!pt) return { error: '누를 화살표 없음' };
    const click = async (n) => {
      wc.sendInputEvent({ type: 'mouseDown', x: pt.x, y: pt.y, button: 'left', clickCount: n });
      wc.sendInputEvent({ type: 'mouseUp', x: pt.x, y: pt.y, button: 'left', clickCount: n });
      await new Promise((s) => setTimeout(s, 60));
    };
    await click(1);
    await click(2);
    await new Promise((s) => setTimeout(s, 250));
    const state = () => wc.executeJavaScript(`(() => ({
      handles: document.querySelectorAll('#grid .arrow-handles .ah-end').length,
      editing: !!document.querySelector('.arrows .arrow.editing[data-rel="${pt.rel}"]'),
    }))()`);
    const plain = await state();
    // 카드 편집 창이 열려 있을 때 — 첫 클릭이 창을 닫으며 보드를 다시 그려도 더블클릭으로 편집이 열린다
    await wc.executeJavaScript(`(async () => { const r = window.__roadmap; r.board.endArrowEdit?.(); r.board.selectRel?.(null);
      r.itemPanel.open(r.store.items[0].id); await new Promise((s) => setTimeout(s, 300)); return true; })()`);
    // 패널이 열리면 보드 폭이 바뀐다 — 화살표 위치를 다시 잰다
    const pt2 = await wc.executeJavaScript(`(() => {
      const p = document.querySelector('.arrows .arrow[data-rel="${pt.rel}"]'); if (!p) return null;
      const len = p.getTotalLength();
      for (let k = 0.3; k <= 0.7; k += 0.1) { const q = p.getPointAtLength(len * k); const m = p.getScreenCTM();
        const x = q.x * m.a + m.e, y = q.y * m.d + m.f; if (document.elementFromPoint(x, y) === p) return { x: Math.round(x), y: Math.round(y) }; }
      return null; })()`);
    let withPanel = null;
    if (pt2) {
      Object.assign(pt, pt2);
      await click(1); await click(2);
      await new Promise((s) => setTimeout(s, 300));
      withPanel = await state();
    }
    await wc.executeJavaScript(`(() => { window.__roadmap.board.endArrowEdit?.(); window.__roadmap.board.selectRel?.(null); return true; })()`);
    console.log('[smoke] arrow-dblclick ' + JSON.stringify({ pt, plain, withPanel }));
    return { pt, plain, withPanel };
  },
  check: (x) => x?.plain?.handles === 2 && x?.plain?.editing === true && x?.withPanel?.handles === 2 && x?.withPanel?.editing === true,
};
