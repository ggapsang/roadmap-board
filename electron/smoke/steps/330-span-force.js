// 스모크 단계 'span-force' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'span-force',
  areas: ["board","drag"],
  async run({ target }) {
    let spanForce = null;
    // 걸침 카드에 크기 강제해도 트랙을 넘나든다 — 강제 상태에서 sp=2가 sp=1보다 넓어야.
    spanForce = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const sp0 = it().place.sp, hd0 = it().place.hd;
      const w = () => document.querySelector('[data-id="' + id + '"]').getBoundingClientRect().width;
      const home = r.store.tracks.findIndex((t) => t.id === it().place.t);
      const w0 = r.store.tracks.map((t) => t.w);
      // 걸칠 두 트랙을 고정폭 200으로 (결정적). sp=1 강제 → 한 칸.
      r.store.commit('세팅', () => {
        it().place.hd = 20; it().place.x = null; it().place.w = null; it().place.sp = 1;
        if (r.store.tracks[home]) r.store.tracks[home].w = 200;
        if (r.store.tracks[home + 1]) r.store.tracks[home + 1].w = 200;
      });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 200));
      const w1 = w();
      // 강제 유지 + sp=2 → 두 칸으로 넓어져야 한다(강제가 걸침을 막지 않음)
      r.store.commit('걸침', () => { it().place.sp = 2; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 200));
      const w2 = w();
      // 강제 카드는 좌우 폭 손잡이로 트랙을 넘나든다(걸침 손잡이 아님).
      const hasWidthGrip = !!document.querySelector('[data-id="' + id + '"] .grip-he');
      r.store.commit('원복', () => {
        it().place.sp = sp0; it().place.hd = hd0;
        r.store.tracks.forEach((t, i) => { t.w = w0[i]; });
      });
      r.board.rebuild();
      return { w1: Math.round(w1), w2: Math.round(w2), spanUnderForce: w2 > w1 + 120, hasWidthGrip };
    })()`);
    console.log('[smoke] span-force ' + JSON.stringify(spanForce));
    return spanForce;
  },
  check: (spanForce) => spanForce?.spanUnderForce === true
    && spanForce?.hasWidthGrip === true,
};
