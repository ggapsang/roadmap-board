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
  RELATION_TYPES, RELATION_KEYS, FILL_KEYS, SCALE_KEYS, SLOT_UNIT_OF,
} from '../config/index.js';

export const SCHEMA_VERSION = 18;

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

function v15_to_v16(doc) {
  // 조합(구성)을 doc.compose로. 옛 이름 doc.refs는 관계 5종의 '참조'와 헷갈려 바꾼다 (docs/SAVE.md §5).
  // 조합은 순서 없는 구성 — 태스크(순서 없는 포함)와 본질이 달라 따로 든다.
  const old = Array.isArray(doc.compose) ? doc.compose : (Array.isArray(doc.refs) ? doc.refs : []);
  doc.compose = old;
  delete doc.refs;
  doc.version = 16;
  return doc;
}

function v16_to_v17(doc) {
  // 카드 색 채우기(place.fill) — 스타일 탭. 팔레트 key 또는 null(채우지 않음). 표현이라 place에 둔다.
  for (const it of doc.items ?? []) {
    if (it.place && typeof it.place === 'object') it.place.fill = it.place.fill ?? null;
  }
  doc.version = 17;
  return doc;
}

function v17_to_v18(doc) {
  // 세로축 눈금 모드(docs/SCALE.md) — 옛 axis(calendar|order)·axisDir를 scale·dated로. 순서 축(초안)은 없앴다.
  // 구간은 그 구간이 어느 모드의 바깥 칸 묶음인지(mode)를 갖는다 — 옛 것은 모두 월-주.
  const d = doc.meta?.display;
  if (d && typeof d === 'object') {
    d.scale = d.scale ?? 'month-week';
    d.dated = d.dated ?? true;
    delete d.axis; delete d.axisDir;
  }
  for (const b of doc.bands ?? []) if (b && typeof b === 'object') b.mode = b.mode ?? 'month-week';
  for (const it of doc.items ?? []) if (it?.place && typeof it.place === 'object') it.place.slot = it.place.slot ?? null;
  doc.version = 18;
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
  15: v15_to_v16,
  16: v16_to_v17,
  17: v17_to_v18,
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

  // ── 표시 설정
  const display = { ...DEFAULT_DISPLAY, ...(doc.meta.display ?? {}) };
  for (const [key, lim] of Object.entries(DISPLAY_LIMITS)) {
    const n = Number(display[key]);
    display[key] = Number.isFinite(n) ? Math.min(lim.max, Math.max(lim.min, n)) : DEFAULT_DISPLAY[key];
  }
  // 세로축 눈금 (docs/SCALE.md) — 날짜 없는 보드는 '눈금 없음' 고정. 날짜 있는 보드의 '눈금 없음'은
  // 한 칸 단위(slotUnit)를 가진다(없으면 월-주의 안쪽 단위 = 주).
  display.dated = display.dated !== false;
  display.scale = SCALE_KEYS.includes(display.scale) ? display.scale : 'month-week';
  if (!display.dated) display.scale = 'none';
  display.slotUnit = display.dated && display.scale === 'none'
    ? (['day', 'week', 'month'].includes(display.slotUnit) ? display.slotUnit : 'week')
    : null;
  delete display.axis; delete display.axisDir;
  doc.meta.display = display;
  const dated = display.dated;

  // ── 시간축 구간 (사용자가 묶은 바깥 칸) — 모드마다 따로(mode). 같은 모드 안에서 겹치면 뒤엣것을 버린다.
  const bandModes = SCALE_KEYS.filter((k) => SLOT_UNIT_OF[k]);
  doc.bands = (Array.isArray(doc.bands) ? doc.bands : [])
    .filter((b) => isObj(b) && ISO.test(b.from) && ISO.test(b.to))
    .map((b, i) => ({
      id: typeof b.id === 'string' && b.id ? b.id : `b${i}`,
      mode: bandModes.includes(b.mode) ? b.mode : 'month-week',
      from: b.from <= b.to ? b.from : b.to,
      to: b.from <= b.to ? b.to : b.from,
      label: typeof b.label === 'string' ? b.label : '',
      // 세로 배율 — 1이면 실제 기간대로. 늘리기(최대 3배)·접기(0.02)를 다 담는다
      scale: Number.isFinite(Number(b.scale)) ? Math.min(3, Math.max(0.02, Number(b.scale))) : 1,
    }))
    .sort((a, b) => a.mode.localeCompare(b.mode) || a.from.localeCompare(b.from))
    .filter((b, i, arr) => {
      const prev = arr[i - 1];
      if (prev && prev.mode === b.mode && b.from <= prev.to) {
        warnings.push(`구간 '${b.label || b.from}'이 앞 구간과 겹쳐 제외했습니다.`);
        return false;
      }
      return true;
    });

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
    const pl = isObj(it.place) ? it.place : {};

    n.ti = typeof n.ti === 'string' ? n.ti : '';
    n.ty = TYPE_KEYS.includes(n.ty) ? n.ty : DEFAULT_TYPE;
    n.st = STATUS_KEYS.includes(n.st) ? n.st : DEFAULT_STATUS;
    n.og = typeof n.og === 'string' && n.og.trim() ? n.og.trim() : doc.orgs[0];
    n.note = typeof n.note === 'string' ? n.note : '';

    if (dated) {
      if (!ISO.test(n.s)) n.s = doc.meta.start;
      if (!ISO.test(n.e)) n.e = n.s;
      if (n.e < n.s) n.e = n.s;               // 종료는 시작 이상 (D-3, inclusive)
    } else {
      // 날짜 없는 보드 — 날짜를 채우지 않는다(SYSTEM.md: 날짜는 선택). 있으면 그대로 둔다(다른 보드와 공유).
      n.s = ISO.test(n.s) ? n.s : null;
      n.e = n.s && ISO.test(n.e) && n.e >= n.s ? n.e : n.s;
    }
    // 마일스톤도 기간(전시회 등)을 가질 수 있다. e===s면 점, e>s면 기간 마일스톤.

    n.pg = clampInt(n.pg, 0, 100, 0);
    n.dp = Array.isArray(n.dp) ? n.dp.filter((d) => typeof d === 'string') : [];
    n.parent = typeof n.parent === 'string' && n.parent ? n.parent : null;

    // 별칭 — 이 카드를 이 보드 맥락의 다른 이름으로 표시(§3.5). 문자열 아니면 없음(null).
    // (옛 board-pointer alias(숫자)는 자연히 버려진다.)
    n.alias = typeof it.alias === 'string' && it.alias.trim() ? it.alias.trim() : null;

    // 순서 없는 태스크(액션 아이템). 태스크도 이벤트라 여러 카드에 함께 담길 수 있다(다중 소속) —
    // 같은 id는 한 카드 목록 안에서만 겹치면 안 된다(간선 PK). 다른 카드와 겹치는 건 같은 이벤트다.
    const seenTask = new Set();
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
    // 소속 트랙(다중, 비연속 허용). place.tracks가 있으면 그걸(존재하는 것만, 트랙 순서로),
    // 없으면 옛 t+sp(연속)로 유도한다. 사이의 트랙을 자동으로 채우지 않는다.
    let members;
    if (Array.isArray(pl.tracks) && pl.tracks.length) {
      const set = new Set(pl.tracks.filter((x) => trackIndex.has(x)));
      set.add(t);
      members = trackIds.filter((id2) => set.has(id2));
    } else {
      const ti0 = trackIndex.get(t);
      const spRaw = clampInt(pl.sp ?? it.sp, 1, doc.tracks.length - ti0, 1);
      members = [];
      for (let k = 0; k < spRaw && ti0 + k < trackIds.length; k += 1) members.push(trackIds[ti0 + k]);
    }
    if (!members.length) members = [t];
    const homeId = members[0];
    let run = 1;                              // 홈부터 연속 칸 수 (레거시 sp)
    const mi = members.map((id2) => trackIndex.get(id2));
    for (let k = 1; k < mi.length; k += 1) { if (mi[k] === mi[k - 1] + 1) run += 1; else break; }

    const align = pl.align ?? it.align;
    const fill = pl.fill ?? it.fill;
    const hd = pl.hd ?? it.hd;
    const w = pl.w ?? it.w;
    const sl = isObj(pl.slot) ? pl.slot : null;
    n.place = {
      t: homeId,
      sp: run,
      tracks: members,
      align: ALIGNS.includes(align) ? align : 'middle',
      showNote: (pl.showNote ?? it.showNote) === true,   // 비고를 카드에 보일지 — 기본은 숨김
      // 색 채우기 — 팔레트 key만(모르는 값·HEX는 버린다). null = 채우지 않음.
      fill: FILL_KEYS.includes(fill) ? fill : null,
      // 칸 — 날짜 없는 보드에서의 세로 위치(순서 위치, 배치). 날짜 있는 보드는 null.
      slot: dated ? null : {
        s: Math.max(0, Math.round(Number(sl?.s) || 0)),
        len: Math.max(1, Math.round(Number(sl?.len) || 1)),
      },
      // 세로 크기 강제(일 단위). 없거나 잘못됐으면 null = 기간대로 자동.
      hd: (typeof hd === 'number' && hd >= 1) ? Math.round(hd) : null,
      x: ratio(pl.x ?? it.x),
      // 가로 폭 비율. 1 = 한 칸. **크기 강제로 여러 트랙에 걸치면 w>1이 될 수 있다**(sp만큼).
      // 1로 잘라 버리면 걸친 카드가 데이터 적용·재정규화 때 한 칸으로 쪼그라든다. 트랙 수까지 허용.
      w: w == null ? null : Math.min(doc.tracks.length || 1, Math.max(0.05, Number(w) || 0.05)),
    };
    delete n.t; delete n.sp; delete n.align; delete n.showNote; delete n.hd; delete n.x; delete n.w; delete n.fill;
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
  // 자식은 상위 일정의 트랙을 따른다 (소속 트랙 개념은 최상위에만)
  for (const it of doc.items) {
    if (!it.parent) continue;
    const parent = itemById.get(it.parent);
    if (parent) { it.place.t = parent.place.t; it.place.sp = 1; it.place.tracks = [parent.place.t]; }
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

  // ── 조합(구성) — 태스크와 본질이 다른 순서 없는 포함 (docs/SAVE.md §5)
  normalizeCompose(doc, warnings);

  doc.version = SCHEMA_VERSION;
  return { doc, warnings };
}

/** 관계 목록 정규화 — 종류 허용, 끝점 존재, 자기순환 금지, 중복 제거, 순환 금지 종류는 사이클 차단. */
function normalizeRelations(doc, itemIds) {
  const acyclic = new Set(RELATION_TYPES.filter((r) => r.acyclic).map((r) => r.key));
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
    // 모르는 종류(옛 same·combine 등)는 버린다 — 동일은 합치기 작업, 조합은 구성(doc.compose)이지
    // 관계가 아니다(docs/SYSTEM.md). dep로 바꾸지도 않는다.
    if (!RELATION_KEYS.includes(r.type)) continue;
    const type = r.type;
    const { from, to } = r;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (from === to) continue;
    if (!itemIds.has(from) || !itemIds.has(to)) continue;   // 선행·포함은 양끝이 이 보드에
    const key = `${type}|${from}|${to}`;
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

/**
 * 조합(구성) 정리 — doc.compose = [{parent, child}] (docs/SAVE.md §5).
 * 조합은 여러 이벤트로 한 이벤트가 만들어진 것이다. 부모는 이 보드의 트랙·카드여야 하고(보드→트랙은
 * doc.tracks가 맡는다), 대상은 **다른 보드의 이벤트**여야 한다. 같은 보드의 이벤트(트랙·카드·태스크)는
 * 명시적 관계가 없어도 이미 이 보드의 포함 그래프 안에 있다 — 그것을 다시 조합으로 품는 것은 모순이다
 * (2026-09-28 사용자 정의, SYSTEM.md §7.1). 대상이 이 문서에 보이면 끊는다. 보드를 넘는 순환·공유
 * 이벤트는 저장이 거부한다.
 */
function normalizeCompose(doc, warnings) {
  const trackIds = new Set(doc.tracks.map((t) => t.id));
  const itemIds = new Set(doc.items.map((i) => i.id));
  const here = new Set([...trackIds, ...itemIds]);     // 이 보드의 이벤트 — 조합 대상이 될 수 없다
  for (const it of doc.items) for (const k of (it.tasks ?? [])) here.add(k.id);

  const seen = new Set();
  const before = Array.isArray(doc.compose) ? doc.compose.length : 0;
  doc.compose = (Array.isArray(doc.compose) ? doc.compose : []).filter((c) => {
    if (!isObj(c) || typeof c.parent !== 'string' || typeof c.child !== 'string') return false;
    if (!c.parent || !c.child || c.parent === c.child) return false;
    if (!itemIds.has(c.parent) && !trackIds.has(c.parent)) return false;   // 부모가 이 보드에 없다
    if (here.has(c.child)) return false;                                     // 같은 보드 이벤트 — 모순
    const key = `${c.parent}\u0001${c.child}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((c) => ({ parent: c.parent, child: c.child }));
  if (doc.compose.length < before) warnings.push('같은 보드 이벤트 등 맞지 않는 조합(구성)을 정리했습니다.');
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
 * 보드-독립 재식별 (docs/DIRECTION.md #3, docs/SAVE.md §8).
 *
 * 이벤트에 **새 id**를 주고 참조(상위 일정·관계·태스크·조합)를 함께 옮긴다. 복제·반입·예시 로드맵으로
 * 같은 id가 여러 보드에 흩어지면 서로 다른 이벤트가 같은 키를 갖고, 저장이 남의 이벤트를 덮어쓰거나
 * 몰래 공유하게 된다. 새 식별을 부여해 그 충돌을 원천에서 막는다.
 *
 * @param {object} doc 정규화된 문서 모양 (변형해서 그대로 돌려준다)
 * @param {{only?: (id:string) => boolean}} [opts]
 *   only 없음  — 전부 새 id (복제본). 트랙도 새 id.
 *   only 있음  — 고른 카드·태스크·트랙만 새 id (충돌하는 것만). 'track:2:t0'처럼 다른 보드 트랙 id를
 *                물고 온 트랙도 새 id를 받아야, 저장이 남의 트랙을 이 보드에 몰래 붙이지 않는다.
 */
export function reidentify(doc, { only = null } = {}) {
  const pick = only ?? (() => true);
  const map = new Map();                       // 옛 id → 새 id (카드·태스크)
  const used = new Set();
  const fresh = (pfx) => { let x; do { x = newId(pfx); } while (used.has(x)); used.add(x); return x; };
  const to = (id) => map.get(id) ?? id;

  for (const it of doc.items ?? []) {
    if (!pick(it.id)) continue;
    const nu = fresh('e');
    map.set(it.id, nu);
    it.id = nu;
  }
  // 트랙도 새 식별(전부일 때만) — 복제본이 원본 트랙 id('track:{원본}:…')를 물고 가면, 저장 때 접두가
  // 겹치고 원본 보드의 포함까지 건드린다. 트랙 id를 새로 주고 place.t 참조를 함께 옮긴다.
  const tmap = new Map();
  for (const t of doc.tracks ?? []) { if (!pick(t.id)) continue; const nu = fresh('t'); tmap.set(t.id, nu); t.id = nu; }
  const tto = (id) => tmap.get(id) ?? id;

  const taskMap = new Map();                   // 같은 태스크가 여러 카드에 있으면 같은 새 id로
  for (const it of doc.items ?? []) {
    if (it.parent) it.parent = to(it.parent);
    if (Array.isArray(it.dp)) it.dp = it.dp.map(to);            // 정규화 전 옛 문서의 선행
    if (it.t) it.t = tto(it.t);                                  // 정규화 전 옛 문서의 트랙
    if (it.place) it.place.t = tto(it.place.t);
    if (it.place && Array.isArray(it.place.tracks)) it.place.tracks = it.place.tracks.map(tto);
    for (const t of (Array.isArray(it.tasks) ? it.tasks : [])) {
      if (!pick(t.id)) continue;
      if (!taskMap.has(t.id)) taskMap.set(t.id, fresh('k'));
      t.id = taskMap.get(t.id);
    }
  }
  const any = (id) => tto(taskMap.get(id) ?? to(id));
  // 없던 필드는 만들지 않는다 — 정규화 전 옛 문서(선행이 item.dp에 있음)를 그대로 넘겨받을 수 있다.
  if (Array.isArray(doc.relations)) {
    doc.relations = doc.relations.map((r) => ({ ...r, id: only ? r.id : fresh('r'), from: to(r.from), to: to(r.to) }));
  }
  // 조합: 부모(이 보드 트랙·카드)와, 이 보드 안의 대상(카드·트랙·태스크)을 옮긴다. 다른 보드의 대상은
  // 그대로 — 복제본도 같은 이벤트들로 만들어진 것이다.
  if (Array.isArray(doc.compose)) {
    doc.compose = doc.compose.map((c) => ({ parent: any(c.parent), child: any(c.child) }));
  }
  return doc;
}
