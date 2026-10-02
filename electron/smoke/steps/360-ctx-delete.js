// 스모크 단계 'ctx-delete' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'ctx-delete',
  areas: ["axis","ctxmenu"],
  async run({ target, withTimeout }) {
    let ctxDelete = null;
    // 빈 세로축 날짜 칸 우클릭 → '이 아래 빈 구간 삭제'로 뒤쪽 빈 행을 지운다
    ctxDelete = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      r.store.commit('확장', (doc) => { doc.meta.end = '2027-12-31'; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const cells = [...document.getElementById('gutM').querySelectorAll('b')];
      const cell = cells[cells.length - 1];
      const box = cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: box.left + 5, clientY: box.top + 5 }));
      await new Promise((res) => setTimeout(res, 80));
      const menu = document.querySelector('.ctx-menu');
      const hadMenu = !!menu;
      const btn = menu && [...menu.querySelectorAll('button')].find((b) => b.textContent.includes('빈 구간 삭제'));
      const maxE = r.store.items.reduce((m, i) => ((i.e || i.s) > m ? (i.e || i.s) : m), '0000-00-00');
      if (btn) btn.click();
      await new Promise((res) => setTimeout(res, 150));
      const afterEnd = r.store.meta.end;
      const menuClosed = !document.querySelector('.ctx-menu');
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { hadMenu, hadBtn: !!btn, afterEnd, maxE, trimmed: afterEnd === maxE, menuClosed };
    })()`), 20000, 'ctx-delete');
    console.log('[smoke] ctx-delete ' + JSON.stringify(ctxDelete));
    return ctxDelete;
  },
  check: (ctxDelete) => ctxDelete?.hadMenu === true
    && ctxDelete?.hadBtn === true
    && ctxDelete?.trimmed === true
    && ctxDelete?.menuClosed === true,
};
