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
import { diffDocs, applyOps, opKeys, withoutPending, docHash } from './ops.js';

export class StorageAdapter {
  get readonly() { return false; }
  /** 변경 이력을 보관하는가 (SQLite만 해당) */
  get hasHistory() { return false; }

  async listProjects() { return []; }
  async listEvents() { return []; }
  async eventCards() { return []; }
  async eventPlaces() { return []; }
  async splitEvent() { return { ok: false, rejected: '지원하지 않습니다.' }; }
  async unsplitEvent() { return { ok: false }; }
  async eventsById() { return []; }
  /** 그래프 뷰 재료 {events, contain, rels} — 저장소에서 그대로. 지원 안 하면 null */
  async graphData() { return null; }
  async eventAncestors(id) { return [id]; }
  /** 휴지통 — 부모를 모두 잃은 이벤트 (docs/SAVE.md §7) */
  get hasTrash() { return false; }
  async listTrash() { return []; }
  async purgeTrash() { return { purged: 0 }; }
  async emptyTrash() { return { purged: 0 }; }
  /** 보드 삭제 전 확인 — 함께 지워질 카드 수 / 다른 곳에도 있어 남는 카드 수 */
  async deletePreview() { return null; }
  /**
   * 저장이 다른 보드 화면을 바꿨을 때(그 보드들을 다시 읽어야 할 때) 부른다 (docs/SAVE.md §6).
   * 저장이 순환이라 넣지 못한 간선이 있을 때는 onRejected.
   */
  onStale = null;
  onRejected = null;
  /** 동일 매핑 — 두 이벤트를 하나로 합친다(§7.2). {ok, rejected?, undo?} */
  async mergeEvents() { return { ok: false, rejected: '지원하지 않습니다.' }; }
  async unmergeEvents() { return { ok: false }; }
  async openProject() { return null; }
  /** 활성 보드만 바꾼다(문서는 안 읽음). 캐시된 탭으로 즉시 전환할 때 저장 대상을 맞춘다. */
  selectProject(id) { this.projectId = id; }
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
  async eventCards(id, opts) { return this.api.eventCards ? this.api.eventCards(id, opts) : []; }
  async eventPlaces(id) { return this.api.eventPlaces ? this.api.eventPlaces(id) : []; }
  async splitEvent(boardId, id) { return this.api.splitEvent ? this.api.splitEvent(boardId, id) : { ok: false, rejected: '지원하지 않습니다.' }; }
  async unsplitEvent(snap) { return this.api.unsplitEvent ? this.api.unsplitEvent(snap) : { ok: false }; }
  async eventsById(ids) { return this.api.eventsById ? this.api.eventsById(ids) : []; }
  async graphData(boardId = null) { return this.api.graphData ? this.api.graphData(boardId) : null; }
  async eventAncestors(id) { return this.api.eventAncestors ? this.api.eventAncestors(id) : [id]; }
  get hasTrash() { return !!this.api.listTrash; }
  async listTrash() { return this.api.listTrash ? this.api.listTrash() : []; }
  async purgeTrash(ids) { return this.api.purgeTrash ? this.api.purgeTrash(ids) : { purged: 0 }; }
  async emptyTrash() { return this.api.emptyTrash ? this.api.emptyTrash() : { purged: 0 }; }
  async deletePreview(id) { return this.api.deletePreview ? this.api.deletePreview(id) : null; }
  async mergeEvents(keepId, dropId) { return this.api.mergeEvents ? this.api.mergeEvents(keepId, dropId) : { ok: false, rejected: '지원하지 않습니다.' }; }
  async unmergeEvents(snapshot) { return this.api.unmergeEvents ? this.api.unmergeEvents(snapshot) : { ok: false }; }

  async openProject(id) {
    const doc = await this.api.openProject(id);
    this.projectId = id;
    return doc;
  }

  /** 활성 보드만 바꾼다 — repo.boardId를 맞춰 이후 save가 이 보드로 가게 한다. 문서는 안 읽음. */
  selectProject(id) {
    this.projectId = id;               // 즉시 (save는 renderer projectId를 안 보지만 일관성 유지)
    this.api.selectProject(id);        // repo.open IPC — 이후 save 이전에 순서대로 도착
  }

  async createProject(doc, name) { return this.api.createProject(doc, name); }
  async renameProject(id, name) { return this.api.renameProject(id, name); }
  async duplicateProject(id, name) { return this.api.duplicateProject(id, name); }
  async reorderProjects(ids) { return this.api.reorderProjects ? this.api.reorderProjects(ids) : undefined; }
  async deleteProject(id) {
    await this.api.deleteProject(id);
    if (this.projectId === id) this.projectId = null;
  }

  async load() { return this.api.load(); }
  async save(doc) {
    const res = await this.api.save(doc, this.lastLabel);
    // 저장은 바뀐 것만 쓴다 — 이 저장으로 화면이 달라진 다른 보드를 알려 준다(탭 캐시를 낡음으로).
    if (res?.affected?.length) this.onStale?.(res.affected);
    if (res?.rejected?.length) this.onRejected?.(res.rejected);
  }

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

// ── 보드 호스팅(docs/SHARE.md) ─────────────────────────────

/** 호스트 창 — 같은 동기화에 IPC로 낀다(호스트는 'host'라는 참가자다) */
export class IpcHostTransport {
  constructor(api, id) { this.api = api.hosting; this.id = id; this.host = true; }
  async hello() { return { cid: 'host', role: 'edit' }; }
  async state() { return this.api.state(this.id); }
  listen(onMsg, onStatus) { this.api.onEvent((id, msg) => { if (id === this.id) onMsg(msg); }); onStatus?.('online'); }
  async send(payload) { return this.api.submit(this.id, payload); }
  presence(sel) { this.api.presence(this.id, { sel }).catch(() => {}); }
}

/** 참가자 브라우저 — HTTP. 호스트 → 화면은 SSE, 화면 → 호스트는 POST. 링크의 토큰을 모든 요청에 싣는다 */
export class HttpTransport {
  constructor(token) { this.token = token; this.cid = null; this.host = false; }
  #url(p) {
    const q = new URLSearchParams();
    if (this.cid) q.set('cid', this.cid);
    if (this.token) q.set('t', this.token);
    return `${p}?${q}`;
  }
  async #post(p, body) {
    const r = await fetch(this.#url(p), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, body: j });
    return j;
  }
  async hello(name, cid) { const r = await this.#post('/api/hello', { name, cid }); this.cid = r.cid; return r; }
  async state() {
    const r = await fetch(this.#url('/api/state'));
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  }
  listen(onMsg, onStatus) {
    this.es?.close();
    const es = new EventSource(this.#url('/api/stream'));
    es.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch { /* 깨진 메시지는 버린다 */ } };
    es.onopen = () => onStatus?.('online');
    // 끊기면 브라우저가 알아서 다시 붙는다. 호스트가 멈췄다 다시 열려 이 참가자를 모르면 거절되어 닫힌다
    es.onerror = () => onStatus?.(es.readyState === EventSource.CLOSED ? 'lost' : 'offline');
    this.es = es;
  }
  async send(payload) { return this.#post('/api/ops', payload); }
  presence(sel) { this.#post('/api/presence', { sel }).catch(() => {}); }
}

/**
 * 호스팅 사본을 고치는 저장소(호스트 창·참가자 브라우저 공통) — docs/SHARE.md §3.
 *   save(doc)   지난번 보낸 문서와의 차이를 변경(op)으로 쪼개 호스트에 보낸다. 보낸 칸은 확정받을 때까지 '내 것'(pending)
 *   받기        호스트가 순서를 붙여 뿌린 변경 — 남의 것은 내 pending 칸을 빼고 적용(내 것이 더 늦게 닿아 결국 남는다),
 *               내 것은 정규화가 고친 것(fix)만 적용. 번호가 빠졌거나 지문이 다르면 문서를 통째로 다시 받는다
 * 화면과의 연결: onApply(ops)·onReset(doc)·onPeople(list)·onRole(role)·onStatus(state) — main.js가 단다.
 * DB 전체를 보거나 바꾸는 것(다른 보드·휴지통·합치기·그래프)은 하지 않는다 — 기본 어댑터의 빈 응답 그대로.
 */
export class HostedAdapter extends StorageAdapter {
  #sending = Promise.resolve();

  constructor(transport, api = null) {
    super();
    this.t = transport;
    this.session = true;
    this.host = !!transport.host;
    this.projectId = null;
    this.role = 'edit';
    this.closed = false;
    this.cid = null;
    this.cseq = 0;
    this.seq = 0;
    this.pending = new Map();      // 칸 이름 → 그 칸을 보낸 cseq
    this.lastSent = null;          // 호스트가 가진 문서에 내가 보낸 것까지 얹은 것(내 화면 기준)
    this.ext = [];
    this.people = [];
    this.hostInfo = {};
    // 호스트 창은 내보내기(PNG·PDF·JSON)를 앱 기능 그대로 쓴다
    if (api) {
      this.exportPng = (clip, suggested) => api.exportPng(clip, suggested);
      this.exportPdf = (size, suggested) => api.exportPdf(size, suggested);
      this.exportJson = (json, suggested) => api.exportJson(json, suggested);
    }
  }

  get readonly() { return this.role !== 'edit' || this.closed; }

  async join(name, cid = null) {
    const h = await this.t.hello(name, cid);
    this.cid = h.cid;
    this.role = h.role ?? 'edit';
    return h;
  }

  async openProject() {
    const st = await this.t.state();
    this.#take(st);
    this.t.listen((m) => this.#onMsg(m), (s) => this.onStatus?.(s));
    return st.doc;
  }

  async listEvents() { return this.ext; }
  async eventsById(ids) { const want = new Set(ids ?? []); return this.ext.filter((e) => want.has(e.id)); }

  #take(st) {
    this.seq = st.seq;
    this.lastSent = JSON.parse(JSON.stringify(st.doc));
    this.pending.clear();
    this.ext = st.ext ?? [];
    this.role = st.role ?? this.role;
    this.people = st.people ?? [];
    this.hostInfo = { name: st.name, port: st.port, urls: st.urls ?? [], host: !!st.host };
  }

  async save(doc) {
    if (this.readonly || !this.lastSent) return undefined;
    const ops = diffDocs(this.lastSent, doc);
    if (!ops.length) return undefined;
    this.lastSent = JSON.parse(JSON.stringify(doc));
    const cseq = (this.cseq += 1);
    for (const k of ops.flatMap(opKeys)) this.pending.set(k, cseq);
    // 한 사람의 변경은 보낸 순서대로 닿아야 한다(나중 것이 이긴다) — 앞의 전송이 끝난 뒤 보낸다
    const run = async () => {
      let r;
      try { r = await this.t.send({ ops, cseq }); } catch (err) { r = { ok: false, error: err.message, resync: true }; }
      if (r?.ok === false) {
        if (r.error === 'readonly') { this.role = 'view'; this.onRole?.('view'); }
        if (r.resync) await this.resync();
      }
    };
    this.#sending = this.#sending.then(run, run);
    return this.#sending;
  }

  #onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ops') {
      if (m.seq !== this.seq + 1) { this.resync(); return; }      // 빠진 변경이 있다 — 통째로 다시
      this.seq = m.seq;
      let apply;
      if (m.cid === this.cid) {
        for (const [k, c] of [...this.pending]) if (c <= (m.cseq ?? 0)) this.pending.delete(k);
        apply = m.fix ?? [];
      } else {
        apply = [...withoutPending(m.ops ?? [], new Set(this.pending.keys())), ...(m.fix ?? [])];
      }
      if (apply.length) applyOps(this.lastSent, apply);
      this.onApply?.(apply, m);
      // 확정 못 받은 것이 없으면 호스트 문서와 같아야 한다 — 다르면 통째로 다시 받는다
      if (!this.pending.size && m.hash && docHash(this.lastSent) !== m.hash) this.resync();
      return;
    }
    if (m.type === 'presence') { this.people = m.people ?? []; this.onPeople?.(this.people); return; }
    if (m.type === 'role') { this.role = m.role; this.onRole?.(m.role); return; }
    if (m.type === 'welcome') { if (m.seq !== this.seq) this.resync(); return; }
    if (m.type === 'kicked') { this.closed = true; this.onStatus?.('kicked', m.reason); return; }
    if (m.type === 'closed') { this.closed = true; this.onStatus?.('closed'); }
  }

  /** 문서를 통째로 다시 받는다 — 번호가 빠졌거나, 지문이 다르거나, 거절당했을 때 */
  async resync() {
    if (this._resyncing) return;
    this._resyncing = true;
    try {
      const st = await this.t.state();
      this.#take(st);
      this.onReset?.(st.doc);
    } catch (err) {
      this.onStatus?.('lost', err?.message);
    } finally { this._resyncing = false; }
  }

  /** 내가 고른 카드 — 다른 사람 화면에 이름 표식으로 */
  presence(sel) { this.t.presence(sel ?? null); }
}

/** 실행 환경에 맞는 어댑터를 고른다. 호스팅 창(?hosting=)·참가자 브라우저(http + 링크 토큰)는 HostedAdapter. */
export function createAdapter(localStorageKey) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  if (typeof window !== 'undefined' && window.roadmapDB?.available) {
    if (q.get('hosting') && window.roadmapDB.hosting) {
      return new HostedAdapter(new IpcHostTransport(window.roadmapDB, Number(q.get('hosting'))), window.roadmapDB);
    }
    return new ElectronAdapter(window.roadmapDB);
  }
  if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && q.get('t')) {
    return new HostedAdapter(new HttpTransport(q.get('t')));
  }
  return new LocalStorageAdapter(localStorageKey);
}
