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

    const depMap = new Map();
    for (const d of deps) {
      if (!depMap.has(d.item_id)) depMap.set(d.item_id, []);
      depMap.get(d.item_id).push(d.depends_on);
    }

    return {
      version: board.doc_version,
      meta: { start: board.start_date, end: board.end_date, name: board.name },
      orgs,
      bands,
      tracks,
      items: rows.map((r) => ({
        id: r.id, t: r.track_id, sp: r.span,
        s: r.start_date, e: r.end_date,
        ti: r.title, ty: r.type, st: r.status,
        og: r.org, pg: r.progress, note: r.note,
        parent: r.parent_id ?? null,
        x: r.pos_x, w: r.pos_w,
        place: { align: r.align, showNote: r.show_note === 1, hd: r.height_days ?? null },
        dp: depMap.get(r.id) ?? [],
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

      doc.items.forEach((it, i) => {
        insItem.run({
          board: this.boardId, id: it.id, track: it.t, ord: i, span: it.sp ?? 1,
          s: it.s, e: it.e, title: it.ti ?? '', type: it.ty ?? 'bar',
          status: it.st ?? 'plan', org: it.og ?? '', pg: it.pg ?? 0, note: it.note ?? '',
          parent: it.parent ?? null, x: it.x ?? null, w: it.w ?? null,
          hd: it.place?.hd ?? null,
          align: it.place?.align ?? 'middle', showNote: it.place?.showNote ? 1 : 0,
        });
      });
      // 선행 참조는 모든 item이 들어간 뒤에 (FK 충족)
      for (const it of doc.items) {
        for (const dep of it.dp ?? []) insDep.run(this.boardId, it.id, dep);
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
