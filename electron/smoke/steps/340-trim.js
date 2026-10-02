// 스모크 단계 'trim' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'trim',
  areas: ["axis","ctxmenu"],
  async run({ target }) {
    let trim = null;
    // 여백 자르기 — 표시 기간을 일정 범위에 맞춰 맨 뒤 빈 구간을 없앤다
    trim = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      r.store.commit('범위 확장', (doc) => { doc.meta.end = '2027-12-31'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const maxE = r.store.items.reduce((m, i) => ((i.e || i.s) > m ? (i.e || i.s) : m), '0000-00-00');
      const beforeEnd = r.store.meta.end;
      document.getElementById('d-trim').click();
      await new Promise((res) => setTimeout(res, 150));
      const afterEnd = r.store.meta.end;
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { beforeEnd, afterEnd, maxE, trimmed: afterEnd === maxE, shrank: afterEnd < beforeEnd };
    })()`);
    console.log('[smoke] trim ' + JSON.stringify(trim));
    return trim;
  },
  check: (trim) => trim?.trimmed === true
    && trim?.shrank === true,
};
