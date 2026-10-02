// 스모크 단계 'child-width' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'child-width',
  areas: ["drag"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, capture, shotDir, withTimeout }) {
    let childWidth = null;
    // 상위 카드 안에 든 자식의 가로 폭 조절
    childWidth = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      // 상위 카드가 놓인 트랙을 넓혀 자식을 늘릴 자리를 만든다(앞 단계가 트랙을 넓혀 두었는지에 기대지 않게) — 끝에 원복
      const tid = r.store.item('e10')?.place.t;
      const tw0 = tid ? r.store.track(tid).w ?? null : null;
      if (tid) { r.store.commit('스모크 트랙 폭', () => { r.store.track(tid).w = 520; }); r.board.rebuild(); await new Promise((res) => setTimeout(res, 150)); }
      const host = document.querySelector('[data-id="e10"]');
      if (!host) return { error: '상위 카드 없음' };
      const child = host.querySelector(':scope > .ev:not(.ms)');
      if (!child) return { error: '자식 카드 없음' };
      const id = child.dataset.id;
      const el = () => document.querySelector('[data-id="' + id + '"]');
      const before = Math.round(el().getBoundingClientRect().width);

      const grip = el().querySelector('.grip-he');
      if (!grip) return { error: 'grip-he 없음' };
      const b = grip.getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: b.top + 20, button: 0 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(b.left + 2)));
      // 세 번에 나눠 움직여 중간 재렌더를 견디는지 본다
      for (const dx of [10, 30, 60]) {
        grid.dispatchEvent(new PointerEvent('pointermove', at(b.left + 2 + dx)));
        await new Promise((res) => setTimeout(res, 40));
      }
      grid.dispatchEvent(new PointerEvent('pointerup', at(b.left + 62)));
      await new Promise((res) => setTimeout(res, 150));
      const after = Math.round(el().getBoundingClientRect().width);
      const stored = { x: r.store.item(id).place.x, w: r.store.item(id).place.w };

      window.__childWidthShot = true;
      await new Promise((res) => setTimeout(res, 50));
      // 더블클릭하면 자동 배치로 복귀
      el().querySelector('.grip-he').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 150));
      const reset = r.store.item(id).place.w;
      if (tid) { r.store.commit('스모크 트랙 폭 원복', () => { r.store.track(tid).w = tw0; }); r.board.rebuild(); }

      return { id, before, after, stored, grew: after > before + 40, reset };
    })()`), 20000, 'child-width');
    console.log('[smoke] child-width ' + JSON.stringify(childWidth));
    // 넓힌 상태를 한 번 더 만들어 캡처한다
    if (shotDir()) {
      await target.webContents.executeJavaScript(`(() => {
        const r = window.__roadmap;
        r.store.commit('폭 예시', () => { const it = r.store.item('e11'); it.place.x = 0.02; it.place.w = 0.62; });
      })()`);
      await capture(target, 'child-width');
    }
    return childWidth;
  },
  check: (childWidth) => childWidth?.grew === true
    && childWidth?.reset === null,
};
