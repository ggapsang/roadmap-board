// 스모크 단계 'bands' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'bands',
  areas: ["axis", "board"],
  async run({ target }) {
    let banded = null;
    // 시간축 구간 묶기 — 2027년 1~3월을 하나로
    banded = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cells = () => [...document.querySelectorAll('.gut-m b')].map((b) => b.textContent);
      const before = cells();
      r.store.commit('구간', (doc) => {
        doc.bands.push({ id: 'q1', from: '2027-01-01', to: '2027-03-31', label: '2027 1Q' });
      });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 150));
      const after = cells();
      const merged = document.querySelectorAll('.gut-m b.merged').length;
      // 보드 끝에서 잘린 채 저장된 한 칸짜리 구간(그 달 1~9일)도 그 달 전체를 한 칸으로 덮는다 — 나머지 날이 칸·손잡이 없이 남아
      // 줄일 수 없던 것(2026-11-24 사용자). 시작 다음 달로 본다
      const st = new Date(r.store.meta.start + 'T00:00:00');
      const m0 = new Date(st.getFullYear(), st.getMonth() + 1, 1), m1 = new Date(st.getFullYear(), st.getMonth() + 2, 1);
      const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      r.store.commit('잘린 구간', (doc) => {
        doc.bands.push({ id: 'clip1', mode: 'month-week', from: iso(m0), to: iso(new Date(m0.getFullYear(), m0.getMonth(), 9)), label: '잘린 달', scale: 0.5 });
      });
      r.board.rebuild(); await new Promise((res) => setTimeout(res, 150));
      const di = (d) => Math.round((d - r.board.origin) / 86400000);
      const cell = document.querySelector('.gut-m b[data-band="clip1"]');
      const whole = !!cell && Number(cell.dataset.from) === di(m0) && Number(cell.dataset.to) === di(m1);
      const sc = r.board.scale, d20 = di(new Date(m0.getFullYear(), m0.getMonth(), 20));
      const halfTail = Math.abs((sc.y(d20 + 7) - sc.y(d20)) - (sc.y(d20 + 7 - 14) - sc.y(d20 - 14))) < 2;   // 20일 뒤도 1~9일과 같은 배율
      const tailScaled = (sc.y(d20 + 7) - sc.y(d20)) < 7 * r.view.ppd * 0.75;
      r.store.commit('잘린 구간 원복', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== 'clip1'); });
      r.board.rebuild(); await new Promise((res) => setTimeout(res, 100));
      // 눈에 보이는 경계선(아래 칸의 윗선) 바로 아래를 잡아 끌어도 위 칸 높이 조절 — 아래 칸을 잡아 묶기가 되던 것(2026-11-24 사용자)
      const gm = document.querySelector('.gut-m');
      const q1 = gm.querySelector(':scope > b[data-band="q1"]');
      q1.scrollIntoView({ block: 'center' }); await new Promise((res) => setTimeout(res, 100));
      const nextCell = [...gm.querySelectorAll(':scope > b')].find((c) => Number(c.dataset.from) === Number(q1.dataset.to));
      const nb = nextCell.getBoundingClientRect(), x = nb.left + nb.width / 2;
      const at = (y) => ({ bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 });
      gm.dispatchEvent(new PointerEvent('pointermove', at(nb.top + 2)));
      const edgeCursor = getComputedStyle(gm).cursor === 'ns-resize' && gm.querySelector('.edge-hot') === q1;
      nextCell.dispatchEvent(new PointerEvent('pointerdown', at(nb.top + 2)));
      gm.dispatchEvent(new PointerEvent('pointermove', at(nb.top + 20)));
      gm.dispatchEvent(new PointerEvent('pointermove', at(nb.top + 40)));
      const picking = gm.querySelectorAll('b.picking').length;
      gm.dispatchEvent(new PointerEvent('pointerup', at(nb.top + 40))); await new Promise((res) => setTimeout(res, 100));
      const grown = (r.store.doc.bands.find((b) => b.id === 'q1')?.scale ?? 1) > 1;
      r.store.commit('스모크 원복', (doc) => { const b = doc.bands.find((x) => x.id === 'q1'); if (b) delete b.scale; });
      // 칸 한가운데는 묶기 — 커서도 기본
      const mid = nb.top + Math.min(nb.height / 2, 30);
      gm.dispatchEvent(new PointerEvent('pointermove', at(mid)));
      const midDefault = getComputedStyle(gm).cursor !== 'ns-resize';
      gm.dispatchEvent(new PointerEvent('pointerleave', at(mid)));
      const edge = { edgeCursor, noPick: picking === 0, grown, midDefault };
      return { before: before.length, after: after.length, merged, labels: after, clip: { whole, halfTail, tailScaled }, edge };
    })()`);
    console.log('[smoke] bands ' + JSON.stringify(banded));
    return banded;
  },
  check: (banded) => banded?.merged === 1
    && banded?.after === banded?.before - 2 && banded?.clip?.whole && banded?.clip?.tailScaled
    && banded?.edge && Object.values(banded.edge).every((v) => v === true),
};
