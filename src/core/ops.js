/**
 * 호스팅 동기화의 변경(op) — 두 문서의 차이를 '대상 + 칸' 단위로 쪼개고(diffDocs), 문서에 적용한다(applyOps).
 * DOM을 모르는 순수 함수. 호스트(메인 프로세스)와 화면(렌더러)이 같은 코드를 쓴다 — 같은 순서로 적용하면 같은 결과다.
 * docs/SHARE.md §3.
 *
 * op 모양
 *   { k:'item'|'track'|'rel'|'band'|'memo', id, add:{…} }     대상 더하기(이미 있으면 통째로 바꾼다)
 *   { k, id, del:true }                                       대상 지우기
 *   { k, id, set:{ 칸:값 } }                                   칸 고치기 — 일정의 place는 칸마다 따로('place.x')
 *   { k:'order', of:'track', ids:[…] }                         트랙 순서(칸 순서는 의미가 있다)
 *   { k:'meta', set:{ name, 'display.fontScale', 'arrows.<관계 id>', hidden… }, unset:[…] }
 *   { k:'doc', set:{ orgs, compose } }                         id 없는 통값
 *
 * 같은 칸을 둘이 고치면 나중에 적용된 것이 남는다(호스트가 순서를 정한다). 지워진 대상의 칸 고치기는 버려진다.
 */

/** 문서의 id 있는 모음 → op 종류. 메모는 meta.memos */
const KEYED = [['items', 'item'], ['tracks', 'track'], ['relations', 'rel'], ['bands', 'band']];
/** meta에서 하위 키마다 따로 다루는 것 — 표시 설정 하나·화살표 모양 하나를 둘이 고쳐도 서로 덮지 않게 */
const META_SUB = new Set(['display', 'arrows']);
/** id 없는 최상위 통값 */
const DOC_WHOLE = ['orgs', 'compose'];

const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function collOf(doc, k) {
  if (k === 'memo') { doc.meta = doc.meta ?? {}; doc.meta.memos = doc.meta.memos ?? []; return doc.meta.memos; }
  const name = KEYED.find(([, kk]) => kk === k)?.[0];
  if (!name) return null;
  doc[name] = doc[name] ?? [];
  return doc[name];
}

function diffKeyed(ops, k, A, B) {
  const a = new Map((A ?? []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const b = new Map((B ?? []).filter((x) => x && x.id != null).map((x) => [x.id, x]));
  for (const [id] of a) if (!b.has(id)) ops.push({ k, id, del: true });
  for (const [id, nb] of b) {
    const na = a.get(id);
    if (!na) { ops.push({ k, id, add: clone(nb) }); continue; }
    const set = {};
    for (const f of new Set([...Object.keys(na), ...Object.keys(nb)])) {
      if (f === 'id') continue;
      if (k === 'item' && f === 'place' && na.place && nb.place && typeof na.place === 'object' && typeof nb.place === 'object') {
        for (const p of new Set([...Object.keys(na.place), ...Object.keys(nb.place)])) {
          if (!same(na.place[p], nb.place[p])) set[`place.${p}`] = clone(nb.place[p]);
        }
        continue;
      }
      if (!same(na[f], nb[f])) set[f] = clone(nb[f]);
    }
    if (Object.keys(set).length) ops.push({ k, id, set });
  }
}

/** 문서 a → b 로 가는 변경들 */
export function diffDocs(a, b) {
  const ops = [];
  for (const [name, k] of KEYED) diffKeyed(ops, k, a?.[name], b?.[name]);
  const ta = (a?.tracks ?? []).map((t) => t.id), tb = (b?.tracks ?? []).map((t) => t.id);
  if (ta.join('\u0001') !== tb.join('\u0001')) ops.push({ k: 'order', of: 'track', ids: tb });
  diffKeyed(ops, 'memo', a?.meta?.memos, b?.meta?.memos);

  const ma = a?.meta ?? {}, mb = b?.meta ?? {};
  const set = {}, unset = [];
  for (const f of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    if (f === 'memos') continue;
    if (META_SUB.has(f)) {
      const sa = ma[f] ?? {}, sb = mb[f] ?? {};
      for (const s of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
        if (!(s in sb)) { if (s in sa) unset.push(`${f}.${s}`); continue; }
        if (!same(sa[s], sb[s])) set[`${f}.${s}`] = clone(sb[s]);
      }
      continue;
    }
    if (!same(ma[f], mb[f])) set[f] = clone(mb[f]);
  }
  if (Object.keys(set).length || unset.length) ops.push({ k: 'meta', ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) });

  const dset = {};
  for (const f of DOC_WHOLE) if (!same(a?.[f], b?.[f])) dset[f] = clone(b?.[f]);
  if (Object.keys(dset).length) ops.push({ k: 'doc', set: dset });
  return ops;
}

function setPath(obj, key, value) {
  const dot = key.indexOf('.');
  if (dot < 0) { obj[key] = value; return; }
  const head = key.slice(0, dot), rest = key.slice(dot + 1);
  if (!obj[head] || typeof obj[head] !== 'object') obj[head] = {};
  obj[head][rest] = value;
}

function unsetPath(obj, key) {
  const dot = key.indexOf('.');
  if (dot < 0) { delete obj[key]; return; }
  const head = obj[key.slice(0, dot)];
  if (head && typeof head === 'object') delete head[key.slice(dot + 1)];
}

/** 변경을 문서에 적용한다(문서를 고친다). 없는 대상의 칸 고치기·지우기는 조용히 건너뛴다. */
export function applyOps(doc, ops) {
  for (const op of ops ?? []) {
    if (!op || typeof op !== 'object') continue;
    if (op.k === 'order' && op.of === 'track') {
      const at = new Map((op.ids ?? []).map((id, i) => [id, i]));
      const tracks = doc.tracks ?? [];
      const known = tracks.filter((t) => at.has(t.id)).sort((x, y) => at.get(x.id) - at.get(y.id));
      doc.tracks = [...known, ...tracks.filter((t) => !at.has(t.id))];
      continue;
    }
    if (op.k === 'meta') {
      doc.meta = doc.meta ?? {};
      for (const [f, v] of Object.entries(op.set ?? {})) setPath(doc.meta, f, clone(v));
      for (const f of op.unset ?? []) unsetPath(doc.meta, f);
      continue;
    }
    if (op.k === 'doc') {
      for (const [f, v] of Object.entries(op.set ?? {})) if (DOC_WHOLE.includes(f)) doc[f] = clone(v);
      continue;
    }
    const coll = collOf(doc, op.k);
    if (!coll || op.id == null) continue;
    const i = coll.findIndex((x) => x?.id === op.id);
    if (op.del) { if (i >= 0) coll.splice(i, 1); continue; }
    if (op.add) {
      const v = { ...clone(op.add), id: op.id };
      if (i >= 0) coll[i] = v; else coll.push(v);
      continue;
    }
    if (op.set && i >= 0) {
      for (const [f, v] of Object.entries(op.set)) {
        if (f.startsWith('place.')) { coll[i].place = coll[i].place ?? {}; coll[i].place[f.slice(6)] = clone(v); }
        else coll[i][f] = clone(v);
      }
    }
  }
  return doc;
}

/**
 * 변경이 건드리는 칸 이름들 — 내 화면이 아직 확정받지 못한 칸(pending)과 남의 변경이 부딪치는지 볼 때 쓴다.
 * 대상 더하기·지우기는 대상 전체('item:e1'), 칸 고치기는 칸('item:e1:ti').
 */
export function opKeys(op) {
  if (!op) return [];
  if (op.k === 'order') return [`order:${op.of}`];
  if (op.k === 'meta') return [...Object.keys(op.set ?? {}), ...(op.unset ?? [])].map((f) => `meta:${f}`);
  if (op.k === 'doc') return Object.keys(op.set ?? {}).map((f) => `doc:${f}`);
  if (op.add || op.del) return [`${op.k}:${op.id}`];
  return Object.keys(op.set ?? {}).map((f) => `${op.k}:${op.id}:${f}`);
}

/**
 * 남의 변경에서 내가 아직 확정받지 못한 칸(pending)을 뺀다 — 내 변경이 호스트에 더 늦게 닿으므로 결국 내 값이 남는다.
 * 남이 대상을 지웠으면 그대로 둔다(내 칸 고치기는 호스트가 버린다). 내가 지운 대상에 온 남의 고치기·더하기는 뺀다.
 */
export function withoutPending(ops, pending) {
  if (!pending?.size) return ops;
  const out = [];
  for (const op of ops) {
    if (op.k === 'meta') {
      const set = Object.fromEntries(Object.entries(op.set ?? {}).filter(([f]) => !pending.has(`meta:${f}`)));
      const unset = (op.unset ?? []).filter((f) => !pending.has(`meta:${f}`));
      if (Object.keys(set).length || unset.length) out.push({ k: 'meta', set, unset });
      continue;
    }
    if (op.k === 'doc') {
      const set = Object.fromEntries(Object.entries(op.set ?? {}).filter(([f]) => !pending.has(`doc:${f}`)));
      if (Object.keys(set).length) out.push({ k: 'doc', set });
      continue;
    }
    if (op.k === 'order') { if (!pending.has(`order:${op.of}`)) out.push(op); continue; }
    const whole = `${op.k}:${op.id}`;
    if (op.del) { out.push(op); continue; }
    if (pending.has(whole)) continue;                      // 내가 더했거나 지운 대상 — 내 것이 남는다
    if (op.add) { out.push(op); continue; }
    const set = Object.fromEntries(Object.entries(op.set ?? {}).filter(([f]) => !pending.has(`${whole}:${f}`)));
    if (Object.keys(set).length) out.push({ k: op.k, id: op.id, set });
  }
  return out;
}

/**
 * 키 순서와 무관한 문서 지문 — 화면과 호스트의 문서가 같은지 가끔 맞춰 본다. 일정·관계·구간·메모의 배열 순서는 뜻이 없어
 * (동시에 더한 것은 화면마다 붙는 순서가 다를 수 있다) id 순으로 놓고 잰다. 트랙 순서는 칸 순서라 그대로.
 */
export function docHash(doc) {
  const byId = (xs) => [...(xs ?? [])].sort((x, y) => String(x?.id).localeCompare(String(y?.id)));
  const d = { ...doc, items: byId(doc?.items), relations: byId(doc?.relations), bands: byId(doc?.bands),
    meta: { ...(doc?.meta ?? {}), memos: byId(doc?.meta?.memos) } };
  const s = stable(d);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
}
