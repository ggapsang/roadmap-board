/** 트랙 헤더 (sticky). 컬럼 폭은 레인 수에 비례해 확장된다. */
import { el, clear, button, ICONS } from '../dom.js';

/**
 * @param {HTMLElement} head
 * @param {object} ctx {tracks, items, selectedTrack, template, onSelect, onAddTrack, dateLabel}
 *   dateLabel(track) — 머리 위쪽에 쓸 트랙 기간(없으면 '')
 *   hidden  숨긴 트랙 id(Set) — 칸은 0 폭으로 남기고(트랙 순서 = 칸 순서), 그 경계에 펼치기 화살표(구글 스프레드시트의 숨긴 열)
 *   picked  고른 트랙 id(Set, Ctrl·Shift+클릭) — 우클릭 숨기기·함께 끌기
 *   onSelect(id, ev) · onContext(id, ev) · onUnhide(ids)
 */
export function renderHead(head, {
  tracks, selectedTrack, template, onSelect, onAddTrack, onResize, onReorder, dateLabel,
  hidden = new Set(), picked = new Set(), onContext, onUnhide,
}) {
  head.style.gridTemplateColumns = template;
  clear(head);
  head.append(el('div.cnr'), el('div.cnr'));

  const shownBefore = (i) => tracks.slice(0, i).some((t) => !hidden.has(t.id));
  const shownAfter = (i) => tracks.slice(i + 1).some((t) => !hidden.has(t.id));

  tracks.forEach((track, i) => {
    // 숨긴 트랙 — 폭 0의 자리만. 이어 숨긴 트랙들의 첫 자리에 펼치기 화살표 한 쌍(누르면 그 묶음을 다시 보인다)
    if (hidden.has(track.id)) {
      const cell = el('div.th.th-hidden', { dataset: { t: track.id }, attrs: { 'aria-hidden': 'true' } });
      if (i === 0 || !hidden.has(tracks[i - 1].id)) {
        const group = [];
        for (let k = i; k < tracks.length && hidden.has(tracks[k].id); k += 1) group.push(tracks[k].id);
        const names = group.map((id) => {
          const t = tracks.find((x) => x.id === id);
          return t?.alias || t?.name || '트랙';
        }).join(', ');
        const title = `숨긴 트랙 ${group.length}개 보이기 — ${names}`;
        const arrow = (dir) => el(`button.unhide.unhide-${dir}`, {
          type: 'button', title,
          on: {
            pointerdown: (e) => e.stopPropagation(),
            click: (e) => { e.stopPropagation(); onUnhide?.(group); },
          },
        });
        // 앞에 보이는 트랙이 있으면 왼쪽(◀) — 그 트랙 오른쪽 끝에, 뒤에 있으면 오른쪽(▶) — 다음 트랙 왼쪽 끝에
        const wrap = el('div.unhide-pair', {}, [
          shownBefore(i) ? arrow('left') : null,
          shownAfter(i + group.length - 1) ? arrow('right') : null,
        ]);
        cell.append(wrap);
      }
      head.append(cell);
      return;
    }

    const dates = dateLabel?.(track) ?? '';
    const cls = ['th'];
    if (track.id === selectedTrack) cls.push('active');
    if (picked.has(track.id)) cls.push('picked');
    const cell = el('div.th', {
      dataset: track.fill ? { t: track.id, fill: track.fill } : { t: track.id },
      title: track.alias ? `${track.alias} (${track.name})` : undefined,
      tabIndex: 0,
      className: cls.join(' '),
      on: {
        // 헤더를 옆으로 끌면 트랙 순서 변경. 살짝 누르면 클릭(트랙 패널). Ctrl·Shift를 누르고 누르면 고르기만(끌지 않는다)
        // 너비 손잡이(.th-resize)는 자기 pointerdown에서 전파를 끊어 여기 안 온다.
        pointerdown: (ev) => {
          if (ev.button === 0 && onReorder && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) onReorder.start(track.id, ev);
        },
        click: (ev) => onSelect(track.id, ev),
        contextmenu: (ev) => { if (onContext) { ev.preventDefault(); onContext(track.id, ev); } },
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(track.id, e); } },
      },
    }, [
      dates ? el('span.th-dates', { text: dates }) : null,
      el('span.lab', { text: track.lab || ' ' }),
      // 별칭이 있으면 이 보드에선 별칭으로(제목은 툴팁)
      el('span.nm', { text: track.alias || track.name }),
    ]);

    // 너비 조절 손잡이 — 트랙 이름이 길거나 일정이 많을 때 넓혀 쓴다
    if (onResize) {
      cell.append(el('div.th-resize', {
        title: '끌어서 트랙 너비 조절 · 더블클릭하면 자동',
        on: {
          pointerdown: (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();
            onResize.start(track.id, ev);
          },
          dblclick: (ev) => { ev.stopPropagation(); onResize.reset(track.id); },
          click: (ev) => ev.stopPropagation(),
        },
      }));
    }
    head.append(cell);
  });

  head.append(el('div.addcol', {}, [
    button({ className: 'btn icon', iconPath: ICONS.plus, title: '트랙 추가', onClick: onAddTrack }),
  ]));
}
