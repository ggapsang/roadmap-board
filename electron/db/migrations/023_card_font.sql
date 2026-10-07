-- 023 · 카드마다 글자 크기 (스타일 탭)
--
-- 보드 전체 글자 크기(표시 설정 fontScale)에 곱하는 그 카드의 배율. 표현이라 포함 간선 위의 배치(disp)에. NULL = 1(보드 크기 그대로).
ALTER TABLE disp ADD COLUMN font_scale REAL;
