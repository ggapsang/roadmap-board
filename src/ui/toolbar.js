/** 툴바 — 검색, 확대 배율, 패널 열기, 되돌리기/다시실행, 테마, 인쇄. */
import { ZOOM_LEVELS } from '../config/index.js';
import { $, el, clear } from './dom.js';
import { toggleTheme } from './theme.js';
import { toast } from './toast.js';

export function initToolbar({ store, view, actions }) {
  // 확대 배율
  const seg = $('zoom');
  clear(seg);
  for (const level of ZOOM_LEVELS) {
    seg.append(el('button', {
      type: 'button',
      text: level.label,
      dataset: { zoom: String(level.weekHeight) },
      attrs: { 'aria-pressed': String(level.weekHeight === view.weekHeight) },
      on: {
        click: () => {
          for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.zoom === String(level.weekHeight)));
          document.documentElement.style.setProperty('--wk', level.weekHeight + 'px');
          view.weekHeight = level.weekHeight;
          actions.rebuild();
        },
      },
    }));
  }

  $('q').addEventListener('input', (e) => {
    view.query = e.target.value.trim().toLowerCase();
    actions.render();
  });

  $('btnTracks').addEventListener('click', () => actions.openTracks());
  $('btnData').addEventListener('click', () => actions.openData());
  $('btnAdd').addEventListener('click', () => actions.addItem());
  $('btnPrint').addEventListener('click', () => window.print());
  $('btnTheme').addEventListener('click', () => { toggleTheme(); actions.redrawArrows(); });

  $('btnUndo').addEventListener('click', () => {
    if (!store.undo()) toast('되돌릴 작업이 없습니다');
  });
  $('btnRedo').addEventListener('click', () => {
    if (!store.redo()) toast('다시 실행할 작업이 없습니다');
  });

  return {
    sync() {
      $('btnUndo').disabled = !store.canUndo;
      $('btnRedo').disabled = !store.canRedo;
      $('rangeLabel').textContent =
        `${store.meta.start.replace(/-/g, '.')} — ${store.meta.end.replace(/-/g, '.')}`;
    },
  };
}
