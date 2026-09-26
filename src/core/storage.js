/**
 * 저장소 어댑터.
 *
 * 보드 하나가 프로젝트 하나다. 어댑터는 프로젝트 목록을 다루고, 그중 하나를
 * 열어 둔 상태에서 load()/save()가 그 프로젝트를 가리킨다.
 *
 * 저장 경로를 여기 한 곳에 가둬 둔 덕분에, 나중에 사내 시스템이나 서버로
 * 옮길 때는 이 인터페이스를 구현한 어댑터를 만들어 createAdapter()에 끼우면 된다.
 * 그 위 코드는 저장 위치를 모른다.
 *
 * 인터페이스
 *   listProjects()              → [{id, name, start, end, items, tracks, updatedAt}]
 *   openProject(id)             → 문서 (마이그레이션 전 원시 형태)
 *   createProject(doc, name)    → 새 id
 *   renameProject(id, name)
 *   duplicateProject(id, name)  → 새 id
 *   deleteProject(id)
 *   load() / save(doc)          → 현재 열린 프로젝트
 */

export class StorageAdapter {
  get readonly() { return false; }
  /** 변경 이력을 보관하는가 (SQLite만 해당) */
  get hasHistory() { return false; }

  async listProjects() { return []; }
  async listEvents() { return []; }
  async openProject() { return null; }
  async createProject() { throw new Error('지원하지 않습니다.'); }
  async renameProject() {}
  async duplicateProject() { throw new Error('지원하지 않습니다.'); }
  async deleteProject() {}

  async load() { return null; }
  async save() {}
}

/**
 * Electron + SQLite. preload가 노출한 window.roadmapDB로 메인 프로세스에 위임한다.
 */
export class ElectronAdapter extends StorageAdapter {
  constructor(api) {
    super();
    this.api = api;
    this.projectId = null;
    this.lastLabel = '';
  }

  async listProjects() { return this.api.listProjects(); }
  async listEvents() { return this.api.listEvents ? this.api.listEvents() : []; }

  async openProject(id) {
    const doc = await this.api.openProject(id);
    this.projectId = id;
    return doc;
  }

  async createProject(doc, name) { return this.api.createProject(doc, name); }
  async renameProject(id, name) { return this.api.renameProject(id, name); }
  async duplicateProject(id, name) { return this.api.duplicateProject(id, name); }
  async deleteProject(id) {
    await this.api.deleteProject(id);
    if (this.projectId === id) this.projectId = null;
  }

  async load() { return this.api.load(); }
  async save(doc) { await this.api.save(doc, this.lastLabel); }

  // ── SQLite에서만 되는 것들 ──────────────────────────────
  get hasHistory() { return true; }
  listRevisions(limit) { return this.api.revisions(limit); }
  getRevision(id) { return this.api.revision(id); }
  info() { return this.api.info(); }
  exportJson(json, suggested) { return this.api.exportJson(json, suggested); }
  exportPng(clip, suggested) { return this.api.exportPng(clip, suggested); }
  exportPdf(size, suggested) { return this.api.exportPdf(size, suggested); }
  importJson() { return this.api.importJson(); }
}

/**
 * 브라우저 localStorage.
 *   {key}:index        프로젝트 목록
 *   {key}:doc:{id}     문서
 *   {key}              P0 시안이 쓰던 단일 문서 — 처음 목록을 읽을 때 프로젝트로 옮긴다
 */
export class LocalStorageAdapter extends StorageAdapter {
  constructor(key) {
    super();
    this.key = key;
    this.projectId = null;
  }

  #read(k, fallback = null) {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }

  #write(k, value) {
    try {
      localStorage.setItem(k, JSON.stringify(value));
    } catch (err) {
      throw new Error('브라우저 저장에 실패했습니다: ' + (err?.name || err));
    }
  }

  #index() {
    const index = this.#read(`${this.key}:index`, null);
    if (index) return index;

    // P0 시안이 남긴 단일 문서를 프로젝트 1번으로 승격시킨다
    const legacy = this.#read(this.key, null);
    const list = [];
    if (legacy && Array.isArray(legacy.items)) {
      this.#write(`${this.key}:doc:1`, legacy);
      list.push(this.#summary(1, legacy.meta?.name || '로드맵', legacy));
    }
    this.#write(`${this.key}:index`, list);
    return list;
  }

  #summary(id, name, doc) {
    return {
      id,
      name,
      start: doc?.meta?.start ?? '',
      end: doc?.meta?.end ?? '',
      items: doc?.items?.length ?? 0,
      tracks: doc?.tracks?.length ?? 0,
      updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
  }

  #saveIndex(list) { this.#write(`${this.key}:index`, list); }

  async listProjects() {
    return [...this.#index()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async openProject(id) {
    this.projectId = id;
    return this.#read(`${this.key}:doc:${id}`, null);
  }

  async createProject(doc, name) {
    const list = this.#index();
    const id = list.reduce((max, p) => Math.max(max, Number(p.id) || 0), 0) + 1;
    const stored = { ...doc, meta: { ...doc.meta, name } };
    this.#write(`${this.key}:doc:${id}`, stored);
    list.push(this.#summary(id, name, stored));
    this.#saveIndex(list);
    return id;
  }

  async renameProject(id, name) {
    const list = this.#index();
    const entry = list.find((p) => p.id === id);
    if (entry) { entry.name = name; this.#saveIndex(list); }
    const doc = this.#read(`${this.key}:doc:${id}`, null);
    if (doc) { doc.meta = { ...doc.meta, name }; this.#write(`${this.key}:doc:${id}`, doc); }
  }

  async duplicateProject(id, name) {
    const doc = this.#read(`${this.key}:doc:${id}`, null);
    if (!doc) throw new Error('복제할 프로젝트를 찾을 수 없습니다.');
    return this.createProject(doc, name);
  }

  async deleteProject(id) {
    try { localStorage.removeItem(`${this.key}:doc:${id}`); } catch { /* noop */ }
    this.#saveIndex(this.#index().filter((p) => p.id !== id));
    if (this.projectId === id) this.projectId = null;
  }

  async load() {
    if (this.projectId == null) return null;
    return this.#read(`${this.key}:doc:${this.projectId}`, null);
  }

  async save(doc) {
    if (this.projectId == null) return;
    this.#write(`${this.key}:doc:${this.projectId}`, doc);
    const list = this.#index();
    const entry = list.find((p) => p.id === this.projectId);
    if (entry) Object.assign(entry, this.#summary(this.projectId, doc.meta?.name ?? entry.name, doc));
    this.#saveIndex(list);
  }
}

/** 저장하지 않는 어댑터. 읽기 전용 공유(P1)나 테스트용. */
export class MemoryAdapter extends StorageAdapter {
  constructor(doc = null, { readonly = false } = {}) {
    super();
    this.doc = doc;
    this._readonly = readonly;
  }
  get readonly() { return this._readonly; }
  async listProjects() { return this.doc ? [{ id: 1, name: this.doc.meta?.name ?? '로드맵', items: this.doc.items?.length ?? 0 }] : []; }
  async openProject() { return this.doc; }
  async load() { return this.doc; }
  async save(doc) { this.doc = doc; }
}

/** 실행 환경에 맞는 어댑터를 고른다. */
export function createAdapter(localStorageKey) {
  if (typeof window !== 'undefined' && window.roadmapDB?.available) {
    return new ElectronAdapter(window.roadmapDB);
  }
  return new LocalStorageAdapter(localStorageKey);
}
