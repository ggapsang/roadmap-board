-- 009 · 보드 별칭 — docs/DIRECTION.md #3·#7
--
-- alias_board : 이 카드가 통째로 대신하는 다른 보드의 id. 펼치면 그 보드로 진입한다.
--   여러 보드가 같은 대상을 별칭할 수 있다("같은 이벤트가 여러 보드에"의 첫 형태).
--   board(id)를 가리키지만 FK는 걸지 않는다 — 보드를 넘는 참조라, 대상이 지워지면
--   조용히 끊긴 별칭(UI가 '없는 보드'로 처리)이 되게 둔다. CASCADE로 카드를 지우지 않는다.

ALTER TABLE item ADD COLUMN alias_board INTEGER;
CREATE INDEX item_alias ON item(board_id, alias_board);
