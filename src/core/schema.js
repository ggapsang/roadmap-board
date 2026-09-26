/**
 * 문서 스키마 · 버전 · 마이그레이션.
 *
 * 기획안 §8: "데이터 스키마에 version 필드를 추가하고 마이그레이션 함수를 두는 것을
 * P1에서 반드시 선행할 것. 현재 시안은 스키마 검증 없이 JSON을 신뢰한다."
 *
 * 규칙
 *  - 저장된 문서를 읽을 때는 반드시 `prepare()`를 거친다.
 *  - 스키마를 바꾸면 SCHEMA_VERSION을 올리고 MIGRATIONS에 from→to 함수를 추가한다.
 *  - 마이그레이션은 입력을 변형(mutate)해도 되지만 예외를 던지면 안 된다.
 */
import {
  STATUS_KEYS, DEFAULT_STATUS, TYPE_KEYS, DEFAULT_TYPE,
  DEFAULT_ORGS, DEFAULT_DISPLAY, DISPLAY_LIMITS,
  RELATION_TYPES, RELATION_KEYS, AXIS_KINDS, AXIS_DIRS,
} from '../config/index.js';

export const SCHEMA_VERSION = 15;

/**
 * v0 = P0 시안 문서(version 필드 없음).
 * 필드 구조는 v1과 동일하므로 태깅만 한다. 실질 정규화는 normalize()가 맡는다.
 */
function v0_to_v1(doc) {
  doc.version = 1;
  return doc;
}

/**
 * v2 = 담당 조직 목록을 문서가 직접 들고 있다.
 * v1까지는 코드 상수(config의 ORGS)에 박혀 있어서 과제마다 손을 대야 했다.
 * 문서에서 실제로 쓰이는 조직을 먼저 살리고, 기본 목록을 뒤에 붙인다.
 */
function v1_to_v2(doc) {
  const used = [...new Set((doc.items ?? []).map((i) => i?.og).filter((o) => typeof o === 'string' && o))];
  doc.orgs = [...DEFAULT_ORGS, ...used.filter((o) => !DEFAULT_ORGS.includes(o))];
  doc.version = 2;
  return doc;
}

/**
 * v3 = 표시 설정(meta.display)을 문서가 들고 있다.
 * 화살표 굵기·글자 크기처럼 "이 보드를 이렇게 보고 싶다"는 값이라 문서와 함께 다닌다.
 */
function v2_to_v3(doc) {
  doc.meta = doc.meta ?? {};
  doc.meta.display = { ...DEFAULT_DISPLAY, ...(doc.meta.display ?? {}) };
  doc.version = 3;
  return doc;
}

/**
 * v4 = 시간축 구간(bands). 왼쪽 월 칸을 사용자가 묶어 이름을 붙일 수 있다.
 * 예: 2027년 1~3월을 "1Q"로. 비어 있으면 월 단위로 자동 표시한다.
 */
function v3_to_v4(doc) {
  doc.bands = Array.isArray(doc.bands) ? doc.bands : [];
  doc.version = 4;
  return doc;
}

/**
 * v5 = 일정 안에 일정을 넣을 수 있다 + 카드 표현 옵션.
 *
 *   parent   상위 일정 id. "1년차 과제 제출용 화면 구성"이 DT 개발·3D 모델링을
 *            품는 식으로, 큰 덩어리 안에 세부 일정이 들어간다.
 *   x, w     트랙(또는 상위 카드) 안에서의 가로 위치·폭 비율 0~1.
 *            null이면 겹침 계산이 자동으로 정한다.
 *   align    카드 안 글자의 세로 정렬
 *   showNote 비고를 카드에 함께 보여 줄지
 */
function v4_to_v5(doc) {
  for (const it of doc.items ?? []) {
    it.parent = it.parent ?? null;
    it.x = it.x ?? null;
    it.w = it.w ?? null;
    it.align = it.align ?? 'middle';
    it.showNote = it.showNote ?? false;
  }
  doc.version = 5;
  return doc;
}

/**
 * v6 = 트랙 너비(track.w)와 구간 높이 배율(band.scale).
 *   track.w  트랙 컬럼의 너비(px). null이면 겹침 계산이 자동으로 정한다.
 *   band.scale 묶은 구간의 세로 압축 배율. 1이면 그대로, 0.4면 40% 높이로 접는다.
 */
function v5_to_v6(doc) {
  // 이미 값이 있으면 건드리지 않는다 (반입 문서가 앞선 필드를 가질 수 있다)
  for (const t of doc.tracks ?? []) t.w = t.w ?? null;
  for (const b of doc.bands ?? []) b.scale = b.scale ?? 1;
  doc.version = 6;
  return doc;
}

function v6_to_v7(doc) {
  // 카드 세로 크기 강제(hd, 일 단위). 없으면 null = 기간대로 자동.
  for (const it of doc.items ?? []) it.hd = it.hd ?? null;
  doc.version = 7;
  return doc;
}

function v7_to_v8(doc) {
  // 배치(표시) 필드를 place로 모은다 (본질/배치 분리 1단계: align·showNote·hd).
  for (const it of doc.items ?? []) {
    const pl = (it.place && typeof it.place === 'object') ? it.place : {};
    it.place = {
      ...pl,
      align: pl.align ?? it.align ?? 'middle',
      showNote: pl.showNote ?? it.showNote ?? false,
      hd: pl.hd ?? it.hd ?? null,
    };
    delete it.align; delete it.showNote; delete it.hd;
  }
  doc.version = 8;
  return doc;
}

function v8_to_v9(doc) {
  // 본질/배치 분리 2단계: 가로 위치·폭(x·w)을 place로.
  for (const it of doc.items ?? []) {
    const pl = (it.place && typeof it.place === 'object') ? it.place : {};
    it.place = { ...pl, x: pl.x ?? it.x ?? null, w: pl.w ?? it.w ?? null };
    delete it.x; delete it.w;
  }
  doc.version = 9;
  return doc;
}

function v9_to_v10(doc) {
  // 본질/배치 분리 3단계: 트랙·걸침(t·sp)을 place로.
  for (const it of doc.items ?? []) {
    const pl = (it.place && typeof it.place === 'object') ? it.place : {};
    it.place = { ...pl, t: pl.t ?? it.t, sp: pl.sp ?? it.sp ?? 1 };
    delete it.t; delete it.sp;
  }
  doc.version = 10;
  return doc;
}

function v10_to_v11(doc) {
  // 관계 일급화: item.dp(선행)를 doc.relations로 모은다 (id/검증은 normalize가).
  const rels = Array.isArray(doc.relations) ? doc.relations.slice() : [];
  for (const it of doc.items ?? []) {
    for (const d of (Array.isArray(it.dp) ? it.dp : [])) rels.push({ type: 'dep', from: d, to: it.id });
    delete it.dp;
  }
  doc.relations = rels;
  doc.version = 11;
  return doc;
}

function v11_to_v12(doc) {
  // 포함(contain)도 관계로 노출한다. item.parent는 렌더용으로 유지(정규화가 다시 만든다).
  const rels = Array.isArray(doc.relations) ? doc.relations.slice() : [];
  for (const it of doc.items ?? []) {
    if (typeof it.parent === 'string' && it.parent) rels.push({ type: 'contain', from: it.parent, to: it.id });
  }
  doc.relations = rels;
  doc.version = 12;
  return doc;
}

function v12_to_v13(doc) {
  // 태스크(순서 없는 할 일) 자리 — 카드 안에 담기는 액션 아이템 (docs/DIRECTION.md #6).
  // 순서가 생기면 하위 카드로 승격한다. 없으면 빈 배열.
  for (const it of doc.items ?? []) it.tasks = Array.isArray(it.tasks) ? it.tasks : [];
  doc.version = 13;
  return doc;
}

function v13_to_v14(doc) {
  // (철회) 'alias = 카드→보드 포인터'는 개념 오해였다 (refs PDF §3.4·§3.5).
  // 같은 이벤트가 여러 보드에 나오는 것은 '이벤트를 보드 밖에 두고 보드는 배치만' 갖는
  // 구조로 다룬다(포인터가 아니다). 잘못 넣은 alias 필드를 걷어낸다.
  for (const it of doc.items ?? []) delete it.alias;
  doc.version = 14;
  return doc;
}

function v14_to_v15(doc) {
  // 별칭(alias) — 같은 이벤트를 이 보드 맥락의 다른 이름으로 부르는 표시명(§3.5). 없으면 null.
  // (옛 board-pointer alias(숫자)는 문자열이 아니라 자연히 버려진다.)
  for (const it of doc.items ?? []) {
    it.alias = typeof it.alias === 'string' ? it.alias : null;
  }
  doc.version = 15;
  return doc;
}

const MIGRATIONS = {
  0: v0_to_v1,
  1: v1_to_v2,
  2: v2_to_v3,
  3: v3_to_v4,
  4: v4_to_v5,
  5: v5_to_v6,
  6: v6_to_v7,
  7: v7_to_v8,
  8: v8_to_v9,
  9: v9_to_v10,
  10: v10_to_v11,
  11: v11_to_v12,
  12: v12_to_v13,
  13: v13_to_v14,
  14: v14_to_v15,
};

export const ALIGNS = ['top', 'middle', 'bottom'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** 문서 모양을 하고 있는가. 내용 정합성은 보지 않는다. */
export function looksLikeDoc(doc) {
  return isObj(doc) && isObj(doc.meta) && Array.isArray(doc.tracks) && Array.isArray(doc.items);
}

/**
 * 결측/불량 필드를 채우고 참조 무결성을 맞춘다.
 * 데이터를 버리지 않는 쪽으로 판단한다 — 고칠 수 있으면 고치고, 못 고치면 warnings에 남긴다.
 * @returns {{doc: object, warnings: string[]}}
 */
export function normalize(doc) {
  const warnings = [];

  if (!isObj(doc.meta)) doc.meta = {};
  if (!ISO.test(doc.meta.start || '')) { doc.meta.start = '2026-09-21'; warnings.push('meta.start가 없어 기본값을 사용했습니다.'); }
  if (!ISO.test(doc.meta.end || ''))   { doc.meta.end   = '2027-04-04'; warnings.push('meta.end가 없어 기본값을 사용했습니다.'); }
  if (doc.meta.end < doc.meta.start) {
    [doc.meta.start, doc.meta.end] = [doc.meta.end, doc.meta.start];
    warnings.push('표시 기간의 시작/종료가 뒤집혀 있어 교환했습니다.');
  }

  // ── 시간축 구간 (사용자가 묶은 월 칸)
  // 겹치는 구간은 뒤엣것을 버린다. 겹치면 어느 쪽을 그릴지 모호해진다.
  doc.bands = (Array.isArray(doc.bands) ? doc.bands : [])
    .filter((b) => isObj(b) && ISO.test(b.from) && ISO.test(b.to))
    .map((b, i) => ({
      id: typeof b.id === 'string' && b.id ? b.id : `b${i}`,
      from: b.from <= b.to ? b.from : b.to,
      to: b.from <= b.to ? b.to : b.from,
      label: typeof b.label === 'string' ? b.label : '',
      // 세로 압축 배율 — 1이면 실제 기간대로, 작을수록 접힌다
      scale: Number.isFinite(Number(b.scale)) ? Math.min(1, Math.max(0.15, Number(b.scale))) : 1,
    }))
    .sort((a, b) => a.from.localeCompare(b.from))
    .filter((b, i, arr) => {
      const prev = arr[i - 1];
      if (prev && b.from <= prev.to) {
        warnings.push(`구간 '${b.label || b.from}'이 앞 구간과 겹쳐 제외했습니다.`);
        return false;
      }
      return true;
    });

  // ── 표시 설정
  const display = { ...DEFAULT_DISPLAY, ...(doc.meta.display ?? {}) };
  for (const [key, lim] of Object.entries(DISPLAY_LIMITS)) {
    const n = Number(display[key]);
    display[key] = Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, n)) : DEFAULT_DISPLAY[key];
  }
  // 축 눈금 종류·방향 (표시 선택 — DIRECTION #4)
  display.axis = AXIS_KINDS.includes(display.axis) ? display.axis : 'calendar';
  display.axisDir = AXIS_DIRS.includes(display.axisDir) ? display.axisDir : 'vertical';
  doc.meta.display = display;

  // ── 담당 조직
  // 일정의 og가 문자열 값이라, 목록에 없는 값이 나오면 버리지 말고 목록에 넣는다.
  if (!Array.isArray(doc.orgs)) doc.orgs = [...DEFAULT_ORGS];
  doc.orgs = [...new Set(
    doc.orgs.filter((o) => typeof o === 'string').map((o) => o.trim()).filter(Boolean),
  )];
  if (!doc.orgs.length) doc.orgs = [...DEFAULT_ORGS];

  // ── 트랙
  const seenTrack = new Set();
  doc.tracks = doc.tracks.filter((t) => isObj(t)).map((t, i) => {
    let id = typeof t.id === 'string' && t.id ? t.id : `t${i}`;
    while (seenTrack.has(id)) id = `${id}_`;
    seenTrack.add(id);
    const w = Number(t.w);
    return {
      ...t, id,
      lab: typeof t.lab === 'string' ? t.lab : '',
      name: typeof t.name === 'string' && t.name ? t.name : `트랙 ${i + 1}`,
      w: Number.isFinite(w) && w > 0 ? Math.min(1200, Math.max(80, w)) : null,
    };
  });
  if (!doc.tracks.length) {
    doc.tracks = [{ id: 't0', lab: '', name: '새 트랙 1' }];
    warnings.push('트랙이 하나도 없어 기본 트랙을 만들었습니다.');
  }

  const trackIds = doc.tracks.map((t) => t.id);
  const trackIndex = new Map(trackIds.map((id, i) => [id, i]));

  // ── 일정
  const seenItem = new Set();
  const seenTask = new Set();               // 태스크 id는 보드 전체에서 유일 (DB PK)
  doc.items = doc.items.filter((it) => isObj(it)).map((it, i) => {
    let id = typeof it.id === 'string' && it.id ? it.id : `e${i}`;
    while (seenItem.has(id)) id = `${id}_`;
    seenItem.add(id);

    const n = { ...it, id };
    const pl = isObj(it.place) ? it.place : {};

    n.ti = typeof n.ti === 'string' ? n.ti : '';
    n.ty = TYPE_KEYS.includes(n.ty) ? n.ty : DEFAULT_TYPE;
    n.st = STATUS_KEYS.includes(n.st) ? n.st : DEFAULT_STATUS;
    n.og = typeof n.og === 'string' && n.og.trim() ? n.og.trim() : doc.orgs[0];
    n.note = typeof n.note === 'string' ? n.note : '';

    if (!ISO.test(n.s)) n.s = doc.meta.start;
    if (!ISO.test(n.e)) n.e = n.s;
    if (n.e < n.s) n.e = n.s;                 // 종료는 시작 이상 (D-3, inclusive)
    // 마일스톤도 기간(전시회 등)을 가질 수 있다. e===s면 점, e>s면 기간 마일스톤.

    n.pg = clampInt(n.pg, 0, 100, 0);
    n.dp = Array.isArray(n.dp) ? n.dp.filter((d) => typeof d === 'string') : [];
    n.parent = typeof n.parent === 'string' && n.parent ? n.parent : null;

    // 별칭 — 이 카드를 이 보드 맥락의 다른 이름으로 표시(§3.5). 문자열 아니면 없음(null).
    // (옛 board-pointer alias(숫자)는 자연히 버려진다.)
    n.alias = typeof it.alias === 'string' && it.alias.trim() ? it.alias.trim() : null;

    // 순서 없는 태스크(액션 아이템). 이벤트 본질이라 place가 아니라 item에 직접 둔다.
    n.tasks = (Array.isArray(it.tasks) ? it.tasks : []).filter(isObj).map((t) => {
      let tid = typeof t.id === 'string' && t.id ? t.id : newId('k');
      while (seenTask.has(tid)) tid = newId('k');
      seenTask.add(tid);
      return { id: tid, text: typeof t.text === 'string' ? t.text : '', done: t.done === true };
    });

    // 배치(표시) 필드는 place로 모은다 — 이벤트 본질과 분리 (docs/DIRECTION.md #1).
    // 트랙·걸침(t·sp) + 표시(align·showNote·hd·x·w). flat/place 둘 다 관대하게 받는다.
    let t = pl.t ?? it.t;
    if (!trackIndex.has(t)) {
      warnings.push(`'${n.ti || id}'의 트랙(${t})을 찾을 수 없어 첫 트랙으로 옮겼습니다.`);
      t = trackIds[0];
    }
    const ti = trackIndex.get(t);             // 병합 폭(sp)은 트랙 경계를 넘지 못한다
    const align = pl.align ?? it.align;
    const hd = pl.hd ?? it.hd;
    const w = pl.w ?? it.w;
    n.place = {
      t,
      sp: clampInt(pl.sp ?? it.sp, 1, doc.tracks.length - ti, 1),
      align: ALIGNS.includes(align) ? align : 'middle',
      showNote: (pl.showNote ?? it.showNote) === true,
      // 세로 크기 강제(일 단위). 없거나 잘못됐으면 null = 기간대로 자동.
      hd: (typeof hd === 'number' && hd >= 1) ? Math.round(hd) : null,
      x: ratio(pl.x ?? it.x),
      w: w == null ? null : Math.min(1, Math.max(0.05, Number(w) || 0.05)),
    };
    delete n.t; delete n.sp; delete n.align; delete n.showNote; delete n.hd; delete n.x; delete n.w;
    return n;
  });

  // 목록에 없는 조직이 일정에 남아 있으면 목록에 추가한다 (반입 데이터 보존)
  for (const it of doc.items) {
    if (!doc.orgs.includes(it.og)) {
      doc.orgs.push(it.og);
      warnings.push(`담당 조직 '${it.og}'을(를) 목록에 추가했습니다.`);
    }
  }

  // ── 상위 일정 정리
  // 없는 부모 · 자기 자신 · 순환은 끊는다. 순환을 두면 렌더가 무한히 돈다.
  const itemById = new Map(doc.items.map((i) => [i.id, i]));
  for (const it of doc.items) {
    if (!it.parent) continue;
    if (it.parent === it.id || !itemById.has(it.parent)) {
      it.parent = null;
      continue;
    }
    const seen = new Set([it.id]);
    let cursor = itemById.get(it.parent);
    while (cursor) {
      if (seen.has(cursor.id)) {
        warnings.push(`'${it.ti || it.id}'의 상위 일정이 순환하여 해제했습니다.`);
        it.parent = null;
        break;
      }
      seen.add(cursor.id);
      cursor = cursor.parent ? itemById.get(cursor.parent) : null;
    }
  }
  // 자식은 상위 일정의 트랙을 따른다
  for (const it of doc.items) {
    if (!it.parent) continue;
    const parent = itemById.get(it.parent);
    if (parent) { it.place.t = parent.place.t; it.place.sp = 1; }
  }

  // ── 관계(relations)를 일급 객체로 정리 (docs/DIRECTION.md #2·#5·#7)
  // doc.relations와 옛 item.dp(선행)를 함께 받아 종류·끝점·순환을 검증한다.
  const itemIds = new Set(doc.items.map((i) => i.id));
  const relBefore = (Array.isArray(doc.relations) ? doc.relations.length : 0)
    + doc.items.reduce((s, it) => s + (Array.isArray(it.dp) ? it.dp.length : 0), 0);
  doc.relations = normalizeRelations(doc, itemIds);
  for (const it of doc.items) delete it.dp;      // 선행은 이제 item이 아니라 relations에
  if (doc.relations.length < relBefore) {
    warnings.push('끊어지거나 순환하는 관계를 정리했습니다.');
  }

  doc.version = SCHEMA_VERSION;
  return { doc, warnings };
}

/** 관계 목록 정규화 — 종류 허용, 끝점 존재, 자기순환 금지, 중복 제거, 순환 금지 종류는 사이클 차단. */
function normalizeRelations(doc, itemIds) {
  const acyclic = new Set(RELATION_TYPES.filter((r) => r.acyclic).map((r) => r.key));
  const symmetric = new Set(RELATION_TYPES.filter((r) => r.symmetric).map((r) => r.key));
  // 보드를 넘나드는 관계(동일·조합)는 반대쪽 끝이 다른 보드에 있을 수 있다. 한쪽만 이 보드
  // 안이면 살린다 — 안 그러면 정규화가 매번 보드 밖 대상을 끊어 버린다.
  const crossBoard = new Set(RELATION_TYPES.filter((r) => r.crossBoard).map((r) => r.key));
  const src = [];
  // 관계는 doc.relations에서 받는다. 단 포함(contain)은 item.parent가 authoritative라
  // 입력의 contain은 버리고 item.parent에서 다시 만든다(중복·불일치 방지).
  if (Array.isArray(doc.relations)) for (const r of doc.relations) if (isObj(r) && r.type !== 'contain') src.push(r);
  for (const it of doc.items) {
    for (const d of (Array.isArray(it.dp) ? it.dp : [])) src.push({ type: 'dep', from: d, to: it.id });
    if (typeof it.parent === 'string' && it.parent) src.push({ type: 'contain', from: it.parent, to: it.id });
  }

  const adj = new Map();                          // `${type}|${node}` -> Set(다음 노드)
  const reaches = (type, s, t) => {               // s에서 t로 가는 경로가 이미 있나 (같은 종류)
    const stack = [s]; const vis = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (node === t) return true;
      if (vis.has(node)) continue;
      vis.add(node);
      for (const m of (adj.get(`${type}|${node}`) ?? [])) stack.push(m);
    }
    return false;
  };

  const seen = new Set();
  const out = [];
  for (const r of src) {
    const type = RELATION_KEYS.includes(r.type) ? r.type : 'dep';
    const { from, to } = r;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (from === to) continue;
    const inHere = crossBoard.has(type)
      ? (itemIds.has(from) || itemIds.has(to))   // 한쪽만 이 보드여도 OK
      : (itemIds.has(from) && itemIds.has(to));  // 선행·포함은 양끝 다 이 보드
    if (!inHere) continue;
    // 대칭 관계(동일)는 (a,b)와 (b,a)가 같다 — 끝점을 정렬해 중복을 없앤다.
    const key = symmetric.has(type)
      ? `${type}|${[from, to].sort().join('|')}`
      : `${type}|${from}|${to}`;
    if (seen.has(key)) continue;
    if (acyclic.has(type) && reaches(type, to, from)) continue;   // from→to가 순환을 만들면 버린다
    seen.add(key);
    out.push({ id: typeof r.id === 'string' && r.id ? r.id : newId('r'), type, from, to });
    const ak = `${type}|${from}`;
    if (!adj.has(ak)) adj.set(ak, new Set());
    adj.get(ak).add(to);
  }
  return out;
}

/** 0~1 비율. 비어 있으면 null (= 자동 배치) */
function ratio(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return Math.min(Math.max(fallback, min), max);
  return Math.min(Math.max(n, min), max);
}

/**
 * 외부에서 들어온 문서(localStorage / JSON 붙여넣기 / 향후 서버 응답)를 사용 가능한
 * 상태로 만든다. 마이그레이션 → 정규화 순.
 * @returns {{doc: object|null, warnings: string[], error: string|null}}
 */
export function prepare(raw) {
  if (!looksLikeDoc(raw)) {
    return { doc: null, warnings: [], error: '문서 형식이 아닙니다 (meta · tracks · items 필요).' };
  }
  const doc = structuredClone(raw);
  let v = Number.isFinite(doc.version) ? doc.version : 0;

  if (v > SCHEMA_VERSION) {
    return { doc: null, warnings: [], error: `이 문서는 더 최신 버전(v${v})입니다. 보드를 업데이트해 주세요.` };
  }
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return { doc: null, warnings: [], error: `v${v} → v${v + 1} 마이그레이션이 없습니다.` };
    step(doc);
    v = doc.version;
  }

  const { doc: out, warnings } = normalize(doc);
  return { doc: out, warnings, error: null };
}

/** 새 id 생성 — 접두사 + 시각 + 난수 */
export function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
}

/**
 * 보드-독립 재식별 (docs/DIRECTION.md #3).
 *
 * 문서의 모든 이벤트에 **새 id**를 주고 참조(상위 일정·관계·태스크)를 함께 옮긴다.
 * 프로젝트 복제·반입으로 같은 id가 여러 보드에 흩어지면, 나중에 "같은 이벤트가 여러
 * 보드에" 올라갈 때 서로 다른 이벤트가 같은 키를 갖는 충돌이 생긴다. 복제본은 별개
 * 이벤트이므로 여기서 새 식별을 부여해 그 충돌을 원천에서 막는다.
 *
 * 입력(정규화된 문서 모양)을 변형하고 그대로 돌려준다.
 */
export function reidentify(doc) {
  const map = new Map();                       // 옛 id → 새 id
  const used = new Set();
  const fresh = (pfx) => { let x; do { x = newId(pfx); } while (used.has(x)); used.add(x); return x; };

  for (const it of doc.items ?? []) {
    const nu = fresh('e');
    map.set(it.id, nu);
    it.id = nu;
  }
  // 트랙도 새 식별 — 복제본이 원본 트랙 id('track:{원본}:…')를 물고 가면, 저장 때 접두가
  // 겹치고 원본 보드의 포함까지 건드린다. 트랙 id를 새로 주고 place.t 참조를 함께 옮긴다.
  const tmap = new Map();
  for (const t of doc.tracks ?? []) { const nu = fresh('t'); tmap.set(t.id, nu); t.id = nu; }
  for (const it of doc.items ?? []) {
    if (it.parent) it.parent = map.get(it.parent) ?? null;
    if (it.place && tmap.has(it.place.t)) it.place.t = tmap.get(it.place.t);
    for (const t of (Array.isArray(it.tasks) ? it.tasks : [])) t.id = fresh('k');
  }
  doc.relations = (Array.isArray(doc.relations) ? doc.relations : [])
    .map((r) => ({ ...r, id: fresh('r'), from: map.get(r.from), to: map.get(r.to) }))
    .filter((r) => r.from && r.to);            // 끝점을 못 옮긴 관계는 버린다
  return doc;
}

/**
 * 'same'(동일) 관계로 이어진 이벤트 무리 — 주어진 id와 같은 이벤트로 묶인 다른 id들.
 * 대칭·이행적이라 연결 요소(BFS)로 구한다.
 */
export function sameGroupOf(relations, id) {
  const adj = new Map();
  for (const r of (relations ?? [])) {
    if (r?.type !== 'same') continue;
    if (!adj.has(r.from)) adj.set(r.from, new Set());
    if (!adj.has(r.to)) adj.set(r.to, new Set());
    adj.get(r.from).add(r.to);
    adj.get(r.to).add(r.from);
  }
  const out = new Set();
  const stack = [id];
  const vis = new Set([id]);
  while (stack.length) {
    const n = stack.pop();
    for (const m of (adj.get(n) ?? [])) if (!vis.has(m)) { vis.add(m); out.add(m); stack.push(m); }
  }
  return out;   // 자기 자신은 포함하지 않는다
}

/**
 * 같은 이벤트로 묶인 카드들끼리 본질(제목·상태·기간·유형·담당·진척·비고)을 맞춘다.
 * 별칭(alias)은 카드별 표시명이라 맞추지 않는다(§3.5). 태스크는 링크(고유 id) 특성상 제외.
 */
export function propagateSame(doc, sourceId) {
  const src = doc.items.find((i) => i.id === sourceId);
  if (!src) return;
  const group = sameGroupOf(doc.relations, sourceId);
  for (const it of doc.items) {
    if (!group.has(it.id)) continue;
    it.ti = src.ti; it.s = src.s; it.e = src.e; it.ty = src.ty;
    it.st = src.st; it.og = src.og; it.pg = src.pg; it.note = src.note;
  }
}
