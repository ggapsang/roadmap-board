// 스모크 단계 'card-halign' — 카드 글자 가로 정렬(스타일 탭 왼쪽·가운데·오른쪽, 2026-11-17 사용자). 세로 정렬처럼 배치 값(place.ha,
//   DB disp.halign) · 고르면 카드 글자가 그쪽으로 · 다시 누르면 자동(null) · 되돌리기 한 단계 · 다시 읽어도 남는다.
export default {
  name: 'card-halign',
  areas: ['panel', 'board', 'db'],
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const o = {};
        const card = (id) => document.querySelector('.col > .ev[data-id="' + id + '"]');
        const it = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && card(x.id) && !card(x.id).classList.contains('container')
          && !card(x.id).classList.contains('short'));
        o.id = it.id;
        card(it.id).click(); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="disp"]').click(); await sleep(60);
        const btn = (k) => document.querySelector('#i-halign .seg-btn[data-ha="' + k + '"]');
        o.buttons = document.querySelectorAll('#i-halign .seg-btn').length === 3
          && [...document.querySelectorAll('#i-halign .seg-btn')].every((b) => b.getAttribute('aria-pressed') === 'false');
        const ta = () => getComputedStyle(card(it.id).querySelector('.t')).textAlign;
        o.auto = ta();
        btn('right').click(); await sleep(150);
        o.right = r.store.item(it.id).place.ha === 'right' && card(it.id).classList.contains('ha-right') && ta() === 'right'
          && btn('right').getAttribute('aria-pressed') === 'true';
        btn('center').click(); await sleep(150);
        o.center = ta() === 'center' && getComputedStyle(card(it.id)).alignItems === 'center';
        r.store.undo(); await sleep(150);
        o.undo = r.store.item(it.id).place.ha === 'right';
        await r.store.flush();
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = r.store.item(it.id)?.place.ha === 'right' && card(it.id)?.classList.contains('ha-right');
        // 다시 누르면 자동
        card(it.id).click(); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="disp"]').click(); await sleep(60);
        btn('right').click(); await sleep(150);
        o.backToAuto = r.store.item(it.id).place.ha === null && !card(it.id).className.includes('ha-') && ta() === o.auto;
        await r.store.flush();
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    if (out?.id) out.dbAuto = db.prepare('SELECT halign FROM disp WHERE child_id = ?').all(out.id).every((x) => x.halign == null);
    console.log('[smoke] card-halign ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o && !o.error && o.buttons && o.right && o.center && o.undo && o.reloaded && o.backToAuto && o.dbAuto,
};
