/**
 * 문서 저장소 — 렌더러가 쓰는 문서 모양({meta, tracks, items})과
 * 정규화된 테이블 사이를 오간다.
 *
 * 저장은 "보드 하나를 통째로 다시 쓰기"다. 일정 수십~수백 건 규모에서는
 * 트랜잭션 한 번이면 끝나고, 부분 갱신 로직을 두는 것보다 정합성이 확실하다.
 * 규모가 커지면 이 함수 안만 바꾸면 된다.
 */
import { reidentify } from '../../src/core/schema.js';

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
             (SELECT count(*) FROM placement WHERE board_id = b.id) AS items,
             (SELECT count(*) FROM track     WHERE board_id = b.id) AS tracks
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

    // 이 보드의 배치 + 각 배치가 가리키는 이벤트 본질. item = event(본질) + placement(배치).
    const rows = this.db.prepare(`
      SELECT e.id AS id, e.title, e.start_date, e.end_date, e.type, e.status, e.org, e.progress, e.note,
             p.track_id, p.span, p.pos_x, p.pos_w, p.height_days, p.align, p.show_note, p.parent_id
      FROM placement p JOIN event e ON e.id = p.event_id
      WHERE p.board_id = ? ORDER BY p.ord
    `).all(this.boardId);

    // 순서 없는 태스크 — 이벤트에 딸린다(보드 무관). 이 보드의 이벤트 것만 모은다.
    const eventIds = rows.map((r) => r.id);
    const tasksByEvent = new Map();
    if (eventIds.length) {
      const ph = eventIds.map(() => '?').join(',');
      const taskRows = this.db.prepare(
        `SELECT id, event_id, text, done FROM event_task WHERE event_id IN (${ph}) ORDER BY ord`,
      ).all(...eventIds);
      for (const t of taskRows) {
        if (!tasksByEvent.has(t.event_id)) tasksByEvent.set(t.event_id, []);
        tasksByEvent.get(t.event_id).push({ id: t.id, text: t.text, done: t.done === 1 });
      }
    }

    // 선행(dep)은 relation 테이블에서, 포함(contain)은 배치의 parent_id에서 파생한다.
    const relations = this.db.prepare(
      'SELECT id, type, from_id, to_id FROM relation WHERE board_id = ?',
    ).all(this.boardId).map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id }));
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
        tasks: tasksByEvent.get(r.id) ?? [],
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

      // 이 보드의 배치·관계·구성을 비운다. 이벤트 본질은 공유될 수 있어 지우지 않고
      // 아래에서 UPSERT한다(§3.4). 이 보드가 갖고 있던 이벤트의 태스크는 함께 정리한다.
      const oldEventIds = this.db.prepare('SELECT event_id FROM placement WHERE board_id = ?')
        .all(this.boardId).map((r) => r.event_id);
      this.db.prepare('DELETE FROM placement WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM relation  WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM track WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM org   WHERE board_id = ?').run(this.boardId);
      this.db.prepare('DELETE FROM band  WHERE board_id = ?').run(this.boardId);
      if (oldEventIds.length) {
        const ph = oldEventIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM event_task WHERE event_id IN (${ph})`).run(...oldEventIds);
      }

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

      // 이벤트 본질은 UPSERT — 같은 이벤트가 여러 보드에 있어도 하나의 본질을 공유한다(§3.4).
      const upEvent = this.db.prepare(`
        INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
        VALUES (@id, @title, @s, @e, @type, @status, @org, @pg, @note)
        ON CONFLICT(id) DO UPDATE SET
          title = @title, start_date = @s, end_date = @e, type = @type,
          status = @status, org = @org, progress = @pg, note = @note
      `);
      const insPlace = this.db.prepare(`
        INSERT INTO placement (board_id, event_id, track_id, ord, span,
                               pos_x, pos_w, height_days, align, show_note, parent_id)
        VALUES (@board, @id, @track, @ord, @span, @x, @w, @hd, @align, @showNote, @parent)
      `);
      const insTask = this.db.prepare(
        'INSERT OR REPLACE INTO event_task (id, event_id, ord, text, done) VALUES (?, ?, ?, ?, ?)',
      );
      const insRel = this.db.prepare(
        'INSERT OR IGNORE INTO relation (board_id, id, type, from_id, to_id) VALUES (?, ?, ?, ?, ?)',
      );

      doc.items.forEach((it, i) => {
        // place(정규화된 배치) 또는 flat(정규화 전) 둘 다 받는다.
        const p = it.place ?? it;
        upEvent.run({
          id: it.id, title: it.ti ?? '', s: it.s, e: it.e, type: it.ty ?? 'bar',
          status: it.st ?? 'plan', org: it.og ?? '', pg: it.pg ?? 0, note: it.note ?? '',
        });
        insPlace.run({
          board: this.boardId, id: it.id, track: p.t, ord: i, span: p.sp ?? 1,
          x: p.x ?? null, w: p.w ?? null, hd: p.hd ?? null,
          align: p.align ?? 'middle', showNote: p.showNote ? 1 : 0, parent: it.parent ?? null,
        });
        // 태스크는 이벤트 뒤에 (FK 충족).
        (Array.isArray(it.tasks) ? it.tasks : []).forEach((t, ti) =>
          insTask.run(t.id, it.id, ti, t.text ?? '', t.done ? 1 : 0));
      });

      // 선행 관계('dep')만 relation 테이블에. 포함(contain)은 placement.parent_id에서 파생.
      // 정규화 전 문서(item.dp만 있는 경우)도 관대하게 받는다.
      if (Array.isArray(doc.relations)) {
        for (const rel of doc.relations) {
          if (rel.type !== 'dep') continue;
          insRel.run(this.boardId, rel.id || `r_${rel.from}_${rel.to}`, 'dep', rel.from, rel.to);
        }
      } else {
        for (const it of doc.items) {
          for (const dep of it.dp ?? []) insRel.run(this.boardId, `r_${dep}_${it.id}`, 'dep', dep, it.id);
        }
      }

      // 어느 보드에도 놓이지 않은 이벤트는 정리한다(지금은 배치 없는 이벤트가 의미 없다).
      this.db.prepare('DELETE FROM event WHERE id NOT IN (SELECT event_id FROM placement)').run();

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
