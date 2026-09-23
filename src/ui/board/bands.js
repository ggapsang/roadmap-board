/**
 * 왼쪽 시간축 칸 묶기.
 *
 * 월 칸을 세로로 끌면 그 범위가 하나로 합쳐지고 이름을 물어본다.
 * 예: 2027년 1~3월을 끌어 "1Q"로. 묶은 칸은 더블클릭해 이름을 바꾸고,
 * 우클릭해 해제한다.
 */
import { dateAt } from '../../core/dates.js';
import { newId } from '../../core/schema.js';
import { askText } from '../dialog.js';
import { toast } from '../toast.js';

export function attachBandEditing(gutM, { store, getOrigin, getScale, onChange }) {
  let drag = null;
  let resizing = null;

  const cellAt = (target) => target.closest('b');

  gutM.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;

    // 아래 가장자리를 잡으면 높이 조절 (묶은 구간만)
    if (ev.target.classList.contains('band-resize')) {
      const cell = cellAt(ev.target);
      const id = cell?.dataset.band;
      if (!id) return;
      ev.preventDefault();
      const band = store.doc.bands.find((b) => b.id === id);
      if (!band) return;
      const days = Number(cell.dataset.to) - Number(cell.dataset.from);
      resizing = {
        id, y: ev.clientY, days,
        full: days * getScale().ppd,
        scale0: band.scale ?? 1,
        began: false,
      };
      ev.target.classList.add('dragging');
      ev.target.setPointerCapture(ev.pointerId);
      return;
    }

    const cell = cellAt(ev.target);
    if (!cell) return;
    drag = { from: Number(cell.dataset.from), to: Number(cell.dataset.to), moved: false };
    gutM.setPointerCapture(ev.pointerId);
  });

  gutM.addEventListener('pointermove', (ev) => {
    if (resizing) {
      const next = Math.min(1, Math.max(0.15,
        (resizing.full * resizing.scale0 + (ev.clientY - resizing.y)) / resizing.full));
      if (!resizing.began) { store.begin('구간 높이'); resizing.began = true; }
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
      for (const el of gutM.querySelectorAll('.band-resize.dragging')) el.classList.remove('dragging');
      if (resizing.began) store.end();
      resizing = null;
      return;
    }
    const current = drag;
    drag = null;
    clearHighlight(gutM);
    if (!current?.moved) return;

    const origin = getOrigin();
    const label = await askText({
      title: '구간 묶기',
      label: `${dateAt(origin, current.from)} — ${dateAt(origin, current.to - 1)}`,
      value: suggestLabel(origin, current.from, current.to),
      confirmLabel: '묶기',
    });
    if (!label) return;

    store.commit('구간 묶기', (doc) => {
      const from = dateAt(origin, current.from);
      const to = dateAt(origin, current.to - 1);
      // 겹치는 기존 구간은 치운다
      doc.bands = doc.bands.filter((b) => b.to < from || b.from > to);
      doc.bands.push({ id: newId('b'), from, to, label, scale: 1 });
      doc.bands.sort((a, b) => a.from.localeCompare(b.from));
    });
    onChange();
  });

  gutM.addEventListener('pointercancel', () => { drag = null; clearHighlight(gutM); });

  // 이름 바꾸기 / 높이 원래대로
  gutM.addEventListener('dblclick', async (ev) => {
    const cell = cellAt(ev.target);
    const id = cell?.dataset.band;
    if (!id) return;
    if (ev.target.classList.contains('band-resize')) {
      store.commit('구간 높이 원복', (doc) => {
        const band = doc.bands.find((b) => b.id === id);
        if (band) band.scale = 1;
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

  // 해제
  gutM.addEventListener('contextmenu', (ev) => {
    const cell = cellAt(ev.target);
    const id = cell?.dataset.band;
    if (!id) return;
    ev.preventDefault();
    store.commit('구간 해제', (doc) => { doc.bands = doc.bands.filter((b) => b.id !== id); });
    onChange();
    toast('구간을 해제했습니다');
  });
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

/** 분기에 딱 맞으면 'N분기'를 미리 채워 준다 */
function suggestLabel(origin, from, to) {
  const start = new Date(origin.getTime() + from * 86400000);
  const end = new Date(origin.getTime() + (to - 1) * 86400000);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  if (months === 3 && start.getMonth() % 3 === 0) {
    return `${start.getFullYear()} ${Math.floor(start.getMonth() / 3) + 1}Q`;
  }
  if (months === 12 && start.getMonth() === 0) return `${start.getFullYear()}년`;
  return `${start.getMonth() + 1}–${end.getMonth() + 1}월`;
}
