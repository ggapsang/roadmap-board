/**
 * 문서 저장소 — 렌더러가 쓰는 문서 모양({meta, tracks, items})과
 * 정규화된 테이블 사이를 오간다.
 *
 * 저장은 "보드 하나를 통째로 다시 쓰기"다. 일정 수십~수백 건 규모에서는
 * 트랜잭션 한 번이면 끝나고, 부분 갱신 로직을 두는 것보다 정합성이 확실하다.
 * 규모가 커지면 이 함수 안만 바꾸면 된다.
 */

/** 리비전을 남기는 최소 간격(분). 타이핑 한 글자마다 스냅샷이 쌓이는 걸 막는다. */
const REVISION_INTERVAL_MIN = 5;
/** 보관할 리비전 수 */
const REVISION_KEEP = 200;

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

  // ── 프로젝트 목록 ───────────────────────────────────────

  /** 최근 연 순서. 목록 화면용이라 문서 본문은 싣지 않는다. */
  listProjects() {
    return this.db.prepare(`
      SELECT b.id, b.name, b.start_date AS start, b.end_date AS end,
             b.updated_at AS updatedAt, b.opened_at AS openedAt,
             (SELECT count(*) FROM item  WHERE board_id = b.id) AS items,
             (SELECT count(*) FROM track WHERE board_id = b.id) AS tracks
      FROM board b
      ORDER BY COALESCE(b.opened_at, b.updated_at) DESC, b.id DESC
    `).all();
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

  deleteProject(id) {
    // board의 자식은 전부 ON DELETE CASCADE다
    this.db.prepare('DELETE FROM board WHERE id = ?').run(id);
    if (this.boardId === id) this.boardId = null;
  }

  renameProject(id, name) {
    this.db.prepare(
      "UPDATE board SET name = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    ).run(name, id);
  }

  /** 문서를 그대로 복사해 새 보드를 만든다 */
  duplicateProject(id, name) {
    const previous = this.boardId;
    this.boardId = id;
    let doc;
    try { doc = this.load(); } finally { this.boardId = previous; }
    if (!doc) throw new Error('복제할 프로젝트를 찾을 수 없습니다.');
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

  /** @returns {object|null} 렌더러 문서. 아직 아무것도 없으면 null. */
  load() {
    if (this.boardId == null) return null;
    const board = this.db.prepare('SELECT * FROM board WHERE id = ?').get(this.boardId);
    if (!board) return null;

    const tracks = this.db.prepare(
      'SELECT id, lab, name, width FROM track WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId).map((t) => ({ id: t.id, lab: t.lab, name: t.name, w: t.width }));

    const orgs = this.db.prepare(
      'SELECT name FROM org WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId).map((r) => r.name);

    const bands = this.db.prepare(
      'SELECT id, from_date, to_date, label, scale FROM band WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId)
      .map((r) => ({ id: r.id, from: r.from_date, to: r.to_date, label: r.label, scale: r.scale }));

    const rows = this.db.prepare(
      'SELECT * FROM item WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId);

    const deps = this.db.prepare(
      'SELECT item_id, depends_on FROM dependency WHERE board_id = ?',
    ).all(this.boardId);

    // 순서 없는 태스크 — item_id로 묶어 각 일정에 붙인다.
    const taskRows = this.db.prepare(
      'SELECT id, item_id, text, done FROM task WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId);
    const tasksByItem = new Map();
    for (const t of taskRows) {
      if (!tasksByItem.has(t.item_id)) tasksByItem.set(t.item_id, []);
      tasksByItem.get(t.item_id).push({ id: t.id, text: t.text, done: t.done === 1 });
    }

    // 선행(dependency) 테이블 = 'dep' 종류의 관계. from=선행(depends_on), to=후행(item_id).
    const relations = deps.map((d) => ({ id: `r_${d.item_id}_${d.depends_on}`, type: 'dep', from: d.depends_on, to: d.item_id }));
    // 포함(contain)은 item.parent_id에서 노출한다 (렌더는 item.parent를 그대로 쓴다).
    for (const r of rows) {
      if (r.parent_id) relations.push({ id: `c_${r.id}`, type: 'contain', from: r.parent_id, to: r.id });
    }

    return {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: board.name },
      orgs,
      bands,
      tracks,
      relations,
      items: rows.map((r) => ({
        id: r.id,
        s: r.start_date, e: r.end_date,
        ti: r.title, ty: r.type, st: r.status,
        og: r.org, pg: r.progress, note: r.note,
        parent: r.parent_id ?? null,
        tasks: tasksByItem.get(r.id) ?? [],
        place: {
          t: r.track_id, sp: r.span,
          align: r.align, showNote: r.show_note === 1, hd: r.height_days ?? null, x: r.pos_x, w: r.pos_w,
        },
      })),
    };
  }

  /**
   * 문서 전체 저장. 트랜잭션 1회.
   * @param {object} doc 렌더러 문서
   * @param {string} label 변경 설명 (리비전 라벨)
   */
  save(doc, label = '') {
    this.#requireBoard();
    const write = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO board (id, name, start_date, end_date, doc_version)
        VALUES (@id, @name, @start, @end, @docVersion)
        ON CONFLICT(id) DO UPDATE SET
          name = @name, start_date = @start, end_date = @end, doc_version = @docVersion,
          updated_at = datetime('now','localtime')
      `).run({
        id: this.boardId,
        name: doc.meta.name ?? '로드맵',
        start: doc.meta.start,
        end: doc.meta.end,
        docVersion: doc.version ?? 1,
      });

      // 자식 테이블을 비우고 다시 채운다. FK CASCADE가 dependency까지 정리한다.
      this.db.prepare('DELETE FROM item WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM track WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM org WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM band WHERE board_id = ?').run(this.boardId);

      const insBand = this.db.prepare(
        'INSERT INTO band (board_id, id, ord, from_date, to_date, label, scale) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      (doc.bands ?? []).forEach((b, i) =>
        insBand.run(this.boardId, b.id, i, b.from, b.to, b.label ?? '', b.scale ?? 1));

      const insOrg = this.db.prepare(
        'INSERT INTO org (board_id, ord, name) VALUES (?, ?, ?)',
      );
      (doc.orgs ?? []).forEach((o, i) => insOrg.run(this.boardId, i, o));

      const insTrack = this.db.prepare(
        'INSERT INTO track (board_id, id, ord, lab, name, width) VALUES (?, ?, ?, ?, ?, ?)',
      );
      doc.tracks.forEach((t, i) => insTrack.run(this.boardId, t.id, i, t.lab ?? '', t.name, t.w ?? null));

      const insItem = this.db.prepare(`
        INSERT INTO item (board_id, id, track_id, ord, span, start_date, end_date,
                          title, type, status, org, progress, note,
                          parent_id, pos_x, pos_w, height_days, align, show_note)
        VALUES (@board, @id, @track, @ord, @span, @s, @e, @title, @type, @status, @org, @pg, @note,
                @parent, @x, @w, @hd, @align, @showNote)
      `);
      const insDep = this.db.prepare(
        'INSERT OR IGNORE INTO dependency (board_id, item_id, depends_on) VALUES (?, ?, ?)',
      );
      const insTask = this.db.prepare(
        'INSERT INTO task (board_id, id, item_id, ord, text, done) VALUES (?, ?, ?, ?, ?, ?)',
      );

      doc.items.forEach((it, i) => {
        // place(정규화된 배치) 또는 flat(정규화 전) 둘 다 받는다.
        const p = it.place ?? it;
        insItem.run({
          board: this.boardId, id: it.id, track: p.t, ord: i, span: p.sp ?? 1,
          s: it.s, e: it.e, title: it.ti ?? '', type: it.ty ?? 'bar',
          status: it.st ?? 'plan', org: it.og ?? '', pg: it.pg ?? 0, note: it.note ?? '',
          parent: it.parent ?? null, x: p.x ?? null, w: p.w ?? null,
          hd: p.hd ?? null,
          align: p.align ?? 'middle', showNote: p.showNote ? 1 : 0,
        });
        // 태스크는 item 뒤에 (FK 충족). item DELETE가 CASCADE로 옛 태스크를 이미 지웠다.
        (Array.isArray(it.tasks) ? it.tasks : []).forEach((t, ti) =>
          insTask.run(this.boardId, t.id, it.id, ti, t.text ?? '', t.done ? 1 : 0));
      });
      // 선행 관계는 모든 item이 들어간 뒤에 (FK 충족). relations의 'dep' 종류를 저장.
      // 정규화 전 문서(item.dp만 있는 경우)도 관대하게 받는다.
      if (Array.isArray(doc.relations)) {
        for (const rel of doc.relations) {
          if (rel.type === 'dep') insDep.run(this.boardId, rel.to, rel.from);
        }
      } else {
        for (const it of doc.items) {
          for (const dep of it.dp ?? []) insDep.run(this.boardId, it.id, dep);
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
