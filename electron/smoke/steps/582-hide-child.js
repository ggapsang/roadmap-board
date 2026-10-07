// 스모크 단계 'hide-child' — 모자관계설정의 눈: 하위 카드를 이 보드에서만 숨긴다(meta.hidden). 모자관계(포함)는 그대로 —
// 문서·DB의 포함이 남고(숨김은 그 보드 meta_json에만), 자식을 다 숨기면 부모는 보통 카드로 그린다.
export default {
  name: 'hide-child',
  areas: ['panel', 'board'],
  requires: ['nesting'],
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const o = {};
        const parent = r.store.items.find((p) => !p.parent && r.store.items.filter((k) => k.parent === p.id).length >= 2);
        const kids = r.store.items.filter((k) => k.parent === parent.id);
        o.parent = parent.id; o.kid = kids[0].id;
        const card = (id) => document.querySelector('.body .ev[data-id="' + id + '"]');
        o.wasShown = !!card(kids[0].id) && card(parent.id).classList.contains('container');
        document.querySelector('.col [data-id="' + parent.id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(200);
        const eyes = () => [...document.querySelectorAll('#i-parent .pc-eye')];
        o.eyes = eyes().length === kids.length;
        eyes()[0].click();
        await sleep(200);
        o.hidden = !card(kids[0].id) && (r.store.meta.hidden ?? []).includes(kids[0].id)
          && r.store.item(kids[0].id).parent === parent.id                 // 모자관계는 그대로
          && card(parent.id).classList.contains('container')               // 다른 자식이 남아 여전히 품는 카드
          && eyes()[0].getAttribute('aria-pressed') === 'true';
        // 자식을 다 숨기면 부모는 보통 카드로
        for (let i = 1; i < kids.length; i++) { eyes()[i].click(); await sleep(120); }
        o.allHidden = kids.every((k) => !card(k.id)) && !card(parent.id).classList.contains('container');
        // 되돌리기 한 단계 = 하나 다시 보임
        r.store.undo(); await sleep(150);
        o.undo = !!card(kids[kids.length - 1].id);
        // 첫 자식만 숨긴 채로 저장 → 다시 읽어도 숨김. 포함은 DB에 남는다
        r.store.commit('스모크 숨김', (doc) => { doc.meta.hidden = [kids[0].id]; });
        await r.store.flush();
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = (r.store.meta.hidden ?? []).join() === kids[0].id && !card(kids[0].id) && r.store.item(kids[0].id)?.parent === parent.id;
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    try {
      out.edgeKept = !!db.prepare('SELECT 1 FROM containment WHERE child_id = ?').get(out?.kid ?? '');
      out.metaHidden = (db.prepare('SELECT meta_json FROM board').all().map((x) => x.meta_json ?? '')).some((j) => j.includes('"hidden"') && j.includes(out?.kid ?? '__'));
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        r.store.commit('스모크 숨김 원복', (doc) => { doc.meta.hidden = []; });
        await r.store.flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()`);
    } catch (err) { out.edgeKept = { error: String(err) }; }
    console.log('[smoke] hide-child ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.wasShown === true
    && o?.eyes === true
    && o?.hidden === true
    && o?.allHidden === true
    && o?.undo === true
    && o?.reloaded === true
    && o?.edgeKept === true
    && o?.metaHidden === true,
};
