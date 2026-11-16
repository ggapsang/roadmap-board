-- 027 · 카드 글자 가로 정렬 (스타일 탭 — 왼쪽·가운데·오른쪽, 2026-11-17 사용자)
--
-- 세로 정렬(align)과 같이 표현이라 포함 간선 위의 배치(disp)에. NULL = 자동(보통 카드는 왼쪽, 큰 카드·상위 카드 제목은 가운데).
ALTER TABLE disp ADD COLUMN halign TEXT;
