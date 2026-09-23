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
  constructor(db) {
    this.db = db;
    this.boardId = 1;              // 현재는 단일 보드 (기획안 P1 "문서 1건")
  }

  /** @returns {object|null} 렌더러 문서. 아직 아무것도 없으면 null. */
  load() {
    const board = this.db.prepare('SELECT * FROM board WHERE id = ?').get(this.boardId);
    if (!board) return null;

    const tracks = this.db.prepare(
      'SELECT id, lab, name FROM track WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId);

    const orgs = this.db.prepare(
      'SELECT name FROM org WHERE board_id = ? ORDER BY ord',
    ).all(this.boardId).map((r) => r.name);

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
      tracks,
      items: rows.map((r) => ({
        id: r.id, t: r.track_id, sp: r.span,
        s: r.start_date, e: r.end_date,
        ti: r.title, ty: r.type, st: r.status,
        og: r.org, pg: r.progress, note: r.note,
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

      const insOrg = this.db.prepare(
        'INSERT INTO org (board_id, ord, name) VALUES (?, ?, ?)',
      );
      (doc.orgs ?? []).forEach((o, i) => insOrg.run(this.boardId, i, o));

      const insTrack = this.db.prepare(
        'INSERT INTO track (board_id, id, ord, lab, name) VALUES (?, ?, ?, ?, ?)',
      );
      doc.tracks.forEach((t, i) => insTrack.run(this.boardId, t.id, i, t.lab ?? '', t.name));

      const insItem = this.db.prepare(`
        INSERT INTO item (board_id, id, track_id, ord, span, start_date, end_date,
                          title, type, status, org, progress, note)
        VALUES (@board, @id, @track, @ord, @span, @s, @e, @title, @type, @status, @org, @pg, @note)
      `);
      const insDep = this.db.prepare(
        'INSERT OR IGNORE INTO dependency (board_id, item_id, depends_on) VALUES (?, ?, ?)',
      );

      doc.items.forEach((it, i) => {
        insItem.run({
          board: this.boardId, id: it.id, track: it.t, ord: i, span: it.sp ?? 1,
          s: it.s, e: it.e, title: it.ti ?? '', type: it.ty ?? 'bar',
          status: it.st ?? 'plan', org: it.og ?? '', pg: it.pg ?? 0, note: it.note ?? '',
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

  /** 변경 이력 목록 (문서 본문 제외) */
  listRevisions(limit = 50) {
    return this.db.prepare(`
      SELECT id, created_at, label, items FROM revision
      WHERE board_id = ? ORDER BY id DESC LIMIT ?
    `).all(this.boardId, limit);
  }

  /** 특정 리비전의 문서 */
  getRevision(id) {
    const row = this.db.prepare(
      'SELECT doc FROM revision WHERE board_id = ? AND id = ?',
    ).get(this.boardId, id);
    return row ? JSON.parse(row.doc) : null;
  }

  /** 보드 비우기 — 기본 로드맵 복원 전에 호출 */
  clear() {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM board WHERE id = ?').run(this.boardId);
    })();
  }
}
