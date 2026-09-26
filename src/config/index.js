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

/**
 * 관계(이벤트 사이) 종류. 코드에 박지 않고 여기서 늘린다 (docs/DIRECTION.md #2·#7).
 *   acyclic  선행·원인처럼 순환이 생기면 안 되는 관계인가 (DAG)
 * 지금 UI가 만드는 것은 'dep'(선행) 하나. 나머지는 자리만 잡아 둔다.
 */
export const RELATION_TYPES = [
  { key: 'dep', label: '선행', acyclic: true },
  { key: 'contain', label: '포함', acyclic: true },   // 상위 일정 안에 든 카드. 지금은 item.parent가 렌더용 사본.
  { key: 'same', label: '동일', symmetric: true, crossBoard: true },    // 두 카드가 같은 이벤트(본질 공유). 대칭.
  { key: 'combine', label: '조합', acyclic: true, crossBoard: true },   // 이 이벤트가 여러 이벤트의 합(포함). §3.7
  // { key: 'cause', label: '원인', acyclic: true },
  // { key: 'join',  label: '합류' },
  // { key: 'ref',   label: '참조' },
];
export const RELATION_KEYS = RELATION_TYPES.map((r) => r.key);
export const DEFAULT_RELATION = 'dep';

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
  /** 클릭으로 만드는 새 일정 기본 길이(일) — 한 칸(1주). 끌어서 만들면 끈 길이. */
  newItemDays: 7,
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
   * 세로축 눈금 종류 (docs/DIRECTION.md #4). 축은 본래 '순서'이고 달력은 그 위에
   * 얹는 선택적 눈금이다. 'calendar'=날짜 눈금, 'order'=순서만.
   * 지금은 'calendar'만 구현 — 'order'는 자리만 잡아 둔다.
   */
  axis: 'calendar',
  /** 축 방향 — 'vertical'(세로) | 'horizontal'(가로). 지금은 vertical만 구현. */
  axisDir: 'vertical',
};

/** 눈금 종류 · 축 방향 허용값 (표시 선택이지 데이터가 아니다) */
export const AXIS_KINDS = ['calendar', 'order'];
export const AXIS_DIRS = ['vertical', 'horizontal'];

export const DISPLAY_LIMITS = {
  arrowWidth: { min: 1, max: 24, step: 1 },
  arrowHead: { min: 1.2, max: 4, step: 0.1 },
  arrowBite: { min: 0, max: 60, step: 2 },
  fontScale: { min: 0.7, max: 2.0, step: 0.05 },
};

/** undo 스택 최대 깊이 (기획안 §5) */
export const UNDO_LIMIT = 60;

/** 상태 요약바의 "향후 N일 마일스톤" */
export const UPCOMING_DAYS = 14;
