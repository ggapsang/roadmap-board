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
  ORGS, DEFAULT_ORG,
} from '../config/index.js';

export const SCHEMA_VERSION = 1;

/**
 * v0 = P0 시안 문서(version 필드 없음).
 * 필드 구조는 v1과 동일하므로 태깅만 한다. 실질 정규화는 normalize()가 맡는다.
 */
function v0_to_v1(doc) {
  doc.version = 1;
  return doc;
}

const MIGRATIONS = {
  0: v0_to_v1,
};

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

  // ── 트랙
  const seenTrack = new Set();
  doc.tracks = doc.tracks.filter((t) => isObj(t)).map((t, i) => {
    let id = typeof t.id === 'string' && t.id ? t.id : `t${i}`;
    while (seenTrack.has(id)) id = `${id}_`;
    seenTrack.add(id);
    return { ...t, id, lab: typeof t.lab === 'string' ? t.lab : '', name: typeof t.name === 'string' && t.name ? t.name : `트랙 ${i + 1}` };
  });
  if (!doc.tracks.length) {
    doc.tracks = [{ id: 't0', lab: '', name: '새 트랙 1' }];
    warnings.push('트랙이 하나도 없어 기본 트랙을 만들었습니다.');
  }

  const trackIds = doc.tracks.map((t) => t.id);
  const trackIndex = new Map(trackIds.map((id, i) => [id, i]));

  // ── 일정
  const seenItem = new Set();
  doc.items = doc.items.filter((it) => isObj(it)).map((it, i) => {
    let id = typeof it.id === 'string' && it.id ? it.id : `e${i}`;
    while (seenItem.has(id)) id = `${id}_`;
    seenItem.add(id);

    const n = { ...it, id };

    if (!trackIndex.has(n.t)) {
      warnings.push(`'${n.ti || id}'의 트랙(${n.t})을 찾을 수 없어 첫 트랙으로 옮겼습니다.`);
      n.t = trackIds[0];
    }
    n.ti = typeof n.ti === 'string' ? n.ti : '';
    n.ty = TYPE_KEYS.includes(n.ty) ? n.ty : DEFAULT_TYPE;
    n.st = STATUS_KEYS.includes(n.st) ? n.st : DEFAULT_STATUS;
    n.og = typeof n.og === 'string' && n.og ? n.og : DEFAULT_ORG;
    n.note = typeof n.note === 'string' ? n.note : '';

    if (!ISO.test(n.s)) n.s = doc.meta.start;
    if (!ISO.test(n.e)) n.e = n.s;
    if (n.e < n.s) n.e = n.s;                 // 종료는 시작 이상 (D-3, inclusive)
    if (n.ty === 'ms') n.e = n.s;             // 마일스톤은 단일 일자

    n.pg = clampInt(n.pg, 0, 100, 0);
    // 병합 폭은 트랙 경계를 넘지 못한다
    const ti = trackIndex.get(n.t);
    n.sp = clampInt(n.sp, 1, doc.tracks.length - ti, 1);

    n.dp = Array.isArray(n.dp) ? n.dp.filter((d) => typeof d === 'string') : [];
    return n;
  });

  // ── 선행 참조 정리: 없는 id / 자기 자신 / 중복 제거
  const itemIds = new Set(doc.items.map((i) => i.id));
  for (const it of doc.items) {
    const before = it.dp.length;
    it.dp = [...new Set(it.dp)].filter((d) => d !== it.id && itemIds.has(d));
    if (it.dp.length !== before) warnings.push(`'${it.ti || it.id}'의 끊어진 선행 일정 참조를 정리했습니다.`);
  }

  doc.version = SCHEMA_VERSION;
  return { doc, warnings };
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
