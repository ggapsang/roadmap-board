// 스모크 단계 'card-font' — 스타일 탭 '글자 크기'(카드마다). 보드 글자 크기에 곱하고, 하위 카드는 상위 배율을 물려받지 않는다.
export default {
  name: 'card-font',
  areas: ['panel', 'board'],
  requires: ['nesting'],   // 상위 카드 안에 든 카드로 물려받지 않음을 본다
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const fsOf = (id) => { const n = document.querySelector('[data-id="' + id + '"]'); return n ? parseFloat(n.style.getPropertyValue('--fs')) : NaN; };
        const near = (a, b) => Math.abs(a - b) < 0.001;
        const o = {};
        const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
        o.id = it.id;
        document.querySelector('.col [data-id="' + it.id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="disp"]').click();
        await sleep(80);
        const btn = (s) => document.querySelector('#i-font .seg-btn[data-step="' + s + '"]');
        btn(1).click(); await sleep(80); btn(1).click(); await sleep(150);
        o.fs = r.store.item(it.id).place.fs;
        o.label = document.getElementById('i-font-val').textContent.trim();
        // 보드 글자 크기에 곱한다
        const boardFs0 = r.store.meta.display.fontScale ?? 1;
        r.store.commit('스모크 보드 글자', (doc) => { doc.meta.display = { ...doc.meta.display, fontScale: 1.1 }; });
        await sleep(150);
        o.multiplied = near(fsOf(it.id), 1.1 * 1.2);
        r.store.commit('스모크 보드 글자 원복', (doc) => { doc.meta.display = { ...doc.meta.display, fontScale: boardFs0 }; });
        await sleep(120);
        // 하위 카드는 상위 카드의 배율을 물려받지 않는다
        const child = r.store.items.find((x) => x.parent && x.ty !== 'ms');
        const parent = r.store.item(child.parent);
        r.store.commit('스모크 상위 글자', () => { parent.place.fs = 1.5; });
        await sleep(150);
        o.parentFs = near(fsOf(parent.id), boardFs0 * 1.5);
        o.childOwn = near(fsOf(child.id), boardFs0);
        r.store.commit('스모크 상위 글자 원복', () => { parent.place.fs = null; });
        await sleep(120);
        // 범위 — 가-를 끝까지 눌러도 60% 밑으로 안 간다. 가운데(100%)는 되돌린다(null)
        for (let i = 0; i < 12; i++) { btn(-1).click(); await sleep(20); }
        o.min = r.store.item(it.id).place.fs;
        btn(0).click(); await sleep(120);
        o.reset = r.store.item(it.id).place.fs === null && document.getElementById('i-font-val').textContent.trim() === '100%';
        // 되돌리기 한 번 = 한 단계
        r.store.undo(); await sleep(150);
        o.undo = r.store.item(it.id).place.fs === 0.6;
        // 120%로 두고 다시 읽어도 남는다
        btn(0).click(); await sleep(60); btn(1).click(); await sleep(60); btn(1).click(); await sleep(120);
        await r.store.flush();
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = r.store.item(it.id)?.place?.fs;
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    try {
      out.dbFs = db.prepare('SELECT font_scale FROM disp WHERE child_id = ?').get(out?.id ?? '')?.font_scale ?? null;
      // 원복
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        const it = r.store.item(${JSON.stringify(out?.id ?? '')});
        if (it) r.store.commit('스모크 글자 원복', () => { it.place.fs = null; });
        await r.store.flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()`);
    } catch (err) { out.dbFs = { error: String(err) }; }
    console.log('[smoke] card-font ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.fs === 1.2
    && o?.label === '120%'
    && o?.multiplied === true
    && o?.parentFs === true
    && o?.childOwn === true
    && o?.min === 0.6
    && o?.reset === true
    && o?.undo === true
    && o?.reloaded === 1.2
    && o?.dbFs === 1.2,
};
