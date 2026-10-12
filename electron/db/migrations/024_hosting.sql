-- 024 · 보드 호스팅 (docs/SHARE.md §2)
--
-- 호스팅 = 보드를 떼어 낸 독립 사본. 4대상(event·containment·disp·rel)에는 쓰지 않는다 — 거두기 전까지 시스템에는 아무 일도 없다.
-- 원래 보드가 지워져도 사본은 남아야 한다(독립 보드로 거둘 수 있게) — 그래서 board_id + CASCADE가 아니라
-- source_board_id + SET NULL(규약 18의 의도적 예외).
CREATE TABLE hosting (
  id              INTEGER PRIMARY KEY,
  source_board_id INTEGER REFERENCES board(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,                 -- 떼어 낼 때의 보드 이름
  port            INTEGER NOT NULL,                 -- 1126부터. 다시 열 때 같은 포트(같은 링크)
  token           TEXT    NOT NULL,                 -- 링크의 토큰(128비트)
  status          TEXT    NOT NULL DEFAULT 'open',  -- open | paused | harvested | discarded
  base_json       TEXT    NOT NULL,                 -- 떼어 낸 시점 문서 — 3방향 합치기의 기준(바뀌지 않는다)
  doc_json        TEXT    NOT NULL,                 -- 사본의 최근 스냅샷(doc_seq까지 반영)
  doc_seq         INTEGER NOT NULL DEFAULT 0,
  ext_json        TEXT,                             -- 사본 밖 이벤트 이름(참조·조합 상대) — 참가자 화면에 이름만 보인다
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at       TEXT,
  result_json     TEXT                              -- 거두기 결과 요약
);

-- 변경 하나(같은 사람이 한 번에 보낸 묶음) = 한 줄. seq는 호스팅 안에서 1부터.
CREATE TABLE hosting_op (
  hosting_id INTEGER NOT NULL REFERENCES hosting(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  author     TEXT    NOT NULL,
  at         TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  op_json    TEXT    NOT NULL,
  PRIMARY KEY (hosting_id, seq)
);
