/**
 * 문서 저장소 — 렌더러가 쓰는 문서 모양({meta, tracks, items})과
 * 4대상 테이블(event·containment·disp·rel) 사이를 오간다.
 *
 * 규칙 3장: 모든 단위는 event, 담김은 containment 하나(순서 있음=트랙 위/하위 카드,
 * 순서 없음=태스크), 표시는 disp(어느 포함 edge 위인가), 이음은 rel(보드 무관).
 * 보드는 저장 대상이 아니라 '펼친 이벤트' — board 테이블은 최상위 레지스트리와
 * 표시 설정(이름·기간·org·band·정렬순서)만 쥔다. 저장은 '보드 하나가 여는 이벤트
 * 서브트리'를 다시 쓰되, 이벤트 본질은 공유되므로 지우지 않고 UPSERT한다(§3.4).
 */
import { reidentify } from '../../src/core/schema.js';

/** 리비전을 남기는 최소 간격(분). 타이핑 한 글자마다 스냅샷이 쌓이는 걸 막는다. */
const REVISION_INTERVAL_MIN = 5;
/** 보관할 리비전 수 */
const REVISION_KEEP = 200;

const SEP = ' ';

export class BoardRepository {
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

  /** parent -> [{child_id, ordered, ord}] (ord 오름차순). 전역 포함 그래프. */
  #childMap() {
    const kids = new Map();
    for (const c of this.db.prepare('SELECT parent_id, child_id, ordered, ord FROM containment').all()) {
      if (!kids.has(c.parent_id)) kids.set(c.parent_id, []);
      kids.get(c.parent_id).push(c);
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.ord - b.ord);
    return kids;
  }

  /**
   * root에서 구조적 포함(순서 있음=1, 태스크=0)을 따라 도달하는 모든 이벤트(루트 제외).
   * 조합(ordered=2)은 다른 보드의 부품을 가리키는 관계라 서브트리에 끌어오지 않는다.
   */
  #descendants(root, kids = this.#childMap()) {
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const c of (kids.get(n) ?? [])) {
        if (c.ordered === 2) continue;
        if (!seen.has(c.child_id)) { seen.add(c.child_id); stack.push(c.child_id); }
      }
    }
    return seen;
  }

  // ── 프로젝트(보드) 목록 ─────────────────────────────────

  /** 최근 연 순서. 목록 화면용이라 문서 본문은 싣지 않는다. */
  listProjects() {
    const boards = this.db.prepare(`
      SELECT b.id, b.name, b.start_date AS start, b.end_date AS end,
             b.updated_at AS updatedAt, b.opened_at AS openedAt, b.ord AS ord,
             b.root_event_id AS root
      FROM board b
      ORDER BY COALESCE(b.opened_at, b.updated_at) DESC, b.id DESC
    `).all();
    const kids = this.#childMap();
    return boards.map((b) => {
      const tracks = (kids.get(b.root) ?? []).filter((c) => c.ordered === 1);
      const desc = b.root ? this.#descendants(b.root, kids) : new Set();
      // 아이템 수 = 서브트리에서 트랙·태스크를 뺀 순서 있는 이벤트. 대략치(목록 배지용).
      const trackIds = new Set(tracks.map((c) => c.child_id));
      let items = 0;
      for (const ev of desc) if (!trackIds.has(ev)) items += 1;
      const { root, ...rest } = b;
      return { ...rest, tracks: tracks.length, items };
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
   * 모든 보드를 통틀어 이벤트 목록. '동일 카드(같은 이벤트)' 연결 후보용.
   * 보드(루트 이벤트)·트랙·카드를 모두 이벤트로 낸다. 각 이벤트가 어느 보드에 속하는지도
   * 함께 실어, 보드를 넘는 동일성 연결에 쓴다.
   * @returns {{id, title, kind, boardIds, boardNames, s, e, ty, st, og, pg, note}[]}
   */
  listEvents() {
    const boardRows = this.db.prepare(
      'SELECT id, name, root_event_id FROM board WHERE root_event_id IS NOT NULL',
    ).all();
    const kids = this.#childMap();
    const rootIds = new Set(boardRows.map((b) => b.root_event_id));

    const trackIds = new Set();
    for (const b of boardRows) {
      for (const c of (kids.get(b.root_event_id) ?? [])) if (c.ordered === 1) trackIds.add(c.child_id);
    }

    // 이벤트 -> 어느 보드들에 속하나
    const member = new Map();
    for (const b of boardRows) {
      for (const ev of this.#descendants(b.root_event_id, kids)) {
        if (!member.has(ev)) member.set(ev, { ids: new Set(), names: new Set() });
        member.get(ev).ids.add(b.id);
        member.get(ev).names.add(b.name);
      }
    }

    // 본질은 한 번에 모아 읽는다(이벤트마다 쿼리하지 않는다 — 카드 열 때마다 호출되므로 속도).
    const need = new Set([...rootIds, ...trackIds, ...member.keys()]);
    const essById = new Map();
    if (need.size) {
      const ids = [...need];
      const ph = ids.map(() => '?').join(',');
      for (const e of this.db.prepare(
        `SELECT id, title, type AS ty, start_date AS s, end_date AS e,
                status AS st, org AS og, progress AS pg, note FROM event WHERE id IN (${ph})`,
      ).all(...ids)) essById.set(e.id, e);
    }
    const memNames = (ev) => { const m = member.get(ev); return m ? [...m.names].join(',') : ''; };
    const memIds = (ev) => { const m = member.get(ev); return m ? [...m.ids].join(',') : ''; };

    const boards = boardRows.map((b) => {
      const e = essById.get(b.root_event_id) ?? { id: b.root_event_id, title: b.name };
      return { ...e, boardNames: b.name, boardIds: String(b.id), boardId: b.id, kind: 'board' };
    });

    const tracks = [...trackIds].map((ev) => {
      const e = essById.get(ev);
      return e ? { ...e, boardNames: memNames(ev), boardIds: memIds(ev), kind: 'track' } : null;
    }).filter(Boolean);

    const cards = [];
    for (const ev of member.keys()) {
      if (rootIds.has(ev) || trackIds.has(ev)) continue;
      const e = essById.get(ev);
      if (!e || e.ty === 'task') continue;   // 태스크는 후보에서 뺀다
      cards.push({ ...e, boardNames: memNames(ev), boardIds: memIds(ev), kind: 'card' });
    }

    return [...boards, ...tracks, ...cards];
  }

  /**
   * 한 이벤트가 품은 카드들(순서 있는 후손, 태스크 제외). 조합(combine)한 이벤트의 안쪽
   * 일정을 '상세' 탭에 펼쳐 보여줄 때 쓴다. 그 이벤트의 홈 보드가 어디든 따라간다.
   * @returns {{id, title, status, depth}[]}
   */
  eventCards(eventId) {
    const kids = this.#childMap();
    const out = [];
    const seen = new Set();
    const walk = (id, depth) => {
      for (const c of (kids.get(id) ?? [])) {
        if (c.ordered !== 1 || seen.has(c.child_id)) continue;
        seen.add(c.child_id);
        out.push({ id: c.child_id, depth });
        walk(c.child_id, depth + 1);
      }
    };
    walk(eventId, 0);
    if (!out.length) return [];
    const ids = out.map((o) => o.id);
    const ph = ids.map(() => '?').join(',');
    const ess = new Map();
    for (const e of this.db.prepare(
      `SELECT id, title, status, type FROM event WHERE id IN (${ph})`,
    ).all(...ids)) ess.set(e.id, e);
    return out
      .map((o) => ({ id: o.id, depth: o.depth, title: ess.get(o.id)?.title ?? '', status: ess.get(o.id)?.status ?? 'plan', type: ess.get(o.id)?.type ?? 'bar' }))
      .filter((r) => r.type !== 'task');
  }

  /**
   * 새 보드를 만들고 문서를 채운다.
   * @returns {number} 새 보드 id
   */
  createProject(doc, name) {
    const create = this.db.transaction(() => {
      const info = this.db.prepare(`
        INSERT INTO board (name, start_date, end_date, doc_version, opened_at)
        VALUES (?, ?, ?, ?, datetime('now','localtime'))
      `).run(name, doc.meta.start, doc.meta.end, doc.version ?? 1);

      const id = Number(info.lastInsertRowid);
      const previous = this.boardId;
      this.boardId = id;
      try {
        this.save({ ...doc, meta: { ...doc.meta, name } }, '새 프로젝트');
      } catch (err) {
        this.boardId = previous;
        throw err;
      }
      return id;
    });
    return create();
  }

  /** 보드 삭제 = 배치의 삭제(규칙 2). 이벤트는 남긴다 — 다른 보드에 쓰일 수 있으므로. */
  deleteProject(id) {
    const del = this.db.transaction(() => {
      const b = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(id);
      if (b?.root_event_id) {
        const parents = new Set([b.root_event_id, ...this.#descendants(b.root_event_id)]);
        const ph = [...parents].map(() => '?').join(',');
        // 이 보드가 여는 서브트리의 표시(배치)·포함 골격만 지운다. 이벤트 본질은 남긴다.
        this.db.prepare(`DELETE FROM disp        WHERE parent_id IN (${ph})`).run(...parents);
        this.db.prepare(`DELETE FROM containment WHERE parent_id IN (${ph})`).run(...parents);
      }
      this.db.prepare('DELETE FROM org  WHERE board_id = ?').run(id);
      this.db.prepare('DELETE FROM band WHERE board_id = ?').run(id);
      this.db.prepare('DELETE FROM board WHERE id = ?').run(id);
    });
    del();
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
   * 4대상 테이블에서 렌더러 문서를 재구성한다.
   *   보드 = 루트 이벤트. 트랙 = 루트의 순서 있는 자식. 카드 = 트랙 아래 순서 있는 후손.
   *   걸침(sp) = 한 카드가 이웃 트랙들에 함께 소속된 수(다중 소속). 태스크 = 순서 없는 자식.
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
      'SELECT id, from_date, to_date, label, scale FROM band WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId)
      .map((r) => ({ id: r.id, from: r.from_date, to: r.to_date, label: r.label, scale: r.scale }));

    const base = {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: board.name },
      orgs, bands, tracks: [], relations: [], items: [],
    };
    if (!root) return base;

    const cont = this.db.prepare('SELECT parent_id, child_id, ordered, ord FROM containment').all();
    const kids = new Map();
    for (const c of cont) {
      if (!kids.has(c.parent_id)) kids.set(c.parent_id, []);
      kids.get(c.parent_id).push(c);
    }
    for (const arr of kids.values()) arr.sort((a, b) => a.ord - b.ord);

    // 트랙 = 루트의 순서 있는 자식
    const trackEdges = (kids.get(root) ?? []).filter((c) => c.ordered === 1);
    const trackIds = trackEdges.map((c) => c.child_id);
    const trackIndex = new Map(trackIds.map((id, i) => [id, i]));
    const trackSet = new Set(trackIds);

    // 다른 보드의 구조 이벤트(그 보드의 루트·트랙)는 이 보드에선 '접힌 참조 카드'로만 보인다.
    // 그 아래(그 보드의 카드들)를 이 보드로 끌어오지 않는다 — 안 그러면 남의 보드 내용이
    // 여기로 쏟아진다(펼치기=board, 접기=card).
    const foreign = new Set();
    for (const b of this.db.prepare('SELECT root_event_id FROM board WHERE root_event_id IS NOT NULL').all()) {
      const r = b.root_event_id;
      if (r === root) continue;
      foreign.add(r);
      for (const c of (kids.get(r) ?? [])) if (c.ordered === 1) foreign.add(c.child_id);
    }

    // 서브트리 이벤트 + 본질. 조합(ordered=2)·남의 보드 구조는 층을 끌어오지 않는다(참조는 잎).
    const inSub = new Set();
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const c of (kids.get(n) ?? [])) {
        if (c.ordered === 2) continue;
        if (!inSub.has(c.child_id)) {
          inSub.add(c.child_id);
          if (!foreign.has(c.child_id)) stack.push(c.child_id);   // 참조 카드는 더 안 판다
        }
      }
    }
    const evIds = [...inSub, root];
    const evById = new Map();
    if (evIds.length) {
      const ph = evIds.map(() => '?').join(',');
      for (const e of this.db.prepare(`SELECT * FROM event WHERE id IN (${ph})`).all(...evIds)) {
        evById.set(e.id, e);
      }
    }

    // 표시는 이 보드의 부모(루트+서브트리) 것만 읽는다 — 전역 disp를 다 훑지 않는다(속도).
    const dispBy = new Map();
    if (evIds.length) {
      const ph = evIds.map(() => '?').join(',');
      for (const d of this.db.prepare(`SELECT * FROM disp WHERE parent_id IN (${ph})`).all(...evIds)) {
        dispBy.set(d.parent_id + SEP + d.child_id, d);
      }
    }

    const tracks = trackEdges.map((c) => {
      const ev = evById.get(c.child_id) ?? {};
      const d = dispBy.get(root + SEP + c.child_id) ?? {};
      return { id: c.child_id, lab: d.lab ?? '', name: ev.title ?? '', w: d.px_width ?? null };
    });

    // 카드 재구성
    const homeTrack = new Map();   // event -> 홈 트랙 id
    const docParent = new Map();   // event -> 부모 카드 id | null
    const spanOf = new Map();      // event -> 걸침 수
    const ordOf = new Map();       // event -> 형제 내 순서

    const trackMembers = new Map();
    for (const c of cont) {
      if (c.ordered !== 1 || !trackSet.has(c.parent_id) || !inSub.has(c.child_id)) continue;
      if (!trackMembers.has(c.child_id)) trackMembers.set(c.child_id, []);
      trackMembers.get(c.child_id).push(trackIndex.get(c.parent_id));
      ordOf.set(c.child_id, c.ord);
    }
    for (const [ev, idxs] of trackMembers) {
      idxs.sort((a, b) => a - b);
      homeTrack.set(ev, trackIds[idxs[0]]);
      spanOf.set(ev, idxs[idxs.length - 1] - idxs[0] + 1);
      docParent.set(ev, null);
    }
    // 중첩 카드: 최상위 카드에서 순서 있는 포함을 따라 내려간다. 참조 카드(남의 보드 구조)는
    // 잎이라 그 아래로 내려가지 않는다.
    const queue = [...trackMembers.keys()];
    while (queue.length) {
      const parent = queue.shift();
      if (foreign.has(parent)) continue;
      for (const c of (kids.get(parent) ?? [])) {
        if (c.ordered !== 1 || !inSub.has(c.child_id) || homeTrack.has(c.child_id)) continue;
        docParent.set(c.child_id, parent);
        homeTrack.set(c.child_id, homeTrack.get(parent));
        spanOf.set(c.child_id, 1);
        ordOf.set(c.child_id, c.ord);
        queue.push(c.child_id);
      }
    }

    // 태스크(순서 없는 포함)
    const tasksOf = new Map();
    for (const c of cont) {
      if (c.ordered !== 0 || !inSub.has(c.child_id)) continue;
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
      const d = dispBy.get(edgeParent + SEP + ev) ?? {};
      items.push({
        id: ev,
        s: e.start_date, e: e.end_date, ti: e.title, ty: e.type, st: e.status,
        og: e.org, pg: e.progress, note: e.note,
        parent: parentId,
        alias: d.alias ?? null,
        tasks: (tasksOf.get(ev) ?? []).map((t) => ({ id: t.id, text: t.text, done: t.done })),
        place: {
          t: homeTrack.get(ev), sp: spanOf.get(ev) ?? 1,
          x: d.pos_x ?? null, w: d.pos_w ?? null, hd: d.height_days ?? null,
          align: d.align ?? 'middle', showNote: d.show_note === 1,
        },
        _o: ordOf.get(ev) ?? 0,
      });
    }
    items.sort((a, b) =>
      (trackIndex.get(a.place.t) ?? 0) - (trackIndex.get(b.place.t) ?? 0) || a._o - b._o);
    items.forEach((it) => { delete it._o; });

    // 관계: rel(전역)에서. 선행(dep)은 양끝이 이 보드, 동일(same)은 보드를 넘으므로 한쪽만
    // 이 보드여도 싣는다. 포함(contain)은 item.parent에서 파생. 조합(combine)은
    // containment(ordered=2)에서 복원 — 부모가 이 보드 이벤트인 것.
    const relations = [];
    for (const r of this.db.prepare('SELECT id, type, from_id, to_id FROM rel').all()) {
      const keep = r.type === 'same'
        ? (inSub.has(r.from_id) || inSub.has(r.to_id))
        : (inSub.has(r.from_id) && inSub.has(r.to_id));
      if (keep) relations.push({ id: r.id, type: r.type, from: r.from_id, to: r.to_id });
    }
    for (const c of cont) {
      if (c.ordered === 2 && inSub.has(c.parent_id)) {
        relations.push({ id: `x_${c.parent_id}_${c.child_id}`, type: 'combine', from: c.parent_id, to: c.child_id });
      }
    }
    for (const it of items) {
      if (it.parent) relations.push({ id: `c_${it.id}`, type: 'contain', from: it.parent, to: it.id });
    }

    return {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: evById.get(root)?.title ?? board.name },
      orgs, bands, tracks, relations, items,
    };
  }

  /**
   * 문서 전체 저장. 트랜잭션 1회. 렌더러 문서를 4대상으로 분해한다.
   * @param {object} doc 렌더러 문서
   * @param {string} label 변경 설명 (리비전 라벨)
   */
  save(doc, label = '') {
    this.#requireBoard();
    const write = this.db.transaction(() => {
      // 루트 이벤트 id 확보
      const boardRow = this.db.prepare('SELECT root_event_id FROM board WHERE id = ?').get(this.boardId);
      let root = boardRow?.root_event_id;
      if (!root) root = `board:${this.boardId}`;

      // 트랙 이벤트 id는 보드마다 유일해야 한다 — 빈 보드가 모두 't0'을 쓰기 때문.
      // 보드 접두를 붙이되 멱등하게(이미 이 보드 접두면 그대로). 복제본은 원본의 트랙 id
      // ('track:{원본}:...')를 물고 오므로 반드시 이 보드 접두로 바꿔야 원본 데이터를 안 건드린다.
      const tkey = (raw) => (typeof raw === 'string' && raw.startsWith(`track:${this.boardId}:`))
        ? raw : `track:${this.boardId}:${raw}`;

      this.db.prepare(`
        INSERT INTO board (id, name, start_date, end_date, doc_version, root_event_id)
        VALUES (@id, @name, @start, @end, @docVersion, @root)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, start_date = @start, end_date = @end, doc_version = @docVersion,
          root_event_id = @root, updated_at = datetime('now','localtime')
      `).run({
        id: this.boardId,
        name: doc.meta.name ?? '로드맵',
        start: doc.meta.start, end: doc.meta.end,
        docVersion: doc.version ?? 1, root,
      });

      // 이 보드가 여는 구조가 부모로 삼는 이벤트들(옛/새)을 모아, 그 아래 포함·표시를 비운다.
      // 이벤트 본질은 공유될 수 있어 지우지 않는다(§3.4).
      const oldParents = new Set([root, ...this.#descendants(root)]);
      // 트랙은 반드시 tkey로 — doc.tracks[].id가 복제 원본의 id일 수 있어, 그대로 지우면
      // 원본 보드의 포함이 날아간다. (이게 복제 시 원본이 비던 버그의 원인이었다.)
      const newParents = new Set([root, ...doc.tracks.map((t) => tkey(t.id)), ...doc.items.map((it) => it.id)]);
      const clearParents = new Set([...oldParents, ...newParents]);
      if (clearParents.size) {
        const ph = [...clearParents].map(() => '?').join(',');
        this.db.prepare(`DELETE FROM containment WHERE parent_id IN (${ph})`).run(...clearParents);
        this.db.prepare(`DELETE FROM disp        WHERE parent_id IN (${ph})`).run(...clearParents);
      }
      // 관계를 갈아끼운다. 선행(dep)은 양끝이 이 보드일 때만. 동일(same)은 보드를 넘으므로
      // 한쪽만 이 보드여도 이 보드 저장이 갱신 주체다(규칙 8 — 관계는 보드 무관, 편집한 쪽이 쓴다).
      const itemIds = doc.items.map((it) => it.id);
      if (itemIds.length) {
        const ph = itemIds.map(() => '?').join(',');
        this.db.prepare(
          `DELETE FROM rel WHERE type = 'dep' AND from_id IN (${ph}) AND to_id IN (${ph})`,
        ).run(...itemIds, ...itemIds);
        this.db.prepare(
          `DELETE FROM rel WHERE type = 'same' AND (from_id IN (${ph}) OR to_id IN (${ph}))`,
        ).run(...itemIds, ...itemIds);
      }
      this.db.prepare('DELETE FROM org  WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM band WHERE board_id = ?').run(this.boardId);

      // 준비된 문장들
      const upEvent = this.db.prepare(`
        INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
        VALUES (@id, @title, @s, @e, @type, @status, @org, @pg, @note)
        ON CONFLICT(id) DO UPDATE SET
          title = @title, start_date = @s, end_date = @e, type = @type,
          status = @status, org = @org, progress = @pg, note = @note
      `);
      const insCont = this.db.prepare(
        'INSERT OR REPLACE INTO containment (parent_id, child_id, ordered, ord) VALUES (?, ?, ?, ?)',
      );
      const insDisp = this.db.prepare(`
        INSERT OR REPLACE INTO disp (parent_id, child_id, pos_x, pos_w, height_days, align, show_note, alias, lab, px_width)
        VALUES (@parent, @child, @x, @w, @hd, @align, @showNote, @alias, @lab, @pxWidth)
      `);
      const insRel = this.db.prepare(
        'INSERT OR IGNORE INTO rel (id, type, from_id, to_id) VALUES (?, ?, ?, ?)',
      );
      const insBand = this.db.prepare(
        'INSERT INTO band (board_id, id, ord, from_date, to_date, label, scale) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      const insOrg = this.db.prepare('INSERT INTO org (board_id, ord, name) VALUES (?, ?, ?)');

      (doc.bands ?? []).forEach((b, i) =>
        insBand.run(this.boardId, b.id, i, b.from, b.to, b.label ?? '', b.scale ?? 1));
      (doc.orgs ?? []).forEach((o, i) => insOrg.run(this.boardId, i, o));

      // 루트(보드) 이벤트
      upEvent.run({
        id: root, title: doc.meta.name ?? '로드맵', s: doc.meta.start, e: doc.meta.end,
        type: 'bar', status: 'plan', org: '', pg: 0, note: '',
      });

      // 트랙: 이벤트 + 포함(루트→트랙) + 표시(라벨·폭)
      doc.tracks.forEach((t, i) => {
        const tid = tkey(t.id);
        upEvent.run({
          id: tid, title: t.name ?? '', s: doc.meta.start, e: doc.meta.end,
          type: 'bar', status: 'plan', org: '', pg: 0, note: '',
        });
        insCont.run(root, tid, 1, i);
        insDisp.run({
          parent: root, child: tid, x: null, w: null, hd: null,
          align: 'middle', showNote: 0, alias: null, lab: t.lab ?? '', pxWidth: t.w ?? null,
        });
      });

      const trackAt = new Map(doc.tracks.map((t, i) => [tkey(t.id), i]));

      doc.items.forEach((it, i) => {
        const p = it.place ?? it;
        upEvent.run({
          id: it.id, title: it.ti ?? '', s: it.s, e: it.e, type: it.ty ?? 'bar',
          status: it.st ?? 'plan', org: it.og ?? '', pg: it.pg ?? 0, note: it.note ?? '',
        });
        // 부모 = 명시된 상위 카드, 없으면 홈 트랙
        const homeTrackId = tkey(p.t);
        const edgeParent = it.parent ?? homeTrackId;
        insCont.run(edgeParent, it.id, 1, i);
        insDisp.run({
          parent: edgeParent, child: it.id,
          x: p.x ?? null, w: p.w ?? null, hd: p.hd ?? null,
          align: p.align ?? 'middle', showNote: p.showNote ? 1 : 0, alias: it.alias ?? null,
          lab: null, pxWidth: null,
        });
        // 걸침: 홈 트랙 다음 (sp-1)개 트랙에도 소속(다중 소속). 최상위 카드에만.
        const sp = p.sp ?? 1;
        if (!it.parent && sp > 1 && trackAt.has(homeTrackId)) {
          const from = trackAt.get(homeTrackId);
          for (let k = 1; k < sp && from + k < doc.tracks.length; k += 1) {
            insCont.run(tkey(doc.tracks[from + k].id), it.id, 1, i);
          }
        }
        // 태스크: 이벤트 + 순서 없는 포함
        (Array.isArray(it.tasks) ? it.tasks : []).forEach((t, ti) => {
          upEvent.run({
            id: t.id, title: t.text ?? '', s: it.s, e: it.e, type: 'task',
            status: t.done ? 'done' : 'plan', org: '', pg: 0, note: '',
          });
          insCont.run(it.id, t.id, 0, ti);
        });
      });

      // 관계 쓰기. 선행·동일은 rel 테이블. 포함(contain)은 item.parent에서 파생이라 안 넣는다.
      // 조합(combine)은 '이 이벤트가 여러 이벤트의 합' — 포함이므로 containment(ordered=2)에 넣되,
      // 부품(자식)은 다른 보드일 수 있어 이 보드 층에는 끌어오지 않는다.
      const idSet = new Set(itemIds);
      if (Array.isArray(doc.relations)) {
        for (const rel of doc.relations) {
          if (rel.type === 'dep' || rel.type === 'same') {
            insRel.run(rel.id || `r_${rel.from}_${rel.to}`, rel.type, rel.from, rel.to);
          } else if (rel.type === 'combine' && idSet.has(rel.from)) {
            insCont.run(rel.from, rel.to, 2, 0);
          }
        }
        // 동일(same)로 묶인 이벤트끼리 본질을 맞춘다 — 보드를 넘어 공유(§3.4). 편집한 이 보드가
        // 원본이라, 이 보드의 이벤트 본질을 반대쪽(다른 보드일 수 있음)에 복사한다. 별칭은 배치라 제외.
        // 트랙·보드(루트)도 이벤트라 원본이 될 수 있다 — 트랙 이름을 바꾸면 동일 카드에 반영된다(§3.2).
        const essenceIds = new Set([...itemIds, root, ...doc.tracks.map((t) => tkey(t.id))]);
        const getEss = this.db.prepare(
          'SELECT title, start_date AS s, end_date AS e, type, status, org, progress AS pg, note FROM event WHERE id = ?',
        );
        for (const rel of doc.relations) {
          if (rel.type !== 'same') continue;
          const src = essenceIds.has(rel.from) ? rel.from : (essenceIds.has(rel.to) ? rel.to : null);
          const dst = src === rel.from ? rel.to : rel.from;
          if (!src || src === dst) continue;
          const e = getEss.get(src);
          if (e) upEvent.run({ id: dst, title: e.title, s: e.s, e: e.e, type: e.type, status: e.status, org: e.org, pg: e.pg, note: e.note });
        }
      } else {
        for (const it of doc.items) {
          for (const dep of it.dp ?? []) insRel.run(`r_${dep}_${it.id}`, 'dep', dep, it.id);
        }
      }

      this.#maybeRevision(doc, label);
    });

    write();
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
