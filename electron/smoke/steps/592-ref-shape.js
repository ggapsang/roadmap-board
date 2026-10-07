// 스모크 단계 'ref-shape' — 참조 선도 선행 화살표처럼 모양을 고친다: 실제 마우스로 더블클릭하면 손잡이, 끝 손잡이를 끌면 그 카드
// 테두리를 따라, 저장 왕복, 자동 경로로 되돌리기. 머리는 여전히 없다.
export default {
  name: 'ref-shape',
  areas: ['arrows', 'board'],
  async run({ target }) {
    const wc = target.webContents;
    const pre = await wc.executeJavaScript(`(async () => {
      const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
      document.querySelector('#pItem [data-close]')?.click();
      const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
      // 다른 트랙의 두 카드 — 옆으로 잇는 선
      const a = cards[0], b = cards.find((x) => x.place.t !== a.place.t);
      r.store.commit('참조', (doc) => { doc.relations.push({ id: 'rshape', type: 'ref', from: a.id, to: b.id }); });
      await sleep(400);
      const p = document.querySelector('.ref-line[data-rel="rshape"]');
      if (!p) return null;
      p.scrollIntoView?.({ block: 'center', inline: 'center' }); await sleep(200);
      const len = p.getTotalLength();
      // 몸통 다각형의 둘레 위 한 점 — 화면 맨 위 요소가 이 선인 곳
      for (let k = 0.05; k < 1; k += 0.05) {
        const q = p.getPointAtLength(len * k); const m = p.getScreenCTM();
        const x = q.x * m.a + m.e, y = q.y * m.d + m.f;
        for (const [dx, dy] of [[0, 0], [0, 2], [0, -2], [2, 0], [-2, 0]]) {
          if (document.elementFromPoint(x + dx, y + dy) === p) return { x: Math.round(x + dx), y: Math.round(y + dy), a: a.id, b: b.id };
        }
      }
      return { miss: true, a: a.id, b: b.id };
    })()`);
    if (!pre || pre.miss) return { error: '참조 선을 누를 자리 없음', pre };
    const click = async (n) => {
      wc.sendInputEvent({ type: 'mouseDown', x: pre.x, y: pre.y, button: 'left', clickCount: n });
      wc.sendInputEvent({ type: 'mouseUp', x: pre.x, y: pre.y, button: 'left', clickCount: n });
      await new Promise((s) => setTimeout(s, 60));
    };
    await click(1); await click(2);
    await new Promise((s) => setTimeout(s, 250));
    const res = await wc.executeJavaScript(`(async () => {
      const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
      const handles = document.querySelectorAll('#grid .arrow-handles .ah-end').length;
      const editing = !!document.querySelector('.ref-line.editing[data-rel="rshape"]');
      // 끝 손잡이를 받는 카드 아래 변 가운데로
      const toCard = document.querySelector('#grid .ev[data-id="${pre.b}"]').getBoundingClientRect();
      const hb = document.querySelector('#grid .arrow-handles .ah-end[data-part="b"]');
      let moved = false;
      if (hb) {
        const hr = hb.getBoundingClientRect();
        const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 33 });
        hb.dispatchEvent(new PointerEvent('pointerdown', at(hr.left + 5, hr.top + 5)));
        window.dispatchEvent(new PointerEvent('pointermove', at(toCard.left + toCard.width / 2, toCard.bottom + 3)));
        window.dispatchEvent(new PointerEvent('pointerup', at(toCard.left + toCard.width / 2, toCard.bottom + 3)));
        await sleep(150);
        const o = r.store.meta.arrows?.rshape;
        moved = o?.b?.side === 'bottom' && Math.abs(o.b.t - 0.5) < 0.05;
      }
      const custom = !!document.querySelector('.ref-line.custom[data-rel="rshape"]') && !document.querySelector('.arrow[data-rel="rshape"]');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(60);
      await sleep(300);
      r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
      const persisted = r.store.meta.arrows?.rshape?.b?.side === 'bottom';
      r.board.resetArrow('rshape'); await sleep(120);
      const reset = !r.store.meta.arrows?.rshape && !document.querySelector('.ref-line.custom[data-rel="rshape"]');
      r.store.commit('정리', (doc) => { doc.relations = doc.relations.filter((x) => x.id !== 'rshape'); });
      await sleep(300);
      return { handles, editing, moved, custom, persisted, reset };
    })()`);
    console.log('[smoke] ref-shape ' + JSON.stringify(res));
    return res;
  },
  check: (x) => x?.handles === 2 && x?.editing === true && x?.moved === true && x?.custom === true && x?.persisted === true && x?.reset === true,
};
