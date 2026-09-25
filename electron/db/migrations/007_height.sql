-- 007 · 카드 세로 크기 강제 조정
--
-- item.height_days : 카드 세로 길이를 날짜와 무관하게 강제로 정한다(일 단위).
--                    NULL이면 기간(start~end)대로 자동. 값이 있으면 그만큼 세로로
--                    그린다 — "짧은 일정이라도 카드를 키워 내용을 보고 싶다"는 요청.
ALTER TABLE item ADD COLUMN height_days REAL;
