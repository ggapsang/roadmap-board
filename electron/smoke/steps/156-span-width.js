// 스모크 단계 'span-width' — 여러 트랙에 걸친 카드가 고른 마지막 트랙 끝에 정확히 닿는다(2026-10-29 사용자). 트랙 폭이 서로 다를 때:
//   자동 크기 — 시작 트랙에 레인이 여럿이고 첫 레인이어도 마지막 트랙까지(예전엔 남은 레인 폭만큼 못 미쳤다) ·
//   사이즈 수동 설정 — x·w는 트랙 단위(자기 트랙 끝 1, 다음 트랙 끝 2 …), 마지막 트랙 밖 '+'로 안 나간다(예전엔 자기 트랙 폭의 배수라
//   넓은 트랙에서 시작하면 넘어갔다) · 오른쪽 가장자리를 끌면 커서가 있는 트랙의 그 자리까지.
export default {
  name: 'span-width',
  areas: ['board', 'drag'],
  async run({ target, wrote, withTimeout }) {
    if (!wrote) return null;
    const out = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const tracks = r.store.tracks;
      if (tracks.length < 3) return { error: '트랙 3개 없음' };
      const ids = tracks.map((t) => t.id);
      const n = ids.length;
      const plain = r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
      const [A, B] = plain;
      const keep = { w0: tracks[0].w, A: structuredClone({ s: A.s, e: A.e, place: A.place }), B: structuredClone({ s: B.s, e: B.e, place: B.place }) };
      const colR = (i) => document.querySelectorAll('.body > .col')[i].getBoundingClientRect();
      const box = () => document.querySelector('.col > .ev[data-id="' + A.id + '"]').getBoundingClientRect();
      const near = (a, b, d = 6) => Math.abs(a - b) <= d;
      const o = {};
      // 첫 트랙을 넓게(다른 트랙과 폭이 다르게), A는 첫 트랙에서 마지막 트랙까지 걸치고 B와 겹쳐 첫 트랙에 레인이 둘
      r.store.commit('스모크 걸침 폭', () => {
        tracks[0].w = 420;
        Object.assign(A, { s: '2026-10-01', e: '2026-10-20' });
        Object.assign(A.place, { t: ids[0], tracks: [...ids], sp: n, hd: null, x: null, w: null, oy: null });
        Object.assign(B, { s: '2026-10-05', e: '2026-10-15' });
        Object.assign(B.place, { t: ids[0], tracks: [ids[0]], sp: 1, hd: null, x: null, w: null, oy: null });
      });
      await sleep(200);
      const lane = r.board._layout.placement.get(A.id + '@' + ids[0]) ?? r.board._layout.placement.get(A.id);
      o.lanes = lane?.lanes;
      o.autoReach = near(box().right, colR(n - 1).right - 4);
      // 사이즈 수동 설정 — w = 트랙 수면 마지막 트랙 끝, 1.5면 다음 트랙 가운데
      r.store.commit('스모크 강제', () => { Object.assign(A.place, { hd: 3, x: 0, w: n }); });
      await sleep(150);
      o.forcedReach = near(box().right, colR(n - 1).right - 4);
      o.notPastLast = box().right <= colR(n - 1).right + 1;
      r.store.commit('스모크 강제 1.5', () => { A.place.w = 1.5; });
      await sleep(150);
      o.halfNext = near(box().right, colR(1).left + colR(1).width / 2 - 4);
      // 오른쪽 가장자리를 끌어 세 번째 트랙 가운데까지
      const grip = document.querySelector('.col > .ev[data-id="' + A.id + '"] > .grip-he');
      const g = grip.getBoundingClientRect();
      const x0 = g.left + g.width / 2, y = g.top + g.height / 2;
      const to = colR(2).left + colR(2).width / 2;
      const at = (x) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 });
      grip.dispatchEvent(new PointerEvent('pointerdown', at(x0)));
      // 첫 움직임에 다시 그려져 손잡이가 DOM에서 빠진다 — 이어지는 이벤트는 보드 몸통에
      const grid = document.getElementById('grid');
      grid.dispatchEvent(new PointerEvent('pointermove', at(x0 + 10)));
      await sleep(50);
      grid.dispatchEvent(new PointerEvent('pointermove', at(to)));
      await sleep(50);
      grid.dispatchEvent(new PointerEvent('pointerup', at(to)));
      await sleep(200);
      o.w = Math.round(A.place.w * 100) / 100;
      o.dragTrackUnits = near(A.place.w, 2.5, 0.08);
      r.store.commit('스모크 걸침 원복', () => {
        tracks[0].w = keep.w0;
        Object.assign(A, { s: keep.A.s, e: keep.A.e }); A.place = keep.A.place;
        Object.assign(B, { s: keep.B.s, e: keep.B.e }); B.place = keep.B.place;
      });
      await r.store.flush();
      return o;
    })()`), 20000, 'span-width');
    console.log('[smoke] span-width ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.lanes >= 2 && o?.autoReach === true && o?.forcedReach === true && o?.notPastLast === true && o?.halfNext === true
    && o?.dragTrackUnits === true,
};
