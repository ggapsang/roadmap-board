-- 011 · 보드도 이벤트다 (PDF §3.2·§5.1: 로드맵 보드 = 펼쳐진 이벤트 하나)
--
-- 모든 단위는 이벤트다 — 카드도, 태스크도, 트랙도, 보드도. 그 연장으로 각 보드에
-- '접으면 그 보드가 되는' 루트 이벤트를 둔다. 이 루트 이벤트를 다른 보드에 배치하면
-- 그 카드가 곧 이 보드다(카드↔보드). 이벤트이므로 상태·관계·별칭을 똑같이 가진다.
--
-- board.root_event_id : 이 보드를 접었을 때의 이벤트. 보드 삭제 시 함께 지운다(repo).

ALTER TABLE board ADD COLUMN root_event_id TEXT;

-- 기존 보드마다 루트 이벤트를 만들고 연결한다.
INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
  SELECT 'board:' || id, name, start_date, end_date, 'bar', 'plan', '', 0, ''
  FROM board;
UPDATE board SET root_event_id = 'board:' || id;
