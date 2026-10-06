/**
 * preload — 렌더러에 노출하는 유일한 창구.
 * sandbox:true 라서 CommonJS로 작성한다. electron 외 모듈은 쓸 수 없다.
 */
const { contextBridge, ipcRenderer } = require('electron');

/** 메인의 guard()가 {ok, data, error} 를 돌려준다. error면 예외로 바꿔 던진다. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok === false && res.error) throw new Error(res.error);
  return res ? res.data : undefined;
}

contextBridge.exposeInMainWorld('roadmapDB', {
  available: true,

  load: () => call('db:load'),
  save: (doc, label) => call('db:save', doc, label),

  // 프로젝트 — 첫 화면의 목록
  listProjects: () => call('project:list'),
  // 모든 보드를 통틀어 이벤트 목록 — '동일 카드(같은 이벤트)' 연결 후보
  listEvents: () => call('event:list'),
  // 한 이벤트가 품은 카드들 — 상세 탭에서 조합한 이벤트의 안쪽 일정
  eventCards: (id, opts) => call('event:cards', id, opts ?? {}),
  // 이 이벤트가 놓인 보드·자리 — 항등설정 아래 '다른 보드에도 있음'
  eventPlaces: (id) => call('event:places', id),
  // 항등 해제 — 이 보드의 놓임을 새 이벤트로 떼어 낸다(안쪽은 복제, 관계는 보이는 보드별로) · 되돌리기
  splitEvent: (boardId, id) => call('event:split', boardId, id),
  unsplitEvent: (snap) => call('event:unsplit', snap),
  eventsById: (ids) => call('event:get', ids),
  // 그래프 뷰 — 이벤트·포함·관계 전체(읽기 전용)
  graphData: (boardId) => call('graph:data', boardId ?? null),
  // 보기 메뉴의 보드 확대·축소(+1 · -1 · 0 원래대로) — 보드 배율은 렌더러가 정한다
  onBoardZoom: (cb) => ipcRenderer.on('view:board-zoom', (_e, dir) => cb(dir)),
  // 창을 닫기 전 — 쓰던 것(비고 등)을 저장하고 저장이 끝나면 알린다
  onFlush: (cb) => ipcRenderer.on('app:flush', async () => {
    try { await cb(); } catch { /* 저장 실패해도 닫기는 진행 */ }
    ipcRenderer.send('app:flushed');
  }),
  eventAncestors: (id) => call('event:ancestors', id),
  // 휴지통 — 부모를 모두 잃은 이벤트. 영구 삭제·비우기
  listTrash: () => call('trash:list'),
  purgeTrash: (ids) => call('trash:purge', ids),
  emptyTrash: () => call('trash:empty'),
  // 동일 매핑 = 두 이벤트를 하나로 합치기(§7.2). {ok, rejected?, undo?} 반환.
  mergeEvents: (keepId, dropId) => call('event:merge', keepId, dropId),
  unmergeEvents: (snapshot) => call('event:unmerge', snapshot),
  openProject: (id) => call('project:open', id),
  // 활성 보드만 바꾼다(문서는 안 읽음) — 탭을 캐시에서 즉시 전환할 때 저장 대상을 맞춘다
  selectProject: (id) => call('project:select', id),
  createProject: (doc, name) => call('project:create', doc, name),
  renameProject: (id, name) => call('project:rename', id, name),
  duplicateProject: (id, name) => call('project:duplicate', id, name),
  deleteProject: (id) => call('project:delete', id),
  deletePreview: (id) => call('project:deletePreview', id),
  reorderProjects: (ids) => call('project:reorder', ids),

  // 변경 이력 (기획안 P2)
  revisions: (limit) => call('db:revisions', limit),
  revision: (id) => call('db:revision', id),

  info: () => call('db:info'),

  exportPng: (clip, suggested) => call('export:png', clip, suggested),
  exportPdf: (size, suggested) => call('export:pdf', size, suggested),

  exportJson: (json, suggested) => call('file:export', json, suggested),
  importJson: () => call('file:import'),
});
