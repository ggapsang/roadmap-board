-- 004 · 시간축 구간
--
-- 왼쪽 월 칸을 사용자가 여러 달씩 묶어 이름을 붙인 것. 예: 2027년 1~3월 = "1Q".
-- 비어 있으면 앱이 월 단위로 자동 표시한다.

CREATE TABLE band (
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  id       TEXT    NOT NULL,
  ord      INTEGER NOT NULL,
  from_date TEXT   NOT NULL,
  to_date   TEXT   NOT NULL,       -- inclusive
  label    TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (board_id, id)
);
CREATE INDEX band_ord ON band(board_id, ord);
