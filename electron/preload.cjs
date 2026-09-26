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
  eventCards: (id) => call('event:cards', id),
  openProject: (id) => call('project:open', id),
  // 활성 보드만 바꾼다(문서는 안 읽음) — 탭을 캐시에서 즉시 전환할 때 저장 대상을 맞춘다
  selectProject: (id) => call('project:select', id),
  createProject: (doc, name) => call('project:create', doc, name),
  renameProject: (id, name) => call('project:rename', id, name),
  duplicateProject: (id, name) => call('project:duplicate', id, name),
  deleteProject: (id) => call('project:delete', id),
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
