// 스모크 단계 'track-resize' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'track-resize',
  areas: ["board","drag"],
  async run({ target, withTimeout }) {
    let trackResize = null;
    // 트랙 열 너비 드래그 — 재렌더로 손잡이가 사라져도 이어져야 한다
    trackResize = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const handle = document.querySelector('.th .th-resize');
      if (!handle) return { error: '손잡이 없음' };
      const id = handle.closest('.th').dataset.t;
      const col = () => document.querySelector('.col[data-t="' + id + '"]').getBoundingClientRect().width;
      const before = Math.round(col());
      const box = handle.getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height / 2, button: 0 });

      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.left)));
      // 여러 번 나눠 움직인다 — 중간 재렌더를 견디는지 보는 것이 핵심
      for (const dx of [20, 60, 120]) {
        window.dispatchEvent(new PointerEvent('pointermove', at(box.left + dx)));
        await new Promise((res) => setTimeout(res, 30));
      }
      window.dispatchEvent(new PointerEvent('pointerup', at(box.left + 120)));
      await new Promise((res) => setTimeout(res, 120));

      const after = Math.round(col());
      const stored = r.store.track(id).w;

      // 더블클릭하면 자동으로 되돌아가는가
      document.querySelector('.th[data-t="' + id + '"] .th-resize')
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      const reset = r.store.track(id).w;

      return { before, after, stored, grew: after > before + 80, reset };
    })()`), 20000, 'track-resize');
    console.log('[smoke] track-resize ' + JSON.stringify(trackResize));
    return trackResize;
  },
  check: (trackResize) => trackResize?.grew === true
    && trackResize?.reset === null,
};
