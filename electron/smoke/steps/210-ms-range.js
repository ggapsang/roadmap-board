// 스모크 단계 'ms-range' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'ms-range',
  areas: ["board", "drag"],
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
    // 사이즈 수동 설정한 점 마일스톤 — 걸침 손잡이 대신 좌우 폭 손잡이가 나오고, 끌면 폭(x/w)이 바뀐다(2026-10-08 사용자)
    msRange.forced = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const it = () => r.store.item('e12');
      const p0 = { ...it().place };
      r.store.commit('강제', () => { it().place.hd = 1; it().place.x = 0; it().place.w = 1; });
      await sleep(150);
      const el = () => document.querySelector('[data-id="e12"]');
      const hasHe = !!el()?.querySelector('.grip-he'), hasSpan = !!el()?.querySelector('.grip-span');
      const before = Math.round(el().getBoundingClientRect().width);
      const grip = el().querySelector('.grip-he');
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const at = (x) => ({ bubbles: true, clientX: x, clientY: box.top + box.height / 2, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.left + 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.left - 80)));
      await sleep(100);
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.left - 80)));
      await sleep(150);
      const after = Math.round(el().getBoundingClientRect().width);
      const w = it().place.w;
      const point = el().classList.contains('point');
      r.store.commit('원복', () => { Object.assign(it().place, p0); });
      await sleep(100);
      return { hasHe, hasSpan, before, after, w, point, shrank: after < before - 40 && w < 1 };
    })()`);
    console.log('[smoke] ms-range forced ' + JSON.stringify(msRange.forced));
    return msRange;
  },
  check: (msRange) => msRange?.wasPoint === true
    && msRange?.nowRanged === true
    && msRange?.grew === true
    && msRange?.backPoint === true
    && msRange?.forced?.hasHe === true
    && msRange?.forced?.hasSpan === false
    && msRange?.forced?.point === true
    && msRange?.forced?.shrank === true,
};
