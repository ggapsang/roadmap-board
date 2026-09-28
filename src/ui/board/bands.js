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
import { el } from '../dom.js';
import { askText } from '../dialog.js';
import { openCtxMenu } from '../ctxmenu.js';
import { toast } from '../toast.js';

export function attachBandEditing(gutM, { store, getOrigin, getScale, getTimeline, onChange }) {
  let drag = null;
  let resizing = null;

  const cellAt = (target) => target.closest('b');
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

  gutM.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;
    if (!modeKey()) return;

    // 아래 가장자리를 잡으면 높이 조절. 묶은 구간이든 낱개 칸이든 된다 —
    // 낱개 칸은 그 칸만 한 칸짜리 구간으로 만들어 스케일을 건다(병합 없이 축소/확대).
    if (ev.target.classList.contains('band-resize')) {
      const cell = cellAt(ev.target);
      if (!cell) return;
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
    if (resizing) {
      const delta = ev.clientY - resizing.y;
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
      // 아래로 끌면 늘리고(최대 3배) 위로 끌면 줄인다(최소 0.15배)
      const next = Math.min(3, Math.max(0.15, (resizing.full * resizing.scale0 + delta) / resizing.full));
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

  gutM.addEventListener('pointercancel', () => {
    if (resizing?.began) store.end();
    resizing = null;
    drag = null;
    clearHighlight(gutM);
  });

  // 이름 바꾸기 / 높이 원래대로
  gutM.addEventListener('dblclick', async (ev) => {
    if (!modeKey()) return;
    const cell = cellAt(ev.target);
    const id = cell?.dataset.band;
    if (!id) return;
    if (ev.target.classList.contains('band-resize')) {
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
      store.commit('칸 접기', (doc) => { const b = doc.bands.find((x) => x.id === id); if (b) b.scale = 0.02; });
    } else {
      const key = modeKey();
      const fromISO = dateAt(origin, from);
      const toISO = dateAt(origin, to - 1);
      const cell = [...gutM.querySelectorAll('b')].find((c) => Number(c.dataset.from) === from);
      store.commit('칸 접기', (doc) => {
        clearRange(doc, key, fromISO, toISO);
        doc.bands.push({ id: newId('b'), mode: key, from: fromISO, to: toISO, label: cell?.dataset.label ?? '', scale: 0.02 });
        sortBands(doc);
      });
    }
    onChange();
  }
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
