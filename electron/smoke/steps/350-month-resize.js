// 스모크 단계 'month-resize' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'month-resize',
  areas: ["axis"],
  async run({ target, withTimeout }) {
    let monthResize = null;
    // 낱개 월 높이 조절 — 병합 없이 월 칸 아래 가장자리를 끌면 그 달만 압축된다
    monthResize = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const gutM = document.getElementById('gutM');
      const cell = gutM.querySelector('b:not(.merged)');
      const handle = cell && cell.querySelector('.band-resize');
      if (!handle) return { error: '월 손잡이 없음' };
      const bandsBefore = (r.store.doc.bands ?? []).length;
      const gridH0 = parseFloat(document.getElementById('grid').style.height);
      const box = handle.getBoundingClientRect();
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 1)));
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 - 60)));   // 위로 = 축소
      await new Promise((res) => setTimeout(res, 150));
      gutM.dispatchEvent(new PointerEvent('pointerup', at(box.top + 1 - 60)));
      await new Promise((res) => setTimeout(res, 150));
      const bands = r.store.doc.bands ?? [];
      const created = bands[bands.length - 1];
      const gridH1 = parseFloat(document.getElementById('grid').style.height);
      const made = bands.length === bandsBefore + 1;
      if (made) r.store.commit('정리', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== created.id); });
      r.board.rebuild();
      await new Promise((res) => setTimeout(res, 120));
      return { made, scale: created?.scale ?? null, shrank: gridH1 < gridH0 };
    })()`), 20000, 'month-resize');
    console.log('[smoke] month-resize ' + JSON.stringify(monthResize));

    // 칸 높이 손잡이는 칸 안 아래 8px — 어디를 눌러도(화면 맨 위 요소로) 그 칸 자신의 손잡이가 잡힌다.
    // 반쯤 밖으로 내밀면 다음 칸이 덮어 2~3px만 잡혔고, 경계선을 잡으면 윗칸이 줄어 헷갈렸다.
    monthResize.handleHit = await target.webContents.executeJavaScript(`(async () => {
      const cells = [...document.querySelectorAll('#gutM b')];
      const out = [];
      for (const c of cells) {
        c.scrollIntoView({ block: 'center' }); await new Promise((res) => setTimeout(res, 30));
        const cb = c.getBoundingClientRect();
        if (cb.height < 12) continue;                         // 접힌 칸은 손잡이도 칸 높이만큼만
        const h = c.querySelector('.band-resize');
        out.push([1, 4, 7].every((d) => document.elementFromPoint(cb.left + cb.width / 2, cb.bottom - d) === h));
      }
      return { n: out.length, all: out.every(Boolean) };
    })()`);

    // 분기-월에서 칸 높이 — 한 분기는 기본 3행뿐이라 3배 한도면 좁다. 끄는 만큼 늘어나야 한다.
    monthResize.quarter = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const sel = document.getElementById('v-scale');
      sel.value = 'quarter-month'; sel.dispatchEvent(new Event('change')); await sleep(200);
      const gutM = document.getElementById('gutM');
      const cells = [...gutM.querySelectorAll('b:not(.merged)')];
      const cell = cells.sort((a, b) => (Number(b.dataset.to) - Number(b.dataset.from)) - (Number(a.dataset.to) - Number(a.dataset.from)))[0];
      const handle = cell?.querySelector('.band-resize');
      if (!handle) { sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); return { error: '분기 손잡이 없음' }; }
      const h0 = cell.getBoundingClientRect().height;
      const box = handle.getBoundingClientRect();
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      const before = new Set((r.store.doc.bands ?? []).map((b) => b.id));
      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 1)));
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + 20)));
      await sleep(80);
      gutM.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + h0 * 7)));   // 8배 높이로
      await sleep(120);
      gutM.dispatchEvent(new PointerEvent('pointerup', at(box.top + 1 + h0 * 7)));
      await sleep(150);
      const made = (r.store.doc.bands ?? []).find((b) => !before.has(b.id));
      const h1 = [...gutM.querySelectorAll('b')].find((c) => c.dataset.band === made?.id)?.getBoundingClientRect().height ?? 0;
      const { prepare } = await import('./src/core/schema.js');
      const kept = prepare(structuredClone(r.store.doc)).doc.bands.find((b) => b.id === made?.id)?.scale ?? null;
      if (made) r.store.commit('정리', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== made.id); });
      sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); await sleep(150);
      return { mode: made?.mode ?? null, scale: made?.scale ?? null, kept, h0: Math.round(h0), h1: Math.round(h1) };
    })()`), 20000, 'quarter-resize');
    console.log('[smoke] quarter-resize ' + JSON.stringify(monthResize.quarter));
    return monthResize;
  },
  check: (monthResize) => monthResize?.made === true
    && monthResize?.scale < 1
    && monthResize?.shrank === true
    && monthResize?.handleHit?.n > 3
    && monthResize?.handleHit?.all === true
    && monthResize?.quarter?.mode === 'quarter-month'
    && monthResize?.quarter?.scale > 3
    && monthResize?.quarter?.kept === monthResize?.quarter?.scale
    && monthResize?.quarter?.h1 > monthResize?.quarter?.h0 * 3,
};
