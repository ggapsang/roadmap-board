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
  /** 이 높이 이상이면 카드를 중앙정렬 'big' 모드로 */
  bigCardHeight: 84,
  /** 이 높이 미만이면 메타 줄을 숨김 */
  metaHideHeight: 52,
  /** 새 일정 기본 길이(일) — 2주 */
  newItemDays: 14,
};

/**
 * 표시 설정의 기본값. 문서(meta.display)에 저장되므로 프로젝트마다 다르게 둘 수 있다.
 */
export const DEFAULT_DISPLAY = {
  /** 화살표 몸통 굵기(px) */
  arrowWidth: 7,
  /** 화살표 머리 크기 = 몸통 × 이 배율 */
  arrowHead: 2.0,
  /** 카드 글자 배율 */
  fontScale: 1.0,
};

export const DISPLAY_LIMITS = {
  arrowWidth: { min: 1, max: 24, step: 1 },
  arrowHead: { min: 1.2, max: 4, step: 0.1 },
  fontScale: { min: 0.7, max: 2.0, step: 0.05 },
};

/** undo 스택 최대 깊이 (기획안 §5) */
export const UNDO_LIMIT = 60;

/** 상태 요약바의 "향후 N일 마일스톤" */
export const UPCOMING_DAYS = 14;
