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
import { STORAGE_KEY, DISPLAY_LIMITS } from './config/index.js';
import { SEED } from './config/seed.js';
import { prepare } from './core/schema.js';
import { createAdapter } from './core/storage.js';
import { Store } from './core/store.js';
import { ViewState } from './core/view.js';
import { $ } from './ui/dom.js';
import { initTheme } from './ui/theme.js';
import { toast } from './ui/toast.js';
import { exportPng, exportPdf } from './ui/export.js';
import { Launcher } from './ui/launcher.js';
import { BoardTabs } from './ui/tabs.js';
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

  // 보드 탭 — 여러 보드를 오간다. launcher·itemPanel·toolbar가 참조하므로 먼저 선언만.
  let tabs;

  // ── 화면 조립 ───────────────────────────────────────────

  const panels = new PanelManager(
    () => {
      view.selectedItem = null;
      view.selectedTrack = null;
      refresh();
    },
    // 패널이 열리고 닫히면 본문 폭이 바뀐다 — 컬럼이 함께 좁아지므로 전체를 다시 그려
    // 여러 트랙에 걸친 카드(px로 잡는다)와 화살표 좌표를 새 폭에 맞춘다.
    () => board.render(),
  );

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

  const itemPanel = new ItemPanel({ store, view, panels, adapter, openProject: (id) => tabs.openBoard(id) });
  const configPanel = new ConfigPanel({ store, view, panels });
  const dataPanel = new DataPanel({
    store, view, panels, adapter,
    onReplaced: () => { rebuild(); configPanel.render(); },
  });

  const launcher = new Launcher({
    adapter,
    onOpen: (id) => tabs.openBoard(id),
    // 열려 있는 프로젝트의 이름이 바뀌면 화면의 문서도 맞춰 저장하고, 탭 이름도 갱신한다.
    // 그러지 않으면 다음 저장 때 store의 옛 meta.name이 DB를 덮어쓴다.
    onRenamed: (id, name) => {
      if (adapter.projectId === id) store.commit('이름 변경', (doc) => { doc.meta.name = name; });
      tabs.renameBoard(id, name);
    },
    onDeleted: (id) => tabs.boardClosed(id),
  });

  tabs = new BoardTabs({
    mount: $('tabbar'), launcher, openProject, adoptCached,
    getDoc: () => store.doc,
    boardName: () => store.meta.name,
  });

  const toolbar = initToolbar({
    store, view,
    actions: {
      render: () => refresh(),
      rebuild: () => rebuild(),
      redrawArrows: () => board.redrawArrows(),
      openTracks: () => configPanel.open(view.selectedTrack),
      openData: () => dataPanel.open(),
      nudgeFont: (d) => nudgeFont(d),
      exportPng: () => { panels.close(); return exportPng(adapter, store); },
      exportPdf: () => { panels.close(); return exportPdf(adapter, store); },
      openProjects: () => { panels.close(); tabs.newLauncherTab(); },
      toggleTextSelect: () => {
        view.textSelect = !view.textSelect;
        toast(view.textSelect ? '텍스트 선택 모드 — 드래그 이동이 멈춥니다' : '텍스트 선택 모드 해제');
        refresh();
      },
      addItem: () => {
        // createItem은 board.origin 기준 일 인덱스를 받는다. 축이 meta 밖으로
        // 늘어났을 수 있으니 meta.start가 아니라 board.origin을 기준으로 잡는다.
        const day = Math.round((new Date().setHours(0, 0, 0, 0) - board.origin) / 86400000);
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
    tabs?.syncActiveName();   // 보드 이름이 바뀌었으면 탭 이름도 맞춘다
    // 실시간 반영 — 같은 이벤트(다중 소속·동일 관계)를 열려 있는 다른 탭에도 즉시 퍼뜨린다.
    if (reason !== 'adopt') tabs?.syncFromActive();
    if (panels.current === 'pData') $('d-json').value = store.toJSON();
  });
  view.on('change', () => refresh());

  // ── 프로젝트 열기 ───────────────────────────────────────

  /** adopt 뒤 화면 상태를 초기화하고 스크롤을 오늘로. (DB 접근 없음) */
  function applyOpenedDoc(doc) {
    store.adopt(doc);
    view.selectedItem = null;
    view.selectedTrack = null;
    view.focus = null;                 // 새 프로젝트를 열면 펼침(드릴다운) 초기화
    view.orgFilter.clear();
    view.query = '';
    $('q').value = '';
    panels.close();
    board.scrollToToday($('scroll'));
    updateStorageNote();
  }

  /** DB에서 읽어 연다. 반환한 doc은 탭 캐시가 들고 있으면서 다시 열 때 즉시 쓴다. */
  async function openProject(id) {
    const loading = $('boardLoading');
    if (loading) loading.hidden = false;      // 빈 보드 대신 로딩 표시
    try {
      const raw = await adapter.openProject(id);
      const { doc, warnings, error } = prepare(raw ?? emptyDoc());
      if (error) throw new Error(error);

      applyOpenedDoc(doc);

      // 문서 마이그레이션 결과를 저장소에 반영해 둔다
      if ((raw?.version ?? 0) !== doc.version) store.commit('스키마 갱신', () => {});
      if (warnings.length) {
        console.warn('문서 보정:', warnings);
        toast(`문서를 보정했습니다 (${warnings.length}건) · 콘솔 참고`, 'warn');
      }
      return store.doc;   // adopt 후의 실제 문서(참조) — 탭 캐시가 이걸 들고 있는다
    } finally {
      if (loading) loading.hidden = true;
    }
  }

  /** 이미 메모리에 있는 문서로 즉시 전환 — DB를 다시 읽지 않는다(리로드 없음). */
  function adoptCached(doc, id) {
    adapter.selectProject(id);   // 저장 대상을 이 보드로 (안 하면 이후 저장이 엉뚱한 보드로 간다)
    applyOpenedDoc(doc);
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      view.textSelect = !view.textSelect;
      toast(view.textSelect ? '텍스트 선택 모드 — 드래그 이동이 멈춥니다' : '텍스트 선택 모드 해제');
      refresh();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); $('q').focus(); return;
    }
    // 글자 크기 — Ctrl +/- (= 키와 텐키 +/- 모두 받는다)
    if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_'].includes(e.key)) {
      e.preventDefault();
      nudgeFont(e.key === '-' || e.key === '_' ? -0.1 : +0.1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') {
      e.preventDefault(); setFont(1); return;
    }
    if (e.key === 'Escape') { panels.close(); return; }   // 고정 중이면 닫히지 않는다
    // 선택한 카드 삭제 — Delete와 Backspace(노트북·맥의 ⌫) 둘 다. 입력 칸에서는 안 먹는다.
    if ((e.key === 'Delete' || e.key === 'Backspace') && view.selectedItem && !typing) {
      e.preventDefault();
      itemPanel.remove();
    }
  });

  function setFont(scale) {
    const lim = DISPLAY_LIMITS.fontScale;
    const next = Math.round(Math.min(lim.max, Math.max(lim.min, scale)) * 100) / 100;
    if (next === store.meta.display.fontScale) return;
    store.commit('글자 크기', (doc) => { doc.meta.display.fontScale = next; });
    configPanel.render();
    toast(`글자 크기 ${Math.round(next * 100)}%`);
  }
  const nudgeFont = (delta) => setFont((store.meta.display?.fontScale ?? 1) + delta);

  // 걸치는 카드는 실제 컬럼 너비로 px를 잡으므로 창 크기가 바뀌면 다시 그려야 한다
  let resizeTimer = null;
  addEventListener('resize', () => {
    board.redrawArrows();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => refresh(), 120);
  });

  // ── 첫 화면 ─────────────────────────────────────────────

  // 예시(기본) 로드맵을 목록에 한 번 넣어 둔다 — 실제로 쓰는 일정이라 처음부터
  // 사용자가 만든 프로젝트와 함께 보이게 한다. 이름이 이미 있으면 다시 만들지 않는다.
  // (스모크 테스트 DB에는 넣지 않는다 — 결정적인 목록을 전제로 하기 때문)
  if (adapter.createProject && adapter.listProjects) {
    try {
      const info = adapter.info ? await adapter.info().catch(() => null) : null;
      const isSmoke = !!info?.file && /wolfpack-smoke/.test(info.file);
      const existing = await adapter.listProjects();
      if (!isSmoke && !existing.some((p) => p.name === SEED.meta.name)) {
        const { doc: seedDoc } = prepare(structuredClone(SEED));
        if (seedDoc) await adapter.createProject(seedDoc, SEED.meta.name);
      }
    } catch { /* 목록/생성 실패는 조용히 무시 — 앱 실행은 계속 */ }
  }

  tabs.init();

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
  Object.assign(globalThis, { __roadmap: { store, view, board, adapter, launcher, tabs, openProject } });
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
