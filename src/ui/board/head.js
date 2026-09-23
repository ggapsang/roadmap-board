/** 트랙 헤더 (sticky). 컬럼 폭은 레인 수에 비례해 확장된다. */
import { el, clear, button, ICONS } from '../dom.js';

/**
 * @param {HTMLElement} head
 * @param {object} ctx {tracks, items, selectedTrack, template, onSelect, onAddTrack}
 */
export function renderHead(head, { tracks, items, selectedTrack, template, onSelect, onAddTrack }) {
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
    head.append(cell);
  }

  head.append(el('div.addcol', {}, [
    button({ className: 'btn icon', iconPath: ICONS.plus, title: '트랙 추가', onClick: onAddTrack }),
  ]));
}
