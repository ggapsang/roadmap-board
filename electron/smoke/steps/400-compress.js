// 스모크 단계 'compress' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'compress',
  areas: ["axis"],
  requires: ['bands'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, capture }) {
    let compressed = null;
    // 묶은 구간 세로 압축 — "접어서 보여 주는 게 목적"
    compressed = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const gridH = () => parseFloat(document.getElementById('grid').style.height);
      const before = gridH();
      const beforeCard = document.querySelector('[data-id="e6"]')?.getBoundingClientRect().height;
      r.store.commit('압축', (doc) => { doc.bands.find((b) => b.id === 'q1').scale = 0.4; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const after = gridH();
      const afterCard = document.querySelector('[data-id="e6"]')?.getBoundingClientRect().height;
      return { before, after, shrank: before > after,
               cardBefore: Math.round(beforeCard ?? 0), cardAfter: Math.round(afterCard ?? 0) };
    })()`);
    console.log('[smoke] compress ' + JSON.stringify(compressed));
    await capture(target, 'board-compressed');
    await capture(target, 'board-bands');
    return compressed;
  },
  check: (compressed) => compressed?.shrank === true
    && compressed?.cardAfter < compressed?.cardBefore,
};
