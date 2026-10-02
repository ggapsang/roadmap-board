// 스모크 단계 'ms-range' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'ms-range',
  areas: ["board"],
  async run({ target, capture, shotDir }) {
    let msRange = null;
    // 기간 마일스톤 — 점 마일스톤(e12)에 종료일을 주면 막대(레인 참여)로 바뀐다
    msRange = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const it = () => r.store.item('e12');
      const beforeE = it().e;
      const wasPoint = !!document.querySelector('[data-id="e12"].ms.point');
      const pointH = Math.round(document.querySelector('[data-id="e12"]').getBoundingClientRect().height);
      r.store.commit('기간 마일스톤', () => { it().e = '2026-10-30'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const node = document.querySelector('[data-id="e12"]');
      const nowRanged = node.classList.contains('ranged') && !node.classList.contains('point');
      const rangeH = Math.round(node.getBoundingClientRect().height);
      return { wasPoint, nowRanged, pointH, rangeH, grew: rangeH > pointH, beforeE };
    })()`);
    console.log('[smoke] ms-range ' + JSON.stringify(msRange));
    if (shotDir()) await capture(target, 'board-msrange');
    msRange.backPoint = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      r.store.commit('원복', () => { r.store.item('e12').e = ${JSON.stringify(msRange?.beforeE)}; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      return !!document.querySelector('[data-id="e12"].ms.point');
    })()`);
    console.log('[smoke] ms-range restored ' + msRange.backPoint);
    return msRange;
  },
  check: (msRange) => msRange?.wasPoint === true
    && msRange?.nowRanged === true
    && msRange?.grew === true
    && msRange?.backPoint === true,
};
