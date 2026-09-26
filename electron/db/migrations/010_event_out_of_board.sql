-- 010 · 이벤트를 보드 밖으로 (refs PDF §3.4·§6-1·§6-2)
--
-- 지금까지 이벤트는 item(board_id 소속)이었다. 이벤트의 '본질'(event)을 보드 밖 전역
-- 테이블로 올리고, 보드는 '배치'(placement)만 갖게 한다. 같은 이벤트가 여러 보드에
-- 놓일 수 있는 토대다. 관계·태스크는 이벤트에 딸린다(보드를 넘나든다).
--
-- 기존 board-scoped id는 board_id를 접두(예: '3:e10')해 전역 유일 event id로 올린다.
-- 앱이 새로 만드는 이벤트는 처음부터 전역 유일 id를 쓴다(접두 없음).

CREATE TABLE event (
  id         TEXT    PRIMARY KEY,             -- 전역 유일 (보드 무관)
  title      TEXT    NOT NULL DEFAULT '',
  start_date TEXT    NOT NULL,
  end_date   TEXT    NOT NULL,
  type       TEXT    NOT NULL DEFAULT 'bar',
  status     TEXT    NOT NULL DEFAULT 'plan',
  org        TEXT    NOT NULL DEFAULT '',
  progress   INTEGER NOT NULL DEFAULT 0,
  note       TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE placement (
  board_id    INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  event_id    TEXT    NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  track_id    TEXT    NOT NULL,
  ord         INTEGER NOT NULL,
  span        INTEGER NOT NULL DEFAULT 1,
  pos_x       REAL,
  pos_w       REAL,
  height_days REAL,
  align       TEXT    NOT NULL DEFAULT 'middle',
  show_note   INTEGER NOT NULL DEFAULT 0,
  parent_id   TEXT,                            -- 이 보드에서의 상위 이벤트(배치 관계)
  PRIMARY KEY (board_id, event_id)
);
CREATE INDEX placement_board ON placement(board_id, ord);
CREATE INDEX placement_event ON placement(event_id);

CREATE TABLE event_task (
  id       TEXT    PRIMARY KEY,
  event_id TEXT    NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  ord      INTEGER NOT NULL,
  text     TEXT    NOT NULL DEFAULT '',
  done     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX event_task_ev ON event_task(event_id, ord);

-- 관계 — 선행(dep). 지금은 보드별로 두되(board_id), 끝점은 전역 event id를 가리킨다.
-- 보드를 넘는 관계로의 확장(§3.6)은 다음 단계에서 board_id를 떼며 이룬다.
CREATE TABLE relation (
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  id       TEXT    NOT NULL,
  type     TEXT    NOT NULL DEFAULT 'dep',
  from_id  TEXT    NOT NULL,                   -- event id (선행)
  to_id    TEXT    NOT NULL,                   -- event id (후행)
  PRIMARY KEY (board_id, id)
);
CREATE INDEX relation_board ON relation(board_id);

-- ── 기존 데이터 이관 (board_id 접두로 전역 유일화) ──
INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
  SELECT board_id || ':' || id, title, start_date, end_date, type, status, org, progress, note
  FROM item;

INSERT INTO placement (board_id, event_id, track_id, ord, span, pos_x, pos_w, height_days, align, show_note, parent_id)
  SELECT board_id, board_id || ':' || id, track_id, ord, span, pos_x, pos_w, height_days, align, show_note,
         CASE WHEN parent_id IS NULL OR parent_id = '' THEN NULL ELSE board_id || ':' || parent_id END
  FROM item;

INSERT INTO event_task (id, event_id, ord, text, done)
  SELECT board_id || ':' || id, board_id || ':' || item_id, ord, text, done
  FROM task;

INSERT INTO relation (board_id, id, type, from_id, to_id)
  SELECT board_id, 'r_' || item_id || '_' || depends_on, 'dep',
         board_id || ':' || depends_on, board_id || ':' || item_id
  FROM dependency;
