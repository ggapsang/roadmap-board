// 스모크 단계 'fixed-height' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'fixed-height',
  areas: ["board","drag","axis"],
  async run({ target, withTimeout }) {
    let fixedH = null;
    // 세로 크기 강제 — hd(일)가 클수록 카드가 높고(결정적), 아래 가장자리를 끌면
    // 날짜는 그대로 hd만 바뀐다. 위 손잡이(시작일)는 감춘다.
    fixedH = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const id = 'e33';
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e, hd: it().place.hd ?? null };
      const node = () => document.querySelector('[data-id="' + id + '"]');
      r.store.commit('h15', () => { it().place.hd = 15; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const h15 = Math.round(node().getBoundingClientRect().height);
      const hasTopGrip = !!node().querySelector('.grip-top');   // 강제 모드도 위 손잡이(위로 리사이즈)를 가진다
      r.store.commit('h25', () => { it().place.hd = 25; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));
      const h25 = Math.round(node().getBoundingClientRect().height);
      // 드래그로 hd가 바뀌고 날짜는 그대로인지 (방향·정확한 양은 합성 이벤트라 관대하게)
      const grip = node().querySelector('.grip');
      const box = grip.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const ppd = r.view.ppd;
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(box.top + box.height / 2)));
      grid.dispatchEvent(new PointerEvent('pointermove', at(box.top + box.height / 2 + ppd * 8)));
      await new Promise((res) => setTimeout(res, 150));
      grid.dispatchEvent(new PointerEvent('pointerup', at(box.top + box.height / 2 + ppd * 8)));
      await new Promise((res) => setTimeout(res, 150));
      const hdAfter = it().place.hd;
      const datesUnchanged = it().s === before.s && it().e === before.e;
      // 강제 높이도 축 배율을 탄다 — 카드가 든 구간을 절반으로 접으면 강제 카드도 그만큼 준다
      r.store.commit('h25', () => { it().place.hd = 25; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      const hFull = node().getBoundingClientRect().height;
      const s0 = it().s, eFold = r.board.timeline.pos(it()).s + 40;
      const { dateAt } = await import('./src/core/dates.js');
      r.store.commit('접기', (doc) => { doc.bands.push({ id: 'bfold', mode: 'month-week', from: s0, to: dateAt(r.board.origin, eFold), label: 'F', scale: 0.5 }); });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const hFold = node().getBoundingClientRect().height;
      const gap = hFull - 25 * r.board.scale.ppd;           // 카드 사이 간격(펼친 상태의 차이)
      const folded = Math.abs(hFold - (25 * r.board.scale.ppd * 0.5 + gap)) < 1.5;
      r.store.commit('접기 원복', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== 'bfold'); });
      r.board.rebuild();
      r.store.commit('원복', () => { it().place.hd = before.hd; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 100));
      return { h15, h25, hdAfter, hasTopGrip, datesUnchanged, mapGrew: h25 > h15, dragChanged: hdAfter !== 25, folded, hFull: Math.round(hFull), hFold: Math.round(hFold) };
    })()`), 20000, 'fixed-height');
    console.log('[smoke] fixed-height ' + JSON.stringify(fixedH));
    return fixedH;
  },
  check: (fixedH) => fixedH?.mapGrew === true
    && fixedH?.hasTopGrip === true
    && fixedH?.datesUnchanged === true
    && fixedH?.dragChanged === true
    && fixedH?.folded === true,
};
