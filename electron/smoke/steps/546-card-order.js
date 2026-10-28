// 스모크 단계 'card-order' — 카드 쌓는 순서(2026-10-28 사용자, 파워포인트의 맨 앞으로·앞으로·뒤로·맨 뒤로). 스타일 탭 버튼 ·
//   단축키(Ctrl+Shift+] 등) · 같은 자리(보드 최상위끼리)에서만 · 한 칸 옮기기는 겹친 카드를 하나 넘는다 · 층(z-index)이 순서대로 ·
//   상위 카드 안의 카드는 상위 카드 자리에서 · 되돌리기 한 단계 · 다시 읽어도 남는다(DB disp.z_order).
export default {
  name: 'card-order',
  areas: ['panel', 'board'],
  requires: ['nesting'],   // 상위 카드 안의 카드가 상위 카드 자리를 따르는지 본다
  async run({ target, db, wrote }) {
    if (!wrote) return null;
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const o = {};
        const top = () => r.store.items.filter((x) => !x.parent);
        const keep = new Map(r.store.items.map((x) => [x.id, x.place?.z ?? null]));
        // 매긴 층(--zo) — 계산된 z-index는 고른 카드(.sel)가 선택 층으로 올라가 있어 순서를 못 본다
        const zi = (id) => Number(document.querySelector('.col > .ev[data-id="' + id + '"]').style.getPropertyValue('--zo'));
        const shown = top().filter((x) => document.querySelector('.col > .ev[data-id="' + x.id + '"]') && x.ty !== 'ms'
          && !document.querySelector('.col > .ev.container[data-id="' + x.id + '"]'));
        const [A, B, C] = shown;
        o.id = A.id;
        // 스타일 탭 — 맨 앞으로: 최상위 카드 가운데 가장 높은 층
        document.querySelector('.col > .ev[data-id="' + A.id + '"]').click();
        await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="disp"]').click();
        await sleep(60);
        const btn = (k) => document.querySelector('#i-order .seg-btn[data-order="' + k + '"]');
        btn('front').click(); await sleep(150);
        o.front = shown.every((x) => x.id === A.id || zi(x.id) < zi(A.id));
        // 되돌리기 한 단계 — 다시 아무도 순서를 안 정했다
        r.store.undo(); await sleep(150);
        o.undo = top().every((x) => (x.place?.z ?? null) === (keep.get(x.id) ?? null));
        // 단축키 — Ctrl+Shift+[ 맨 뒤로(고른 카드)
        r.view.selectedItem = A.id;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true, bubbles: true }));
        await sleep(150);
        o.backKey = shown.every((x) => x.id === A.id || zi(x.id) > zi(A.id));
        o.toastAtBack = (() => { const before = r.store.rev; btn('back').click(); return r.store.rev === before; })();
        // 앞으로 — 겹친 카드를 하나 넘는다: A(맨 뒤) · C(안 겹침) · B(겹침) 순서에서 A는 B 위로(C만 넘는 게 아니라)
        r.store.commit('스모크 순서', () => {
          top().forEach((x, k) => { x.place.z = x.id === A.id ? null : x.id === C.id ? 1 : x.id === B.id ? 2 : 3 + k; });
        });
        await sleep(150);
        const na = document.querySelector('.col > .ev[data-id="' + A.id + '"]').getBoundingClientRect();
        const nb = document.querySelector('.col > .ev[data-id="' + B.id + '"]');
        const nc = document.querySelector('.col > .ev[data-id="' + C.id + '"]');
        const col = nb.parentElement.getBoundingClientRect();
        // 화면에서만 B를 A 위에 겹치고 C는 멀리 — reorder는 지금 그려진 상자로 겹침을 본다
        Object.assign(nb.style, { left: (na.left - col.left) + 'px', top: (na.top - col.top) + 'px', width: na.width + 'px', height: na.height + 'px' });
        nc.style.top = '-5000px';
        r.board.reorder(A.id, 'forward');
        await sleep(150);
        o.forwardSkips = zi(A.id) > zi(B.id) && zi(C.id) < zi(B.id);
        // 상위 카드 안의 카드 — 상위 카드 자리에서 층을 받는다(상위 카드는 z-index 없음, 제목 바는 안의 카드 위)
        const parent = r.store.items.find((x) => r.store.items.some((k) => k.parent === x.id) && document.querySelector('.col > .ev.container[data-id="' + x.id + '"]'));
        if (parent) {
          const pn = document.querySelector('.col > .ev[data-id="' + parent.id + '"]');
          const kids = [...pn.querySelectorAll(':scope > .ev:not(.sel)')].map((n) => Number(getComputedStyle(n).zIndex));
          const tz = Number(getComputedStyle(pn.querySelector(':scope > .t')).zIndex);
          o.nested = getComputedStyle(pn).zIndex === 'auto' && kids.length > 0 && kids.every((z) => z < tz);
        } else o.nested = 'no-parent';
        // 우클릭 메뉴에 네 가지
        document.querySelector('.col > .ev[data-id="' + A.id + '"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
        await sleep(50);
        const labels = [...document.querySelectorAll('.ctx-menu button')].map((b) => b.textContent);
        o.menu = ['맨 앞으로 가져오기', '앞으로 가져오기', '뒤로 보내기', '맨 뒤로 보내기'].every((l) => labels.includes(l));
        document.querySelector('.ctx-menu')?.remove();
        // 다시 읽어도 남는다
        o.zSaved = r.store.item(A.id).place.z;
        await r.store.flush();
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(300);
        o.reloaded = r.store.item(A.id)?.place?.z === o.zSaved && o.zSaved != null;
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 20000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    try {
      out.db = db.prepare('SELECT z_order FROM disp WHERE child_id = ?').all(out?.id ?? '').some((x) => x.z_order === out?.zSaved);
      // 원복 — 순서를 정하지 않은 상태로
      await target.webContents.executeJavaScript(`(async () => {
        const r = window.__roadmap;
        r.store.commit('스모크 순서 원복', () => { for (const x of r.store.items) if (x.place && x.place.z != null) x.place.z = null; });
        await r.store.flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      })()`);
    } catch (err) { out.db = { error: String(err) }; }
    console.log('[smoke] card-order ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.front === true && o?.undo === true && o?.backKey === true && o?.toastAtBack === true && o?.forwardSkips === true
    && (o?.nested === true) && o?.menu === true && o?.reloaded === true && o?.db === true,
};
