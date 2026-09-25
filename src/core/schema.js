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
} from '../config/index.js';

export const SCHEMA_VERSION = 7;

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

const MIGRATIONS = {
  0: v0_to_v1,
  1: v1_to_v2,
  2: v2_to_v3,
  3: v3_to_v4,
  4: v4_to_v5,
  5: v5_to_v6,
  6: v6_to_v7,
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
    n.og = typeof n.og === 'string' && n.og.trim() ? n.og.trim() : doc.orgs[0];
    n.note = typeof n.note === 'string' ? n.note : '';

    if (!ISO.test(n.s)) n.s = doc.meta.start;
    if (!ISO.test(n.e)) n.e = n.s;
    if (n.e < n.s) n.e = n.s;                 // 종료는 시작 이상 (D-3, inclusive)
    // 마일스톤도 기간(전시회 등)을 가질 수 있다. e===s면 점, e>s면 기간 마일스톤.

    n.pg = clampInt(n.pg, 0, 100, 0);
    // 병합 폭은 트랙 경계를 넘지 못한다
    const ti = trackIndex.get(n.t);
    n.sp = clampInt(n.sp, 1, doc.tracks.length - ti, 1);

    n.dp = Array.isArray(n.dp) ? n.dp.filter((d) => typeof d === 'string') : [];

    n.parent = typeof n.parent === 'string' && n.parent ? n.parent : null;
    n.align = ALIGNS.includes(n.align) ? n.align : 'middle';
    n.showNote = n.showNote === true;
    n.x = ratio(n.x);
    n.w = n.w == null ? null : Math.min(1, Math.max(0.05, Number(n.w) || 0.05));
    // 세로 크기 강제(일 단위). 없거나 잘못됐으면 null = 기간대로 자동.
    n.hd = (typeof n.hd === 'number' && n.hd >= 1) ? Math.round(n.hd) : null;
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
    if (parent) { it.t = parent.t; it.sp = 1; }
  }

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
