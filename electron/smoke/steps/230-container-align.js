// 스모크 단계 'container-align' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'container-align',
  areas: ["board"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target }) {
    let containerAlign = null;
    // 컨테이너 카드도 글자 세로 정렬(align)을 따르는가 — e10은 nesting 단계부터 컨테이너
    containerAlign = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.item('e10').place.align;
      r.store.commit('정렬', () => { r.store.item('e10').place.align = 'bottom'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e10"]');
      const jc = getComputedStyle(node).justifyContent;
      const cBottom = node.classList.contains('c-bottom');
      const isContainer = node.classList.contains('container');
      r.store.commit('원복', () => { r.store.item('e10').place.align = before; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { jc, cBottom, isContainer };
    })()`);
    console.log('[smoke] container-align ' + JSON.stringify(containerAlign));
    return containerAlign;
  },
  check: (containerAlign) => containerAlign?.jc === 'flex-end'
    && containerAlign?.cBottom === true
    && containerAlign?.isContainer === true,
};
