-- 008 · 순서 없는 태스크 (액션 아이템) — docs/DIRECTION.md #6
--
-- 카드 안에 담기는 "할 일" 목록이다. 하위 카드(parent)와 달리 서로 앞뒤(순서)가 없다.
-- 순서가 생기면 하위 카드로 승격한다 — 같은 단위, "순서축 위에 놓이는가"만 다르다.
-- item과 함께 산다. item이 지워지면 CASCADE로 함께 지워진다.

CREATE TABLE task (
  board_id INTEGER NOT NULL,
  id       TEXT    NOT NULL,
  item_id  TEXT    NOT NULL,
  ord      INTEGER NOT NULL,                -- 화면 표시 순서 (순서축과 무관, 목록 나열용)
  text     TEXT    NOT NULL DEFAULT '',
  done     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, id),
  FOREIGN KEY (board_id, item_id) REFERENCES item(board_id, id) ON DELETE CASCADE
);
CREATE INDEX task_item ON task(board_id, item_id);
