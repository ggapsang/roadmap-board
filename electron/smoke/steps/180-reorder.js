// 스모크 단계 'reorder' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'reorder',
  areas: ["board","drag"],
  async run({ target, withTimeout }) {
    let reorder = null;
    // 트랙 열 순서 드래그 (엑셀식) — 첫 헤더를 오른쪽으로 끌면 순서가 바뀐다
    reorder = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.tracks.map((t) => t.id);
      const heads = [...document.querySelectorAll('.th')];
      const cell = heads[0];
      const movingId = cell.dataset.t;
      const r0 = cell.getBoundingClientRect();
      const target = heads[2].getBoundingClientRect();
      const at = (x) => ({ bubbles: true, clientX: x, clientY: r0.top + r0.height / 2, button: 0, pointerId: 1 });
      cell.dispatchEvent(new PointerEvent('pointerdown', at(r0.left + 20)));
      window.dispatchEvent(new PointerEvent('pointermove', at(target.left + target.width * 0.6)));
      await new Promise((res) => setTimeout(res, 100));
      window.dispatchEvent(new PointerEvent('pointerup', at(target.left + target.width * 0.6)));
      await new Promise((res) => setTimeout(res, 150));
      const after = r.store.tracks.map((t) => t.id);
      const newIndex = after.indexOf(movingId);
      r.store.commit('원복', (doc) => {
        doc.tracks.sort((a, b) => before.indexOf(a.id) - before.indexOf(b.id));
      });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const restored = r.store.tracks.map((t) => t.id).join(',') === before.join(',');
      return { count: before.length, movingId, newIndex, moved: newIndex > 0, restored };
    })()`), 20000, 'reorder');
    console.log('[smoke] reorder ' + JSON.stringify(reorder));
    return reorder;
  },
  check: (reorder) => reorder?.moved === true
    && reorder?.restored === true,
};
