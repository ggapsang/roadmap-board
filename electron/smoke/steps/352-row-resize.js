// 스모크 단계 'row-resize' — 두 번째 칸(안쪽 칸: 월-주의 주) 행마다 높이 손잡이(2026-10-26 사용자).
//   끌면 그 행만 늘고(다른 행·바깥 칸 구간은 그대로) 그 행의 카드도 따라 늘어난다 · 되돌리기 한 단계 · 더블클릭 원래대로 ·
//   모드마다 따로(주-일로 바꾸면 그 배율이 걸리지 않는다) · 손잡이는 행 안 아래쪽(어디를 눌러도 자기 손잡이)
export default {
  name: 'row-resize',
  areas: ['axis'],
  async run({ target, withTimeout }) {
    const out = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
      const gutW = document.getElementById('gutW');
      const o = {};
      if (r.store.meta.display.scale !== 'month-week') return { error: '월-주가 아님' };
      // 카드가 걸친 주 하나를 고른다 — 카드 높이도 따라 늘어나는지 본다
      const tl = r.board.timeline;
      const card = r.store.items.find((x) => !x.parent && x.ty !== 'ms' && tl.pos(x) && tl.pos(x).e - tl.pos(x).s >= 6);
      const rows = [...gutW.querySelectorAll('b.row')];
      const row = rows.find((b) => Number(b.dataset.from) >= tl.pos(card).s && Number(b.dataset.to) <= tl.pos(card).e + 1) ?? rows[2];
      const iso = row.dataset.row;
      const other = rows.find((b) => b !== row && b.dataset.row !== iso);
      const hOf = (iso) => { const b = gutW.querySelector('b.row[data-row="' + iso + '"]'); return b.getBoundingClientRect().height; };
      const cardH = () => document.querySelector('.col > .ev[data-id="' + card.id + '"]').getBoundingClientRect().height;
      const h0 = hOf(iso), o0 = hOf(other.dataset.row), c0 = cardH();
      // 손잡이는 행 안 아래쪽 — 그 자리를 누르면 이 행의 손잡이가 잡힌다
      row.scrollIntoView({ block: 'center' }); await sleep(60);
      const rb = row.getBoundingClientRect();
      const handle = row.querySelector('.band-resize');
      o.handleHit = [1, 4, 7].every((d) => document.elementFromPoint(rb.left + rb.width / 2, rb.bottom - d) === handle);
      const box = handle.getBoundingClientRect();
      const at = (y) => ({ bubbles: true, clientX: box.left + box.width / 2, clientY: y, button: 0, pointerId: 1 });
      const rev0 = r.store.rev;
      handle.dispatchEvent(new PointerEvent('pointerdown', at(box.top + 1)));
      gutW.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + 20)));
      await sleep(60);
      gutW.dispatchEvent(new PointerEvent('pointermove', at(box.top + 1 + h0)));          // 두 배로
      await sleep(120);
      gutW.dispatchEvent(new PointerEvent('pointerup', at(box.top + 1 + h0)));
      await sleep(150);
      const sc = r.store.meta.display.rowScales?.['month-week']?.[iso];
      o.saved = sc >= 1.8 && sc <= 2.2;
      o.grew = hOf(iso) > h0 * 1.7 && Math.abs(hOf(other.dataset.row) - o0) < 1;
      o.cardGrew = cardH() > c0 + h0 * 0.7;
      o.noBand = !(r.store.doc.bands ?? []).some((b) => b.from === iso);   // 바깥 칸 구간은 만들지 않는다
      const { prepare } = await import('./src/core/schema.js');
      o.kept = prepare(structuredClone(r.store.doc)).doc.meta.display.rowScales?.['month-week']?.[iso] === sc;
      // 모드마다 따로 — 주-일에선 이 배율이 안 걸린다
      const sel = document.getElementById('v-scale');
      sel.value = 'week-day'; sel.dispatchEvent(new Event('change')); await sleep(200);
      o.otherMode = !r.board.scale.compressed;
      sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); await sleep(200);
      // 되돌리기 한 단계(모드 바꾸기 두 번을 먼저 되돌린다)
      while (r.store.meta.display.scale !== 'month-week' || r.store.rev > rev0 + 1) { if (!r.store.canUndo) break; r.store.undo(); await sleep(30); if (r.store.meta.display.rowScales?.['month-week']?.[iso] == null) break; }
      o.undo = r.store.meta.display.rowScales?.['month-week']?.[iso] == null && Math.abs(hOf(iso) - h0) < 1;
      r.store.redo(); await sleep(150);
      // 더블클릭 — 원래대로
      gutW.querySelector('b.row[data-row="' + iso + '"] .band-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(150);
      o.reset = r.store.meta.display.rowScales?.['month-week']?.[iso] == null && Math.abs(hOf(iso) - h0) < 1;
      if (r.store.meta.display.scale !== 'month-week') { sel.value = 'month-week'; sel.dispatchEvent(new Event('change')); }
      await r.store.flush();
      return o;
    })()`), 20000, 'row-resize');
    console.log('[smoke] row-resize ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.handleHit === true && o?.saved === true && o?.grew === true && o?.cardGrew === true && o?.noBand === true
    && o?.kept === true && o?.otherMode === true && o?.undo === true && o?.reset === true,
};
