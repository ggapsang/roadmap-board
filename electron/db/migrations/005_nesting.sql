-- 005 · 일정 안에 일정 + 카드 표현 옵션
--
-- parent_id : 상위 일정. "1년차 과제 제출용 화면 구성"이 DT 개발·3D 모델링을
--             품는 식이다. 같은 보드 안의 일정만 가리킨다.
-- pos_x/pos_w : 트랙(또는 상위 카드) 안에서의 가로 위치·폭 비율 0~1.
--               NULL이면 겹침 계산이 자동으로 정한다.
-- align     : 카드 안 글자의 세로 정렬
-- show_note : 비고를 카드에 함께 보여 줄지

ALTER TABLE item ADD COLUMN parent_id TEXT;
ALTER TABLE item ADD COLUMN pos_x     REAL;
ALTER TABLE item ADD COLUMN pos_w     REAL;
ALTER TABLE item ADD COLUMN align     TEXT    NOT NULL DEFAULT 'middle';
ALTER TABLE item ADD COLUMN show_note INTEGER NOT NULL DEFAULT 0;

CREATE INDEX item_parent ON item(board_id, parent_id);
