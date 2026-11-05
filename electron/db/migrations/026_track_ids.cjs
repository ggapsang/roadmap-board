// 026 · 트랙 id 정리 — 저장이 붙이던 보드 접두('track:{보드}:{원래 id}')를 걷어 낸다 (2026-11-06 사용자)
//
// 예전엔 새 트랙을 저장할 때 id 앞에 'track:{보드}:'를 붙였다. 열린 화면은 다시 읽기 전까지 원래 id('tmue…')를 들고 있어,
// 그 사이 항등설정(합치기)·다른 보드 자리·항등 해제가 '이벤트를 찾을 수 없음'이 됐다. 이제 트랙 id는 이벤트 id 그대로이고
// (저장이 바꾸지 않는다, repository #project tkey), 여기서 옛 접두 id를 고친 규칙에 맞게 바꾼다:
//   'track:5:tmunquubvo2' → 'tmunquubvo2'   (원래 id가 전역 유일한 모양이면 그대로 — 열린 문서·이력에 남은 id와도 맞는다)
//   'track:2:t0'          → 't' + 새 id     (옛 틀의 짧은 번호는 보드마다 겹친다 — 새로 준다)
// 이벤트 id를 쓰는 곳을 모두 옮긴다: event · containment · disp · rel · board.root_event_id(트랙과 합친 보드 루트) ·
// board.meta_json(메모의 트랙) · revision.doc(이력 — 복원해도 같은 트랙) · hosting(사본·기준·이력 — 거둘 때 같은 트랙).
// 4대상 테이블엔 외래 키가 없어 UPDATE로 옮긴다. 마이그레이션 전 백업은 db/index.js가 떠 둔다.
'use strict';

const LEGACY = /^t\d+$/;                 // src/core/schema.js LEGACY_TRACK_ID와 같은 규칙
const PREFIXED = /^track:(\d+):(.+)$/;

function up(db) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  // 옮길 id — 이벤트 표와 그 id를 쓰는 표 어디에든 남은 접두 id
  const olds = new Set();
  const collect = (sql) => { for (const r of db.prepare(sql).all()) if (r.id && PREFIXED.test(r.id)) olds.add(r.id); };
  collect("SELECT id FROM event WHERE id LIKE 'track:%'");
  collect("SELECT parent_id AS id FROM containment WHERE parent_id LIKE 'track:%' UNION SELECT child_id FROM containment WHERE child_id LIKE 'track:%'");
  collect("SELECT parent_id AS id FROM disp WHERE parent_id LIKE 'track:%' UNION SELECT child_id FROM disp WHERE child_id LIKE 'track:%'");
  collect("SELECT from_id AS id FROM rel WHERE from_id LIKE 'track:%' UNION SELECT to_id FROM rel WHERE to_id LIKE 'track:%'");
  collect("SELECT root_event_id AS id FROM board WHERE root_event_id LIKE 'track:%'");
  if (!olds.size) return;

  const taken = new Set(db.prepare('SELECT id FROM event').all().map((r) => r.id));
  const fresh = () => {
    let x;
    do { x = 't' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); } while (taken.has(x));
    taken.add(x);
    return x;
  };
  const map = new Map();                 // 옛 접두 id → 새 id
  const rawByBoard = new Map();          // 보드 → (원래 id → 새 id) — 이력·사본 문서에 남은 접두 없는 id용
  for (const old of [...olds].sort()) {
    const [, bid, raw] = old.match(PREFIXED);
    const keep = !LEGACY.test(raw) && !raw.startsWith('track:') && !taken.has(raw);
    const nu = keep ? raw : fresh();
    taken.add(nu);
    map.set(old, nu);
    if (!rawByBoard.has(bid)) rawByBoard.set(bid, new Map());
    rawByBoard.get(bid).set(raw, nu);
  }

  // 4대상 · 보드 루트
  const moves = [
    'UPDATE event SET id = @nu WHERE id = @old',
    'UPDATE containment SET parent_id = @nu WHERE parent_id = @old',
    'UPDATE containment SET child_id = @nu WHERE child_id = @old',
    'UPDATE disp SET parent_id = @nu WHERE parent_id = @old',
    'UPDATE disp SET child_id = @nu WHERE child_id = @old',
    'UPDATE rel SET from_id = @nu WHERE from_id = @old',
    'UPDATE rel SET to_id = @nu WHERE to_id = @old',
    'UPDATE board SET root_event_id = @nu WHERE root_event_id = @old',
  ].map((sql) => db.prepare(sql));
  for (const [old, nu] of map) for (const st of moves) st.run({ old, nu });

  // JSON 안의 id — 옛 접두 id와 똑같은 문자열 값·키만 바꾼다(관계 id처럼 그 글자를 품은 다른 문자열은 건드리지 않는다)
  const swap = (v) => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[map.get(k) ?? k] = swap(x);
      return o;
    }
    return v;
  };
  // 보드 문서(이력·사본) — 열린 화면이 저장한 문서라 다시 읽기 전의 원래 id(접두 없음)도 남아 있다. 그 보드의 트랙 자리만 옮긴다
  const docFix = (doc, bid) => {
    const raw = rawByBoard.get(String(bid));
    if (!raw || !doc || typeof doc !== 'object') return doc;
    const t = (id) => (typeof id === 'string' && raw.has(id) ? raw.get(id) : id);
    for (const tr of Array.isArray(doc.tracks) ? doc.tracks : []) if (tr && typeof tr === 'object') tr.id = t(tr.id);
    for (const it of Array.isArray(doc.items) ? doc.items : []) {
      if (!it || typeof it !== 'object') continue;
      if ('t' in it) it.t = t(it.t);
      if (it.place && typeof it.place === 'object') {
        it.place.t = t(it.place.t);
        if (Array.isArray(it.place.tracks)) it.place.tracks = it.place.tracks.map(t);
      }
    }
    for (const c of Array.isArray(doc.compose) ? doc.compose : []) if (c && typeof c === 'object') { c.parent = t(c.parent); c.child = t(c.child); }
    for (const r of Array.isArray(doc.relations) ? doc.relations : []) if (r && typeof r === 'object') { r.from = t(r.from); r.to = t(r.to); }
    for (const m of Array.isArray(doc.meta?.memos) ? doc.meta.memos : []) if (m && typeof m === 'object' && 'track' in m) m.track = t(m.track);
    return doc;
  };
  const rewrite = (text, bid, isDoc) => {
    if (typeof text !== 'string' || !text) return text;
    let v;
    try { v = JSON.parse(text); } catch { return text; }
    let out = swap(v);
    if (isDoc && bid != null) out = docFix(out, bid);
    const next = JSON.stringify(out);
    return next === JSON.stringify(v) ? text : next;
  };

  // 보드 표시 값 — 메모의 트랙(meta.memos[].track)
  if (has('board')) {
    const cols = db.prepare('PRAGMA table_info(board)').all().map((c) => c.name);
    if (cols.includes('meta_json')) {
      const upd = db.prepare('UPDATE board SET meta_json = ? WHERE id = ?');
      for (const b of db.prepare('SELECT id, meta_json FROM board').all()) {
        let meta;
        try { meta = JSON.parse(b.meta_json ?? 'null'); } catch { continue; }
        if (!meta || typeof meta !== 'object') continue;
        const next = docFix({ meta: swap(meta) }, b.id).meta;
        const s = JSON.stringify(next);
        if (s !== b.meta_json && s !== JSON.stringify(meta)) upd.run(s, b.id);
      }
    }
  }
  // 이력 — 복원해도 같은 트랙 이벤트로
  if (has('revision')) {
    const upd = db.prepare('UPDATE revision SET doc = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, board_id, doc FROM revision').all()) {
      const next = rewrite(r.doc, r.board_id, true);
      if (next !== r.doc) upd.run(next, r.id);
    }
  }
  // 호스팅 사본 — 거둘 때 같은 트랙 이벤트로(docs/SHARE.md)
  if (has('hosting')) {
    const upd = db.prepare('UPDATE hosting SET base_json = ?, doc_json = ?, ext_json = ?, result_json = ? WHERE id = ?');
    for (const h of db.prepare('SELECT id, source_board_id, base_json, doc_json, ext_json, result_json FROM hosting').all()) {
      const n = [rewrite(h.base_json, h.source_board_id, true), rewrite(h.doc_json, h.source_board_id, true),
        rewrite(h.ext_json, null, false), rewrite(h.result_json, null, false)];
      if (n[0] !== h.base_json || n[1] !== h.doc_json || n[2] !== h.ext_json || n[3] !== h.result_json) upd.run(...n, h.id);
    }
  }
  if (has('hosting_op')) {
    const upd = db.prepare('UPDATE hosting_op SET op_json = ? WHERE hosting_id = ? AND seq = ?');
    for (const o of db.prepare('SELECT hosting_id, seq, op_json FROM hosting_op').all()) {
      const next = rewrite(o.op_json, null, false);
      if (next !== o.op_json) upd.run(next, o.hosting_id, o.seq);
    }
  }
  console.log(`[db] 026 트랙 id 정리: ${map.size}개`);
}

module.exports = { up };
