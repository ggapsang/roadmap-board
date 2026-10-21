// 스모크 단계 'ms-runs' — 여러 트랙에 속한 최상위 점 마일스톤. 붙은 트랙끼리는 걸쳐서 한 표식, 떨어진 트랙엔 따로(막대 카드와 같은 규칙).
//   속하지 않은 사이 트랙을 가로지르지 않는다(2026-10-21 사용자 — 예전엔 처음~끝 트랙을 다 채웠다).
export default {
  name: 'ms-runs',
  areas: ['board'],
  async run({ target, wrote, withTimeout }) {
    if (!wrote) return null;
    const out = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const ms = r.store.items.find((x) => !x.parent && r.board.timeline.isPoint(x));
      if (!ms || r.store.tracks.length < 3) return { error: '점 마일스톤 또는 트랙 3개 없음' };
      const keep = { t: ms.place.t, tracks: ms.place.tracks, sp: ms.place.sp };
      const ids = r.store.tracks.map((t) => t.id);
      const cols = () => [...document.querySelectorAll('.col')].map((c) => c.getBoundingClientRect());
      const nodes = () => [...document.querySelectorAll('.col > .ev[data-id="' + ms.id + '"]')];
      const covers = (n) => { const b = n.getBoundingClientRect(); return cols().map((c, i) => (Math.min(b.right, c.right) - Math.max(b.left, c.left) > 8 ? i : -1)).filter((i) => i >= 0); };
      const set = async (tracks) => { r.store.commit('스모크 마일스톤 트랙', () => { ms.place.t = tracks[0]; ms.place.tracks = tracks; ms.place.sp = 1; }); await sleep(150); };
      const o = {};
      // 떨어진 두 트랙(0·2) — 따로 두 표식, 사이 트랙(1)은 덮지 않는다
      await set([ids[0], ids[2]]);
      o.split = nodes().length === 2 && JSON.stringify(nodes().map(covers)) === JSON.stringify([[0], [2]]);
      // 붙은 두 트랙(0·1) — 걸쳐서 한 표식
      await set([ids[0], ids[1]]);
      o.joined = nodes().length === 1 && JSON.stringify(covers(nodes()[0])) === JSON.stringify([0, 1]);
      r.store.commit('스모크 원복', () => { ms.place.t = keep.t; ms.place.tracks = keep.tracks; ms.place.sp = keep.sp; });
      await r.store.flush();
      return o;
    })()`), 20000, 'ms-runs');
    console.log('[smoke] ms-runs ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.split === true && o?.joined === true,
};
