-- 001 · 초기 스키마
--
-- 문서를 JSON 한 덩어리로 넣지 않고 정규화한다. 지금 규모(일정 수십 건)에는
-- 과하지만, 기획안 P2(변경 이력)·P3(산출물 id 링크)가 전부 관계형 질의를
-- 전제하기 때문에 처음부터 테이블로 쪼개 둔다.

CREATE TABLE board (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL DEFAULT '로드맵',
  start_date  TEXT    NOT NULL,              -- YYYY-MM-DD (로컬)
  end_date    TEXT    NOT NULL,
  doc_version INTEGER NOT NULL DEFAULT 1,     -- 문서 스키마 버전 (src/core/schema.js).
                                              -- DB 스키마 버전(user_version)과는 별개다.
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE track (
  board_id  INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  id        TEXT    NOT NULL,
  ord       INTEGER NOT NULL,                -- 화면 표시 순서
  lab       TEXT    NOT NULL DEFAULT '',     -- '요구사항 4' 등 분류 라벨
  name      TEXT    NOT NULL,
  PRIMARY KEY (board_id, id)
);
CREATE INDEX track_ord ON track(board_id, ord);

CREATE TABLE item (
  board_id    INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  id          TEXT    NOT NULL,
  track_id    TEXT    NOT NULL,
  ord         INTEGER NOT NULL,
  span        INTEGER NOT NULL DEFAULT 1,    -- 트랙 병합 폭
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,              -- inclusive (기획안 D-3)
  title       TEXT    NOT NULL DEFAULT '',
  type        TEXT    NOT NULL DEFAULT 'bar',
  status      TEXT    NOT NULL DEFAULT 'plan',
  org         TEXT    NOT NULL DEFAULT '',
  progress    INTEGER NOT NULL DEFAULT 0,
  note        TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (board_id, id),
  FOREIGN KEY (board_id, track_id) REFERENCES track(board_id, id) ON DELETE CASCADE
);
CREATE INDEX item_track ON item(board_id, track_id);
CREATE INDEX item_dates ON item(board_id, start_date, end_date);
CREATE INDEX item_status ON item(board_id, status);

-- 선후행. 표시 전용이고 자동 재계산은 하지 않는다 (기획안 D-4).
CREATE TABLE dependency (
  board_id   INTEGER NOT NULL,
  item_id    TEXT    NOT NULL,
  depends_on TEXT    NOT NULL,
  PRIMARY KEY (board_id, item_id, depends_on),
  FOREIGN KEY (board_id, item_id) REFERENCES item(board_id, id) ON DELETE CASCADE
);

-- 변경 이력 스냅샷 (기획안 P2). 저장할 때마다가 아니라 일정 간격으로만 남긴다.
CREATE TABLE revision (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  label      TEXT    NOT NULL DEFAULT '',
  items      INTEGER NOT NULL DEFAULT 0,     -- 목록에서 규모를 보여 주기 위한 캐시
  doc        TEXT    NOT NULL                -- 문서 전체 JSON
);
CREATE INDEX revision_board ON revision(board_id, id DESC);
