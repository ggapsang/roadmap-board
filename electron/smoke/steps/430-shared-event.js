// 스모크 단계 'shared-event' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'shared-event',
  areas: ["db"],
  async run({ target, db, opened, wrote }) {
    // 이벤트를 보드 밖으로 뺀 핵심 검증 — 같은 이벤트를 두 보드에 두면 본질이 공유되고,
    // 보드를 지워도 이벤트는 남는다 (§3.4·규칙 2). 배치=포함(containment)으로 확인한다.
    let shared = null;
    if (wrote) {
      try {
        const bid = opened.opened;
        const first = db.prepare(
          `SELECT cc.child_id AS id FROM board b
           JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.compose = 1
           JOIN containment cc ON cc.parent_id = tc.child_id AND cc.ordered = 1
           WHERE b.id = ? ORDER BY tc.ord, cc.ord LIMIT 1`,
        ).get(bid);
        const eventId = first.id;
        const root2 = 'board:shared-test';
        db.prepare(
          "INSERT OR IGNORE INTO event (id, title, start_date, end_date, type, status, org, progress, note) VALUES (?, '공유 테스트','2026-09-21','2027-04-04','bar','plan','',0,'')",
        ).run(root2);
        const b2 = db.prepare(
          "INSERT INTO board (name, start_date, end_date, doc_version, root_event_id) VALUES ('공유 테스트','2026-09-21','2027-04-04',17, ?)",
        ).run(root2);
        const b2id = Number(b2.lastInsertRowid);
        // 같은 이벤트를 두 번째 보드의 루트 밑에 포함으로도 둔다 (다중 소속)
        db.prepare('INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord) VALUES (?, ?, 1, 0)').run(root2, eventId);
        // 본질을 한 번 바꾸면 두 보드가 함께 반영 (본질은 전역 하나)
        db.prepare("UPDATE event SET status = 'done' WHERE id = ?").run(eventId);
        const st = db.prepare('SELECT status FROM event WHERE id = ?').get(eventId)?.status;
        const places = db.prepare('SELECT count(*) c FROM containment WHERE child_id = ?').get(eventId).c;
        // 보드 삭제 = 배치 삭제. 이벤트는 남아야 한다.
        db.prepare('DELETE FROM containment WHERE parent_id = ?').run(root2);
        db.prepare('DELETE FROM board WHERE id = ?').run(b2id);
        const survives = !!db.prepare('SELECT id FROM event WHERE id = ?').get(eventId);
        shared = st === 'done' && places >= 2 && survives;
        console.log('[smoke] shared-event ' + JSON.stringify({ shared, places, st, survives }));
      } catch (err) { console.log('[smoke] shared-event FAIL ' + err); shared = false; }
    }
    return shared;
  },
  check: (shared) => shared === true,
};
