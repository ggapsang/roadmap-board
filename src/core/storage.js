/**
 * 저장소 어댑터.
 *
 * P0는 localStorage 한 곳이지만, 기획안 §7 P1에서 "서버 저장(문서 1건)"으로
 * 옮겨간다. 그때 이 인터페이스를 구현한 RemoteAdapter를 만들어 main.js에서
 * 주입하는 것으로 끝나도록 저장 경로를 여기 한 곳에 가둬 둔다.
 *
 * 인터페이스
 *   load()      → Promise<object|null>   저장된 원시 문서 (마이그레이션 전)
 *   save(doc)   → Promise<void>
 *   clear()     → Promise<void>
 *   readonly    → boolean                 true면 UI가 편집을 잠근다
 */

export class StorageAdapter {
  get readonly() { return false; }
  /** 변경 이력을 보관하는가 (SQLite만 해당) */
  get hasHistory() { return false; }
  async load() { return null; }
  async save() {}
  async clear() {}
}

/** 브라우저 localStorage. 키는 P0 시안과 동일하게 유지한다. */
export class LocalStorageAdapter extends StorageAdapter {
  constructor(key) {
    super();
    this.key = key;
  }

  async load() {
    let raw = null;
    try { raw = localStorage.getItem(this.key); } catch { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async save(doc) {
    try {
      localStorage.setItem(this.key, JSON.stringify(doc));
    } catch (err) {
      // 용량 초과 등. 조용히 삼키면 사용자가 날린 걸 모른다.
      throw new Error('브라우저 저장에 실패했습니다: ' + (err?.name || err));
    }
  }

  async clear() {
    try { localStorage.removeItem(this.key); } catch { /* noop */ }
  }
}

/** 저장하지 않는 어댑터. 읽기 전용 공유 링크(P1)나 테스트용. */
export class MemoryAdapter extends StorageAdapter {
  constructor(doc = null, { readonly = false } = {}) {
    super();
    this.doc = doc;
    this._readonly = readonly;
  }
  get readonly() { return this._readonly; }
  async load() { return this.doc; }
  async save(doc) { this.doc = doc; }
  async clear() { this.doc = null; }
}

/**
 * Electron + SQLite. preload가 노출한 window.roadmapDB로 메인 프로세스에 위임한다.
 * 브라우저에서 열면 window.roadmapDB가 없으므로 LocalStorageAdapter로 떨어진다.
 */
export class ElectronAdapter extends StorageAdapter {
  constructor(api) {
    super();
    this.api = api;
    this.lastLabel = '';
  }

  async load() {
    return this.api.load();
  }

  async save(doc) {
    await this.api.save(doc, this.lastLabel);
  }

  async clear() {
    await this.api.clear();
  }

  // ── SQLite에서만 되는 것들 ──────────────────────────────
  get hasHistory() { return true; }
  listRevisions(limit) { return this.api.revisions(limit); }
  getRevision(id) { return this.api.revision(id); }
  info() { return this.api.info(); }
  exportJson(json, suggested) { return this.api.exportJson(json, suggested); }
  importJson() { return this.api.importJson(); }
}

/** 실행 환경에 맞는 어댑터를 고른다. */
export function createAdapter(localStorageKey) {
  if (typeof window !== 'undefined' && window.roadmapDB?.available) {
    return new ElectronAdapter(window.roadmapDB);
  }
  return new LocalStorageAdapter(localStorageKey);
}
