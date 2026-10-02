// 스모크 단계 'task-is-event' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'task-is-event',
  areas: ["db"],
  requires: ['task'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target, db, wrote }) {
    // 태스크도 이벤트다 — 순서 없는 포함(ordered=0, 구성 아님)의 자식은 type='task' 이벤트다 (§3.2·§3.3)
    let taskEvent = null;
    if (wrote) {
      try {
        const et = db.prepare('SELECT child_id AS id FROM containment WHERE ordered = 0 AND compose = 0 LIMIT 1').get();
        const ev = et ? db.prepare('SELECT type, title FROM event WHERE id = ?').get(et.id) : null;
        taskEvent = !!ev && ev.type === 'task';
        console.log('[smoke] task-is-event ' + JSON.stringify({ taskEvent, id: et?.id, type: ev?.type }));
      } catch (err) { console.log('[smoke] task-is-event FAIL ' + err); taskEvent = false; }
    }
    return taskEvent;
  },
  check: (taskEvent) => taskEvent === true,
};
