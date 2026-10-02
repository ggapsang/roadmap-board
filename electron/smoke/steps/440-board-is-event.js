// 스모크 단계 'board-is-event' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'board-is-event',
  areas: ["db"],
  async run({ target, db, opened, wrote }) {
    // 보드도 이벤트다 — 각 보드에 루트 이벤트가 있고 그 본질이 보드에 맞춰진다 (§3.2·§5.1)
    let boardEvent = null;
    if (wrote) {
      try {
        const b = db.prepare('SELECT name, root_event_id FROM board WHERE id = ?').get(opened.opened);
        const ev = b?.root_event_id ? db.prepare('SELECT id, title FROM event WHERE id = ?').get(b.root_event_id) : null;
        boardEvent = !!ev && ev.title === b.name;
        console.log('[smoke] board-is-event ' + JSON.stringify({ boardEvent, root: b?.root_event_id, title: ev?.title }));
      } catch (err) { console.log('[smoke] board-is-event FAIL ' + err); boardEvent = false; }
    }
    return boardEvent;
  },
  check: (boardEvent) => boardEvent === true,
};
