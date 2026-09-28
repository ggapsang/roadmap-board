-- 021 · 세로축 눈금 모드와 날짜 없는 보드 (docs/SCALE.md)
--
-- 1) 이벤트 날짜를 선택 속성으로 — start_date·end_date의 NOT NULL을 푼다(SYSTEM.md "날짜는 선택").
--    SQLite는 제약을 못 바꾸므로 테이블을 새로 만든다. 옛 테이블을 DROP하면 옛 이관용 테이블
--    (placement·event_task, 010)이 ON DELETE CASCADE로 비워지므로, 옛 것은 이름만 바꿔 남긴다 —
--    RENAME이 그 테이블들의 참조를 event_v20으로 옮겨 준다. 읽는 코드는 없다(017에서 이관 끝).
PRAGMA legacy_alter_table = OFF;
ALTER TABLE event RENAME TO event_v20;

CREATE TABLE event (
  id         TEXT    PRIMARY KEY,             -- 전역 유일 (보드 무관)
  title      TEXT    NOT NULL DEFAULT '',
  start_date TEXT,                            -- YYYY-MM-DD. 날짜 없는 이벤트면 NULL
  end_date   TEXT,                            -- inclusive
  type       TEXT    NOT NULL DEFAULT 'bar',
  status     TEXT    NOT NULL DEFAULT 'plan',
  org        TEXT    NOT NULL DEFAULT '',
  progress   INTEGER NOT NULL DEFAULT 0,
  note       TEXT    NOT NULL DEFAULT ''
);
INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
  SELECT id, title, start_date, end_date, type, status, org, progress, note FROM event_v20;

-- 2) 칸 — 날짜 없는 보드에서의 세로 위치. 배치(표현)라 포함 간선 위(disp)에 둔다.
ALTER TABLE disp ADD COLUMN slot_start INTEGER;   -- 0부터
ALTER TABLE disp ADD COLUMN slot_len   INTEGER;   -- 1 이상

-- 3) 구간은 어느 눈금 모드의 바깥 칸 묶음인가 — 모드마다 따로 기억한다. 옛 구간은 월-주.
ALTER TABLE band ADD COLUMN mode TEXT NOT NULL DEFAULT 'month-week';
