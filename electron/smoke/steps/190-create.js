// 스모크 단계 'create' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'create',
  areas: ["drag","board"],
  async run({ target, withTimeout }) {
    let madeCards = null;
    // 빈 곳 클릭/드래그로 일정 만들기 (구글 캘린더식). 클릭=1주, 드래그=끈 길이.
    madeCards = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const grid = document.getElementById('grid');
      const S = r.board.scale;
      const lastId = r.store.tracks[r.store.tracks.length - 1].id;
      const col = document.querySelector('.col[data-t="' + lastId + '"]');
      const rect = col.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const yOf = (d) => rect.top + S.y(d);
      const incDays = (it) => Math.round((new Date(it.e) - new Date(it.s)) / 86400000) + 1;
      const ev = (type, y) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      const countBefore = r.store.items.length;

      // 클릭 — 빈 40일 지점(그 트랙엔 10일 카드뿐이라 비어 있다)
      col.dispatchEvent(ev('pointerdown', yOf(40)));
      grid.dispatchEvent(ev('pointerup', yOf(40)));
      await new Promise((res) => setTimeout(res, 150));
      const clicked = r.store.items[r.store.items.length - 1];
      const clickDays = incDays(clicked);

      // 드래그 — 60일에서 80일까지
      col.dispatchEvent(ev('pointerdown', yOf(60)));
      grid.dispatchEvent(ev('pointermove', yOf(80)));
      grid.dispatchEvent(ev('pointerup', yOf(80)));
      await new Promise((res) => setTimeout(res, 150));
      const dragged = r.store.items[r.store.items.length - 1];
      const dragDays = incDays(dragged);

      // 정리 — 만든 두 카드 제거
      const ids = [clicked.id, dragged.id];
      r.store.commit('정리', (doc) => { doc.items = doc.items.filter((i) => !ids.includes(i.id)); });
      await new Promise((res) => setTimeout(res, 120));
      return { countBefore, added: 2, clickDays, dragDays, restored: r.store.items.length === countBefore };
    })()`), 20000, 'create');
    console.log('[smoke] create ' + JSON.stringify(madeCards));
    return madeCards;
  },
  check: (madeCards) => madeCards?.clickDays === 7
    && madeCards?.dragDays > 7
    && madeCards?.restored === true,
};
