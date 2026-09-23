/**
 * 부트스트랩.
 *
 * 첫 화면은 프로젝트 목록이다. 보드 하나가 프로젝트 하나이고, 어느 것을 열지
 * 고른 뒤에야 보드가 그려진다. 프로젝트를 바꿔도 Store/Board를 새로 만들지 않고
 * 문서만 갈아끼운다 (store.adopt) — 화면 상태와 이벤트 연결이 그대로 유지된다.
 *
 * 실행 환경 두 가지를 모두 지원한다.
 *   Electron : SQLite 파일 DB (변경 이력 · 파일 반출입 포함)
 *   브라우저 : localStorage
 * 어느 쪽인지는 createAdapter()가 판단하고, 그 아래 코드는 구분하지 않는다.
 */
import { STORAGE_KEY } from './config/index.js';
import { prepare } from './core/schema.js';
import { createAdapter } from './core/storage.js';
import { Store } from './core/store.js';
import { ViewState } from './core/view.js';
import { $ } from './ui/dom.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { Launcher } from './ui/launcher.js';
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
  const view = new ViewState();
  document.documentElement.style.setProperty('--wk', view.weekHeight + 'px');

  // 문서는 프로젝트를 열 때 채워진다. 그 전까지는 빈 껍데기.
  const store = new Store({ adapter, doc: emptyDoc() });
  store.on('error', (message) => toast(message, 'warn'));

  // ── 화면 조립 ───────────────────────────────────────────

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

  const launcher = new Launcher({ adapter, onOpen: openProject });

  const toolbar = initToolbar({
    store, view,
    actions: {
      render: () => refresh(),
      rebuild: () => rebuild(),
      redrawArrows: () => board.redrawArrows(),
      openTracks: () => configPanel.open(view.selectedTrack),
      openData: () => dataPanel.open(),
      openProjects: () => { panels.close(); launcher.show({ closable: true }); },
      addItem: () => {
        const origin = new Date(store.meta.start.replace(/-/g, '/'));
        const day = Math.round((new Date().setHours(0, 0, 0, 0) - origin) / 86400000);
        board.createItem(store.tracks[0].id, Math.max(0, day));
      },
    },
  });

  // ── 렌더 경로 ───────────────────────────────────────────

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
    // 기간·트랙 구성이 통째로 바뀌는 변경은 골격부터 다시 그린다
    if (['replace', 'undo', 'redo', 'adopt'].includes(reason)) rebuild();
    else refresh();
    if (panels.current === 'pData') $('d-json').value = store.toJSON();
  });
  view.on('change', () => refresh());

  // ── 프로젝트 열기 ───────────────────────────────────────

  async function openProject(id) {
    const raw = await adapter.openProject(id);
    const { doc, warnings, error } = prepare(raw ?? emptyDoc());
    if (error) throw new Error(error);

    store.adopt(doc);
    view.selectedItem = null;
    view.selectedTrack = null;
    view.orgFilter.clear();
    view.query = '';
    $('q').value = '';

    panels.close();
    board.scrollToToday($('scroll'));

    // 문서 마이그레이션 결과를 저장소에 반영해 둔다
    if ((raw?.version ?? 0) !== doc.version) store.commit('스키마 갱신', () => {});
    if (warnings.length) {
      console.warn('문서 보정:', warnings);
      toast(`문서를 보정했습니다 (${warnings.length}건) · 콘솔 참고`, 'warn');
    }
    updateStorageNote();
  }

  // ── 전역 키 ─────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (launcher.visible) {
      if (e.key === 'Escape' && !$('l-close').hidden) launcher.hide();
      return;
    }
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
    if (e.key === 'Delete' && view.selectedItem && !typing) itemPanel.remove();
  });

  addEventListener('resize', () => board.redrawArrows());

  // ── 첫 화면 ─────────────────────────────────────────────

  await launcher.show({ closable: false });

  const foot = $('l-foot');
  if (adapter.info) {
    adapter.info().then((i) => { foot.textContent = `SQLite · ${i.file}`; }).catch(() => {});
  } else {
    foot.textContent = '이 브라우저에 저장됩니다. 다른 PC로 옮길 때는 데이터 패널에서 JSON을 반출하세요.';
  }

  function updateStorageNote() {
    const note = $('d-storage');
    if (adapter.info) {
      adapter.info()
        .then((i) => { note.textContent = `SQLite에 자동 저장됩니다 · ${i.file}`; })
        .catch(() => { note.textContent = 'SQLite에 자동 저장됩니다.'; });
    } else {
      note.textContent = '이 브라우저에 자동 저장됩니다. 다른 PC로 옮길 때는 JSON을 반출하세요.';
    }
  }

  // 개발자 도구에서 바로 만질 수 있게
  Object.assign(globalThis, { __roadmap: { store, view, board, adapter, launcher, openProject } });
}

/** 프로젝트를 열기 전의 빈 문서 */
function emptyDoc() {
  const y = new Date().getFullYear();
  return {
    meta: { start: `${y}-01-01`, end: `${y}-12-31`, name: '' },
    orgs: [], tracks: [{ id: 't0', lab: '', name: '트랙 1' }], items: [],
  };
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML =
    `<pre style="padding:24px;font-family:ui-monospace,monospace;white-space:pre-wrap">시작에 실패했습니다.\n\n${err?.stack ?? err}</pre>`;
});
