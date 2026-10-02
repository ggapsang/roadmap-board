// 스모크 단계 'drill' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'drill',
  areas: ["board"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, capture, shotDir }) {
    let drill = null;
    // 펼치기(드릴다운) — 자식을 품은 카드를 펼치면 그 자식들이 보드가 된다 (PDF §8)
    drill = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const container = r.store.items.find((i) => r.store.items.some((c) => c.parent === i.id));
      const id = container.id;
      const kids = r.store.items.filter((c) => c.parent === id).map((c) => c.id);
      r.view.setFocus(id);
      await new Promise((res) => setTimeout(res, 200));
      const crumbsVisible = !document.getElementById('crumbs').hidden;
      const topInCols = [...document.querySelectorAll('.col > .ev')].map((n) => n.dataset.id);
      const childrenShown = kids.every((k) => topInCols.includes(k));
      const containerNotTop = !topInCols.includes(id);   // 펼친 카드 자신은 루트라 컬럼에 없다
      r.view.setFocus(null);
      await new Promise((res) => setTimeout(res, 150));
      const restored = document.getElementById('crumbs').hidden
        && [...document.querySelectorAll('.col > .ev')].some((n) => n.dataset.id === id);
      return { kids: kids.length, crumbsVisible, childrenShown, containerNotTop, restored };
    })()`);
    console.log('[smoke] drill ' + JSON.stringify(drill));
    if (shotDir()) {
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const c = r.store.items.find((i) => r.store.items.some((x) => x.parent === i.id));
        r.view.setFocus(c.id);
      })()`);
      await new Promise((res) => setTimeout(res, 300));
      await capture(target, 'board-drill');
      await target.webContents.executeJavaScript('window.__roadmap.view.setFocus(null)');
      await new Promise((res) => setTimeout(res, 150));
    }
    return drill;
  },
  check: (drill) => drill?.kids > 0
    && drill?.crumbsVisible === true
    && drill?.childrenShown === true
    && drill?.containerNotTop === true
    && drill?.restored === true,
};
