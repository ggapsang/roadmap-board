// 스모크 단계 'lane-stable' — 같은 칸에서 시작하는 카드들을 나란히 둔 채 하나를 늘리거나 줄여도 좌우 자리(레인)가 그대로다
// (2026-11-17 사용자 — 레인을 길이 순(짧은 것 먼저)으로 세워, 늘린 카드가 오른쪽으로 밀려나고 옆 카드가 자리를 바꿨다. 끄는 동안에도
// 자리가 바뀌어 다른 카드가 늘어나는 것처럼 보였다). 실제 아래 가장자리 끌기로, 끄는 중과 놓은 뒤 둘 다 본다.
export default {
  name: 'lane-stable',
  areas: ['board', 'drag'],
  async run({ target }) {
    const out = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
        const doc0 = JSON.parse(JSON.stringify(r.store.doc));
        const grid = document.getElementById('grid');
        const T = 't-lane-probe';
        const ids = ['e-lane-a', 'e-lane-b', 'e-lane-c'];
        const start = r.store.meta.start;
        const end = (n) => { const d = new Date(start); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
        // 새 트랙에 같은 날 시작하는 카드 셋 — 길이는 c < b < a(길이 순이면 c, b, a로 뒤집힌다)
        r.store.commit('스모크 레인', (doc) => {
          doc.tracks.push({ id: T, lab: '', name: '레인 점검' });
          ids.forEach((id, k) => doc.items.push({ id, ti: '레인 ' + 'ABC'[k], s: start, e: end(20 - k * 6), ty: 'bar', st: 'plan', og: '', pg: 0, note: '',
            place: { t: T, sp: 1, align: 'middle', showNote: false, hd: null, x: null, w: null, slot: null } }));
        });
        await sleep(250);
        const lefts = () => ids.map((id) => Math.round(document.querySelector('.col > .ev[data-id="' + id + '"]').getBoundingClientRect().left));
        const order = () => { const l = lefts(); return ids.slice().sort((a, b) => l[ids.indexOf(a)] - l[ids.indexOf(b)]).join(); };
        const o = { first: order() };
        o.docOrder = o.first === ids.join();                       // 길이와 상관없이 만든 순서(A, B, C)
        // C(가장 짧은 것)의 아래 가장자리를 끌어 가장 길게
        const card = document.querySelector('.col > .ev[data-id="' + ids[2] + '"]');
        const g = card.querySelector('.grip');
        const b = g.getBoundingClientRect();
        const at = (y) => ({ bubbles: true, clientX: b.left + b.width / 2, clientY: y, button: 0 });
        g.dispatchEvent(new PointerEvent('pointerdown', at(b.top + 2)));
        grid.dispatchEvent(new PointerEvent('pointermove', at(b.top + 2 + 25 * r.view.ppd)));
        await sleep(120);
        o.during = order();
        grid.dispatchEvent(new PointerEvent('pointerup', at(b.top + 2 + 25 * r.view.ppd)));
        await sleep(200);
        o.after = order();
        o.longer = r.store.item(ids[2]).e > r.store.item(ids[0]).e;   // 정말 가장 길어졌다
        o.stable = o.during === o.first && o.after === o.first;
        r.store.replace(doc0, '스모크 원복');
        await r.store.flush(); await sleep(150);
        o.restored = !r.store.track(T) && !ids.some((id) => r.store.item(id));
        return o;
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    console.log('[smoke] lane-stable ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o && !o.error && o.docOrder && o.longer && o.stable && o.restored,
};
