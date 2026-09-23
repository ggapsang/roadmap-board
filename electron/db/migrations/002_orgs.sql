-- 002 · 담당 조직 목록을 보드가 직접 들고 있게 한다
--
-- v1까지는 코드 상수에 박혀 있어서 과제마다 소스를 고쳐야 했다.
-- 조직명은 item.org에 문자열 값으로 들어가므로(트랙처럼 id 참조가 아니다)
-- 이름을 바꿀 때는 렌더러가 item.org까지 함께 갱신한다.

CREATE TABLE org (
  board_id INTEGER NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  ord      INTEGER NOT NULL,
  name     TEXT    NOT NULL,
  PRIMARY KEY (board_id, name)
);
CREATE INDEX org_ord ON org(board_id, ord);

-- 이미 쓰이고 있는 조직을 먼저 채워 둔다. 기본 목록은 앱이 문서 마이그레이션
-- (v1 -> v2)에서 합쳐 넣는다.
INSERT INTO org (board_id, ord, name)
SELECT board_id,
       ROW_NUMBER() OVER (PARTITION BY board_id ORDER BY MIN(ord)) - 1,
       org
FROM item
WHERE org <> ''
GROUP BY board_id, org;
