// 스모크 단계 'shots' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'shots',
  areas: ["shot"],
  shotOnly: true,
  async run({ target, capture, shotDir, wrote }) {
    let shots = null;
    // 스타일·매핑 탭 모습 — --shot일 때만 (라이트·다크). 카드 몇 장에 채우기를 입혀 본다.
    if (wrote && shotDir()) {
      const show = (tab, theme) => target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        document.documentElement.dataset.theme = ${JSON.stringify(theme)};
        const keys = ['gray', 'red', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'];
        const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
        r.store.commit('shot 채우기', () => { cards.slice(0, keys.length).forEach((c, i) => { c.place.fill = keys[i]; }); });
        document.querySelector('[data-id="' + cards[0].id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="' + ${JSON.stringify(tab)} + '"]').click();
        await sleep(350);
        return true;
      })()`);
      for (const theme of ['light', 'dark']) {
        await show('disp', theme); await capture(target, `style-tab-${theme}`);
        await show('rel', theme); await capture(target, `map-tab-${theme}`);
      }
      await show('attr', 'light'); await capture(target, 'attr-tab-light');
      await show('task', 'light'); await capture(target, 'task-tab-light');
      await show('rel', 'light');
      await target.webContents.executeJavaScript(`(async () => { document.querySelector('#i-parent > button.btn').click(); await new Promise((r) => setTimeout(r, 300)); return true; })()`);
      await capture(target, 'parent-child-popup');
      await target.webContents.executeJavaScript(`(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true })); await new Promise((r) => setTimeout(r, 600)); return true; })()`);
      await capture(target, 'help-popup');
      await target.webContents.executeJavaScript(`(() => { document.querySelector('.help-scrim')?.remove(); return true; })()`);
      for (const theme of ['light', 'dark']) {
        await target.webContents.executeJavaScript(`(async () => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 100)); document.getElementById('btnGraph').click(); await new Promise((r) => setTimeout(r, 700)); return true; })()`);
        await capture(target, `graph-${theme}`);
        await target.webContents.executeJavaScript(`(async () => { const gv = window.__roadmap.graphView; const big = [...gv.graph.nodes].sort((a, b) => b.degree - a.degree)[0]; document.querySelector('#graphView .gv-node[data-id="' + big.id + '"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); await new Promise((r) => setTimeout(r, 120)); return true; })()`);
        await capture(target, `graph-hover-${theme}`);
        await target.webContents.executeJavaScript(`(() => { const t = window.__roadmap.tabs; t.closeTab(t.tabs.findIndex((x) => x.kind === 'graph')); return true; })()`);
      }
      await target.webContents.executeJavaScript(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
      await target.webContents.executeJavaScript(`(() => {
        const r = window.__roadmap;
        r.store.commit('shot 원복', () => { for (const c of r.store.items) c.place.fill = null; });
        delete document.documentElement.dataset.theme;
        document.querySelector('#pItem [data-close]')?.click();
        return true;
      })()`);
    }
    return shots;
  },
  check: () => true,
};
