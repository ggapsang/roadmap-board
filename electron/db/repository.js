/**
 * 문서 저장소 — 렌더러 문서({meta, tracks, items, relations, compose})와
 * 4대상 테이블(event·containment·disp·rel) 사이를 오간다.
 *
 * 규칙 3장: 모든 단위는 event, 담김은 containment 하나, 표시는 disp(어느 포함 간선 위인가),
 * 이음은 rel(보드 무관). 포함은 세 종류다 (019, docs/SAVE.md §5):
 *   ordered=1 compose=0  순서 있는 포함 — 트랙 위 카드, 하위 카드
 *   ordered=0 compose=0  순서 없는 포함 — 태스크
 *   ordered=0 compose=1  구성(조합) — 보드 → 트랙, 이벤트 → 조합 대상
 *
 * 보드는 저장 대상이 아니라 '펼친 이벤트'다. 보드 문서는 전역 그래프를 그 보드에서 본 투영이고,
 * **저장은 그 투영이 바뀐 만큼만 적용한다**(docs/SAVE.md) — 기준(그 문서가 나온 상태의 투영)과
 * 비교해 보드가 실제로 고친 것만 쓴다. 다른 보드가 그사이 바꾼 것, 이 보드가 안 본 것은 건드리지 않는다.
 */
import { reidentify } from '../../src/core/schema.js';
import { TRASH_GRACE_MIN } from '../../src/config/index.js';

/** 리비전을 남기는 최소 간격(분). 타이핑 한 글자마다 스냅샷이 쌓이는 걸 막는다. */
const REVISION_INTERVAL_MIN = 5;
/** 보관할 리비전 수 */
const REVISION_KEEP = 200;

const SEP = '\u0001';
const key = (parent, child) => parent + SEP + child;

/** 이벤트 본질 컬럼 — 동적 UPDATE는 이 목록 안에서만 만든다 */
const ESSENCE = ['title', 'start_date', 'end_date', 'type', 'status', 'org', 'progress', 'note'];
const INSERT_DEFAULTS = { title: '', type: 'bar', status: 'plan', org: '', progress: 0, note: '' };
const DISP_COLS = ['pos_x', 'pos_w', 'height_days', 'align', 'show_note', 'alias', 'lab', 'px_width', 'fill', 'slot_start', 'slot_len'];

/** 빈 투영 — 새 보드의 기준 */
const emptyProjection = () => ({
  events: new Map(), edges: new Map(), disp: new Map(), rels: new Map(), parents: new Set(),
});

const dispRow = (parent, child, v = {}) => ({
  parent_id: parent, child_id: child,
  pos_x: v.pos_x ?? null, pos_w: v.pos_w ?? null, height_days: v.height_days ?? null,
  align: v.align ?? 'middle', show_note: v.show_note ?? 0, alias: v.alias ?? null,
  lab: v.lab ?? null, px_width: v.px_width ?? null, fill: v.fill ?? null,
  slot_start: v.slot_start ?? null, slot_len: v.slot_len ?? null,
});

export class BoardRepository {
  /** 보드별 기준 투영 — 렌더러 문서가 나온 상태. 렌더러가 열 때(openView)·저장할 때 정한다. */
  #base = new Map();
  /** 이번 실행 중 만든 이벤트 → 만든 시각(ms). '방금 만든 것' 판단용 — 메모리에만 둔다. */
  #created = new Map();
  /** 합치기로 없앤 id → 남은 id. 낡은 문서가 저장돼도 없앤 이벤트를 되살리지 않는다(§7.2 사라지는 id). */
  #merged = new Map();

  /**
   * @param {import('better-sqlite3').Database} db
   * @param {number|null} boardId 다룰 보드. open()으로 바꾼다.
   */
  constructor(db, boardId = null) {
    this.db = db;
    this.boardId = boardId;
  }

  open(boardId) { this.boardId = boardId; }

  // ── 포함 그래프 헬퍼 ────────────────────────────────────

  /** 포함 간선 전부. 보드 루트를 자식으로 담는 간선은 무시한다 — 보드는 최상위다(옛 오염은 019가 걷었다). */
  #edges() {
    return this.db.prepare(
      "SELECT parent_id, child_id, ordered, compose, ord FROM containment WHERE child_id NOT LIKE 'board:%'",
    ).all();
  }

  /** parent -> [간선] (ord 오름차순) */
  #childMap(edges = this.#edges()) {
    const kids = new Map();
    for (const c of edges) {
      if (!kids.has(c.parent_id)) kids.set(c.parent_id, []);
      kids.get(c.parent_id).push(c);
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.ord - b.ord);
    return kids;
  }

  #liveRoots() {
    return new Set(this.db.prepare('SELECT root_event_id r FROM board WHERE root_event_id IS NOT NULL').all().map((x) => x.r));
  }

  /**
   * 한 보드 화면에 놓이는 것 — 루트의 구성(트랙), 트랙·카드의 순서 있는 포함(카드·하위 카드),
   * 카드의 순서 없는 포함(태스크). 카드·트랙의 조합 대상은 화면에 그리지 않으므로 넣지 않는다.
   */
  #view(root, kids) {
    const tracks = (kids.get(root) ?? []).filter((c) => c.compose === 1);
    const trackIds = new Set(tracks.map((c) => c.child_id));
    const cards = new Set();
    const tasks = new Set();
    const stack = [...trackIds];
    while (stack.length) {
      const n = stack.pop();
      for (const c of (kids.get(n) ?? [])) {
        if (c.compose === 1) continue;
        if (c.ordered === 1) {
          if (!cards.has(c.child_id) && !trackIds.has(c.child_id)) { cards.add(c.child_id); stack.push(c.child_id); }
        } else if (cards.has(n)) {
          tasks.add(c.child_id);
        }
      }
    }
    return { tracks, trackIds, cards, tasks };
  }

  /** from에서 포함(모든 종류)을 따라 to에 닿는가 — 간선을 더하기 전 순환 검사 */
  #reaches(from, to) {
    if (from === to) return true;
    const q = this.db.prepare('SELECT child_id FROM containment WHERE parent_id = ?');
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const n = stack.pop();
      for (const { child_id: c } of q.all(n)) {
        if (c === to) return true;
        if (!seen.has(c)) { seen.add(c); stack.push(c); }
      }
    }
    return false;
  }

  /**
   * seeds와, 그 안에 든 것 중 **부모가 모두 이 집합 안인 것**(accept를 통과한 것)을 모은다.
   * 다른 곳에도 담긴 이벤트는 들어가지 않는다 — 삭제가 공유 이벤트를 건드리지 않게 하는 경계.
   */
  #closure(seeds, accept = () => true) {
    const kids = new Map();
    const parents = new Map();
    for (const e of this.db.prepare('SELECT parent_id, child_id FROM containment').all()) {
      if (!kids.has(e.parent_id)) kids.set(e.parent_id, []);
      kids.get(e.parent_id).push(e.child_id);
      if (!parents.has(e.child_id)) parents.set(e.child_id, []);
      parents.get(e.child_id).push(e.parent_id);
    }
    const out = new Set(seeds);
    const stack = [...seeds];
    while (stack.length) {
      const n = stack.pop();
      for (const c of (kids.get(n) ?? [])) {
        if (out.has(c) || !accept(c)) continue;
        if ((parents.get(c) ?? []).every((p) => out.has(p))) { out.add(c); stack.push(c); }
      }
    }
    return out;
  }

  /** 이벤트 영구 삭제 (SYSTEM.md '이벤트 삭제') — 이벤트와 연결된 포함·배치·관계를 전부 지운다. */
  #purge(ids) {
    const q = [
      this.db.prepare('DELETE FROM containment WHERE parent_id = ? OR child_id = ?'),
      this.db.prepare('DELETE FROM disp WHERE parent_id = ? OR child_id = ?'),
      this.db.prepare('DELETE FROM rel WHERE from_id = ? OR to_id = ?'),
    ];
    const delEvent = this.db.prepare('DELETE FROM event WHERE id = ?');
    for (const id of ids) {
      for (const s of q) s.run(id, id);
      delEvent.run(id);
      this.#created.delete(id);
    }
  }

  #isFresh(id) {
    const t = this.#created.get(id);
    return t != null && Date.now() - t <= TRASH_GRACE_MIN * 60000;
  }

  // ── 프로젝트(보드) 목록 ─────────────────────────────────

  /** 최근 연 순서. 목록 화면용이라 문서 본문은 싣지 않는다. */
  listProjects() {
    const boards = this.db.prepare(`
      SELECT b.id, b.name, b.start_date AS start, b.end_date AS end,
             b.updated_at AS updatedAt, b.opened_at AS openedAt, b.ord AS ord,
             b.root_event_id AS root, b.meta_json AS metaJson
      FROM board b
      ORDER BY COALESCE(b.opened_at, b.updated_at) DESC, b.id DESC
    `).all();
    const kids = this.#childMap();
    return boards.map((b) => {
      const v = b.root ? this.#view(b.root, kids) : null;
      const { root, metaJson, ...rest } = b;
      // 눈금 모드 — 첫 화면이 날짜 없는 보드에 기간 대신 '눈금 없음'을 쓰도록
      let display = null;
      try { display = metaJson ? JSON.parse(metaJson).display : null; } catch { display = null; }
      return {
        ...rest, dated: display?.dated !== false, scale: display?.scale ?? 'month-week',
        tracks: v ? v.tracks.length : 0, items: v ? v.cards.size : 0,
      };
    });
  }

  /** 수동 정렬 순서 저장 — 첫 화면 드래그 재배치. orderedIds 순서대로 ord를 매긴다. */
  reorderProjects(orderedIds) {
    const set = this.db.prepare('UPDATE board SET ord = ? WHERE id = ?');
    this.db.transaction(() => {
      orderedIds.forEach((id, i) => set.run(i, id));
    })();
  }

  /**
   * 모든 보드를 통틀어 이벤트 목록 — 조합·합치기 후보용. 보드(루트)·트랙·카드를 모두 이벤트로 내고,
   * 각 이벤트가 어느 보드 화면에 놓였는지도 싣는다.
   * @returns {{id, title, kind, boardIds, boardNames, s, e, ty, st, og, pg, note}[]}
   */
  listEvents() {
    const boardRows = this.db.prepare(
      'SELECT id, name, root_event_id FROM board WHERE root_event_id IS NOT NULL',
    ).all();
    const kids = this.#childMap();
    const rootIds = new Set(boardRows.map((b) => b.root_event_id));

    const trackIds = new Set();
    const member = new Map();       // 이벤트 -> 어느 보드들 화면에 놓였나
    const note = (ev, b) => {
      if (!member.has(ev)) member.set(ev, { ids: new Set(), names: new Set() });
      member.get(ev).ids.add(b.id);
      member.get(ev).names.add(b.name);
    };
    const cardIds = new Set();
    for (const b of boardRows) {
      const v = this.#view(b.root_event_id, kids);
      for (const t of v.trackIds) { trackIds.add(t); note(t, b); }
      for (const c of v.cards) { cardIds.add(c); note(c, b); }
      for (const t of v.tasks) note(t, b);
    }

    // 본질은 한 번에 모아 읽는다(이벤트마다 쿼리하지 않는다 — 카드 열 때마다 호출되므로 속도).
    const essById = this.#essence([...rootIds, ...member.keys()]);
    const memNames = (ev) => [...(member.get(ev)?.names ?? [])].join(',');
    const memIds = (ev) => [...(member.get(ev)?.ids ?? [])].join(',');

    const boards = boardRows.map((b) => {
      const e = essById.get(b.root_event_id) ?? { id: b.root_event_id, title: b.name };
      return { ...e, boardNames: b.name, boardIds: String(b.id), boardId: b.id, kind: 'board' };
    });
    const tracks = [...trackIds].map((ev) => {
      const e = essById.get(ev);
      return e ? { ...e, boardNames: memNames(ev), boardIds: memIds(ev), kind: 'track' } : null;
    }).filter(Boolean);
    // 카드인가 태스크인가는 **놓인 모습**(순서 있는/없는 포함)으로 가른다 — event.type('task')이 아니다(승격한 태스크는
    // type이 'task'로 남아도 카드다). 어느 보드에서든 카드로 놓였으면 카드, 태스크로만 놓였으면 태스크.
    const cards = [];
    for (const ev of member.keys()) {
      if (rootIds.has(ev) || trackIds.has(ev)) continue;
      const e = essById.get(ev);
      if (!e) continue;
      cards.push({ ...e, boardNames: memNames(ev), boardIds: memIds(ev), kind: cardIds.has(ev) ? 'card' : 'task' });
    }
    return [...boards, ...tracks, ...cards];
  }

  /** id -> 본질(목록용 모양) */
  #essence(ids) {
    const out = new Map();
    const list = [...new Set(ids)];
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const ph = chunk.map(() => '?').join(',');
      for (const e of this.db.prepare(
        `SELECT id, title, type AS ty, start_date AS s, end_date AS e,
                status AS st, org AS og, progress AS pg, note FROM event WHERE id IN (${ph})`,
      ).all(...chunk)) out.set(e.id, e);
    }
    return out;
  }

  /**
   * 그래프 뷰 재료 — 이벤트·포함·관계를 저장소에서 **그대로** 읽는다(G-02: 사본·별도 스키마 없음).
   * 모든 이벤트(보드 화면 밖·휴지통 포함)가 노드다. 정렬은 id순 — 같은 데이터면 같은 배치(G-22).
   * 읽기만 한다(G-01).
   */
  graphData(boardId = null) {
    // 보드에서 연 그래프는 그 보드의 루트(펼친 이벤트)에서 출발한다 — 범위는 렌더러가 자른다(core/graph.js scopeGraph).
    const root = boardId == null ? null
      : this.db.prepare('SELECT root_event_id AS r FROM board WHERE id = ?').get(boardId)?.r ?? null;
    return {
      root,
      events: this.db.prepare('SELECT id, title, status FROM event ORDER BY id').all(),
      contain: this.db.prepare("SELECT parent_id, child_id, ordered, compose FROM containment WHERE child_id NOT LIKE 'board:%' ORDER BY parent_id, child_id").all(),
      rels: this.db.prepare('SELECT id, type, from_id, to_id FROM rel ORDER BY id').all(),
    };
  }

  /** 이벤트 몇 개의 본질 — 조합 대상처럼 어느 보드 화면에도 없는 것의 이름을 보여 줄 때. */
  eventsById(ids) {
    return [...this.#essence(Array.isArray(ids) ? ids : []).values()];
  }

  /** 이 이벤트의 조상(모든 종류의 포함) + 자기 자신 — 조합 대상에서 빼야 순환이 안 생긴다. */
  ancestorsOf(id) {
    const q = this.db.prepare('SELECT parent_id FROM containment WHERE child_id = ?');
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const n = stack.pop();
      for (const { parent_id: p } of q.all(n)) if (!out.has(p)) { out.add(p); stack.push(p); }
    }
    return [...out];
  }

  /**
   * 한 이벤트가 품은 카드들(순서 있는 후손, 태스크 제외). 조합 대상의 안쪽 일정을 '상세' 탭에
   * 펼쳐 보여 주거나, 고르기 트리에서 트랙 아래 카드를 펼칠 때 쓴다.
   * @returns {{id, title, status, depth}[]}
   */
  eventCards(eventId, { withTasks = false } = {}) {
    const kids = this.#childMap();
    const out = [];
    const seen = new Set();
    const walk = (id, depth) => {
      for (const c of (kids.get(id) ?? [])) {
        if (c.compose === 1 || seen.has(c.child_id)) continue;
        if (c.ordered !== 1) {                                  // 순서 없는 포함 = 태스크 — 원할 때만, 그 안으로는 안 들어간다
          if (withTasks && id !== eventId) { seen.add(c.child_id); out.push({ id: c.child_id, depth, task: true }); }
          continue;
        }
        seen.add(c.child_id);
        out.push({ id: c.child_id, depth });
        walk(c.child_id, depth + 1);
      }
    };
    walk(eventId, 0);
    if (!out.length) return [];
    const ess = this.#essence(out.map((o) => o.id));
    // 카드인지는 순서 있는 포함으로 정했다 — event.type('task')로 거르지 않는다(승격한 태스크도 카드다)
    return out.map((o) => ({ id: o.id, depth: o.depth, title: ess.get(o.id)?.title ?? '', status: ess.get(o.id)?.st ?? 'plan',
      type: ess.get(o.id)?.ty ?? 'bar', kind: o.task ? 'task' : 'card' }));
  }

  /**
   * 새 보드를 만들고 문서를 채운다. DB에 이미 있는 이벤트 id는 새 id로 바꿔 넣는다 — 예시 로드맵의
   * e1… 같은 id가 다른 보드 이벤트를 덮어쓰거나 몰래 공유하지 않게 (docs/SAVE.md §8).
   * @returns {number} 새 보드 id
   */
  createProject(doc, name) {
    const exists = this.db.prepare('SELECT 1 FROM event WHERE id = ?');
    const copy = structuredClone(doc);
    reidentify(copy, { only: (id) => !!exists.get(id) });
    const create = this.db.transaction(() => {
      const info = this.db.prepare(`
        INSERT INTO board (name, start_date, end_date, doc_version, opened_at)
        VALUES (?, ?, ?, ?, datetime('now','localtime'))
      `).run(name, copy.meta.start, copy.meta.end, copy.version ?? 1);

      const id = Number(info.lastInsertRowid);
      const previous = this.boardId;
      const freshBefore = new Set(this.#created.keys());
      this.boardId = id;
      this.#base.set(id, emptyProjection());     // 새 보드 — 기준은 비어 있다(전부 추가)
      try {
        this.save({ ...copy, meta: { ...copy.meta, name } }, '새 프로젝트');
      } finally {
        this.boardId = previous;
        this.#base.delete(id);                   // 렌더러가 열 때 다시 정한다
        // 새 보드에 담겨 온 이벤트는 '방금 만든 것'이 아니다 — 지우면 휴지통으로 가야 한다.
        for (const k of [...this.#created.keys()]) if (!freshBefore.has(k)) this.#created.delete(k);
      }
      return id;
    });
    return create();
  }

  /** 삭제 전 확인용 — 이 보드에만 담겨 함께 지워질 카드 수와, 다른 곳에도 담겨 남는 카드 수. */
  deletePreview(id) {
    const b = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(id);
    if (!b?.root_event_id) return { items: 0, shared: 0 };
    const v = this.#view(b.root_event_id, this.#childMap());
    const doomed = this.#closure(new Set([b.root_event_id]));
    let items = 0; let shared = 0;
    for (const c of v.cards) { if (doomed.has(c)) items += 1; else shared += 1; }
    return { items, shared };
  }

  /**
   * 보드 삭제 (docs/SAVE.md §7). 그 보드에만 담긴 이벤트는 지운다(확인 창이 명시 요청이다).
   * 다른 보드에도 놓이거나 다른 이벤트가 조합으로 품은 이벤트는 **남기고 안쪽 구조도 그대로** —
   * 지우는 보드 쪽 간선만 끊는다.
   */
  deleteProject(id) {
    const del = this.db.transaction(() => {
      const b = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(id);
      if (b?.root_event_id) this.#purge(this.#closure(new Set([b.root_event_id])));
      this.db.prepare('DELETE FROM org  WHERE board_id = ?').run(id);
      this.db.prepare('DELETE FROM band WHERE board_id = ?').run(id);
      this.db.prepare('DELETE FROM board WHERE id = ?').run(id);
    });
    del();
    this.#base.delete(id);
    if (this.boardId === id) this.boardId = null;
  }

  renameProject(id, name) {
    const b = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(id);
    this.db.prepare(
      "UPDATE board SET name = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    ).run(name, id);
    // 보드 이름 = 루트 이벤트 제목 (규칙 6·§5.1) — 함께 바꾼다.
    if (b?.root_event_id) this.db.prepare('UPDATE event SET title = ? WHERE id = ?').run(name, b.root_event_id);
  }

  // ── 휴지통 — 부모를 모두 잃은 이벤트 (docs/SAVE.md §7) ─────────────

  /**
   * 휴지통 = 부모가 하나도 없고 살아 있는 보드 루트도 아닌 이벤트. 안에 든 것(함께 지워질 것) 수를 싣는다.
   * @returns {{id, title, type, s, e, st, inside}[]}
   */
  listTrash() {
    const roots = this.#liveRoots();
    const rows = this.db.prepare(`
      SELECT e.id, e.title, e.type, e.start_date AS s, e.end_date AS e, e.status AS st FROM event e
      WHERE NOT EXISTS (SELECT 1 FROM containment c WHERE c.child_id = e.id)
    `).all().filter((r) => !roots.has(r.id));
    return rows
      .map((r) => ({ ...r, inside: this.#closure(new Set([r.id])).size - 1 }))
      .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko') || a.id.localeCompare(b.id));
  }

  /** 휴지통의 이벤트를 영구 삭제 — 그 이벤트와 그 안에만 든 것. 휴지통에 없는 id는 무시한다. */
  purgeTrash(ids) {
    const inTrash = new Set(this.listTrash().map((r) => r.id));
    const seeds = new Set((Array.isArray(ids) ? ids : []).filter((id) => inTrash.has(id)));
    if (!seeds.size) return { purged: 0 };
    let n = 0;
    this.db.transaction(() => {
      const doomed = this.#closure(seeds);
      this.#purge(doomed);
      n = doomed.size;
    })();
    return { purged: n };
  }

  /** 휴지통 비우기 — 전부 영구 삭제 */
  emptyTrash() {
    return this.purgeTrash(this.listTrash().map((r) => r.id));
  }

  // ── 동일 매핑 = 두 이벤트를 하나로 합치는 작업 (docs/SYSTEM.md §7.2) ──────────

  /** id를 지나는 포함 순환이 있나 — 합치기로 바뀐 간선은 모두 keep을 지나므로 그것만 본다. */
  #containmentCycleThrough(id) {
    const q = this.db.prepare('SELECT child_id FROM containment WHERE parent_id = ?');
    const seen = new Set();
    const stack = q.all(id).map((r) => r.child_id);
    while (stack.length) {
      const n = stack.pop();
      if (n === id) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const r of q.all(n)) stack.push(r.child_id);
    }
    return false;
  }

  /** id를 지나는 선행 순환이 있나 */
  #depCycleThrough(id) {
    const q = this.db.prepare("SELECT to_id FROM rel WHERE type = 'dep' AND from_id = ?");
    const seen = new Set();
    const stack = q.all(id).map((r) => r.to_id);
    while (stack.length) {
      const n = stack.pop();
      if (n === id) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const r of q.all(n)) stack.push(r.to_id);
    }
    return false;
  }

  /**
   * 두 이벤트를 하나로 합친다. keepId를 남기고 dropId를 없앤다. dropId를 가리키던 포함·표시·
   * 관계·보드루트를 keepId로 옮기고, 중복·자기순환을 정리한다. 합친 결과 포함이나 선행에 순환이
   * 생기면 거부(롤백). 본질은 keepId 것을 남긴다 — 호출부가 keep을 정한다.
   * @returns {{ok:boolean, rejected?:string, undo?:object}} undo=합치기 전 스냅샷(되돌리기용).
   */
  mergeEvents(keepId, dropId) {
    if (!keepId || !dropId || keepId === dropId) return { ok: false, rejected: '같은 이벤트' };
    const keepEv = this.db.prepare('SELECT * FROM event WHERE id=?').get(keepId);
    const dropEv = this.db.prepare('SELECT * FROM event WHERE id=?').get(dropId);
    if (!keepEv || !dropEv) return { ok: false, rejected: '이벤트를 찾을 수 없음' };
    // 되돌리기용 스냅샷 — 양쪽 이벤트와 관련 간선 전부.
    const affected = [keepId, dropId];
    const snapshot = {
      keepId, dropId, dropEvent: dropEv, keepEvent: keepEv,
      containment: this.db.prepare('SELECT * FROM containment WHERE parent_id IN (?,?) OR child_id IN (?,?)').all(...affected, ...affected),
      disp: this.db.prepare('SELECT * FROM disp WHERE parent_id IN (?,?) OR child_id IN (?,?)').all(...affected, ...affected),
      rel: this.db.prepare('SELECT * FROM rel WHERE from_id IN (?,?) OR to_id IN (?,?)').all(...affected, ...affected),
      board: this.db.prepare('SELECT id FROM board WHERE root_event_id = ?').all(dropId).map((b) => b.id),
    };
    const insCont = this.db.prepare('INSERT OR IGNORE INTO containment (parent_id,child_id,ordered,compose,ord) VALUES (?,?,?,?,?)');
    const insDispRow = this.db.prepare('INSERT OR IGNORE INTO disp (parent_id,child_id,pos_x,pos_w,height_days,align,show_note,alias,lab,px_width,fill,slot_start,slot_len) VALUES (@parent_id,@child_id,@pos_x,@pos_w,@height_days,@align,@show_note,@alias,@lab,@px_width,@fill,@slot_start,@slot_len)');
    const insDisp = { run: (d) => insDispRow.run({ fill: null, slot_start: null, slot_len: null, ...d }) };
    const run = this.db.transaction(() => {
      // 포함: dropId를 keepId로. 자기순환(부모=자식)은 버린다. 같은 쌍이 이미 있으면 IGNORE.
      for (const c of this.db.prepare('SELECT * FROM containment WHERE parent_id=?').all(dropId)) {
        if (keepId !== c.child_id) insCont.run(keepId, c.child_id, c.ordered, c.compose, c.ord);
      }
      for (const c of this.db.prepare('SELECT * FROM containment WHERE child_id=?').all(dropId)) {
        if (c.parent_id !== keepId) insCont.run(c.parent_id, keepId, c.ordered, c.compose, c.ord);
      }
      this.db.prepare('DELETE FROM containment WHERE parent_id=? OR child_id=?').run(dropId, dropId);
      // 표시(배치): dropId를 keepId로. keepId에 이미 있으면 dropId 것은 버린다(IGNORE).
      for (const d of this.db.prepare('SELECT * FROM disp WHERE parent_id=?').all(dropId)) {
        if (keepId !== d.child_id) insDisp.run({ ...d, parent_id: keepId });
      }
      for (const d of this.db.prepare('SELECT * FROM disp WHERE child_id=?').all(dropId)) {
        if (d.parent_id !== keepId) insDisp.run({ ...d, child_id: keepId });
      }
      this.db.prepare('DELETE FROM disp WHERE parent_id=? OR child_id=?').run(dropId, dropId);
      // 관계: 끝점을 keepId로. 자기순환·중복은 버린다.
      for (const rr of this.db.prepare('SELECT * FROM rel WHERE from_id=? OR to_id=?').all(dropId, dropId)) {
        const from = rr.from_id === dropId ? keepId : rr.from_id;
        const to = rr.to_id === dropId ? keepId : rr.to_id;
        if (from === to) { this.db.prepare('DELETE FROM rel WHERE id=?').run(rr.id); continue; }
        const dup = this.db.prepare('SELECT id FROM rel WHERE type=? AND from_id=? AND to_id=? AND id<>?').get(rr.type, from, to, rr.id);
        if (dup) this.db.prepare('DELETE FROM rel WHERE id=?').run(rr.id);
        else this.db.prepare('UPDATE rel SET from_id=?, to_id=? WHERE id=?').run(from, to, rr.id);
      }
      this.db.prepare('UPDATE board SET root_event_id=? WHERE root_event_id=?').run(keepId, dropId);
      // 사라지는 이벤트 제거. 본질은 keepId 것을 남긴다(이미 keep에 있음). 단 남는 쪽이 태스크로 만든 이벤트(type 'task')고
      // 상대가 카드면 유형은 카드 것을 쓴다 — 'task'는 놓인 역할이지 기간/마일스톤 같은 본질 유형이 아니다.
      if (keepEv.type === 'task' && dropEv.type && dropEv.type !== 'task') {
        this.db.prepare('UPDATE event SET type=? WHERE id=?').run(dropEv.type, keepId);
      }
      this.db.prepare('DELETE FROM event WHERE id=?').run(dropId);
      // 합친 결과 순환이면 거부(롤백). 바뀐 간선은 모두 keep을 지나므로 keep을 지나는 순환만 본다 —
      // 합치기와 상관없는 곳의 옛 순환이 모든 합치기를 막지 않게.
      if (this.#containmentCycleThrough(keepId)) throw new Error('합치면 포함이 순환합니다');
      if (this.#depCycleThrough(keepId)) throw new Error('합치면 선행이 순환합니다');
    });
    // 보드들의 기준은 그대로 둔다 — 기준이 있으면 낡은 문서가 저장돼도 바뀐 것만 쓰므로 안전하다.
    // 렌더러는 다른 탭 캐시를 낡음으로 표시하고 다시 읽는다(docs/SAVE.md §6).
    try { run(); } catch (e) { return { ok: false, rejected: String(e.message || e) }; }
    this.#merged.set(dropId, keepId);
    return { ok: true, undo: snapshot };
  }

  /** 합치기 되돌리기 — 스냅샷으로 두 이벤트와 간선을 원래대로 복원. */
  unmergeEvents(snapshot) {
    if (!snapshot || !snapshot.dropId) return { ok: false };
    const s = snapshot;
    const run = this.db.transaction(() => {
      // 합치기가 건드린 keep·drop 관련 간선을 싹 지우고 스냅샷을 그대로 되살린다.
      this.db.prepare('DELETE FROM containment WHERE parent_id IN (?,?) OR child_id IN (?,?)').run(s.keepId, s.dropId, s.keepId, s.dropId);
      this.db.prepare('DELETE FROM disp WHERE parent_id IN (?,?) OR child_id IN (?,?)').run(s.keepId, s.dropId, s.keepId, s.dropId);
      this.db.prepare('DELETE FROM rel WHERE from_id IN (?,?) OR to_id IN (?,?)').run(s.keepId, s.dropId, s.keepId, s.dropId);
      const upEv = this.db.prepare('INSERT OR REPLACE INTO event (id,title,start_date,end_date,type,status,org,progress,note) VALUES (@id,@title,@start_date,@end_date,@type,@status,@org,@progress,@note)');
      if (s.dropEvent) upEv.run(s.dropEvent);
      if (s.keepEvent) upEv.run(s.keepEvent);
      const insCont = this.db.prepare('INSERT OR REPLACE INTO containment (parent_id,child_id,ordered,compose,ord) VALUES (?,?,?,?,?)');
      for (const c of s.containment) insCont.run(c.parent_id, c.child_id, c.ordered, c.compose ?? 0, c.ord);
      const insDisp = this.db.prepare('INSERT OR REPLACE INTO disp (parent_id,child_id,pos_x,pos_w,height_days,align,show_note,alias,lab,px_width,fill,slot_start,slot_len) VALUES (@parent_id,@child_id,@pos_x,@pos_w,@height_days,@align,@show_note,@alias,@lab,@px_width,@fill,@slot_start,@slot_len)');
      for (const d of s.disp) insDisp.run({ fill: null, slot_start: null, slot_len: null, ...d });   // 020·021 이전 스냅샷엔 없는 칸
      const insRel = this.db.prepare('INSERT OR REPLACE INTO rel (id,type,from_id,to_id) VALUES (?,?,?,?)');
      for (const r of s.rel) insRel.run(r.id, r.type, r.from_id, r.to_id);
      for (const bid of (s.board ?? [])) this.db.prepare('UPDATE board SET root_event_id=? WHERE id=?').run(s.dropId, bid);
    });
    try { run(); } catch (e) { return { ok: false, rejected: String(e.message || e) }; }
    this.#merged.delete(s.dropId);
    return { ok: true };
  }

  /** 문서를 그대로 복사해 새 보드를 만든다 */
  duplicateProject(id, name) {
    const previous = this.boardId;
    this.boardId = id;
    let doc;
    try { doc = this.load(); } finally { this.boardId = previous; }
    if (!doc) throw new Error('복제할 프로젝트를 찾을 수 없습니다.');
    // 복제본은 별개 이벤트다 — 새 id를 부여해 보드를 넘는 식별 충돌을 막는다 (#3).
    reidentify(doc);
    return this.createProject(doc, name);
  }

  /** 목록 정렬용 — 프로젝트를 열 때 찍는다 */
  touchOpened(id) {
    this.db.prepare(
      "UPDATE board SET opened_at = datetime('now','localtime') WHERE id = ?",
    ).run(id);
  }

  #requireBoard() {
    if (this.boardId == null) throw new Error('열린 프로젝트가 없습니다.');
  }

  // ── 문서 ────────────────────────────────────────────────

  /**
   * 렌더러가 보드를 연다 — 문서를 읽고, 그 문서가 나온 상태를 이 보드의 저장 기준으로 삼는다.
   * (기준은 렌더러가 받을 때만 정한다. 복제·목록 같은 내부 읽기는 load()만 쓴다.)
   */
  openView(id) {
    this.open(id);
    this.touchOpened(id);
    const doc = this.load();
    if (doc) this.#base.set(id, this.#project(doc, this.#rootOf(id)));
    return doc;
  }

  /**
   * 이 이벤트가 **어느 보드의 어디에** 놓였나 — 항등설정 아래 '다른 보드에도 있음' 목록.
   * @returns {{boardId:number, boardName:string, role:'board'|'track'|'card'|'task', path:string[]}[]}
   *   path: 그 보드에서 이 이벤트를 품은 쪽(트랙 이름 › 상위 카드 제목 …), 가까운 것이 마지막
   */
  eventPlaces(eventId) {
    const boards = this.db.prepare('SELECT id, name, root_event_id FROM board WHERE root_event_id IS NOT NULL ORDER BY id').all();
    const edges = this.#edges();
    const kids = this.#childMap(edges);
    const parentsOf = new Map();
    for (const c of edges) {
      if (c.compose === 1 && !boards.some((b) => b.root_event_id === c.parent_id)) continue;   // 조합 대상은 '놓임'이 아니다
      if (!parentsOf.has(c.child_id)) parentsOf.set(c.child_id, []);
      parentsOf.get(c.child_id).push(c.parent_id);
    }
    const out = [];
    const titles = new Map();
    const titleOf = (id) => {
      if (!titles.has(id)) titles.set(id, this.db.prepare('SELECT title FROM event WHERE id=?').get(id)?.title ?? '');
      return titles.get(id);
    };
    for (const b of boards) {
      if (b.root_event_id === eventId) { out.push({ boardId: b.id, boardName: b.name, role: 'board', path: [] }); continue; }
      const v = this.#view(b.root_event_id, kids);
      const role = v.trackIds.has(eventId) ? 'track' : v.cards.has(eventId) ? 'card' : v.tasks.has(eventId) ? 'task' : null;
      if (!role) continue;
      const inView = (id) => id === b.root_event_id || v.trackIds.has(id) || v.cards.has(id);
      // 이 보드 안의 부모 하나를 따라 트랙까지 올라가며 경로를 만든다(여러 곳이면 첫 곳)
      const path = [];
      let cur = eventId;
      for (let guard = 0; guard < 32 && role !== 'track'; guard += 1) {
        const p = (parentsOf.get(cur) ?? []).find(inView);
        if (!p || p === b.root_event_id) break;
        path.unshift(titleOf(p) || '(제목 없음)');
        if (v.trackIds.has(p)) break;
        cur = p;
      }
      out.push({ boardId: b.id, boardName: b.name, role, path });
    }
    return out;
  }

  /**
   * 항등 해제(분리) — 여러 보드에 함께 놓인 이벤트를, 한 보드에서 **다른 이벤트로 떼어 낸다**(합치기의 반대 작업).
   * 2026-10-01 사용자 결정:
   *   - 이 보드(boardId)의 놓임이 새 이벤트가 된다(본질 복사). 다른 보드는 원래 이벤트를 그대로 쓴다.
   *   - 안에 든 하위 카드·태스크도 **함께 복제**해 완전히 별개가 된다(조합 대상은 복제하지 않고 새 쪽도 품는다).
   *   - 선행 등 관계는 **보이는 보드별로** 나눈다: 이 보드에서만 보이는 것은 새 쪽으로 옮기고, 다른 보드에서만 보이는 것은
   *     원래 쪽에 두고, 둘 다에서 보이면 양쪽에 하나씩.
   * '이 보드의 놓임' = 이 보드 화면의 부모(루트·트랙·카드)에서 이 이벤트로 오는 포함 간선. 그 밖의 부모가 없으면(다른 보드엔
   * 상위 카드를 통해서만 보인다) 떼어 낼 것이 없다 — 상위 카드를 나누라고 알린다.
   * @returns {{ok:true, newId:string, undo:object} | {ok:false, rejected:string}}
   */
  splitEvent(boardId, eventId) {
    const root = this.#rootOf(boardId);
    const boards = this.db.prepare('SELECT id, name, root_event_id FROM board WHERE root_event_id IS NOT NULL').all();
    const edges = this.#edges();
    const kids = this.#childMap(edges);
    const views = new Map(boards.map((b) => [b.id, this.#view(b.root_event_id, kids)]));
    const vB = views.get(boardId);
    if (!vB || !(vB.cards.has(eventId) || vB.tasks.has(eventId))) return { ok: false, rejected: '이 보드의 카드·태스크가 아닙니다' };
    const parentsB = new Set([root, ...vB.trackIds, ...vB.cards]);
    const allUp = this.db.prepare('SELECT * FROM containment WHERE child_id = ?').all(eventId);
    const mine = allUp.filter((c) => c.compose === 0 && parentsB.has(c.parent_id));
    const rest = allUp.filter((c) => !mine.includes(c));
    if (!mine.length) return { ok: false, rejected: '이 보드에 놓인 자리를 찾을 수 없습니다' };
    if (!rest.length) {
      return { ok: false, rejected: '다른 보드와 따로 놓인 이벤트가 아닙니다 — 다른 보드에는 상위 카드를 통해서만 보입니다(그 상위 카드를 나누세요)' };
    }

    // 떼어 낼 것 — 이 이벤트와 그 안(순서 있는·없는 포함, 조합 제외)을 끝까지
    const copied = [eventId];
    const seen = new Set(copied);
    for (let i = 0; i < copied.length; i += 1) {
      for (const c of (kids.get(copied[i]) ?? [])) {
        if (c.compose === 1 || seen.has(c.child_id)) continue;
        seen.add(c.child_id); copied.push(c.child_id);
      }
    }
    const rand = () => Math.random().toString(36).slice(2, 8);
    const map = new Map(copied.map((id) => [id, `e${Date.now().toString(36)}${rand()}`]));

    // 보이는 곳 — 바꾸기 전의 보드별 화면 집합
    const visIn = (v, id) => v.trackIds.has(id) || v.cards.has(id) || v.tasks.has(id);
    const inB = (id) => visIn(vB, id);
    const together = (a, b) => [...views].some(([bid, v]) => bid !== boardId && visIn(v, a) && visIn(v, b));

    const snap = { boardId, eventId, newId: map.get(eventId), created: [...map.values()], movedEdges: mine, movedDisp: [], relsBefore: [] };
    const getEvent = this.db.prepare('SELECT * FROM event WHERE id = ?');
    const insEvent = this.db.prepare('INSERT INTO event (id,title,start_date,end_date,type,status,org,progress,note) VALUES (@id,@title,@start_date,@end_date,@type,@status,@org,@progress,@note)');
    const insCont = this.db.prepare('INSERT OR IGNORE INTO containment (parent_id,child_id,ordered,compose,ord) VALUES (?,?,?,?,?)');
    const delCont = this.db.prepare('DELETE FROM containment WHERE parent_id=? AND child_id=?');
    const getDisp = this.db.prepare('SELECT * FROM disp WHERE parent_id=? AND child_id=?');
    const delDisp = this.db.prepare('DELETE FROM disp WHERE parent_id=? AND child_id=?');
    const insDisp = this.db.prepare('INSERT OR REPLACE INTO disp (parent_id,child_id,pos_x,pos_w,height_days,align,show_note,alias,lab,px_width,fill,slot_start,slot_len) VALUES (@parent_id,@child_id,@pos_x,@pos_w,@height_days,@align,@show_note,@alias,@lab,@px_width,@fill,@slot_start,@slot_len)');
    const withDefaults = (d) => ({ fill: null, slot_start: null, slot_len: null, ...d });
    let relN = 0;

    const run = this.db.transaction(() => {
      // 1) 새 이벤트들 — 본질 복사
      for (const [oldId, newIdv] of map) insEvent.run({ ...getEvent.get(oldId), id: newIdv });
      // 2) 이 보드의 놓임(부모 → 이벤트)을 새 이벤트로 옮긴다(배치 포함)
      for (const c of mine) {
        const d = getDisp.get(c.parent_id, eventId);
        if (d) { snap.movedDisp.push(d); delDisp.run(c.parent_id, eventId); insDisp.run(withDefaults({ ...d, child_id: map.get(eventId) })); }
        delCont.run(c.parent_id, eventId);
        insCont.run(c.parent_id, map.get(eventId), c.ordered, c.compose, c.ord);
      }
      // 3) 안쪽 구조를 복제 — 복제한 것끼리의 포함, 조합 대상은 새 쪽도 품는다(대상은 복제하지 않는다)
      for (const u of copied) {
        for (const c of (kids.get(u) ?? [])) {
          const child = c.compose === 1 ? c.child_id : map.get(c.child_id);
          if (!child) continue;
          insCont.run(map.get(u), child, c.ordered, c.compose, c.ord);
          const d = getDisp.get(u, c.child_id);
          if (d) insDisp.run(withDefaults({ ...d, parent_id: map.get(u), child_id: child }));
        }
      }
      // 4) 관계 — 보이는 보드별로 나눈다
      const rels = new Map();
      for (const id of copied) for (const r of this.db.prepare('SELECT * FROM rel WHERE from_id=? OR to_id=?').all(id, id)) rels.set(r.id, r);
      const upd = this.db.prepare('UPDATE rel SET from_id=?, to_id=? WHERE id=?');
      const ins = this.db.prepare('INSERT INTO rel (id,type,from_id,to_id) VALUES (?,?,?,?)');
      for (const r of rels.values()) {
        const shownHere = inB(r.from_id) && inB(r.to_id);
        if (!shownHere) continue;                                   // 이 보드에서 안 보인다 — 원래 쪽에 둔다
        const nf = map.get(r.from_id) ?? r.from_id, nt = map.get(r.to_id) ?? r.to_id;
        if (together(r.from_id, r.to_id)) {
          ins.run(`${r.id}~${(relN += 1)}${rand()}`, r.type, nf, nt);      // 둘 다에서 보인다 — 새 쪽에도 하나
        } else {
          snap.relsBefore.push(r);
          upd.run(nf, nt, r.id);                                        // 이 보드에서만 보인다 — 새 쪽으로 옮긴다
        }
      }
    });
    try { run(); } catch (e) { return { ok: false, rejected: String(e.message || e) }; }
    return { ok: true, newId: map.get(eventId), undo: snap };
  }

  /** 항등 해제 되돌리기 — 만든 이벤트와 그 간선·배치·관계를 지우고, 옮긴 놓임·관계를 원래대로 */
  unsplitEvent(snap) {
    if (!snap?.created?.length) return { ok: false };
    const run = this.db.transaction(() => {
      this.#purge(snap.created);
      const insCont = this.db.prepare('INSERT OR REPLACE INTO containment (parent_id,child_id,ordered,compose,ord) VALUES (?,?,?,?,?)');
      for (const c of snap.movedEdges ?? []) insCont.run(c.parent_id, c.child_id, c.ordered, c.compose ?? 0, c.ord);
      const insDisp = this.db.prepare('INSERT OR REPLACE INTO disp (parent_id,child_id,pos_x,pos_w,height_days,align,show_note,alias,lab,px_width,fill,slot_start,slot_len) VALUES (@parent_id,@child_id,@pos_x,@pos_w,@height_days,@align,@show_note,@alias,@lab,@px_width,@fill,@slot_start,@slot_len)');
      for (const d of snap.movedDisp ?? []) insDisp.run({ fill: null, slot_start: null, slot_len: null, ...d });
      const insRel = this.db.prepare('INSERT OR REPLACE INTO rel (id,type,from_id,to_id) VALUES (?,?,?,?)');
      for (const r of snap.relsBefore ?? []) insRel.run(r.id, r.type, r.from_id, r.to_id);
    });
    try { run(); } catch (e) { return { ok: false, rejected: String(e.message || e) }; }
    return { ok: true };
  }

  #rootOf(id) {
    return this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(id)?.root_event_id || `board:${id}`;
  }

  /**
   * 4대상 테이블에서 렌더러 문서를 재구성한다. 순수 읽기다.
   *   보드 = 루트 이벤트. 트랙 = 루트의 구성. 카드 = 트랙 아래 순서 있는 후손.
   *   걸침 = 한 카드가 여러 트랙에 함께 소속(다중 소속). 태스크 = 카드의 순서 없는 포함.
   *   조합 = 트랙·카드의 구성 → doc.compose (보드에 카드로 그리지 않는다).
   * @returns {object|null}
   */
  load() {
    if (this.boardId == null) return null;
    const board = this.db.prepare('SELECT * FROM board WHERE id = ?').get(this.boardId);
    if (!board) return null;
    const root = board.root_event_id;

    const orgs = this.db.prepare(
      'SELECT name FROM org WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId).map((r) => r.name);
    const bands = this.db.prepare(
      'SELECT id, mode, from_date, to_date, label, scale FROM band WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId)
      .map((r) => ({ id: r.id, mode: r.mode, from: r.from_date, to: r.to_date, label: r.label, scale: r.scale }));

    // 보드별 표현 설정(display)·상태 이름 재정의(statusLabels)를 meta_json에서 복원.
    let boardMeta = {};
    try { boardMeta = board.meta_json ? JSON.parse(board.meta_json) : {}; } catch { boardMeta = {}; }
    const metaExtra = {};
    if (boardMeta.display) metaExtra.display = boardMeta.display;
    if (boardMeta.statusLabels) metaExtra.statusLabels = boardMeta.statusLabels;

    const base = {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: board.name, ...metaExtra },
      orgs, bands, tracks: [], relations: [], items: [], compose: [],
    };
    if (!root) return base;

    const edges = this.#edges();
    const kids = this.#childMap(edges);
    const v = this.#view(root, kids);
    const trackIds = v.tracks.map((c) => c.child_id);
    const trackIndex = new Map(trackIds.map((id, i) => [id, i]));
    const trackSet = v.trackIds;

    const evById = new Map();
    const evIds = [root, ...trackIds, ...v.cards, ...v.tasks];
    for (let i = 0; i < evIds.length; i += 500) {
      const chunk = evIds.slice(i, i + 500);
      const ph = chunk.map(() => '?').join(',');
      for (const e of this.db.prepare(`SELECT * FROM event WHERE id IN (${ph})`).all(...chunk)) evById.set(e.id, e);
    }

    // 표시는 이 보드의 부모(루트·트랙·카드) 것만 읽는다 — 전역 disp를 다 훑지 않는다(속도).
    const dispBy = new Map();
    const parentIds = [root, ...trackIds, ...v.cards];
    for (let i = 0; i < parentIds.length; i += 500) {
      const chunk = parentIds.slice(i, i + 500);
      const ph = chunk.map(() => '?').join(',');
      for (const d of this.db.prepare(`SELECT * FROM disp WHERE parent_id IN (${ph})`).all(...chunk)) {
        dispBy.set(key(d.parent_id, d.child_id), d);
      }
    }

    const tracks = v.tracks.map((c) => {
      const ev = evById.get(c.child_id) ?? {};
      const d = dispBy.get(key(root, c.child_id)) ?? {};
      return { id: c.child_id, lab: d.lab ?? '', name: ev.title ?? '', w: d.px_width ?? null };
    });

    // 카드 재구성
    const homeTrack = new Map();   // event -> 홈 트랙 id
    const docParent = new Map();   // event -> 부모 카드 id | null
    const spanOf = new Map();      // event -> 홈부터 연속 칸 수(레거시)
    const tracksOf = new Map();    // event -> 소속 트랙 id들(정렬, 사이는 안 채움)
    const ordOf = new Map();       // event -> 형제 내 순서

    const trackMembers = new Map();
    for (const c of edges) {
      if (c.ordered !== 1 || !trackSet.has(c.parent_id) || !v.cards.has(c.child_id)) continue;
      if (!trackMembers.has(c.child_id)) trackMembers.set(c.child_id, []);
      trackMembers.get(c.child_id).push(trackIndex.get(c.parent_id));
      if (!ordOf.has(c.child_id)) ordOf.set(c.child_id, c.ord);
    }
    for (const [ev, idxs] of trackMembers) {
      idxs.sort((a, b) => a - b);
      homeTrack.set(ev, trackIds[idxs[0]]);
      tracksOf.set(ev, idxs.map((i) => trackIds[i]));   // 실제 소속만 (비연속 유지)
      let run = 1;
      for (let k = 1; k < idxs.length; k += 1) { if (idxs[k] === idxs[k - 1] + 1) run += 1; else break; }
      spanOf.set(ev, run);
      docParent.set(ev, null);
    }
    // 중첩 카드: 최상위 카드에서 순서 있는 포함을 따라 내려간다.
    const queue = [...trackMembers.keys()];
    while (queue.length) {
      const parent = queue.shift();
      for (const c of (kids.get(parent) ?? [])) {
        if (c.ordered !== 1 || !v.cards.has(c.child_id) || homeTrack.has(c.child_id)) continue;
        docParent.set(c.child_id, parent);
        homeTrack.set(c.child_id, homeTrack.get(parent));
        spanOf.set(c.child_id, 1);
        ordOf.set(c.child_id, c.ord);
        queue.push(c.child_id);
      }
    }

    // 태스크(순서 없는 포함) — 조합(구성)과 다르다
    const tasksOf = new Map();
    for (const c of edges) {
      if (c.ordered !== 0 || c.compose !== 0 || !homeTrack.has(c.parent_id)) continue;
      const t = evById.get(c.child_id);
      if (!t) continue;
      if (!tasksOf.has(c.parent_id)) tasksOf.set(c.parent_id, []);
      tasksOf.get(c.parent_id).push({ ord: c.ord, id: c.child_id, text: t.title, done: t.status === 'done' });
    }
    for (const arr of tasksOf.values()) arr.sort((a, b) => a.ord - b.ord);

    const items = [];
    for (const ev of homeTrack.keys()) {
      const e = evById.get(ev);
      if (!e) continue;
      const parentId = docParent.get(ev) ?? null;
      const edgeParent = parentId ?? homeTrack.get(ev);
      const d = dispBy.get(key(edgeParent, ev)) ?? {};
      items.push({
        id: ev,
        s: e.start_date, e: e.end_date, ti: e.title, ty: e.type, st: e.status,
        og: e.org, pg: e.progress, note: e.note,
        parent: parentId,
        alias: d.alias ?? null,
        tasks: (tasksOf.get(ev) ?? []).map((t) => ({ id: t.id, text: t.text, done: t.done })),
        place: {
          t: homeTrack.get(ev), sp: spanOf.get(ev) ?? 1,
          tracks: parentId ? undefined : (tracksOf.get(ev) ?? [homeTrack.get(ev)]),
          x: d.pos_x ?? null, w: d.pos_w ?? null, hd: d.height_days ?? null,
          align: d.align ?? 'middle', showNote: d.show_note === 1, fill: d.fill ?? null,
          slot: d.slot_start == null ? null : { s: d.slot_start, len: d.slot_len ?? 1 },
        },
        _o: ordOf.get(ev) ?? 0,
      });
    }
    items.sort((a, b) =>
      (trackIndex.get(a.place.t) ?? 0) - (trackIndex.get(b.place.t) ?? 0) || a._o - b._o);
    items.forEach((it) => { delete it._o; });

    // 관계: 선행(dep)은 양끝이 이 보드 카드인 것. 포함(contain)은 item.parent에서 파생.
    const relations = [];
    for (const r of this.db.prepare("SELECT id, type, from_id, to_id FROM rel WHERE type = 'dep'").all()) {
      if (homeTrack.has(r.from_id) && homeTrack.has(r.to_id)) relations.push({ id: r.id, type: r.type, from: r.from_id, to: r.to_id });
    }
    for (const it of items) {
      if (it.parent) relations.push({ id: `c_${it.id}`, type: 'contain', from: it.parent, to: it.id });
    }

    // 조합(구성) — 이 보드의 트랙·카드가 구성으로 품은 이벤트. 보드에 카드로 그리지 않고 상세에서 보인다.
    const compose = [];
    for (const c of edges) {
      if (c.compose !== 1 || c.parent_id === root) continue;
      if (!trackSet.has(c.parent_id) && !homeTrack.has(c.parent_id)) continue;
      compose.push({ parent: c.parent_id, child: c.child_id, _o: c.ord });
    }
    compose.sort((a, b) => (a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : a._o - b._o));
    compose.forEach((c) => { delete c._o; });

    return {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: evById.get(root)?.title ?? board.name, ...metaExtra },
      orgs, bands, tracks, relations, items, compose,
    };
  }

  /**
   * 투영 — 렌더러 문서를 DB 행 집합으로 (docs/SAVE.md §3). 기준과 새 상태를 같은 함수로 만들어
   * 비교하므로, 바뀌지 않은 것은 절대 쓰지 않는다.
   *   events  id -> {fields:[이 보드가 정하는 본질 필드들], insert:기본값}  (같은 이벤트가 두 번 나오면 둘 다)
   *   edges   (부모,자식) -> {ordered, compose, ord}
   *   disp    (부모,자식) -> 배치 행
   *   rels    id -> {type, from, to}  (선행, 양끝이 이 보드 카드)
   *   parents 이 보드 화면의 부모들 — 루트·트랙·카드
   */
  #project(doc, root) {
    const bid = this.boardId;
    const existsQ = this.db.prepare('SELECT 1 FROM event WHERE id = ?');
    // 트랙 id는 보드마다 유일해야 한다 — 빈 보드가 모두 't0'을 쓰기 때문. 이 보드 접두를 붙이되 멱등하게.
    // 이미 이벤트로 있는 id(이 보드 접두, 또는 합치기로 트랙이 된 다른 이벤트)는 그대로 쓴다.
    const tcache = new Map();
    const tkey = (raw) => {
      if (typeof raw !== 'string' || !raw) return raw;
      if (!tcache.has(raw)) {
        tcache.set(raw, raw.startsWith(`track:${bid}:`) || existsQ.get(raw) ? raw : `track:${bid}:${raw}`);
      }
      return tcache.get(raw);
    };

    const out = emptyProjection();
    out.root = root;
    const { events, edges, disp, rels, parents } = out;
    parents.add(root);
    const addEvent = (id, fields, insert) => {
      const e = events.get(id);
      if (e) e.fields.push(fields); else events.set(id, { fields: [fields], insert });
    };
    const addEdge = (parent, child, ordered, compose, ord) => {
      const k = key(parent, child);
      if (edges.has(k) || parent === child) return false;     // 한 쌍에 간선은 하나
      edges.set(k, { parent, child, ordered, compose, ord });
      return true;
    };
    const sib = new Map();
    const nextOrd = (p) => { const n = sib.get(p) ?? 0; sib.set(p, n + 1); return n; };

    const meta = doc.meta ?? {};
    addEvent(root, { title: meta.name ?? '로드맵', start_date: meta.start, end_date: meta.end }, { ...INSERT_DEFAULTS });

    // 트랙 — 보드는 트랙들의 조합(구성)
    const docTrack = new Map();                   // 문서의 트랙 id -> 이벤트 id
    (doc.tracks ?? []).forEach((t, i) => {
      const tid = tkey(t.id);
      docTrack.set(t.id, tid);
      parents.add(tid);
      addEvent(tid, { title: t.name ?? '' }, { ...INSERT_DEFAULTS, start_date: meta.start, end_date: meta.end });
      addEdge(root, tid, 0, 1, i);
      disp.set(key(root, tid), dispRow(root, tid, { lab: t.lab ?? '', px_width: t.w ?? null }));
    });
    const trackOf = (raw) => docTrack.get(raw) ?? tkey(raw);
    const trackSet = new Set(docTrack.values());

    const items = Array.isArray(doc.items) ? doc.items : [];
    const itemIds = new Set(items.map((it) => it.id));
    for (const id of itemIds) parents.add(id);

    for (const it of items) {
      const p = it.place ?? it;
      addEvent(it.id, {
        title: it.ti ?? '', start_date: it.s, end_date: it.e, type: it.ty ?? 'bar',
        status: it.st ?? 'plan', org: it.og ?? '', progress: it.pg ?? 0, note: it.note ?? '',
      }, { ...INSERT_DEFAULTS });
      // 부모 = 명시된 상위 카드(이 문서에 있을 때), 없으면 홈 트랙
      const home = trackOf(p.t);
      const nested = typeof it.parent === 'string' && itemIds.has(it.parent);
      const edgeParent = nested ? it.parent : home;
      if (!nested && !trackSet.has(home)) continue;          // 놓일 트랙이 없다 (정규화가 막는다)
      addEdge(edgeParent, it.id, 1, 0, nextOrd(edgeParent));
      disp.set(key(edgeParent, it.id), dispRow(edgeParent, it.id, {
        pos_x: p.x ?? null, pos_w: p.w ?? null, height_days: p.hd ?? null,
        align: p.align ?? 'middle', show_note: p.showNote ? 1 : 0, alias: it.alias ?? null, fill: p.fill ?? null,
        slot_start: p.slot?.s ?? null, slot_len: p.slot ? (p.slot.len ?? 1) : null,
      }));
      // 소속 트랙: 홈 외의 소속 트랙에도 포함(다중 소속, 사이는 안 채움). 최상위 카드에만.
      if (!nested) {
        const members = Array.isArray(p.tracks) && p.tracks.length ? p.tracks : [p.t];
        for (const raw of members) {
          const tid = trackOf(raw);
          if (tid === edgeParent || !trackSet.has(tid)) continue;
          addEdge(tid, it.id, 1, 0, nextOrd(tid));
        }
      }
      // 태스크: 이벤트 + 순서 없는 포함. 이 보드가 정하는 건 제목·완료뿐(날짜는 새로 만들 때만 채운다).
      (Array.isArray(it.tasks) ? it.tasks : []).forEach((t, ti) => {
        addEvent(t.id, { title: t.text ?? '', status: t.done ? 'done' : 'plan' },
          { ...INSERT_DEFAULTS, start_date: it.s, end_date: it.e, type: 'task' });
        addEdge(it.id, t.id, 0, 0, ti);
      });
    }

    // 조합(구성) — 이 보드의 트랙·카드가 품은 다른 보드의 이벤트. 이 보드 화면에 있는 이벤트(합치기로
    // 공유된 것 포함)는 이미 이 보드의 포함 그래프 안이라 조합 대상이 될 수 없다(SYSTEM.md §7.1) — 뺀다.
    const cOrd = new Map();
    for (const c of (Array.isArray(doc.compose) ? doc.compose : [])) {
      if (!c || typeof c.parent !== 'string' || typeof c.child !== 'string') continue;
      const parent = itemIds.has(c.parent) ? c.parent : docTrack.get(c.parent) ?? c.parent;
      if (parent === root || !parents.has(parent)) continue;
      const child = itemIds.has(c.child) ? c.child : docTrack.get(c.child) ?? c.child;
      if (events.has(child)) continue;                     // 같은 보드의 이벤트 — 모순
      const n = cOrd.get(parent) ?? 0;
      if (addEdge(parent, child, 0, 1, n)) cOrd.set(parent, n + 1);
    }

    // 관계 — 선행(dep)만. 포함(contain)은 item.parent에서 파생이라 안 넣는다. 동일은 합치기 '작업'이고
    // 조합은 구성이라 관계가 아니다.
    if (Array.isArray(doc.relations)) {
      for (const r of doc.relations) {
        if (r?.type !== 'dep' || r.from === r.to || !itemIds.has(r.from) || !itemIds.has(r.to)) continue;
        rels.set(r.id || `r_${r.from}_${r.to}`, { type: 'dep', from: r.from, to: r.to });
      }
    } else {
      for (const it of items) {
        for (const dep of it.dp ?? []) if (itemIds.has(dep)) rels.set(`r_${dep}_${it.id}`, { type: 'dep', from: dep, to: it.id });
      }
    }
    return out;
  }

  /**
   * 문서 저장 — 기준 대비 바뀐 것만 적용한다 (docs/SAVE.md §4). 트랜잭션 1회.
   * @param {object} doc 렌더러 문서
   * @param {string} label 변경 설명 (리비전 라벨)
   * @returns {{affected:number[], rejected:{parent,child,reason}[]}}
   *   affected 이 저장으로 화면이 달라진 다른 보드들(열려 있으면 다시 읽어야 한다)
   *   rejected 순환이라 넣지 않은 포함 간선
   */
  save(doc, label = '') {
    this.#requireBoard();
    const bid = this.boardId;
    const result = { affected: [], rejected: [] };
    let next = null;
    let touched = null;
    const write = this.db.transaction(() => {
      const root = this.#rootOf(bid);
      // 보드별 '표현' 설정(화살표·글자·축)과 상태 이름 재정의를 JSON으로 보관(시스템과 무관).
      const metaJson = JSON.stringify({
        display: doc.meta.display ?? null,
        statusLabels: doc.meta.statusLabels ?? null,
      });
      this.db.prepare(`
        INSERT INTO board (id, name, start_date, end_date, doc_version, root_event_id, meta_json)
        VALUES (@id, @name, @start, @end, @docVersion, @root, @metaJson)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, start_date = @start, end_date = @end, doc_version = @docVersion,
          root_event_id = @root, meta_json = @metaJson, updated_at = datetime('now','localtime')
      `).run({
        id: bid,
        name: doc.meta.name ?? '로드맵',
        start: doc.meta.start, end: doc.meta.end,
        docVersion: doc.version ?? 1, root, metaJson,
      });
      // 보드 소유(레지스트리·표시) — 그대로 덮어쓴다
      this.db.prepare('DELETE FROM org  WHERE board_id = ?').run(bid);
      this.db.prepare('DELETE FROM band WHERE board_id = ?').run(bid);
      const insBand = this.db.prepare(
        'INSERT INTO band (board_id, id, ord, mode, from_date, to_date, label, scale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const insOrg = this.db.prepare('INSERT INTO org (board_id, ord, name) VALUES (?, ?, ?)');
      (doc.bands ?? []).forEach((b, i) =>
        insBand.run(bid, b.id, i, b.mode ?? 'month-week', b.from, b.to, b.label ?? '', b.scale ?? 1));
      (doc.orgs ?? []).forEach((o, i) => insOrg.run(bid, i, o));

      next = this.#project(doc, root);
      const base = this.#base.get(bid) ?? this.#dbProjection(root);
      touched = this.#apply(base, next, result);
      this.#maybeRevision(doc, label);
    });
    write();
    this.#base.set(bid, next);
    result.affected = this.#affected(bid, touched);
    return result;
  }

  /** 기준이 없을 때(예외적) — 지금 DB 상태의 투영을 기준으로 삼는다. */
  #dbProjection(root) {
    const hasRoot = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(this.boardId)?.root_event_id;
    if (!hasRoot) return emptyProjection();
    const doc = this.load();
    return doc ? this.#project(doc, root) : emptyProjection();
  }

  /** 기준 → 새 투영의 차이를 DB에 적용한다. @returns 건드린 것 {events, parents, relEnds} */
  #apply(base, next, result) {
    const touched = { events: new Set(), parents: new Set(), relEnds: new Set() };
    const getEvent = this.db.prepare('SELECT * FROM event WHERE id = ?');
    const insEvent = this.db.prepare(`
      INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
      VALUES (@id, @title, @start_date, @end_date, @type, @status, @org, @progress, @note)
    `);
    const updEvent = (id, changes) => {
      const cols = Object.keys(changes).filter((c) => ESSENCE.includes(c));
      if (!cols.length) return 0;
      return this.db.prepare(`UPDATE event SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
        .run({ ...changes, id }).changes;
    };

    // 1) 본질 — 바뀐 필드만
    for (const [id, n] of next.events) {
      const b = base.events.get(id);
      if (!b) {
        // 이 보드 화면에 새로 들어온 이벤트
        const want = Object.assign({}, ...[...n.fields].reverse());   // 겹치면 앞의 것
        const cur = getEvent.get(id);
        if (!cur && this.#merged.has(id)) continue;                   // 합치기로 없앤 것 — 되살리지 않는다
        if (!cur) {
          insEvent.run({ id, ...INSERT_DEFAULTS, ...n.insert, ...want });
          this.#created.set(id, Date.now());
          touched.events.add(id);
        } else {
          const diff = {};
          for (const [k, val] of Object.entries(want)) if (cur[k] !== val) diff[k] = val;
          if (Object.keys(diff).length && updEvent(id, diff)) touched.events.add(id);
        }
        continue;
      }
      const bf = b.fields[0];
      const changes = {};
      for (const f of n.fields) {
        for (const [k, val] of Object.entries(f)) if (val !== bf[k] && !(k in changes)) changes[k] = val;
      }
      // DB에 없으면(합치기·영구 삭제로 사라짐) 되살리지 않는다 — UPDATE가 0행이다.
      if (Object.keys(changes).length && updEvent(id, changes)) touched.events.add(id);
    }

    // 2) 포함 간선
    const upEdge = this.db.prepare(`
      INSERT INTO containment (parent_id, child_id, ordered, compose, ord) VALUES (@parent, @child, @ordered, @compose, @ord)
      ON CONFLICT(parent_id, child_id) DO UPDATE SET ordered = @ordered, compose = @compose, ord = @ord
    `);
    const delEdge = this.db.prepare('DELETE FROM containment WHERE parent_id = ? AND child_id = ?');
    const delDisp = this.db.prepare('DELETE FROM disp WHERE parent_id = ? AND child_id = ?');
    const rejectedKeys = new Set();
    for (const [k, n] of next.edges) {
      const b = base.edges.get(k);
      if (!b) {
        if (this.#merged.has(n.parent) || this.#merged.has(n.child)) { rejectedKeys.add(k); continue; }
        if (this.#reaches(n.child, n.parent)) {   // 넣으면 포함이 순환한다
          result.rejected.push({ parent: n.parent, child: n.child, reason: '순환' });
          rejectedKeys.add(k);
          continue;
        }
        upEdge.run(n);
        touched.parents.add(n.parent);
      } else if (b.ordered !== n.ordered || b.compose !== n.compose || b.ord !== n.ord) {
        upEdge.run(n);
        touched.parents.add(n.parent);
      }
    }
    const lost = new Set();                       // 이번에 부모 간선 하나를 잃은 이벤트
    for (const [k, b] of base.edges) {
      if (next.edges.has(k)) continue;
      // 부모가 화면에서 빠졌으면(카드·트랙을 보드에서 뺌) 그 부모의 안쪽 구조는 건드리지 않는다.
      if (!next.parents.has(b.parent)) continue;
      delEdge.run(b.parent, b.child);
      delDisp.run(b.parent, b.child);
      touched.parents.add(b.parent);
      lost.add(b.child);
    }

    // 3) 배치(disp) — 간선을 따라간다
    const upDisp = this.db.prepare(`
      INSERT OR REPLACE INTO disp (parent_id, child_id, pos_x, pos_w, height_days, align, show_note, alias, lab, px_width, fill, slot_start, slot_len)
      VALUES (@parent_id, @child_id, @pos_x, @pos_w, @height_days, @align, @show_note, @alias, @lab, @px_width, @fill, @slot_start, @slot_len)
    `);
    for (const [k, n] of next.disp) {
      if (rejectedKeys.has(k)) continue;
      const b = base.disp.get(k);
      if (b && DISP_COLS.every((c) => b[c] === n[c])) continue;
      upDisp.run(n);
      touched.parents.add(n.parent_id);
    }
    for (const [k, b] of base.disp) {
      if (next.disp.has(k) || !next.parents.has(b.parent_id)) continue;
      delDisp.run(b.parent_id, b.child_id);
      touched.parents.add(b.parent_id);
    }

    // 4) 관계(선행) — 보드에서 뺀 이벤트의 관계는 남긴다(관계는 보드 밖 대상). 양끝이 보일 때만 지운다.
    const upRel = this.db.prepare('INSERT OR REPLACE INTO rel (id, type, from_id, to_id) VALUES (@id, @type, @from, @to)');
    const delRel = this.db.prepare('DELETE FROM rel WHERE id = ?');
    for (const [id, n] of next.rels) {
      const b = base.rels.get(id);
      if (b && b.type === n.type && b.from === n.from && b.to === n.to) continue;
      upRel.run({ id, ...n });
      touched.relEnds.add(n.from).add(n.to);
    }
    for (const [id, b] of base.rels) {
      if (next.rels.has(id)) continue;
      if (!next.events.has(b.from) || !next.events.has(b.to)) continue;
      delRel.run(id);
      touched.relEnds.add(b.from).add(b.to);
    }

    // 4-b) 같은 보드 이벤트를 조합으로 품은 옛 간선 — 모순이라(SYSTEM.md §7.1) 이 보드 저장이 걷어 낸다.
    //      투영이 이런 간선을 만들지 않으므로 기준·새 상태 비교로는 안 지워진다. 그래서 따로 본다.
    const composeKids = this.db.prepare('SELECT child_id FROM containment WHERE parent_id = ? AND compose = 1');
    for (const p of next.parents) {
      if (p === next.root) continue;                     // 보드 → 트랙은 구성이 맞다
      for (const { child_id: c } of composeKids.all(p)) {
        if (!next.events.has(c)) continue;
        delEdge.run(p, c);
        delDisp.run(p, c);
        touched.parents.add(p);
      }
    }

    // 5) 방금 만든 것 — 이번에 부모를 모두 잃었으면 휴지통을 거치지 않고 없앤다 (§7).
    //    그 안에 든 것 중 역시 방금 만든 것만 함께. 옛 이벤트는 부모를 잃고 휴지통으로 간다.
    if (lost.size) {
      const hasParent = this.db.prepare('SELECT 1 FROM containment WHERE child_id = ? LIMIT 1');
      const roots = this.#liveRoots();
      const seeds = new Set([...lost].filter((id) => !roots.has(id) && this.#isFresh(id) && !hasParent.get(id)));
      if (seeds.size) {
        const doomed = this.#closure(seeds, (id) => this.#isFresh(id));
        this.#purge(doomed);
        for (const id of doomed) touched.events.add(id);
      }
    }
    return touched;
  }

  /** 이 저장으로 화면이 달라진 다른 보드들 — 그 보드 기준에 든 이벤트·부모를 건드렸으면 영향받았다. */
  #affected(selfId, touched) {
    if (!touched) return [];
    const out = [];
    for (const [bid, b] of this.#base) {
      if (bid === selfId) continue;
      const hit = [...touched.events].some((id) => b.events.has(id))
        || [...touched.parents].some((p) => b.parents.has(p))
        || [...touched.relEnds].some((e) => b.events.has(e));
      if (hit) out.push(bid);
    }
    return out;
  }

  /** 마지막 리비전이 충분히 오래됐을 때만 스냅샷을 남긴다. */
  #maybeRevision(doc, label) {
    const last = this.db.prepare(
      'SELECT created_at FROM revision WHERE board_id = ? ORDER BY id DESC LIMIT 1',
    ).get(this.boardId);

    if (last) {
      const age = (Date.now() - new Date(last.created_at.replace(' ', 'T')).getTime()) / 60000;
      if (age < REVISION_INTERVAL_MIN) return;
    }

    this.db.prepare(
      'INSERT INTO revision (board_id, label, items, doc) VALUES (?, ?, ?, ?)',
    ).run(this.boardId, label, doc.items.length, JSON.stringify(doc));

    this.db.prepare(`
      DELETE FROM revision WHERE board_id = ? AND id NOT IN (
        SELECT id FROM revision WHERE board_id = ? ORDER BY id DESC LIMIT ?
      )
    `).run(this.boardId, this.boardId, REVISION_KEEP);
  }

  // ── 변경 이력 ───────────────────────────────────────────

  /** 변경 이력 목록 (문서 본문 제외) */
  listRevisions(limit = 50) {
    if (this.boardId == null) return [];
    return this.db.prepare(`
      SELECT id, created_at, label, items FROM revision
      WHERE board_id = ? ORDER BY id DESC LIMIT ?
    `).all(this.boardId, limit);
  }

  /** 특정 리비전의 문서 */
  getRevision(id) {
    if (this.boardId == null) return null;
    const row = this.db.prepare(
      'SELECT doc FROM revision WHERE board_id = ? AND id = ?',
    ).get(this.boardId, id);
    return row ? JSON.parse(row.doc) : null;
  }

}
