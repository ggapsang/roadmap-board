// 스모크 단계 'title-fit' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'title-fit',
  areas: ["board"],
  async run({ target }) {
    let titleFit = null;
    // 제목이 카드를 넘치면 폰트가 줄어 잘리지 않는가 — 짧은 카드 e33에 긴 제목
    titleFit = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = r.store.item('e33').ti;
      r.store.commit('긴 제목', () => { r.store.item('e33').ti = '진행 계획 공유 및 세부 조율 회의 자료 준비'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e33"]');
      const t = node.querySelector(':scope > .t');
      const font1 = parseFloat(getComputedStyle(t).fontSize);
      const fits = node.scrollHeight <= node.clientHeight + 1
        && t.scrollHeight <= t.clientHeight + 1 && t.scrollWidth <= t.clientWidth + 1;
      r.store.commit('원복', () => { r.store.item('e33').ti = before; });
      r.board.render();
      return { font1, shrank: font1 < 11, fits };
    })()`);
    console.log('[smoke] title-fit ' + JSON.stringify(titleFit));
    return titleFit;
  },
  check: (titleFit) => titleFit?.shrank === true
    && titleFit?.fits === true,
};
