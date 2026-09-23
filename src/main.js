/**
 * 부트스트랩 — 저장소를 고르고, 문서를 읽고, 뷰를 조립한다.
 *
 * 실행 환경 두 가지를 모두 지원한다.
 *   Electron : SQLite 파일 DB (변경 이력 · 파일 반출입 포함)
 *   브라우저 : localStorage (기존 P0 시안 저장분을 그대로 이어받음)
 * 어느 쪽인지는 createAdapter()가 판단하고, 그 아래 코드는 구분하지 않는다.
 */
import { STORAGE_KEY } from './config/index.js';
import { SEED } from './config/seed.js';
import { prepare } from './core/schema.js';
import { createAdapter } from './core/storage.js';
import { Store } from './core/store.js';
import { ViewState } from './core/view.js';
import { $ } from './ui/dom.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { Board } from './ui/board/index.js';
import { initToolbar } from './ui/toolbar.js';
import { renderStatusBar } from './ui/statusbar.js';
import { PanelManager } from './ui/panels/manager.js';
import { ItemPanel } from './ui/panels/item.js';
import { ConfigPanel } from './ui/panels/config.js';
import { DataPanel } from './ui/panels/data.js';

async function boot() {
  initTheme();

  const adapter = createAdapter(STORAGE_KEY);

  // 1) 저장된 문서를 읽고, 없으면 기본 로드맵으로 시작한다
  let raw = null;
  try { raw = await adapter.load(); } catch (err) { console.error(err); }

  let { doc, warnings, error } = prepare(raw ?? SEED);
  if (error) {
    console.warn('저장된 문서를 읽지 못했습니다:', error);
    ({ doc, warnings } = prepare(structuredClone(SEED)));
  }
  const isFirstRun = raw == null;

  const store = new Store({ adapter, doc });
  const view = new ViewState();
  document.documentElement.style.setProperty('--wk', view.weekHeight + 'px');

  store.on('error', (message) => toast(message, 'warn'));

  // 2) 화면 조립
  const panels = new PanelManager(() => {
    view.selectedItem = null;
    view.selectedTrack = null;
    refresh();
  });

  const board = new Board({
    head: $('head'), grid: $('grid'), lines: $('lines'),
    gutM: $('gutM'), gutW: $('gutW'),
    store, view,
    handlers: {
      openItem: (id) => itemPanel.open(id),
      openTrack: (id) => configPanel.open(id),
      addTrack: () => configPanel.add(),
    },
  });

  const itemPanel = new ItemPanel({ store, view, panels });
  const configPanel = new ConfigPanel({ store, view, panels });
  const dataPanel = new DataPanel({
    store, view, panels, adapter,
    onReplaced: () => { rebuild(); configPanel.render(); },
  });

  const toolbar = initToolbar({
    store, view,
    actions: {
      render: () => refresh(),
      rebuild: () => rebuild(),
      redrawArrows: () => board.redrawArrows(),
      openTracks: () => configPanel.open(view.selectedTrack),
      openData: () => dataPanel.open(),
      addItem: () => {
        const origin = new Date(store.meta.start.replace(/-/g, '/'));
        const day = Math.round((new Date().setHours(0, 0, 0, 0) - origin) / 86400000);
        board.createItem(store.tracks[0].id, Math.max(0, day));
      },
    },
  });

  // 3) 렌더 경로. 문서/뷰 변경은 전부 여기로 모인다.
  function refresh() {
    board.render();
    renderStatusBar($('statusBar'), { store, view, onChange: refresh });
    toolbar.sync();
  }

  function rebuild() {
    board.rebuild();
    renderStatusBar($('statusBar'), { store, view, onChange: refresh });
    toolbar.sync();
    dataPanel.syncRange();
  }

  store.on('change', ({ reason }) => {
    // 기간·트랙 구성이 바뀌는 변경은 골격부터 다시 그린다
    if (reason === 'replace' || reason === 'undo' || reason === 'redo') rebuild();
    else refresh();
    if (panels.current === 'pData') $('d-json').value = store.toJSON();
  });
  view.on('change', () => refresh());

  // 4) 전역 키
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '');

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) { if (!store.redo()) toast('다시 실행할 작업이 없습니다'); }
      else if (!store.undo()) toast('되돌릴 작업이 없습니다');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (!store.redo()) toast('다시 실행할 작업이 없습니다');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); $('q').focus(); return;
    }
    if (e.key === 'Escape') { panels.close(); return; }
    if (e.key === 'Delete' && view.selectedItem && !typing) { itemPanel.remove(); }
  });

  addEventListener('resize', () => board.redrawArrows());

  // 5) 첫 화면
  rebuild();
  board.scrollToToday($('scroll'));

  if (isFirstRun) {
    // 기본 로드맵을 저장소에 심는다
    store.commit('기본 로드맵', () => {});
  }
  if (warnings.length) {
    console.warn('문서 보정:', warnings);
    toast(`문서를 보정했습니다 (${warnings.length}건) · 콘솔 참고`, 'warn');
  }

  // 저장 위치 안내
  const note = $('d-storage');
  if (adapter.info) {
    adapter.info()
      .then((i) => { note.textContent = `SQLite에 자동 저장됩니다 · ${i.file}`; })
      .catch(() => { note.textContent = 'SQLite에 자동 저장됩니다.'; });
  } else {
    note.textContent = '이 브라우저에 자동 저장됩니다. 다른 PC로 옮길 때는 JSON을 반출하세요.';
  }

  // 디버깅 편의 (개발자 도구에서 board/store를 바로 만질 수 있게)
  Object.assign(globalThis, { __roadmap: { store, view, board, adapter } });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="padding:24px;font-family:ui-monospace,monospace;white-space:pre-wrap">시작에 실패했습니다.\n\n${err?.stack ?? err}</pre>`;
});
