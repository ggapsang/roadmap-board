-- 018 · 보드별 '표현' 설정을 JSON으로 보관
--
-- 시스템(이벤트·관계)과 무관한 표현 설정 — 화살표 굵기·글자 배율·축 종류(display)와,
-- 카드 상태 이름 재정의(statusLabels: 계획/진행중/완료/지연/보류를 보드마다 다른 이름으로)를
-- board 행에 blob으로 둔다. 담당 조직은 이미 org 테이블에 있다.
-- NULL이면 기본값을 쓴다.

ALTER TABLE board ADD COLUMN meta_json TEXT;
