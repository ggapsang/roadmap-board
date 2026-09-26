-- 013 · 태스크도 이벤트다 (PDF §3.2·§3.3)
--
-- 카드·보드·트랙에 이어 마지막 단위인 태스크도 이벤트로. 각 태스크에 배킹 이벤트를 둔다.
-- 태스크는 '순서 없는 포함'이다 — 순서(placement)가 생기면 하위 카드로 승격하고, 없으면
-- 태스크로 남는다(§3.3). event_task는 '어느 이벤트가 이 태스크를 순서 없이 담는가'의 링크다.
-- (제목=text, 상태=done. 날짜는 담는 카드 기간을 물려받아 채운다 — 태스크는 본래 무날짜다.)

INSERT INTO event (id, title, start_date, end_date, type, status, org, progress, note)
  SELECT et.id, et.text, e.start_date, e.end_date, 'task',
         CASE WHEN et.done = 1 THEN 'done' ELSE 'plan' END, '', 0, ''
  FROM event_task et JOIN event e ON e.id = et.event_id;
