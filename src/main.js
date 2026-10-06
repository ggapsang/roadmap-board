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

/** 글을 쓰는 입력 칸 — 여기서는 Ctrl+Z/Y가 그 칸의 글자 되돌리기다. 날짜·체크박스·숫자 등은 보드 되돌리기로 넘긴다 */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password']);

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
      openItem: (id) => { view.selectedRel = null; itemPanel.open(id); },
      openTrack: (id) => { view.selectedRel = null; itemPanel.openTrack(id); refresh(); },
      closePanel: () => panels.close(),   // 트랙도 이벤트 — 트랙 편집(보드 설정은 도구 모음 '설정')
      addTrack: () => configPanel.add(),
    },
  });

  const itemPanel = new ItemPanel({
    store, view, panels, adapter,
    openProject: (id) => tabs.openBoard(id),
    // 합치기·되돌리기는 DB 전체를 바꾼다 — 이 보드는 다시 읽고, 다른 탭은 돌아갈 때 다시 읽는다.
    reloadBoard: async () => { tabs.markAllStale(); await tabs.reloadActive(); },
    // 참조 목록에서 그쪽으로 가기 — 그 보드를 열고(이미 이 보드면 그대로) 카드면 열어 보이게, 트랙이면 트랙 편집,
    // 태스크면 그것을 담은 카드, 보드 자체면 보드만
    goToEvent: async (boardId, id) => {
      // 다른 창에 열린 보드면 그 창이 앞으로 나온다(한 보드는 한 창에만) — 여기서는 더 하지 않는다
      if (boardId && boardId !== adapter.projectId && !(await tabs.openBoard(boardId))) return;
      view.selectedRel = null;
      const host = store.items.find((x) => (x.tasks ?? []).some((t) => t.id === id));
      const cardId = store.item(id) ? id : host?.id ?? null;
      if (cardId) { itemPanel.open(cardId); refresh(); board.revealItem(cardId); }
      else if (store.track(id)) { itemPanel.openTrack(id); refresh(); }
      else panels.close();
    },
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

  // 창끼리(데스크톱) — 탭을 끌어 따로 빼기, 다른 창으로 옮기기, 한 보드는 한 창에만
  const bridge = window.roadmapDB?.claimBoard ? {
    claim: async (id) => (await window.roadmapDB.claimBoard(id))?.ok !== false,
    report: (ids) => window.roadmapDB.reportTabs(ids),
    detach: (payload) => window.roadmapDB.detachTab(payload),
  } : null;
  tabs = new BoardTabs({
    mount: $('tabbar'), launcher, graph: graphView, openProject, adoptCached,
    getDoc: () => store.doc,
    boardName: () => store.meta.name,
    win: bridge,
    // 떼어 내기 전 — 쓰던 비고 등을 저장하고 DB에 닿을 때까지(새 창이 그 보드를 읽는다)
    beforeDetach: async () => { document.activeElement?.blur?.(); itemPanel.flushNote(); await store.flush(); },
  });
  window.roadmapDB?.onTabActivate?.((id) => tabs.showBoard(id));
  window.roadmapDB?.onTabAdopt?.((tab) => tabs.adopt(tab));
  // 다른 창의 저장·합치기로 이 창 보드의 화면이 달라졌다 — 다른 탭은 돌아갈 때, 보고 있는 보드는 바로 다시 읽는다
  window.roadmapDB?.onBoardsStale?.(async (ids) => {
    const active = adapter.projectId;
    if (ids == null) tabs.markAllStale(); else tabs.markStale(ids);
    if (active != null && (ids == null || ids.includes(active))) await tabs.reloadActive();
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

  /**
   * 되돌리기·다시 실행 뒤 열린 패널을 문서에 맞춘다. 일정 편집은 그 일정을 다시 채우고(되돌려서 사라졌으면 닫는다),
   * 보드 설정은 다시 그린다. 패널은 열 때 한 번 채우는 구조라 그냥 두면 되돌리기 전 값이 남아 보인다.
   */
  function syncPanelsToDoc() {
    if (panels.current === 'pItem' && itemPanel.mode === 'track') {
      const id = view.selectedTrack;
      if (id && store.track(id)) itemPanel.openTrack(id);
      else panels.close({ force: true });
    } else if (panels.current === 'pItem') {
      const id = view.selectedItem;
      if (id && store.item(id)) itemPanel.open(id);
      else panels.close({ force: true });   // 되돌려서 그 일정이 없어졌다 — 고정해 둔 패널도 닫는다
    } else if (panels.current === 'pTrack') {
      configPanel.render();
    }
  }

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
    // 되돌리기·다시 실행 — 열린 패널의 칸도 되돌린 값으로(패널은 문서를 새로 읽어야 보인다)
    if (['undo', 'redo', 'replace'].includes(reason)) syncPanelsToDoc();
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
    // 입력 칸에 있을 때 — 글을 쓰는 칸(글 입력·textarea·비고 편집기)이면 되돌리기(Ctrl+Z/Y)는 그 칸의 글자만 되돌린다.
    // 날짜·드롭다운·체크박스·숫자·슬라이더는 자기 되돌리기가 없어 Ctrl+Z/Y를 보드 되돌리기로 넘긴다(패널에서 고친 것도
    // 되돌아간다). 카드 삭제(Delete/Backspace)·선택 모드(Ctrl+I/B)는 어느 입력 칸에서든 번지지 않는다.
    const ae = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ae?.tagName ?? '') || !!ae?.isContentEditable;
    const writing = typing && (ae.isContentEditable || ae.tagName === 'TEXTAREA'
      || (ae.tagName === 'INPUT' && TEXT_INPUTS.has((ae.type || 'text').toLowerCase())));
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (writing ? ['z', 'y', 'i', 'b'] : typing ? ['i', 'b'] : []).includes(k)) return;

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
    if (e.key === 'Escape') {
      if (view.selectedRel) { board.selectRel(null); return; }   // 고른 화살표부터 푼다
      panels.close(); return;                                    // 고정 중이면 닫히지 않는다
    }
    // 고른 화살표(선행관계) 지우기 — Delete와 Backspace. 입력 칸에서는 안 먹는다
    if ((e.key === 'Delete' || e.key === 'Backspace') && view.selectedRel && !typing) {
      e.preventDefault();
      board.deleteRel(view.selectedRel);
      return;
    }
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
  // 탭을 끌어 뺀 창 — 그 탭(보드·그래프)을 바로 연다(보드는 메인이 이 창 것으로 옮겨 두었다)
  {
    const q = new URLSearchParams(location.search);
    if (q.get('board')) await tabs.openBoard(Number(q.get('board')), { claimed: true });
    else if (q.get('graph')) await tabs.openGraph({ scope: q.get('graph') === 'all' ? null : Number(q.get('graph')), name: q.get('gname') ?? '' });
  }

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
  // 창을 닫기 전(메인이 요청) — 커서가 있는 칸을 떠나게 해 그 칸의 저장(비고 편집기의 나갈 때 저장 등)을 부르고,
  // 쓰던 비고를 당겨 저장한 뒤 마지막 저장이 DB에 닿을 때까지 기다린다.
  window.roadmapDB?.onFlush?.(async () => {
    document.activeElement?.blur?.();
    itemPanel.flushNote();
    await store.flush();
  });

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
