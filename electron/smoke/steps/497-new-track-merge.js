// 스모크 단계 'new-track-merge' — 방금 추가한 트랙도 다시 읽지 않고 곧바로 항등설정(합치기)·다른 보드 자리 보기가 된다(2026-11-06 사용자).
// 예전엔 저장이 새 트랙 id에 'track:{보드}:'를 붙여, 열린 화면의 id(원래 것)로는 DB에서 '이벤트를 찾을 수 없음'이었다.
//   새 트랙 id = DB 이벤트 id · 보드를 만들어도 접두 id가 생기지 않는다 · 합치기(상대를 남긴다·이쪽을 남긴다) 둘 다 ·
//   026 마이그레이션 — 옛 접두 id를 모든 곳(4대상·보드 루트·메모·이력·호스팅)에서 같은 새 id로 옮긴다
import { createRequire } from 'node:module';
import path from 'node:path';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);

/** 026을 작은 메모리 DB에 돌려 본다 — 옛 접두 id가 남김없이·한결같이 옮겨지나 */
function migrationCheck(root) {
  const mem = new Database(':memory:');
  mem.exec(`
    CREATE TABLE event (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE containment (parent_id TEXT, child_id TEXT, ordered INTEGER, compose INTEGER, ord INTEGER, PRIMARY KEY (parent_id, child_id));
    CREATE TABLE disp (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
    CREATE TABLE rel (id TEXT PRIMARY KEY, type TEXT, from_id TEXT, to_id TEXT);
    CREATE TABLE board (id INTEGER PRIMARY KEY, root_event_id TEXT, meta_json TEXT);
    CREATE TABLE revision (id INTEGER PRIMARY KEY, board_id INTEGER, doc TEXT);
    CREATE TABLE hosting (id INTEGER PRIMARY KEY, source_board_id INTEGER, base_json TEXT, doc_json TEXT, ext_json TEXT, result_json TEXT);
    CREATE TABLE hosting_op (hosting_id INTEGER, seq INTEGER, op_json TEXT, PRIMARY KEY (hosting_id, seq));
    INSERT INTO event VALUES ('board:1','보드'),('board:2','보드2'),('track:1:t0','옛 트랙'),('track:2:tmabc123','새 모양 트랙'),('e1','카드');
    INSERT INTO containment VALUES ('board:1','track:1:t0',0,1,0),('board:2','track:2:tmabc123',0,1,0),('track:1:t0','e1',1,0,0),('board:1','track:2:tmabc123',0,1,1);
    INSERT INTO disp VALUES ('board:1','track:1:t0'),('track:1:t0','e1');
    INSERT INTO rel VALUES ('ref_track:1:t0_e1','ref','track:1:t0','e1');
    INSERT INTO board VALUES (1,'board:1','{"memos":[{"id":"m1","track":"track:1:t0"}]}'),(2,'track:2:tmabc123',null);
    INSERT INTO revision VALUES (1,1,'{"tracks":[{"id":"track:1:t0"},{"id":"t0"}],"items":[{"id":"e1","place":{"t":"t0","tracks":["t0","track:2:tmabc123"]}}]}');
    INSERT INTO hosting VALUES (1,1,'{"tracks":[{"id":"track:1:t0"}]}','{"tracks":[{"id":"track:1:t0"}]}','{"track:2:tmabc123":{"title":"x"}}',null);
    INSERT INTO hosting_op VALUES (1,1,'[{"k":"track","id":"track:1:t0","f":"name","v":"a"}]');
  `);
  require(path.join(root, 'electron/db/migrations/026_track_ids.cjs')).up(mem);
  const one = (sql) => mem.prepare(sql).get();
  const t0 = one("SELECT child_id AS id FROM containment WHERE parent_id = 'board:1' AND ord = 0").id;
  const left = one(`SELECT
      (SELECT COUNT(*) FROM event WHERE id LIKE 'track:%') + (SELECT COUNT(*) FROM containment WHERE parent_id LIKE 'track:%' OR child_id LIKE 'track:%')
    + (SELECT COUNT(*) FROM disp WHERE parent_id LIKE 'track:%' OR child_id LIKE 'track:%') + (SELECT COUNT(*) FROM rel WHERE from_id LIKE 'track:%' OR to_id LIKE 'track:%')
    + (SELECT COUNT(*) FROM board WHERE root_event_id LIKE 'track:%') AS n`).n;
  const rev = JSON.parse(one('SELECT doc FROM revision WHERE id = 1').doc);
  const out = {
    t0Fresh: /^t[0-9a-z]+$/.test(t0) && t0 !== 't0' && !!one(`SELECT 1 FROM event WHERE id = '${t0}'`),
    keptRaw: !!one("SELECT 1 FROM event WHERE id = 'tmabc123'") && one('SELECT root_event_id AS r FROM board WHERE id = 2').r === 'tmabc123',
    noneLeft: left === 0,
    relMoved: one("SELECT from_id AS f FROM rel WHERE id = 'ref_track:1:t0_e1'")?.f === t0,      // 관계 id는 그대로, 끝만
    cardUnder: !!one(`SELECT 1 FROM containment WHERE parent_id = '${t0}' AND child_id = 'e1'`) && !!one(`SELECT 1 FROM disp WHERE parent_id = '${t0}' AND child_id = 'e1'`),
    memo: JSON.parse(one('SELECT meta_json AS m FROM board WHERE id = 1').m).memos[0].track === t0,
    // 이력 문서 — 접두 id도, 그 보드에서 다시 읽기 전의 원래 id('t0')도 같은 새 id로
    revision: rev.tracks.every((t) => t.id === t0) && rev.items[0].place.t === t0 && rev.items[0].place.tracks.join() === [t0, 'tmabc123'].join(),
    hosting: JSON.parse(one('SELECT doc_json AS d FROM hosting').d).tracks[0].id === t0 && 'tmabc123' in JSON.parse(one('SELECT ext_json AS e FROM hosting').e)
      && JSON.parse(one('SELECT op_json AS o FROM hosting_op').o)[0].id === t0,
  };
  // 두 번 돌려도 그대로(남은 접두 id가 없으면 아무것도 안 한다)
  const snap = JSON.stringify(mem.prepare('SELECT * FROM event ORDER BY id').all());
  require(path.join(root, 'electron/db/migrations/026_track_ids.cjs')).up(mem);
  out.idempotent = snap === JSON.stringify(mem.prepare('SELECT * FROM event ORDER BY id').all());
  mem.close();
  return out;
}

export default {
  name: 'new-track-merge',
  areas: ['panel', 'db', 'config'],
  async run({ target, db, root, wrote }) {
    if (!wrote) return null;
    const ui = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap, sleep = (ms) => new Promise((s) => setTimeout(s, ms));
        const b1 = r.adapter.projectId;
        const b2 = await r.adapter.duplicateProject(b1, '트랙 가져올 보드');
        await r.tabs.openBoard(b1); await sleep(300);
        const n0 = r.store.tracks.length;
        // 머리의 '+'로 새 트랙 — 다시 읽지 않는다
        document.querySelector('button[title="트랙 추가"]').click();
        await sleep(300); await r.store.flush();
        const fresh = r.store.tracks[n0];
        const id = fresh?.id;
        const ev = await r.adapter.listEvents();
        const inDb = ev.some((e) => e.id === id && e.kind === 'track');
        const places = (await r.adapter.eventPlaces(id)).length;
        const others = ev.filter((e) => e.kind === 'track' && String(e.boardIds) === String(b2));
        // 상대 이벤트를 남긴다 → 되돌리기 → 이 이벤트를 남긴다 → 되돌리기
        const theirs = await r.adapter.mergeEvents(others[0].id, id);
        const u1 = theirs?.ok ? await r.adapter.unmergeEvents(theirs.undo) : null;
        const mine = await r.adapter.mergeEvents(id, others[1].id);
        const u2 = mine?.ok ? await r.adapter.unmergeEvents(mine.undo) : null;
        // 원복 — 새 트랙 빼기
        r.tabs.markAllStale(); await r.tabs.reloadActive(); await sleep(200);
        r.store.commit('스모크 원복', (doc) => { doc.tracks = doc.tracks.filter((t) => t.id !== id); });
        await r.store.flush();
        return { b2, id, inDb, places, theirs: theirs?.ok === true ? true : theirs?.rejected, mine: mine?.ok === true ? true : mine?.rejected,
          undone: u1?.ok === true && u2?.ok === true, back: r.store.tracks.length === n0 };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 15000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    const out = { ...ui };
    if (ui && !ui.error) {
      // 보드를 만들어도(틀·복제·예시) 접두 id가 생기지 않는다
      out.noPrefixed = db.prepare("SELECT COUNT(*) n FROM event WHERE id LIKE 'track:%'").get().n === 0;
    }
    out.migration = migrationCheck(root);
    if (ui?.b2) {
      await target.webContents.executeJavaScript(`(async () => { const r = window.__roadmap; await r.adapter.deleteProject(${JSON.stringify(ui?.b2)}); r.tabs.boardClosed?.(${JSON.stringify(ui?.b2)}); return true; })()`);
    }
    console.log('[smoke] new-track-merge ' + JSON.stringify(out));
    return out;
  },
  check: (o) => o?.inDb === true && o?.places >= 1 && o?.theirs === true && o?.mine === true && o?.undone === true && o?.back === true
    && o?.noPrefixed === true && Object.values(o?.migration ?? { x: false }).every((v) => v === true),
};
