/**
 * 거두기 — 3방향 합치기 (docs/SHARE.md §5). DOM을 모르는 순수 함수.
 *
 *   base    떼어 낸 시점 문서(기준)
 *   theirs  호스팅 사본(참가자들이 고친 것)
 *   ours    지금 원래 보드(호스트가 그동안 고친 것)
 *
 * 대상·칸 단위로 비교한다(ops.js의 diffDocs와 같은 칸 나눔).
 *   사본만 바뀜 → 사본 · 보드만 바뀜 → 보드 · 같게 바뀜 → 그 값
 *   다르게 바뀜 / 한쪽은 지우고 한쪽은 고침 → 충돌 — 호스트가 고른다
 * 결과는 ours에 사본 쪽 변경을 얹은 문서 — 원래 보드의 저장 경로(보드가 본 것만 고친다, docs/SAVE.md)로 쓴다.
 * id에 ':'가 들어갈 수 있어(트랙 'track:1:t0') 칸 이름을 쪼개 읽지 않는다 — 변경마다 {k,id,f}를 들고 다닌다.
 */
import { diffDocs, applyOps } from './ops.js';

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const SEP = '\u001f';
const entKey = (k, id) => `${k}${SEP}${id}`;

/** 변경 목록 → 칸 이름별 변경 { k, id?, f?, type:'add'|'del'|'set'|'unset'|'order', value, op } */
function changeMap(ops) {
  const m = new Map();
  for (const op of ops) {
    if (op.k === 'order') { m.set(`order${SEP}${op.of}`, { k: 'order', type: 'order', value: op.ids, op }); continue; }
    if (op.k === 'meta') {
      for (const [f, v] of Object.entries(op.set ?? {})) m.set(`meta${SEP}${f}`, { k: 'meta', f, type: 'set', value: v, op: { k: 'meta', set: { [f]: v } } });
      for (const f of op.unset ?? []) m.set(`meta${SEP}${f}`, { k: 'meta', f, type: 'unset', value: undefined, op: { k: 'meta', unset: [f] } });
      continue;
    }
    if (op.k === 'doc') {
      for (const [f, v] of Object.entries(op.set ?? {})) m.set(`doc${SEP}${f}`, { k: 'doc', f, type: 'set', value: v, op: { k: 'doc', set: { [f]: v } } });
      continue;
    }
    const whole = entKey(op.k, op.id);
    if (op.add) { m.set(whole, { k: op.k, id: op.id, type: 'add', value: op.add, op }); continue; }
    if (op.del) { m.set(whole, { k: op.k, id: op.id, type: 'del', value: undefined, op }); continue; }
    for (const [f, v] of Object.entries(op.set ?? {})) {
      m.set(`${whole}${SEP}${f}`, { k: op.k, id: op.id, f, type: 'set', value: v, op: { k: op.k, id: op.id, set: { [f]: v } } });
    }
  }
  return m;
}

const entityOf = (c) => (c.id != null && c.f != null ? entKey(c.k, c.id) : null);

/** 문서에서 대상 찾기 */
export function findEntity(doc, k, id) {
  const coll = k === 'item' ? doc?.items : k === 'track' ? doc?.tracks : k === 'rel' ? doc?.relations : k === 'band' ? doc?.bands : k === 'memo' ? doc?.meta?.memos : null;
  return clone((coll ?? []).find((x) => x?.id === id)) ?? null;
}

/** 칸의 값 */
export function fieldValue(doc, c) {
  if (c.k === 'meta') { const d = c.f.indexOf('.'); return d < 0 ? doc?.meta?.[c.f] : doc?.meta?.[c.f.slice(0, d)]?.[c.f.slice(d + 1)]; }
  if (c.k === 'doc') return doc?.[c.f];
  if (c.k === 'order') return (doc?.tracks ?? []).map((t) => t.id);
  const ent = findEntity(doc, c.k, c.id);
  if (!ent || c.f == null) return ent ?? undefined;
  return c.f.startsWith('place.') ? ent.place?.[c.f.slice(6)] : ent[c.f];
}

/**
 * @returns {{ doc:object, conflicts:object[], applied:number, resolve:(choices:Map<string,'theirs'|'ours'>)=>object }}
 *   doc        충돌이 없는 칸만 합친 문서(충돌 칸은 보드 쪽 그대로)
 *   conflicts  [{ key, k, id, f, kind:'both'|'theirs-del'|'ours-del'|'order', base, theirs, ours }]
 *   resolve    충돌마다 고른 쪽을 받아 최종 문서를 만든다(고르지 않은 것은 'theirs')
 */
export function merge3(base, theirs, ours) {
  const T = changeMap(diffDocs(base, theirs));
  const O = changeMap(diffDocs(base, ours));
  const fieldsBy = (M) => {
    const out = new Map();
    for (const c of M.values()) { const e = entityOf(c); if (e) { if (!out.has(e)) out.set(e, []); out.get(e).push(c.f); } }
    return out;
  };
  const oFields = fieldsBy(O);

  const clean = [];                 // 그대로 얹을 사본 쪽 변경
  const conflicts = [];
  const seen = new Set();
  for (const [key, t] of T) {
    const o = O.get(key);
    const ent = entityOf(t);
    // 대상을 보드 쪽이 지웠는데 사본 쪽이 칸을 고쳤다
    if (ent && O.get(ent)?.type === 'del') {
      if (!seen.has(ent)) {
        seen.add(ent);
        conflicts.push({ key: ent, k: t.k, id: t.id, kind: 'ours-del', base: findEntity(base, t.k, t.id), theirs: findEntity(theirs, t.k, t.id), ours: null });
      }
      continue;
    }
    if (t.type === 'del') {
      // 사본 쪽이 지웠는데 보드 쪽이 칸을 고쳤다
      if (oFields.has(key)) {
        conflicts.push({ key, k: t.k, id: t.id, kind: 'theirs-del', base: findEntity(base, t.k, t.id), theirs: null, ours: findEntity(ours, t.k, t.id), fields: oFields.get(key) });
        continue;
      }
      if (o?.type === 'del') continue;   // 둘 다 지웠다
      clean.push(t.op);
      continue;
    }
    if (!o) { clean.push(t.op); continue; }
    if (t.type === o.type && same(t.value, o.value)) continue;   // 같게 바뀜
    conflicts.push({ key, k: t.k, id: t.id, f: t.f, kind: t.k === 'order' ? 'order' : 'both', base: fieldValue(base, t), theirs: t.value, ours: o.value, op: t.op });
  }

  const resolve = (choices = new Map()) => {
    const extra = [];
    for (const c of conflicts) {
      if ((choices.get(c.key) ?? 'theirs') !== 'theirs') continue;
      if (c.kind === 'ours-del') { if (c.theirs) extra.push({ k: c.k, id: c.id, add: c.theirs }); }
      else if (c.kind === 'theirs-del') extra.push({ k: c.k, id: c.id, del: true });
      else extra.push(c.op);
    }
    return applyOps(applyOps(clone(ours), clean), extra);
  };
  return { doc: applyOps(clone(ours), clean), conflicts, applied: clean.length, resolve };
}
