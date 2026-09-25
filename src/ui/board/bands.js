/**
 * 왼쪽 시간축 칸 묶기.
 *
 * 월 칸을 세로로 끌면 그 범위가 하나로 합쳐지고 이름을 물어본다.
 * 예: 2027년 1~3월을 끌어 "1Q"로. 묶은 칸은 더블클릭해 이름을 바꾸고,
 * 우클릭해 해제한다.
 */
import { dateAt, parseDate, dayIndex } from '../../core/dates.js';
import { newId } from '../../core/schema.js';
import { el } from '../dom.js';
import { askText } from '../dialog.js';
import { toast } from '../toast.js';

export function attachBandEditing(gutM, { store, getOrigin, getScale, onChange }) {
  let drag = null;
  let resizing = null;

  const cellAt = (target) => target.closest('b');

  gutM.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;

    // 아래 가장자리를 잡으면 높이 조절. 묶은 구간이든 낱개 월이든 된다 —
    // 낱개 월은 그 달만 1개월짜리 구간으로 만들어 스케일을 건다(병합 없이 축소/확대).
    if (ev.target.classList.contains('band-resize')) {
      const cell = cellAt(ev.target);
      if (!cell) return;
      ev.preventDefault();
      const from = Number(cell.dataset.from);
      const to = Number(cell.dataset.to);
      const id = cell.dataset.band || null;
      const band = id ? store.doc.bands.find((b) => b.id === id) : null;
      resizing = {
        id,                                 // null이면 낱개 월 — 움직일 때 구간을 만든다
        month: id ? null : { from, to },
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
        if (resizing.id == null) {          // 낱개 월 → 이 달만 1개월 구간으로 만든다
          const origin = getOrigin();
          const fromISO = dateAt(origin, resizing.month.from);
          const toISO = dateAt(origin, resizing.month.to - 1);
          const id = newId('b');
          store.commit('월 높이', (doc) => {
            doc.bands = doc.bands.filter((b) => b.to < fromISO || b.from > toISO);
            doc.bands.push({ id, from: fromISO, to: toISO, label: `${Number(fromISO.slice(5, 7))}월`, scale: 1 });
            doc.bands.sort((a, b) => a.from.localeCompare(b.from));
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

  gutM.addEventListener('pointercancel', () => {
    if (resizing?.began) store.end();
    resizing = null;
    drag = null;
    clearHighlight(gutM);
  });

  // 이름 바꾸기 / 높이 원래대로
  gutM.addEventListener('dblclick', async (ev) => {
    const cell = cellAt(ev.target);
    const id = cell?.dataset.band;
    if (!id) return;
    if (ev.target.classList.contains('band-resize')) {
      // 낱개 월(1개월 자동 구간)은 통째로 없애 원래 월 칸으로 되돌리고,
      // 여러 달을 묶은 구간은 높이만 원래대로(scale=1) 한다.
      const band = store.doc.bands.find((b) => b.id === id);
      store.commit('구간 높이 원복', (doc) => {
        if (isSingleMonth(band)) doc.bands = doc.bands.filter((b) => b.id !== id);
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

  // 한 칸(월)을 거의 안 보이게 접는다 — 빈 구간을 화면에서 지우는 효과
  function collapseMonth(from, to, id) {
    const origin = getOrigin();
    if (id) {
      store.commit('칸 접기', (doc) => { const b = doc.bands.find((x) => x.id === id); if (b) b.scale = 0.02; });
    } else {
      const fromISO = dateAt(origin, from);
      const toISO = dateAt(origin, to - 1);
      store.commit('칸 접기', (doc) => {
        doc.bands = doc.bands.filter((b) => b.to < fromISO || b.from > toISO);
        doc.bands.push({ id: newId('b'), from: fromISO, to: toISO, label: `${Number(fromISO.slice(5, 7))}월`, scale: 0.02 });
        doc.bands.sort((a, b) => a.from.localeCompare(b.from));
      });
    }
    onChange();
  }
}

/** 커서 위치에 뜨는 작은 우클릭 메뉴. 바깥을 누르면 닫힌다. */
function openCtxMenu(x, y, options) {
  document.querySelector('.ctx-menu')?.remove();
  const menu = el('div.ctx-menu', { style: { left: `${x}px`, top: `${y}px` } });
  const onDoc = (e) => {
    if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); }
  };
  for (const opt of options) {
    menu.append(el('button', {
      text: opt.label,
      on: { click: () => { menu.remove(); document.removeEventListener('pointerdown', onDoc, true); opt.action(); } },
    }));
  }
  document.body.append(menu);
  // 화면 밖으로 나가면 안쪽으로 당긴다
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, x - r.width)}px`;
  if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, y - r.height)}px`;
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
}

/** 한 캘린더 달에 딱 맞는 구간인가 (드래그로 만든 낱개 월 높이 조절 구간) */
function isSingleMonth(band) {
  if (!band) return false;
  const s = parseDate(band.from);
  const e = parseDate(band.to);
  const lastDay = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate();
  return s.getDate() === 1 && s.getFullYear() === e.getFullYear()
    && s.getMonth() === e.getMonth() && e.getDate() === lastDay;
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
