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
  openProject: (id) => call('project:open', id),
  createProject: (doc, name) => call('project:create', doc, name),
  renameProject: (id, name) => call('project:rename', id, name),
  duplicateProject: (id, name) => call('project:duplicate', id, name),
  deleteProject: (id) => call('project:delete', id),

  // 변경 이력 (기획안 P2)
  revisions: (limit) => call('db:revisions', limit),
  revision: (id) => call('db:revision', id),

  info: () => call('db:info'),

  exportJson: (json, suggested) => call('file:export', json, suggested),
  importJson: () => call('file:import'),
});
