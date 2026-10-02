// 스모크 단계 'panel-fit' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'panel-fit',
  areas: ["board","panel"],
  async run({ target, withTimeout }) {
    let panelFit = null;
    // 지정 너비 트랙이 있어도 오른쪽 패널이 열리면 본문이 함께 좁아진다(가로 스크롤 없음)
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
      const fits = calW <= scrollW + 2;                  // 본문이 좁아진 영역에 들어간다
      document.querySelector('#pItem [data-close]').click();
      r.store.commit('원복', () => { for (const t of r.store.tracks) t.w = null; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      return { panelOpen, calW, scrollW, fits };
    })()`), 20000, 'panel-fit');
    console.log('[smoke] panel-fit ' + JSON.stringify(panelFit));
    return panelFit;
  },
  check: (panelFit) => panelFit?.panelOpen === true
    && panelFit?.fits === true,
};
