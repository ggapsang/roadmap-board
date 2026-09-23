-- 003 · 보드 여러 개 (프로젝트)
--
-- 001에서 board.id를 1로 고정해 넣고 있었다. 이 도구를 다른 과제에도 쓰려면
-- 보드가 여러 개여야 한다. 스키마 자체는 이미 board_id로 분리돼 있으므로
-- 테이블 구조는 그대로 두고, id를 자동 배정으로 바꾸고 정렬용 컬럼만 더한다.

-- 목록에서 최근 연 순서로 보여 주기 위한 컬럼
ALTER TABLE board ADD COLUMN opened_at TEXT;

UPDATE board SET opened_at = updated_at WHERE opened_at IS NULL;

-- 이름으로 찾기
CREATE INDEX board_name ON board(name);
