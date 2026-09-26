-- 014 · 별칭(alias) — 같은 이벤트를 이 보드 맥락의 다른 이름으로 표시 (PDF §3.5)
--
-- 별칭은 이벤트 본질이 아니라 '이 보드에서 이렇게 부른다'는 배치·표시라 placement에 둔다.
-- 같은 이벤트가 여러 보드에 있으면 보드마다 다른 별칭을 가질 수 있다.

ALTER TABLE placement ADD COLUMN alias TEXT;
