/**
 * 런타임 설정.
 *
 * 여기 있는 값은 **새 프로젝트의 초기값**이거나 화면 동작 상수다.
 * 사용자가 바꾸는 것(담당 조직 목록, 트랙 구성)은 문서 안에 들어 있고
 * 보드에서 직접 편집한다 — 코드를 고칠 필요 없다.
 */

/** 저장 키. P0 시안과 동일하게 유지 — 기존 브라우저 저장분을 그대로 이어받는다. */
export const STORAGE_KEY = 'dr-roadmap-v2';

/**
 * 일정 상태. `key`는 데이터에 기록되는 값이고 CSS 클래스 `.st-{key}`와 짝을 이룬다.
 * 추가하려면 여기에 항목을 넣고 styles/board.css에 `.ev.st-{key}` 규칙을 더하면 된다.
 */
export const STATUSES = [
  { key: 'plan', label: '계획' },
  { key: 'run',  label: '진행중' },
  { key: 'done', label: '완료' },
  { key: 'late', label: '지연' },
  { key: 'hold', label: '보류' },
];

export const STATUS_KEYS = STATUSES.map((s) => s.key);
export const DEFAULT_STATUS = 'plan';

/**
 * 이 보드의 상태 목록 — 기본 상태(계획·진행중·완료·지연·보류)에 보드별 이름 재정의를 덮는다.
 * 상태의 key·색·의미(완료=흐림, 보류=점선 등)는 고정이고, 보드마다 '이름'만 바꿀 수 있다(표현).
 */
export function statusList(doc) {
  const ov = (doc && doc.meta && doc.meta.statusLabels) || {};
  return STATUSES.map((s) => ({ ...s, label: ov[s.key] ?? s.label }));
}

/**
 * 담당 조직의 **초기값**. 새 프로젝트를 만들 때만 쓰인다.
 * 실제 목록은 문서(`doc.orgs`)에 들어 있고 보드 구성 패널에서 편집한다.
 * 조직명은 일정의 `og`에 문자열로 들어가므로, 이름을 바꾸면 참조도 함께 갱신한다.
 */
export const DEFAULT_ORGS = [
  '다임리서치',
  '다임랩스',
  '에이텍모빌리티',
  '에이텍오토',
  'LG에너지솔루션',
  '공동',
];

/** 문서에 조직 목록이 하나도 없을 때의 최후 폴백 */
export const FALLBACK_ORG = DEFAULT_ORGS[0];

/** 일정 유형 */
export const ITEM_TYPES = [
  { key: 'bar', label: '기간' },
  { key: 'ms',  label: '마일스톤' },
];
export const TYPE_KEYS = ITEM_TYPES.map((t) => t.key);
export const DEFAULT_TYPE = 'bar';

/**
 * 관계(이벤트 사이) 종류. 코드에 박지 않고 여기서 늘린다 (docs/DIRECTION.md #2·#7).
 *   acyclic  선행·원인처럼 순환이 생기면 안 되는 관계인가 (DAG)
 * 지금 UI가 만드는 것은 'dep'(선행) 하나. 나머지는 자리만 잡아 둔다.
 */
export const RELATION_TYPES = [
  { key: 'dep', label: '선행', acyclic: true },
  { key: 'contain', label: '포함', acyclic: true },   // 상위 일정 안에 든 카드. 지금은 item.parent가 렌더용 사본.
  // 동일=합치기 작업, 조합=구성(순서 없는 포함, doc.compose)이라 관계 타입이 아니다(docs/SYSTEM.md §7,
  // docs/SAVE.md §5). 아래는 미구현 관계.
  // { key: 'merge', label: '합류' },   // 여러 → 하나 (트리)
  // { key: 'cause', label: '원인', acyclic: true },
  // { key: 'join',  label: '합류' },
  // { key: 'ref',   label: '참조' },
];
export const RELATION_KEYS = RELATION_TYPES.map((r) => r.key);
export const DEFAULT_RELATION = 'dep';

/**
 * 그래프 뷰 (refs/WOLFPACK_그래프뷰_개발요청서.md) — 관계 종류별 방향 중력·선·라벨을 **이 한 곳**에서 정한다(G-21).
 *
 * 엣지 종류 = 포함(containment 세 종류는 모두 'contain') + 관계 종류(rel.type). 종류 → 계열(family) → 힘·색.
 *   contain  부모 → 자식, 아래(0,1), '구조 중력' 슬라이더
 *   flow     선행·합류 — 앞 → 뒤, 오른쪽(1,0), '흐름 중력' 슬라이더
 *   cause    원인 → 결과, 오른쪽(1,0), '흐름 중력' 슬라이더
 *   ref      참조 — 방향 중력 없음(G-18, 순환 허용), 약한 스프링만
 * 합류·원인·참조는 아직 만들 수 없는 관계지만(RELATION_TYPES 주석), 생기면 여기 계열이 그대로 적용된다.
 * 방향 중력은 목표 좌표로 끌지 않고 **최소 간격(gap)에 못 미칠 때만** 벌린다(G-20).
 */
export const GRAPH = {
  /** 엣지 종류 → 계열 */
  typeFamily: { contain: 'contain', dep: 'flow', merge: 'flow', cause: 'cause', ref: 'ref' },
  /** 계열별 방향 중력(u·gap·strength·slider)과 스프링 세기 */
  families: {
    // strength·gap은 합성 데이터(2보드·3단 포함·다중 소속·흐름 교차 순환)로 맞췄다: 구조만 켜면 부모가 위 99%,
    // 흐름만 켜면 앞이 왼쪽 100%, 둘 다 0.5면 96%·100%, 300틱 안에 수렴. 위치만으로 방향이 보장되진 않아
    // 화살촉을 단다(G-15).
    contain: { u: [0, 1], gap: 100, strength: 1, slider: 'structure', spring: 0.35 },
    flow:    { u: [1, 0], gap: 90, strength: 1, slider: 'flow', spring: 0.35 },
    cause:   { u: [1, 0], gap: 90, strength: 1, slider: 'flow', spring: 0.35 },
    ref:     { u: null, spring: 0.08 },
  },
  /** 호버 라벨 — 엣지 종류(포함은 세부 종류까지) */
  labels: {
    // 짧게 — 한 노드에 엣지가 몰리면 라벨이 겹친다. 순서 있는/없는 포함은 라벨로만 구분(G-14)
    'contain:ordered': '포함', 'contain:unordered': '포함·순서 없음', 'contain:compose': '구성(조합)',
    dep: '선행', merge: '합류', cause: '원인', ref: '참조',
  },
  /** 노드 반지름 r = min(rMax, rMin + k·√(하위 이벤트 수)) — 3.1 */
  node: { rMin: 5, k: 3, rMax: 40 },
  /** 힘 — 반발(Barnes-Hut θ)·스프링 길이·충돌 여백·약한 중심 복귀 */
  sim: { charge: -140, theta: 0.9, linkDistance: 60, collidePad: 4, center: 0.03 },
  /** 초기 배치 간격(px) — y=포함 깊이, x=흐름 순위 (3.3) */
  init: { dy: 90, dx: 110, jitter: 24 },
  /** 두 중력의 시작 세기 0~1 (Q-5: 중간값에서 시작) */
  sliders: { structure: 0.5, flow: 0.5 },
  /** 라벨을 보이는 최소 화면 반지름(px) — 멀리서는 큰 노드만 (4.5) */
  labelMinScreenRadius: 9,
};

/**
 * 카드 색 채우기 팔레트 (스타일 탭 — 파워포인트·엑셀의 '채우기'). 사용자가 고르는 표현이다.
 * 데이터에는 key만 남고, 색은 styles/tokens.css의 `--fill-{key}`가 테마별로 정한다(HEX 직접 금지).
 * Orange는 넣지 않는다 — 오늘·선택·진행·CTA 신호색이라 채우기로 쓰면 선택과 헷갈린다(가이드 §14).
 * 상태 표시(좌측 4px)는 채우기와 따로 그대로 보인다.
 */
export const FILLS = [
  { key: 'gray',   label: '회색' },
  { key: 'red',    label: '빨강' },
  { key: 'yellow', label: '노랑' },
  { key: 'green',  label: '초록' },
  { key: 'teal',   label: '청록' },
  { key: 'blue',   label: '파랑' },
  { key: 'purple', label: '보라' },
  { key: 'pink',   label: '분홍' },
  // 빗금(///) — 색이 아니라 무늬. 면 색은 그대로 두고 옅은 사선을 듬성듬성 긋는다(--fill-hatch 선 색)
  { key: 'hatch',  label: '빗금' },
];
export const FILL_KEYS = FILLS.map((f) => f.key);

/** 행 높이(1주) 프리셋. px/일 = weekHeight / 7 */
export const ZOOM_LEVELS = [
  { weekHeight: 40, label: '축소' },
  { weekHeight: 56, label: '기본', default: true },
  { weekHeight: 80, label: '확대' },
];

export const LAYOUT = {
  /** 레인 n개인 트랙의 컬럼 폭 계수 = 1 + GROWTH*(n-1), 상한 MAX (기획안 §4) */
  laneGrowth: 0.55,
  laneWidthMax: 2.4,
  /** 카드 최소 높이(px) */
  minCardHeight: 28,
  /**
   * 카드 사이 세로 간격(px). 화살표가 지나갈 자리다.
   * 4px이던 시절에는 붙어 있는 일정 사이 화살표가 점처럼 보였다.
   */
  cardGap: 14,
  /** 이 높이 이상이면 카드를 중앙정렬 'big' 모드로 */
  bigCardHeight: 84,
  /** 이 높이 미만이면 메타 줄을 숨김 */
  metaHideHeight: 52,
  /**
   * 이 높이 미만이면 카드를 한 줄 'short' 모드로. 짧은 일정(≤5일 등)은 높이가
   * minCardHeight 근처라 제목 한 줄(18px)+세로 여백(16px)이 안 들어가 글씨가
   * 세로로 짤린다. 이때는 마일스톤처럼 제목을 한 줄에 눕히고 폰트를 줄인다.
   * 높이 기준이라 확대하면(일당 픽셀↑) 같은 일수도 충분히 높아져 자동 해제된다.
   */
  compactCardHeight: 40,
  /** 점 마일스톤 표식 높이(px) — CSS .ev.ms.point의 height(--u6)와 같게. 레인 겹침 판단용 */
  pointCardHeight: 24,
  /** 제목 글자를 줄일 수 있는 하한(px). 이보다 작으면 읽히지 않는다 — 대신 다른 정보를 먼저 숨긴다 */
  minTitleFont: 9,
  // 새 일정 기본 길이는 눈금 모드가 정한다(SCALE_MODES.newUnit).
};

/**
 * 표시 설정의 기본값. 문서(meta.display)에 저장되므로 프로젝트마다 다르게 둘 수 있다.
 */
export const DEFAULT_DISPLAY = {
  /** 화살표 몸통 굵기(px) */
  arrowWidth: 6,
  /** 화살표 머리 크기 = 몸통 × 이 배율 */
  arrowHead: 2.2,
  /**
   * 화살표가 카드 안으로 파고드는 깊이(px).
   * 기본 0 — 카드 밖으로만 지나가게 둔다. 파고들면 제목을 가린다.
   * 더 길게 보고 싶은 사람을 위해 열어 두기만 한다.
   */
  arrowBite: 0,
  /** 카드 글자 배율 */
  fontScale: 1.0,
  /**
   * 세로축 눈금 (docs/SCALE.md). 축은 본래 '순서'이고 달력은 그 위에 얹는 선택적 눈금이다.
   *   scale    SCALE_MODES의 key — 주-일 · 월-주 · 분기-월 · 눈금 없음
   *   dated    false면 날짜 없는 보드 — 일정 위치는 칸(place.slot)뿐, 눈금은 '눈금 없음' 고정
   *   slotUnit 날짜 있는 보드를 '눈금 없음'으로 볼 때 한 칸의 단위(전환 전 안쪽 단위)
   */
  scale: 'month-week',
  dated: true,
  slotUnit: null,
};

/**
 * 세로축 눈금 모드 (docs/SCALE.md §3). outer=바깥 칸(구간 묶기 단위), inner=안쪽 칸,
 * row=한 행(줌 높이)이 뜻하는 날 수(일당 픽셀 = 줌 높이 / row), step=드래그 정밀도, newUnit=새 일정 길이.
 * 시·분은 아직 없다 — 생기면 여기에 모드를 더한다.
 */
export const SCALE_MODES = {
  'week-day':      { key: 'week-day', label: '주-일', outer: 'week', inner: 'day', row: 1, step: 'day', newUnit: 'day' },
  'month-week':    { key: 'month-week', label: '월-주', outer: 'month', inner: 'week', row: 7, step: 'day', newUnit: 'week' },
  'quarter-month': { key: 'quarter-month', label: '분기-월', outer: 'quarter', inner: 'month', row: 30.44, step: 'week', newUnit: 'month' },
  none:            { key: 'none', label: '눈금 없음', outer: null, inner: 'slot', row: null, step: null, newUnit: null },
};
export const SCALE_KEYS = Object.keys(SCALE_MODES);
/** 날짜 없는 보드에 눈금을 입힐 때 고르는 한 칸의 단위 (시·분은 나중에) */
export const SLOT_UNITS = [
  { key: 'day', label: '일' }, { key: 'week', label: '주' }, { key: 'month', label: '월' }, { key: 'quarter', label: '분기' },
];
/** 날짜 있는 보드를 '눈금 없음'으로 볼 때의 칸 단위 = 전환 전 모드의 안쪽 단위 */
export const SLOT_UNIT_OF = { 'week-day': 'day', 'month-week': 'week', 'quarter-month': 'month' };
/** 눈금 없음에서 한 칸이 뜻하는 날 수(일당 픽셀 계산용) */
export const UNIT_DAYS = { day: 1, week: 7, month: 30.44, quarter: 91.3 };

/**
 * 구간(왼쪽 칸) 세로 배율 — 1이면 실제 기간대로. 끌어서 늘리기는 사실상 제한 없이(분기-월에서 한 분기는
 * 기본 3행뿐이라 3배로 막으면 너무 좁다), 줄이기는 min까지, '이 칸 접기'는 fold까지.
 * max는 실수로 끝없이 끌어 축이 수십만 px이 되는 것만 막는 안전 한도다.
 */
export const BAND_SCALE = { min: 0.15, fold: 0.02, max: 100 };

export const DISPLAY_LIMITS = {
  arrowWidth: { min: 1, max: 24, step: 1 },
  arrowHead: { min: 1.2, max: 4, step: 0.1 },
  arrowBite: { min: 0, max: 60, step: 2 },
  fontScale: { min: 0.7, max: 2.0, step: 0.05 },
};

/** undo 스택 최대 깊이 (기획안 §5) */
export const UNDO_LIMIT = 60;

/**
 * 방금 만든 이벤트를 이 시간(분) 안에 지우면 휴지통을 거치지 않고 바로 없앤다 —
 * 실수로 만들었다가 바로 지운 것 (docs/SAVE.md §7). 이번 실행 중에 만든 것만 해당한다.
 */
export const TRASH_GRACE_MIN = 5;

/** 상태 요약바의 "향후 N일 마일스톤" */
export const UPCOMING_DAYS = 14;
