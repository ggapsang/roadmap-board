/**
 * 왼쪽 시간축 칸 묶기.
 *
 * 바깥 칸(주-일=주, 월-주=월, 분기-월=분기)을 세로로 끌면 그 범위가 하나로 합쳐지고 이름을 물어본다.
 * 예: 2027년 1~3월을 끌어 "1Q"로. 묶은 칸은 더블클릭해 이름을 바꾸고, 우클릭해 해제한다.
 * 구간은 **모드마다 따로** 기억한다(band.mode) — 월-주에서 묶은 것이 분기-월 보기를 흔들지 않는다.
 * 눈금 없음에는 바깥 칸이 없어 아무것도 하지 않는다.
 */
import { dateAt, parseDate, formatDate, dayIndex } from '../../core/dates.js';
import { unitStart, addUnits } from '../../core/timeline.js';
import { newId } from '../../core/schema.js';
import { BAND_SCALE } from '../../config/index.js';
import { el } from '../dom.js';
import { askText } from '../dialog.js';
import { openCtxMenu } from '../ctxmenu.js';
import { toast } from '../toast.js';

/**
 * 높이 손잡이 잡기 — 칸 아래 경계선의 **위아래** EDGE px 안이면 그 칸(경계 위 칸)을 조절한다. 좌표로 판정한다.
 * 예전엔 칸 안 아래쪽 8px 손잡이 요소만 잡혔다 — 눈에 보이는 경계선은 아래 칸의 윗선이라 선을 겨누면 아래 칸을 잡아 묶기(병합)가
 * 시작되고, 칸 전체 커서가 ↕라 어디를 잡아도 조절될 것처럼 보였다(아모레 2027 2Q, 2026-11-24 사용자). 작은 칸은 자기 높이의 1/3까지만
 * 내준다 — 접은 칸이 이어져도 칸 안을 눌러 묶기를 시작할 수 있게.
 */
const EDGE = 6;
export function edgeCell(container, selector, clientY) {
  const cells = [...container.querySelectorAll(selector)]
    .map((c) => ({ c, r: c.getBoundingClientRect() }))
    .filter((x) => x.r.height > 0)
    .sort((a, b) => a.r.top - b.r.top);
  let best = null, bestD = Infinity;
  cells.forEach(({ c, r }, i) => {
    const below = cells[i + 1]?.r;
    const up = Math.max(2, Math.min(EDGE, r.height / 3));
    const down = below && Math.abs(below.top - r.bottom) < 2 ? Math.max(2, Math.min(EDGE, below.height / 3)) : EDGE;
    const d = clientY - r.bottom;
    if ((d <= 0 ? -d <= up : d <= down) && Math.abs(d) < bestD) { bestD = Math.abs(d); best = c; }
  });
  return best;
}

/** 경계 가까이 올리면 커서를 ↕로, 조절될 칸을 칠하고 손잡이를 보인다 — 무엇이 조절될지 미리 보이게 */
function markEdge(container, cell) {
  container.classList.toggle('at-edge', !!cell);
  for (const c of container.querySelectorAll('.edge-hot')) if (c !== cell) c.classList.remove('edge-hot');
  cell?.classList.add('edge-hot');
}

export function attachBandEditing(gutM, { store, getOrigin, getScale, getTimeline, getZoom = () => 1, onChange }) {
  let drag = null;
  let resizing = null;

  const cellAt = (target) => target.closest('b');
  /** 높이를 조절할 칸 — 손잡이를 눌렀으면 그 칸, 아니면 경계선 위아래 근처의 칸 */
  const resizeCell = (ev) => (ev.target.classList?.contains('band-resize') ? cellAt(ev.target) : null)
    ?? edgeCell(gutM, ':scope > b', ev.clientY);
  /** 지금 모드 — 바깥 칸이 있을 때만(날짜 있는 보드의 주-일·월-주·분기-월) */
  const modeKey = () => {
    const tl = getTimeline();
    return tl.dated && tl.mode.outer ? tl.mode.key : null;
  };
  const outer = () => getTimeline().mode.outer;
  /** 같은 모드에서 [fromISO, toISO]와 겹치는 구간을 치운다 — 다른 모드의 구간은 건드리지 않는다 */
  const clearRange = (doc, key, fromISO, toISO) => {
    doc.bands = doc.bands.filter((b) => (b.mode ?? 'month-week') !== key || b.to < fromISO || b.from > toISO);
  };
  const sortBands = (doc) => doc.bands.sort((a, b) =>
    (a.mode ?? '').localeCompare(b.mode ?? '') || a.from.localeCompare(b.from));

  /** 날짜 없는 보드 — 칸마다 높이(display.slotRows). 묶기는 없다 */
  const slotMode = () => !getTimeline().dated;
  let slotResize = null;
  const setSlotRow = (doc, p, scale) => {
    const rows = { ...(doc.meta.display.slotRows ?? {}) };
    if (scale == null || Math.abs(scale - 1) < 0.005) delete rows[p]; else rows[p] = Math.round(scale * 100) / 100;
    doc.meta.display.slotRows = rows;
  };

  gutM.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;
    if (slotMode()) {
      const cell = resizeCell(ev);
      if (!cell) return;
      ev.preventDefault();
      const p = Number(cell.dataset.slot);
      slotResize = { p, y: ev.clientY, full: getScale().ppd, scale0: Number(store.meta.display?.slotRows?.[p]) || 1, began: false };
      gutM.setPointerCapture(ev.pointerId);
      return;
    }
    if (!modeKey()) return;

    // 아래 가장자리를 잡으면 높이 조절. 묶은 구간이든 낱개 칸이든 된다 —
    // 낱개 칸은 그 칸만 한 칸짜리 구간으로 만들어 스케일을 건다(병합 없이 축소/확대).
    const edge = resizeCell(ev);
    if (edge) {
      const cell = edge;
      ev.preventDefault();
      const from = Number(cell.dataset.from);
      const to = Number(cell.dataset.to);
      const id = cell.dataset.band || null;
      const band = id ? store.doc.bands.find((b) => b.id === id) : null;
      resizing = {
        id,                                 // null이면 낱개 칸 — 움직일 때 구간을 만든다
        month: id ? null : { from, to, label: cell.dataset.label ?? '' },
        y: ev.clientY,
        full: (to - from) * getScale().ppd,
        scale0: band ? (band.scale ?? 1) : 1,
        began: false,
      };
      // 낱개 월은 드래그 시작 때 구간이 생겨 손잡이가 재생성된다. gutM에 캡처해
      // 재렌더에도 pointermove가 끊기지 않게 한다.
      gutM.setPointerCapture(ev.pointerId);
      return;
    }

    const cell = cellAt(ev.target);
    if (!cell) return;
    drag = { from: Number(cell.dataset.from), to: Number(cell.dataset.to), moved: false };
    gutM.setPointerCapture(ev.pointerId);
  });

  gutM.addEventListener('pointermove', (ev) => {
    if (!slotResize && !resizing && !drag) markEdge(gutM, store.readonly ? null : resizeCell(ev));
    if (slotResize) {
      const delta = (ev.clientY - slotResize.y) / getZoom();     // 화면 px → 보드 px
      if (!slotResize.began) {
        if (Math.abs(delta) < 4) return;
        store.begin('칸 높이');
        slotResize.began = true;
      }
      const next = Math.min(BAND_SCALE.max, Math.max(BAND_SCALE.min, (slotResize.full * slotResize.scale0 + delta) / slotResize.full));
      store.commit('칸 높이', (doc) => setSlotRow(doc, slotResize.p, next));
      onChange();
      return;
    }
    if (resizing) {
      const delta = (ev.clientY - resizing.y) / getZoom();     // 화면 px → 보드 px
      if (!resizing.began) {
        if (Math.abs(delta) < 4) return;    // 클릭 수준이면 아직 아무것도 만들지 않는다
        store.begin('구간 높이');
        resizing.began = true;
        if (resizing.id == null) {          // 낱개 칸 → 이 칸만 한 칸짜리 구간으로 만든다
          const origin = getOrigin();
          const key = modeKey();
          const fromISO = dateAt(origin, resizing.month.from);
          const toISO = dateAt(origin, resizing.month.to - 1);
          const id = newId('b');
          store.commit('칸 높이', (doc) => {
            clearRange(doc, key, fromISO, toISO);
            doc.bands.push({ id, mode: key, from: fromISO, to: toISO, label: resizing.month.label, scale: 1 });
            sortBands(doc);
          });
          resizing.id = id;
        }
      }
      // 아래로 끌면 늘리고(끄는 만큼, 안전 한도 BAND_SCALE.max) 위로 끌면 줄인다(최소 BAND_SCALE.min)
      const next = Math.min(BAND_SCALE.max, Math.max(BAND_SCALE.min, (resizing.full * resizing.scale0 + delta) / resizing.full));
      store.commit('구간 높이', (doc) => {
        const band = doc.bands.find((b) => b.id === resizing.id);
        if (band) band.scale = Math.round(next * 100) / 100;
      });
      onChange();
      return;
    }
    if (!drag) return;
    const cell = cellAt(document.elementFromPoint(ev.clientX, ev.clientY) ?? document.body);
    if (!cell) return;
    const from = Math.min(drag.from, Number(cell.dataset.from));
    const to = Math.max(drag.to, Number(cell.dataset.to));
    if (from !== drag.from || to !== drag.to) {
      drag.from = from; drag.to = to; drag.moved = true;
      highlight(gutM, from, to);
    }
  });

  gutM.addEventListener('pointerup', async () => {
    if (slotResize) {
      if (slotResize.began) store.end();
      slotResize = null;
      return;
    }
    if (resizing) {
      if (resizing.began) store.end();
      resizing = null;
      return;
    }
    const current = drag;
    drag = null;
    clearHighlight(gutM);
    if (!current?.moved) return;

    const origin = getOrigin();
    const key = modeKey();
    const unit = outer();
    const label = await askText({
      title: '구간 묶기',
      label: `${dateAt(origin, current.from)} — ${dateAt(origin, current.to - 1)}`,
      value: suggestLabel(origin, current.from, current.to, unit),
      confirmLabel: '묶기',
    });
    if (!label) return;

    store.commit('구간 묶기', (doc) => {
      const from = dateAt(origin, current.from);
      const to = dateAt(origin, current.to - 1);
      // 같은 모드에서 겹치는 기존 구간은 치운다
      clearRange(doc, key, from, to);
      doc.bands.push({ id: newId('b'), mode: key, from, to, label, scale: 1 });
      sortBands(doc);
    });
    onChange();
  });

  gutM.addEventListener('pointerleave', () => { if (!slotResize && !resizing && !drag) markEdge(gutM, null); });

  gutM.addEventListener('pointercancel', () => {
    if (slotResize?.began) store.end();
    slotResize = null;
    if (resizing?.began) store.end();
    resizing = null;
    drag = null;
    clearHighlight(gutM);
  });

  // 이름 바꾸기 / 높이 원래대로
  gutM.addEventListener('dblclick', async (ev) => {
    if (slotMode()) {
      // 손잡이(경계)나 칸을 더블클릭하면 그 칸 높이를 원래대로
      const cell = resizeCell(ev) ?? cellAt(ev.target);
      if (!cell || store.meta.display?.slotRows?.[cell.dataset.slot] == null) return;
      store.commit('칸 높이 원복', (doc) => setSlotRow(doc, Number(cell.dataset.slot), null));
      onChange();
      return;
    }
    if (!modeKey()) return;
    const edge = resizeCell(ev);
    const cell = edge ?? cellAt(ev.target);
    const id = cell?.dataset.band;
    if (!id) return;
    if (edge) {
      // 낱개 칸(한 칸 자동 구간)은 통째로 없애 원래 칸으로 되돌리고,
      // 여러 칸을 묶은 구간은 높이만 원래대로(scale=1) 한다.
      const band = store.doc.bands.find((b) => b.id === id);
      const unit = outer();
      store.commit('구간 높이 원복', (doc) => {
        if (isSingleCell(band, unit)) doc.bands = doc.bands.filter((b) => b.id !== id);
        else { const b = doc.bands.find((x) => x.id === id); if (b) b.scale = 1; }
      });
      onChange();
      return;
    }
    const band = store.doc.bands.find((b) => b.id === id);
    if (!band) return;
    const label = await askText({
      title: '구간 이름', label: `${band.from} — ${band.to}`, value: band.label, confirmLabel: '변경',
    });
    if (!label) return;
    store.commit('구간 이름', () => { band.label = label; });
    onChange();
  });

  // 우클릭 메뉴 — 빈 구간(세로축 날짜 칸) 삭제 / 접기, 묶은 구간 해제
  gutM.addEventListener('contextmenu', (ev) => {
    if (slotMode()) {
      const cell = cellAt(ev.target);
      if (!cell) return;
      ev.preventDefault();
      const p = Number(cell.dataset.slot);
      const tl = getTimeline();
      const hasCards = store.items.some((it) => { const q = tl.pos(it); return q && q.s <= p && q.e >= p; });
      const opts = [];
      if (!hasCards) opts.push({ label: '이 칸 접기', action: () => { store.commit('칸 접기', (doc) => setSlotRow(doc, p, BAND_SCALE.fold)); onChange(); } });
      if (store.meta.display?.slotRows?.[p] != null) {
        opts.push({ label: '높이 원래대로', action: () => { store.commit('칸 높이 원복', (doc) => setSlotRow(doc, p, null)); onChange(); } });
      }
      if (opts.length) openCtxMenu(ev.clientX, ev.clientY, opts);
      return;
    }
    if (!modeKey()) return;
    const cell = cellAt(ev.target);
    if (!cell) return;
    ev.preventDefault();
    const id = cell.dataset.band || null;
    const from = Number(cell.dataset.from);
    const to = Number(cell.dataset.to);
    const origin = getOrigin();
    // 이 칸과 겹치는 일정이 있나 / 이 칸부터 아래가 전부 빈 구간인가
    const hasCards = store.items.some((it) => {
      const s = dayIndex(it.s, origin), e = dayIndex(it.e, origin);
      return s < to && e >= from;
    });
    const trailingEmpty = !store.items.some((it) => dayIndex(it.e, origin) >= from);

    const opts = [];
    if (!hasCards) {
      if (trailingEmpty) {
        opts.push({ label: '↥ 이 아래 빈 구간 삭제', action: () => {
          let maxEnd = null;
          for (const it of store.items) { const e = it.e || it.s; if (e && (maxEnd === null || e > maxEnd)) maxEnd = e; }
          if (!maxEnd) return;
          store.commit('빈 구간 삭제', (doc) => { doc.meta.end = maxEnd; });
          onChange();
          toast('빈 구간을 삭제했습니다');
        } });
      }
      opts.push({ label: '이 칸 접기', action: () => collapseMonth(from, to, id) });
    }
    if (id) {
      opts.push({ label: '높이 원래대로', action: () => {
        store.commit('구간 높이 원복', (doc) => { const b = doc.bands.find((x) => x.id === id); if (b) b.scale = 1; });
        onChange();
      } });
      opts.push({ label: '구간 해제', action: () => {
        store.commit('구간 해제', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== id); });
        onChange();
        toast('구간을 해제했습니다');
      } });
    }
    if (opts.length) openCtxMenu(ev.clientX, ev.clientY, opts);
  });

  // 한 칸을 거의 안 보이게 접는다 — 빈 구간을 화면에서 지우는 효과
  function collapseMonth(from, to, id) {
    const origin = getOrigin();
    if (id) {
      store.commit('칸 접기', (doc) => { const b = doc.bands.find((x) => x.id === id); if (b) b.scale = BAND_SCALE.fold; });
    } else {
      const key = modeKey();
      const fromISO = dateAt(origin, from);
      const toISO = dateAt(origin, to - 1);
      const cell = [...gutM.querySelectorAll('b')].find((c) => Number(c.dataset.from) === from);
      store.commit('칸 접기', (doc) => {
        clearRange(doc, key, fromISO, toISO);
        doc.bands.push({ id: newId('b'), mode: key, from: fromISO, to: toISO, label: cell?.dataset.label ?? '', scale: BAND_SCALE.fold });
        sortBands(doc);
      });
    }
    onChange();
  }
}


/**
 * 두 번째 칸(안쪽 칸 — 월-주의 주, 주-일의 날, 분기-월의 달) 행마다 높이. 아래 가장자리 손잡이를 끌면 그 행만 늘고 줄며,
 * 더블클릭하면 원래대로. 배율은 보드 표시 값 display.rowScales[모드][행 시작일] — 모드마다 따로(구간과 같다), 구간 배율과 곱한다.
 * 리스너는 다시 그려지지 않는 두 번째 칸(gutW)에 두고 포인터를 거기 잡아 둔다 — 끄는 중 다시 그려져 손잡이가 바뀌어도 이어진다(규약 14).
 */
export function attachRowEditing(gutW, { store, getScale, getTimeline, getZoom = () => 1, onChange }) {
  let rs = null;
  const modeKey = () => {
    const tl = getTimeline();
    return tl.dated && tl.mode.outer ? tl.mode.key : null;
  };
  const setRow = (doc, key, iso, scale) => {
    const all = { ...(doc.meta.display.rowScales ?? {}) };
    const m = { ...(all[key] ?? {}) };
    if (scale == null || Math.abs(scale - 1) < 0.005) delete m[iso]; else m[iso] = Math.round(scale * 100) / 100;
    if (Object.keys(m).length) all[key] = m; else delete all[key];
    doc.meta.display.rowScales = all;
  };

  const rowAt = (ev) => (ev.target.classList?.contains('band-resize') ? ev.target.closest('b.row') : null)
    ?? edgeCell(gutW, ':scope > b.row', ev.clientY);
  gutW.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;
    const key = modeKey();
    const row = rowAt(ev);
    if (!key || !row) return;
    ev.preventDefault();
    const scale = getScale();
    const from = Number(row.dataset.from), to = Number(row.dataset.to);
    rs = {
      key, iso: row.dataset.row, y: ev.clientY,
      h0: Math.max(1, scale.y(to) - scale.y(from)),             // 지금 보이는 높이(구간 배율까지 탄)
      scale0: Number(store.meta.display?.rowScales?.[key]?.[row.dataset.row]) || 1,
      began: false,
    };
    row.querySelector('.band-resize')?.classList.add('dragging');
    gutW.setPointerCapture(ev.pointerId);
  });

  gutW.addEventListener('pointermove', (ev) => {
    if (!rs) { markEdge(gutW, store.readonly || !modeKey() ? null : rowAt(ev)); return; }
    const delta = (ev.clientY - rs.y) / getZoom();               // 화면 px → 보드 px
    if (!rs.began) {
      if (Math.abs(delta) < 4) return;
      store.begin('행 높이');
      rs.began = true;
    }
    const next = Math.min(BAND_SCALE.max, Math.max(BAND_SCALE.min, rs.scale0 * (rs.h0 + delta) / rs.h0));
    store.commit('행 높이', (doc) => setRow(doc, rs.key, rs.iso, next));
    onChange();
  });

  const end = () => {
    if (rs?.began) store.end();
    rs = null;
  };
  gutW.addEventListener('pointerup', end);
  gutW.addEventListener('pointerleave', () => { if (!rs) markEdge(gutW, null); });
  gutW.addEventListener('pointercancel', end);

  gutW.addEventListener('dblclick', (ev) => {
    const key = modeKey();
    const row = rowAt(ev);
    if (!key || !row || store.readonly || store.meta.display?.rowScales?.[key]?.[row.dataset.row] == null) return;
    store.commit('행 높이 원복', (doc) => setRow(doc, key, row.dataset.row, null));
    onChange();
  });
}

/** 바깥 칸 하나(주·월·분기)에 딱 맞는 구간인가 (드래그로 만든 낱개 칸 높이 조절 구간) */
function isSingleCell(band, unit) {
  if (!band || !unit) return false;
  const s = parseDate(band.from);
  if (unitStart(s, unit).getTime() !== s.getTime()) return false;
  const end = addUnits(s, unit, 1);
  return formatDate(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)) === band.to;
}

/** 끌고 있는 범위를 미리 보여 준다 */
function highlight(gutM, from, to) {
  for (const cell of gutM.querySelectorAll('b')) {
    const f = Number(cell.dataset.from), t = Number(cell.dataset.to);
    cell.classList.toggle('picking', f >= from && t <= to);
  }
}

function clearHighlight(gutM) {
  for (const cell of gutM.querySelectorAll('b')) cell.classList.remove('picking');
}

/** 묶을 이름을 미리 채워 준다 — 월 묶음이 분기·한 해에 딱 맞으면 그 이름 */
function suggestLabel(origin, from, to, unit = 'month') {
  const start = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + from);
  const end = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + to - 1);
  if (unit === 'week') return `${start.getMonth() + 1}.${start.getDate()} – ${end.getMonth() + 1}.${end.getDate()}`;
  if (unit === 'quarter') {
    const q0 = Math.floor(start.getMonth() / 3) + 1;
    const q1 = Math.floor(end.getMonth() / 3) + 1;
    if (start.getFullYear() === end.getFullYear() && q0 === 1 && q1 === 4) return `${start.getFullYear()}년`;
    return start.getFullYear() === end.getFullYear() ? `${start.getFullYear()} ${q0}–${q1}분기`
      : `${start.getFullYear()} ${q0}분기 – ${end.getFullYear()} ${q1}분기`;
  }
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  if (months === 3 && start.getMonth() % 3 === 0) {
    return `${start.getFullYear()} ${Math.floor(start.getMonth() / 3) + 1}Q`;
  }
  if (months === 12 && start.getMonth() === 0) return `${start.getFullYear()}년`;
  return `${start.getMonth() + 1}–${end.getMonth() + 1}월`;
}
