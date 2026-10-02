// 스모크 단계 'span' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'span',
  areas: ["panel","board"],
  async run({ target, withTimeout }) {
    let spanEdit = null;
    // 트랙 걸침 — 숫자 대신 트랙 칩을 눌러 조절. 세 번째 칩 → sp=3.
    spanEdit = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      card.click();
      await sleep(200);
      document.querySelector('#pItem .ptab[data-tab="attr"]').click();
      await sleep(60);
      const chips = () => document.querySelectorAll('#i-span .seg-btn');
      const nodes = () => document.querySelectorAll('.cal .ev[data-id="' + id + '"]').length;
      const boxW = () => { const e = document.querySelector('.cal .ev[data-id="' + id + '"]'); return e ? Math.round(e.getBoundingClientRect().width) : 0; };
      const home = r.store.trackIndex(r.store.item(id).place.t);
      const before = { sp: r.store.item(id).place.sp, px: boxW(), nodes: nodes() };
      // 인접 트랙 추가 → 붙어 있으니 걸침(한 장이 더 넓어짐)
      chips()[home + 1].click(); await sleep(180);
      const adj = { sp: r.store.item(id).place.sp, px: boxW(), nodes: nodes() };
      // 떨어진 트랙 추가(사이 한 칸 비움) → 사이 트랙은 자동 선택되지 않고, 사본이 따로 뜬다
      chips()[home + 3].click(); await sleep(180);
      const it = r.store.item(id);
      const gapId = r.store.tracks[home + 2].id;
      const far = { gapSelected: (it.place.tracks || []).includes(gapId), nodes: nodes(), members: (it.place.tracks || []).length };
      r.store.commit('원복', () => { const x = r.store.item(id); x.place.tracks = [x.place.t]; x.place.sp = 1; });
      document.querySelector('#pItem [data-close]').click();
      return { before, adj, far, chips: chips().length };
    })()`), 20000, 'span');
    console.log('[smoke] span ' + JSON.stringify(spanEdit));
    return spanEdit;
  },
  check: (spanEdit) => spanEdit?.adj?.sp === 2
    && spanEdit?.adj?.px > spanEdit?.before?.px
    && spanEdit?.adj?.nodes === 1
    && spanEdit?.far?.gapSelected === false
    && spanEdit?.far?.nodes === 2,
};
