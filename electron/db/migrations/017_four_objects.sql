-- 017 · 4대상 모델 (개발 규칙 3장) — event / 포함(containment) / 배치(disp) / 관계(rel)
--
-- 트랙·태스크가 별도 테이블이고 포함이 track_id·parent_id·span 세 곳에 흩어져 있던 것을
-- 정리한다. 모든 단위는 event, 담김은 containment 하나, 표시는 disp, 이음은 rel(보드 무관).
--   containment : (부모 이벤트, 자식 이벤트, ordered=순서축 위인가, ord=형제 내 표시순서)
--   disp        : 그 포함 edge 위의 표시 (x·w·hd·정렬·비고표시·별칭 / 트랙이면 라벨·폭)
--   rel         : 관계 (종류·출발·도착, board_id 없음)
-- board·org·band 테이블은 '펼친 이벤트(보드)'의 표시 설정·레지스트리로 남긴다.
-- event 테이블은 본질 저장소로 유지(날짜 완화는 후속 — 지금은 달력 모드라 값이 있다).

CREATE TABLE containment (
  parent_id TEXT NOT NULL,
  child_id  TEXT NOT NULL,
  ordered   INTEGER NOT NULL DEFAULT 1,   -- 1=순서축 위(하위카드·트랙 위 카드), 0=태스크
  ord       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_id, child_id)
);
CREATE INDEX containment_parent ON containment(parent_id, ord);
CREATE INDEX containment_child  ON containment(child_id);

CREATE TABLE disp (
  parent_id   TEXT NOT NULL,
  child_id    TEXT NOT NULL,
  pos_x       REAL,
  pos_w       REAL,
  height_days REAL,
  align       TEXT NOT NULL DEFAULT 'middle',
  show_note   INTEGER NOT NULL DEFAULT 0,
  alias       TEXT,
  lab         TEXT,        -- 트랙 라벨 (트랙 edge)
  px_width    REAL,        -- 트랙 폭 px (트랙 edge)
  PRIMARY KEY (parent_id, child_id)
);

CREATE TABLE rel (
  id      TEXT PRIMARY KEY,
  type    TEXT NOT NULL DEFAULT 'dep',
  from_id TEXT NOT NULL,
  to_id   TEXT NOT NULL
);
CREATE INDEX rel_from ON rel(from_id);
CREATE INDEX rel_to   ON rel(to_id);

-- ── 이관 ────────────────────────────────────────────────

-- 보드 루트 → 트랙 (순서 있는 포함)
INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord)
  SELECT b.root_event_id, t.event_id, 1, t.ord
  FROM track t JOIN board b ON b.id = t.board_id
  WHERE t.event_id IS NOT NULL AND b.root_event_id IS NOT NULL;

INSERT OR IGNORE INTO disp (parent_id, child_id, lab, px_width, align)
  SELECT b.root_event_id, t.event_id, t.lab, t.width, 'middle'
  FROM track t JOIN board b ON b.id = t.board_id
  WHERE t.event_id IS NOT NULL AND b.root_event_id IS NOT NULL;

-- 카드 → 부모 (parent_id 있으면 그 이벤트, 없으면 홈 트랙 이벤트)
INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord)
  SELECT CASE WHEN p.parent_id IS NOT NULL AND p.parent_id != '' THEN p.parent_id
              ELSE 'track:' || p.board_id || ':' || p.track_id END,
         p.event_id, 1, p.ord
  FROM placement p;

INSERT OR IGNORE INTO disp (parent_id, child_id, pos_x, pos_w, height_days, align, show_note, alias)
  SELECT CASE WHEN p.parent_id IS NOT NULL AND p.parent_id != '' THEN p.parent_id
              ELSE 'track:' || p.board_id || ':' || p.track_id END,
         p.event_id, p.pos_x, p.pos_w, p.height_days, p.align, p.show_note, p.alias
  FROM placement p;

-- 걸침(span>1): 최상위 카드가 홈 트랙 다음의 트랙들에도 소속 (다중 소속으로)
INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord)
  SELECT 'track:' || p.board_id || ':' || t2.id, p.event_id, 1, p.ord
  FROM placement p
  JOIN track t1 ON t1.board_id = p.board_id AND t1.id = p.track_id
  JOIN track t2 ON t2.board_id = p.board_id AND t2.ord > t1.ord AND t2.ord < t1.ord + p.span
  WHERE (p.parent_id IS NULL OR p.parent_id = '') AND p.span > 1;

-- 태스크 → 카드 (순서 없는 포함). 태스크 이벤트는 이미 존재(013).
INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, ord)
  SELECT et.event_id, et.id, 0, et.ord FROM event_task et;

-- 관계 → rel (board_id 제거, id는 보드 접두로 전역 유일)
INSERT OR IGNORE INTO rel (id, type, from_id, to_id)
  SELECT board_id || ':' || id, type, from_id, to_id FROM relation;
