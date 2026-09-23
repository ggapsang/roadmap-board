/** 트랙 헤더 (sticky). 컬럼 폭은 레인 수에 비례해 확장된다. */
import { el, clear, button, ICONS } from '../dom.js';

/**
 * @param {HTMLElement} head
 * @param {object} ctx {tracks, items, selectedTrack, template, onSelect, onAddTrack}
 */
export function renderHead(head, { tracks, items, selectedTrack, template, onSelect, onAddTrack, onResize }) {
  head.style.gridTemplateColumns = template;
  clear(head);
  head.append(el('div.cnr'), el('div.cnr'));

  const counts = new Map();
  for (const it of items) counts.set(it.t, (counts.get(it.t) ?? 0) + 1);

  for (const track of tracks) {
    const cell = el('div.th', {
      dataset: { t: track.id },
      tabIndex: 0,
      className: track.id === selectedTrack ? 'th active' : 'th',
      on: {
        click: () => onSelect(track.id),
        keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(track.id); } },
      },
    }, [
      el('span.lab', { text: track.lab || ' ' }),
      el('span.nm', { text: track.name }),
      el('span.cnt', { text: String(counts.get(track.id) ?? 0) }),
    ]);

    // 너비 조절 손잡이 — 트랙 이름이 길거나 일정이 많을 때 넓혀 쓴다
    if (onResize) {
      cell.append(el('div.th-resize', {
        title: '끌어서 트랙 너비 조절 · 더블클릭하면 자동',
        on: {
          pointerdown: (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onResize.start(track.id, ev, cell.getBoundingClientRect().width);
          },
          dblclick: (ev) => { ev.stopPropagation(); onResize.reset(track.id); },
          click: (ev) => ev.stopPropagation(),
        },
      }));
    }
    head.append(cell);
  }

  head.append(el('div.addcol', {}, [
    button({ className: 'btn icon', iconPath: ICONS.plus, title: '트랙 추가', onClick: onAddTrack }),
  ]));
}
