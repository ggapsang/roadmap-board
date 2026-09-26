-- 012 · 트랙도 이벤트다 (PDF §3.2: 트랙을 펼치면 그 역시 하나의 보드)
--
-- 각 트랙에 배킹 이벤트를 둔다. 트랙 이름 = 이벤트 제목. 트랙을 펼치면 그 트랙에 놓인
-- placement들이 하나의 보드가 된다(카드=보드와 같은 재귀). 이벤트이므로 관계·상태를 가진다.

ALTER TABLE track ADD COLUMN event_id TEXT;

INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
  SELECT 'track:' || t.board_id || ':' || t.id, t.name,
         b.start_date, b.end_date, 'bar', 'plan', '', 0, ''
  FROM track t JOIN board b ON b.id = t.board_id;

UPDATE track SET event_id = 'track:' || board_id || ':' || id;
