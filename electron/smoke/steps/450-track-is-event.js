// 스모크 단계 'track-is-event' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'track-is-event',
  areas: ["db"],
  async run({ target, db, opened, wrote }) {
    // 트랙도 이벤트다 — 트랙은 루트의 순서 있는 자식이고, 그 자체가 event다 (§3.2)
    let trackEvent = null;
    if (wrote) {
      try {
        const tr = db.prepare(
          `SELECT tc.child_id AS id, e.title FROM board b
           JOIN containment tc ON tc.parent_id = b.root_event_id AND tc.compose = 1
           JOIN event e ON e.id = tc.child_id
           WHERE b.id = ? ORDER BY tc.ord LIMIT 1`,
        ).get(opened.opened);
        trackEvent = !!tr && typeof tr.title === 'string';
        console.log('[smoke] track-is-event ' + JSON.stringify({ trackEvent, event: tr?.id, title: tr?.title }));
      } catch (err) { console.log('[smoke] track-is-event FAIL ' + err); trackEvent = false; }
    }
    return trackEvent;
  },
  check: (trackEvent) => trackEvent === true,
};
