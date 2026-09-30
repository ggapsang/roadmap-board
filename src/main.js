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
import { GraphView } from './ui/graph.js';
import { openHelp } from './ui/help.js';

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

  const itemPanel = new ItemPanel({
    store, view, panels, adapter,
    openProject: (id) => tabs.openBoard(id),
    // 합치기·되돌리기는 DB 전체를 바꾼다 — 이 보드는 다시 읽고, 다른 탭은 돌아갈 때 다시 읽는다.
    reloadBoard: async () => { tabs.markAllStale(); await tabs.reloadActive(); },
  });
  const configPanel = new ConfigPanel({ store, view, panels, adapter });
  const dataPanel = new DataPanel({
    store, view, panels, adapter,
    onReplaced: () => { rebuild(); configPanel.render(); },
  });

  // 그래프 뷰 — 모든 보드의 이벤트·포함·관계(읽기 전용). 보드와 무관한 독립 탭으로 연다.
  const graphView = new GraphView({ adapter, store });
  // 보드의 그래프 = 이 보드가 품은 것 + 한 걸음. 전체 그래프는 첫 화면에서.
  $('btnGraph').addEventListener('click', () => {
    if (tabs.graphActive) return;              // 보드 도구 모음의 버튼 — 그래프 탭에선 보드가 없다
    panels.close();
    tabs.openGraph({ scope: adapter.projectId ?? null, name: store.meta.name ?? '' });
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
    onGraph: () => tabs.openGraph(),
  });

  tabs = new BoardTabs({
    mount: $('tabbar'), launcher, graph: graphView, openProject, adoptCached,
    getDoc: () => store.doc,
    boardName: () => store.meta.name,
  });

  // 저장은 바뀐 것만 쓴다(docs/SAVE.md). 그 저장으로 다른 보드 화면이 달라졌으면 그 탭은 돌아갈 때
  // 다시 읽는다. 순환이라 넣지 못한 포함은 알린다.
  adapter.onStale = (ids) => tabs.markStale(ids);
  adapter.onRejected = (list) => toast(`포함이 순환해서 ${list.length}건은 넣지 않았습니다`, 'warn');

  const toolbar = initToolbar({
    store, view,
    actions: {
      render: () => refresh(),
      rebuild: () => rebuild(),
      redrawArrows: () => board.redrawArrows(),
      openTracks: () => configPanel.open(view.selectedTrack),
      openData: () => dataPanel.open(),
      nudgeFont: (d) => nudgeFont(d),
      exportPng: () => { panels.close(); return atFullSize(() => exportPng(adapter, store)); },
      exportPdf: () => { panels.close(); return atFullSize(() => exportPdf(adapter, store)); },
      openProjects: () => { panels.close(); tabs.newLauncherTab(); },
      toggleTextSelect: () => {
        view.textSelect = !view.textSelect;
        toast(view.textSelect ? '텍스트 선택 모드 — 드래그 이동이 멈춥니다' : '텍스트 선택 모드 해제');
        refresh();
      },
      addItem: () => {
        // 날짜 없는 보드 — 마지막 일정 다음 칸에. 날짜 있는 보드 — 오늘에(정밀도 단위의 처음으로).
        // createItem은 board.origin 기준 일 인덱스를 받는다. 축이 meta 밖으로
        // 늘어났을 수 있으니 meta.start가 아니라 board.origin을 기준으로 잡는다.
        const tl = board.timeline;
        if (!tl.dated) {
          const last = Math.max(-1, ...store.items.map((i) => tl.pos(i)?.e ?? -1));
          board.createItem(store.tracks[0].id, last + 1);
          return;
        }
        const day = Math.round((new Date().setHours(0, 0, 0, 0) - board.origin) / 86400000);
        board.createItem(store.tracks[0].id, tl.snap(Math.max(0, day)));
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
    if (e.key === 'F1') { e.preventDefault(); openHelp(); return; }   // 도움말 — 어느 화면에서든
    // 브라우저처럼 탭 조작 — 런처가 떠 있어도, 입력 중이어도 먼저 받는다.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault(); tabs.newLauncherTab(); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'Tab' || e.code === 'Tab')) {
      e.preventDefault();
      const n = tabs.tabs.length;
      if (n > 1) { const next = (tabs.active + (e.shiftKey ? -1 : 1) + n) % n; tabs.activate(next); }
      return;
    }
    if (launcher.visible) {
      if (e.key === 'Escape' && !$('l-close').hidden) launcher.hide();
      return;
    }
    if (tabs.graphActive) return;        // 그래프 탭 — 보드 단축키(되돌리기·삭제 등)는 뒤의 보드에 가지 않게
    // 글을 쓰는 중 — 입력 칸·비고 편집기(contenteditable). 여기서는 되돌리기(Ctrl+Z/Y)가 그 칸의 글자만 되돌리고,
    // 보드(카드) 되돌리기·카드 삭제(Delete/Backspace)·선택 모드(Ctrl+I)로 번지지 않는다.
    const ae = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName ?? '') || !!ae?.isContentEditable;
    if (typing && (e.ctrlKey || e.metaKey) && ['z', 'y', 'i', 'b'].includes(e.key.toLowerCase())) return;

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

  // ── 보드 확대·축소 (Ctrl+휠) ─────────────────────────────
  // 웹 브라우저처럼 Ctrl+휠 위 = 확대, 아래 = 축소 — 단 **보드만**(트랙 머리·카드·날짜 칸). 도구 모음·패널은 그대로.
  // .cal에 CSS zoom을 건다. 그 안의 좌표는 보드 px 그대로라, 마우스 좌표(화면 px)를 보드 px로 바꾸는 곳만
  // view.boardZoom으로 나눈다(Board·drag·bands). 커서 아래 지점이 제자리에 남도록 스크롤을 맞춘다.
  // 배율은 화면 상태(문서 아님)이고 이 PC에 기억한다.
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const ZOOM_KEY = 'wolfpack:board-zoom';
  function setBoardZoom(next, anchor = null, { quiet = false } = {}) {
    const z0 = view.boardZoom || 1;
    next = Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], Number(next) || 1));
    const cal = document.querySelector('.cal');
    const sc = $('scroll');
    const r = sc.getBoundingClientRect();
    const ax = anchor ? anchor.x - r.left : sc.clientWidth / 2;
    const ay = anchor ? anchor.y - r.top : sc.clientHeight / 2;
    const bx = (sc.scrollLeft + ax) / z0, by = (sc.scrollTop + ay) / z0;
    view.boardZoom = next;
    cal.style.zoom = next === 1 ? '' : String(next);
    board.rebuild();                                  // 칸 폭(fr)이 다시 흐른다 — 걸침 카드 px·화살표를 다시 잰다
    sc.scrollLeft = bx * next - ax;
    sc.scrollTop = by * next - ay;
    try { localStorage.setItem(ZOOM_KEY, String(next)); } catch { /* 이번 실행엔 적용 */ }
    if (!quiet) toast(`보드 ${Math.round(next * 100)}% — Ctrl+휠로 조절 · 보기 › 보드 원래 크기`);
  }
  /** 보드 배율과 무관하게 100%로 그려 놓고 fn(내보내기)을 돌린 뒤 보던 배율로 되돌린다 — 걸침 카드 px를 다시 잰다 */
  async function atFullSize(fn) {
    const z = view.boardZoom || 1;
    if (z === 1) return fn();
    setBoardZoom(1, null, { quiet: true });
    try { return await fn(); } finally { setBoardZoom(z, null, { quiet: true }); }
  }
  const stepBoardZoom = (dir, anchor) => {
    const cur = view.boardZoom || 1;
    const next = dir > 0 ? (ZOOM_STEPS.find((z) => z > cur + 0.001) ?? cur)
      : dir < 0 ? ([...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001) ?? cur) : 1;
    if (next !== cur) setBoardZoom(next, anchor);
  };
  // 트랙패드는 잘게 여러 번 오므로 한 번 움직이면 잠시 쉰다(한 번 굴림 = 한 단계). 휠을 스스로 쓰는 곳(그래프 확대)은
  // 기본 동작을 막으니 건너뛰고, 보드가 안 보일 때(첫 화면·그래프 탭)는 아무것도 안 한다 — 창 배율로 새지 않게 막기만.
  let zoomAt = 0;
  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || e.defaultPrevented) return;
    e.preventDefault();
    if (launcher.visible || tabs?.graphActive) return;
    const now = performance.now();
    if (now - zoomAt < 120 || !e.deltaY) return;
    zoomAt = now;
    stepBoardZoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY });
  }, { passive: false });
  window.roadmapDB?.onBoardZoom?.((dir) => { if (!launcher.visible && !tabs?.graphActive) stepBoardZoom(dir); });
  {
    let saved = 1;
    try { saved = Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch { saved = 1; }
    if (saved !== 1) { view.boardZoom = saved; document.querySelector('.cal').style.zoom = String(saved); }
  }

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
  Object.assign(globalThis, { __roadmap: { store, view, board, adapter, launcher, tabs, openProject, graphView, itemPanel } });
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
