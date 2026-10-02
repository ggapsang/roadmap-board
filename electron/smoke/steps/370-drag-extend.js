// 스모크 단계 'drag-extend' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'drag-extend',
  areas: ["drag","axis"],
  async run({ target, capture, shotDir, withTimeout }) {
    let dragExtend = null;
    // 잘라낸 뒤에도 마지막 카드를 아래로 끌면 축이 다시 늘어난다 (빈 구간 복구)
    dragExtend = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const s0 = r.store.meta.start, e0 = r.store.meta.end;
      let maxEnd = null;
      for (const it of r.store.items) { const e = it.e || it.s; if (e && (maxEnd === null || e > maxEnd)) maxEnd = e; }
      r.store.commit('맞춤', (doc) => { doc.meta.end = maxEnd; });   // 일정에 딱 맞춰 자른 상태
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const lastId = r.store.items.reduce((a, b) => ((b.e || b.s) > (a.e || a.s) ? b : a)).id;
      const el = () => document.querySelector('[data-id="' + lastId + '"]');
      const beforeE = r.store.item(lastId).e;
      const beforeH = parseFloat(document.getElementById('grid').style.height);
      const grip = el().querySelector('.grip');
      if (!grip) return { error: 'grip 없음' };
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.top + 2 + ppd * 30)));   // 30일 아래로
      await new Promise((res) => setTimeout(res, 150));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.top + 2 + ppd * 30)));
      await new Promise((res) => setTimeout(res, 150));
      const afterE = r.store.item(lastId).e;
      const afterH = parseFloat(document.getElementById('grid').style.height);
      r.store.commit('원복', (doc) => { doc.meta.start = s0; doc.meta.end = e0; const it = doc.items.find((i) => i.id === lastId); if (it) it.e = beforeE; });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { beforeE, afterE, extended: afterE > beforeE, grewAxis: afterH > beforeH };
    })()`), 20000, 'drag-extend');
    console.log('[smoke] drag-extend ' + JSON.stringify(dragExtend));

    // 다크 테마도 찍는다 — 가이드 적용 결과를 눈으로 봐야 한다
    if (shotDir()) {
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','dark')`,
      );
      await capture(target, 'board-dark');
      await target.webContents.executeJavaScript(
        `document.documentElement.setAttribute('data-theme','light')`,
      );
    }
    return dragExtend;
  },
  check: (dragExtend) => dragExtend?.extended === true
    && dragExtend?.grewAxis === true,
};
