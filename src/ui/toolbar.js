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

  // 글자 크기 — 구성 패널 안에만 두니 찾지 못한다는 이야기가 있어 툴바로 올렸다
  $('fontDown').addEventListener('click', () => actions.nudgeFont(-0.1));
  $('fontUp').addEventListener('click', () => actions.nudgeFont(+0.1));

  $('btnProjects').addEventListener('click', () => actions.openProjects());
  $('btnSelect').addEventListener('click', () => actions.toggleTextSelect());
  $('btnTracks').addEventListener('click', () => actions.openTracks());
  $('btnData').addEventListener('click', () => actions.openData());
  $('btnAdd').addEventListener('click', () => actions.addItem());
  // 내보내기 메뉴
  const menu = $('exportMenu');
  const closeMenu = () => { menu.hidden = true; $('btnExport').setAttribute('aria-expanded', 'false'); };
  $('btnExport').addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('btnExport').setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  $('ex-png').addEventListener('click', () => { closeMenu(); actions.exportPng(); });
  $('ex-pdf').addEventListener('click', () => { closeMenu(); actions.exportPdf(); });
  $('ex-print').addEventListener('click', () => { closeMenu(); window.print(); });
  $('btnTheme').addEventListener('click', () => { toggleTheme(); actions.redrawArrows(); });

  $('btnUndo').addEventListener('click', () => {
    if (!store.undo()) toast('되돌릴 작업이 없습니다');
  });
  $('btnRedo').addEventListener('click', () => {
    if (!store.redo()) toast('다시 실행할 작업이 없습니다');
  });

  return {
    sync() {
      $('btnSelect').setAttribute('aria-pressed', String(view.textSelect));
      document.body.classList.toggle('select-text', view.textSelect);
      $('btnUndo').disabled = !store.canUndo;
      $('btnRedo').disabled = !store.canRedo;
      const period = `${store.meta.start.replace(/-/g, '.')} — ${store.meta.end.replace(/-/g, '.')}`;
      $('rangeLabel').textContent = store.meta.name ? `${store.meta.name} · ${period}` : period;
    },
  };
}
