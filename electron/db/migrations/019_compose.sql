-- 019 · 포함의 세 종류 — 순서 있는 포함 / 순서 없는 포함(태스크) / 구성(조합)  (docs/SAVE.md §5)
--
-- 조합은 여러 이벤트로 하나의 이벤트가 만들어진 것이다 — 보드가 트랙들의 조합인 것과 같다.
-- 태스크는 이벤트 안의 하위 이벤트가 순서를 갖지 않을 뿐이고, 모은다고 이벤트가 되지 않는다.
-- 둘 다 순서축 위가 아니지만(ordered=0) 본질이 다르므로 compose로 가른다.
--   ordered=1 compose=0 : 순서 있는 포함 (트랙 위 카드, 하위 카드)
--   ordered=0 compose=0 : 순서 없는 포함 = 태스크
--   ordered=0 compose=1 : 구성 = 조합 (보드 → 트랙, 이벤트 → 조합 대상)

ALTER TABLE containment ADD COLUMN compose INTEGER NOT NULL DEFAULT 0;

-- 보드 루트를 자식으로 담는 간선 — 옛 조합이 남긴 오염(순환 원인). 어느 코드도 읽지 않던 것이다.
DELETE FROM disp        WHERE child_id IN (SELECT root_event_id FROM board WHERE root_event_id IS NOT NULL);
DELETE FROM containment WHERE child_id IN (SELECT root_event_id FROM board WHERE root_event_id IS NOT NULL);

-- 옛 조합 표식(ordered=2) → 구성
UPDATE containment SET ordered = 0, compose = 1 WHERE ordered = 2;

-- 옛 데이터의 '트랙을 품은 카드'(ordered=1, 부모가 보드 루트가 아닌데 자식이 어떤 보드의 트랙) —
-- 예전 load가 조합 참조로 읽던 것 → 구성. 보드 루트→트랙 간선을 바꾸기 전에 해야 트랙을 알아본다.
UPDATE containment SET ordered = 0, compose = 1
 WHERE ordered = 1
   AND parent_id NOT IN (SELECT root_event_id FROM board WHERE root_event_id IS NOT NULL)
   AND child_id IN (
     SELECT c.child_id FROM containment c JOIN board b ON c.parent_id = b.root_event_id WHERE c.ordered = 1
   );

-- 보드 → 트랙 = 보드는 트랙들의 조합(구성). 트랙끼리는 순서가 없다(좌우 순서는 표시, ord로 보관).
UPDATE containment SET ordered = 0, compose = 1
 WHERE ordered = 1
   AND parent_id IN (SELECT root_event_id FROM board WHERE root_event_id IS NOT NULL);

-- '동일'은 관계가 아니라 합치기 작업이다(SYSTEM.md) — 옛 same 관계 행을 걷어낸다.
DELETE FROM rel WHERE type = 'same';
