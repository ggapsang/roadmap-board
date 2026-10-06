// 스모크 단계 'title-wrap' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'title-wrap',
  areas: ["board","panel"],
  async run({ target }) {
    let titleWrap = null;
    // 제목 줄바꿈 — 여러 줄 제목이 카드에서 실제로 두 줄로 그려지는가
    titleWrap = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = () => r.store.item('e1');
      const before = it().ti;
      // 한 줄 기준도 짧은 제목으로 잰다 — 지금 제목(기본 점검이 붙인 긴 표식)은 카드 폭에 따라 이미 두 줄일 수 있다
      r.store.commit('제목 한 줄', () => { it().ti = '라인1'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const oneH = Math.round(document.querySelector('[data-id="e1"] .t').getBoundingClientRect().height);
      r.store.commit('제목 줄바꿈', () => { it().ti = '라인1\\n라인2'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const t = document.querySelector('[data-id="e1"] .t');
      const ws = getComputedStyle(t).whiteSpace;
      const twoH = Math.round(t.getBoundingClientRect().height);
      const hasNL = t.textContent.includes('\\n');
      r.store.commit('원복', () => { it().ti = before; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { ws, oneH, twoH, hasNL, grew: twoH > oneH };
    })()`);
    console.log('[smoke] title-wrap ' + JSON.stringify(titleWrap));
    return titleWrap;
  },
  check: (titleWrap) => titleWrap?.ws === 'pre-line'
    && titleWrap?.hasNL === true
    && titleWrap?.grew === true,
};
