// 스모크 단계 'alt-dep' — 카드를 고른 채 다른 카드를 Alt+클릭하면 고른 카드(선행) → 누른 카드(후행) 선행관계가 이어진다(실제 마우스
// 입력, Alt 수정자). 고른 카드는 그대로, 누른 카드는 끌리지 않는다. 다시 Alt+클릭하면 풀린다. 순환이면 잇지 않는다.
export default {
  name: 'alt-dep',
  areas: ['board', 'drag', 'panel'],
  async run({ target }) {
    const wc = target.webContents;
    const pre = await wc.executeJavaScript(`(async () => {
      const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
      const deps = () => r.store.relations.filter((x) => x.type === 'dep');
      const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && !deps().some((d) => d.from === x.id || d.to === x.id));
      const [a, b] = cards;
      r.itemPanel.open(a.id); await sleep(250);
      const el = document.querySelector('#grid .ev[data-id="' + b.id + '"]');
      el.scrollIntoView({ block: 'center', inline: 'center' }); await sleep(150);
      const rc = el.getBoundingClientRect();
      return { a: a.id, b: b.id, x: Math.round(rc.left + rc.width / 2), y: Math.round(rc.top + Math.min(rc.height / 2, 20)), s0: b.s };
    })()`);
    const altClick = async () => {
      wc.sendInputEvent({ type: 'mouseDown', x: pre.x, y: pre.y, button: 'left', clickCount: 1, modifiers: ['alt'] });
      wc.sendInputEvent({ type: 'mouseMove', x: pre.x, y: pre.y + 3, modifiers: ['alt', 'leftButtonDown'] });
      wc.sendInputEvent({ type: 'mouseUp', x: pre.x, y: pre.y + 3, button: 'left', clickCount: 1, modifiers: ['alt'] });
      await new Promise((s) => setTimeout(s, 300));
    };
    const state = () => wc.executeJavaScript(`(() => {
      const r = window.__roadmap;
      const d = r.store.relations.find((x) => x.type === 'dep' && x.from === '${pre.a}' && x.to === '${pre.b}');
      return { has: !!d, selected: r.view.selectedItem, notMoved: r.store.item('${pre.b}').s === ${JSON.stringify(pre.s0)},
        succ: [...document.querySelectorAll('#i-deps .combine-chip-name')].map((x) => x.textContent) };
    })()`);
    await altClick();
    const on = await state();
    await altClick();
    const off = await state();
    // 순환 — b → a 를 먼저 이어 두고 a를 고른 채 b를 Alt+클릭하면 a → b → a가 되어 거부
    await wc.executeJavaScript(`(async () => { const r = window.__roadmap;
      r.store.commit('스모크', (doc) => { doc.relations.push({ id: 'rcyc', type: 'dep', from: '${pre.b}', to: '${pre.a}' }); });
      r.itemPanel.open('${pre.a}'); await new Promise((s) => setTimeout(s, 250)); return true; })()`);
    await altClick();
    const cyc = await state();
    await wc.executeJavaScript(`(async () => { const r = window.__roadmap;
      r.store.commit('정리', (doc) => { doc.relations = doc.relations.filter((x) => x.id !== 'rcyc'); });
      document.querySelector('#pItem [data-close]')?.click(); await new Promise((s) => setTimeout(s, 150)); return true; })()`);
    const out = { pre, on, off, cycleRejected: cyc.has === false };
    console.log('[smoke] alt-dep ' + JSON.stringify(out));
    return out;
  },
  check: (x) => x?.on?.has === true && x?.on?.selected === x?.pre?.a && x?.on?.notMoved === true && x?.on?.succ?.length >= 1
    && x?.off?.has === false && x?.cycleRejected === true,
};
