// 스모크 단계 'link-hl' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'link-hl',
  areas: ["arrows"],
  async run({ target }) {
    let linkHl = null;
    // 이어진 카드 강조 — 카드에 커서를 올리면 그 카드에 닿는 선행 화살표가 채워지고, 양끝 카드 테두리가 밝아진다.
  // 다시 그려도 유지, 빈 곳으로 옮기면 사라진다.
  linkHl = await target.webContents.executeJavaScript(`(async () => {
    const r = window.__roadmap, sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const deps = r.store.relations.filter((x) => x.type === 'dep');
    const deg = new Map();
    for (const d of deps) for (const k of [d.from, d.to]) deg.set(k, (deg.get(k) ?? 0) + 1);
    const id = [...deg].sort((a, b) => b[1] - a[1])[0][0];                 // 화살표가 가장 많은 카드
    // 기대값 — 계보: 선행을 거슬러 끝까지 + 후행을 따라 끝까지(사촌 제외). 화면에 그려진 카드 사이 화살표만.
    const drawn = new Set([...document.querySelectorAll('#grid .ev')].map((n) => n.dataset.id));
    const vis = deps.filter((d) => drawn.has(d.from) && drawn.has(d.to));
    const want = new Set([id]); const edges = new Set();
    const go = (start, dir) => { const st = [start], seen = new Set([start]);
      while (st.length) { const c = st.pop(); for (const d of vis) { const hit = dir > 0 ? d.from === c : d.to === c; if (!hit) continue;
        edges.add(d); const k = dir > 0 ? d.to : d.from; want.add(k); if (!seen.has(k)) { seen.add(k); st.push(k); } } } };
    go(id, -1); go(id, +1);
    const arrows = edges.size;
    // 사촌(앞선 일의 다른 후행 중 계보 밖)이 하나라도 있으면 그게 강조되지 않는지도 본다
    const cousins = new Set();
    for (const a of want) for (const d of vis) if (d.from === a && !want.has(d.to)) cousins.add(d.to);
    const card = document.querySelector('#grid .ev[data-id="' + id + '"]');
    card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await sleep(50);
    const hl = [...document.querySelectorAll('.arrows .arrow.hl')];
    const linked = new Set([...document.querySelectorAll('#grid .ev.linked')].map((n) => n.dataset.id));
    const ok = hl.length === arrows && [...want].every((k) => linked.has(k)) && [...linked].every((k) => want.has(k))
      && [...cousins].every((k) => !linked.has(k));
    r.board.render(); await sleep(80);
    const kept = document.querySelectorAll('.arrows .arrow.hl').length === arrows;
    const col = document.querySelector('#grid .col');
    col.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));             // 빈 칸 — 카드 밖
    await sleep(50);
    const cleared = !document.querySelector('.arrows .arrow.hl') && !document.querySelector('#grid .ev.linked');
    const fill = (() => { document.querySelector('#grid .ev[data-id="' + id + '"]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));   // 다시 그려 새 카드
      const p = document.querySelector('.arrows .arrow.hl'); const f = p ? getComputedStyle(p).fill : ''; col.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); return f; })();
    const base = getComputedStyle(document.querySelector('.arrows .arrow')).fill;
    return { arrows, linked: linked.size, want: want.size, cousins: cousins.size, ok, kept, cleared, filled: !!fill && fill !== base };
  })()`);
  console.log('[smoke] link-hl ' + JSON.stringify(linkHl));
    return linkHl;
  },
  check: (linkHl) => linkHl?.arrows > 0
    && linkHl?.ok === true
    && linkHl?.kept === true
    && linkHl?.cleared === true
    && linkHl?.filled === true,
};
