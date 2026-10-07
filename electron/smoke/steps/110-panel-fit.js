// 스모크 단계 'panel-fit' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'panel-fit',
  areas: ["board","panel"],
  async run({ target, withTimeout }) {
    let panelFit = null;
    // 트랙 칸은 최소 폭 밑으로 줄지 않는다 — 넓은 트랙이 많으면 패널이 열려도 보드가 가로로 스크롤되고, 날짜 축은 제자리(sticky)
    panelFit = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('넓은 트랙', () => { for (const t of r.store.tracks) t.w = 320; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const scroll = document.getElementById('scroll');
      document.querySelector('.col > .ev')?.click();     // 패널 열기
      await new Promise((res) => setTimeout(res, 350));
      const panelOpen = document.body.classList.contains('panel-open');
      const cal = document.querySelector('.cal');
      const calW = Math.round(cal.getBoundingClientRect().width);
      const scrollW = Math.round(scroll.clientWidth);
      const colW = Math.round(document.querySelector('.col').getBoundingClientRect().width);
      const kept = colW >= 318;                          // 정한 폭(320) 그대로
      const scrolls = scroll.scrollWidth > scroll.clientWidth + 10;
      scroll.scrollLeft = 400;
      await new Promise((res) => setTimeout(res, 100));
      const gm = document.getElementById('gutM').getBoundingClientRect(), sc = scroll.getBoundingClientRect();
      const gutterStays = Math.abs(gm.left - sc.left) < 2 && scroll.scrollLeft > 0;
      // 자동 폭 트랙도 최소 폭 밑으로 안 준다
      r.store.commit('자동 폭', () => { for (const t of r.store.tracks) t.w = null; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const minCol = Math.min(...[...document.querySelectorAll('.col')].map((c) => c.getBoundingClientRect().width));
      const autoMin = minCol >= 195;
      scroll.scrollLeft = 0;
      document.querySelector('#pItem [data-close]').click();
      r.store.commit('원복', () => { for (const t of r.store.tracks) t.w = null; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      return { panelOpen, calW, scrollW, colW, kept, scrolls, gutterStays, minCol: Math.round(minCol), autoMin };
    })()`), 20000, 'panel-fit');
    console.log('[smoke] panel-fit ' + JSON.stringify(panelFit));
    return panelFit;
  },
  check: (panelFit) => panelFit?.panelOpen === true
    && panelFit?.kept === true && panelFit?.scrolls === true && panelFit?.gutterStays === true && panelFit?.autoMin === true,
};
