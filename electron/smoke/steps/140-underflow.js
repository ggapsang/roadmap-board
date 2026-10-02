// 스모크 단계 'underflow' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'underflow',
  areas: ["axis","board"],
  async run({ target, capture, shotDir, withTimeout }) {
    let underflow = null;
    // 축 밖으로 넘긴 일정 — 시작일을 meta.start(9월)보다 앞선 8월로 보내면
    // 축이 8월까지 늘어나야 한다 (카드가 축 위로 튀어나가 사라지면 안 된다).
    underflow = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const card = document.querySelector('.col > .ev:not(.ms)');
      const id = card.dataset.id;
      const it = () => r.store.item(id);
      const before = { s: it().s, e: it().e };
      const originBefore = r.board.origin.getTime();
      const monthsBefore = [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);

      r.store.commit('축 밖으로', () => { it().s = '2026-08-10'; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 150));

      const originAfter = r.board.origin.getTime();
      const monthsAfter = [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);
      const hasAug = monthsAfter.some((t) => t.startsWith('8월'));
      const cardTop = Math.round(document.querySelector('[data-id="' + id + '"]').getBoundingClientRect().top);

      return {
        before, originBefore, originAfter, hasAug,
        monthsBefore: monthsBefore.length, monthsAfter: monthsAfter.length,
        extended: originAfter < originBefore, cardTop,
      };
    })()`), 20000, 'underflow');
    console.log('[smoke] underflow ' + JSON.stringify(underflow));
    if (shotDir()) await capture(target, 'board-underflow');

    // 원복 — 이후 단계(밴드/압축 등)가 원래 범위를 전제로 한다
    underflow.restored = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cid = document.querySelector('.col > .ev:not(.ms)').dataset.id;
      r.store.commit('원복', () => { r.store.item(cid).s = ${JSON.stringify(underflow?.before?.s)}; });
      r.board.render();
      await new Promise((res) => setTimeout(res, 120));
      return r.board.origin.getTime() === ${underflow?.originBefore ?? 0};
    })()`);
    console.log('[smoke] underflow restored ' + underflow.restored);
    return underflow;
  },
  check: (underflow) => underflow?.extended === true
    && underflow?.hasAug === true
    && underflow?.restored === true,
};
