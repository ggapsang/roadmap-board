-- 020 · 카드 색 채우기 (스타일 탭) — 파워포인트·엑셀의 '채우기'와 같은 기능
--
-- 표현이다(보드마다 다를 수 있다) — 이벤트 본질이 아니라 그 포함 간선 위의 배치(disp)에 둔다.
-- 값은 팔레트 키(src/config/index.js FILLS, 예: 'blue')다. 색 자체(HEX)는 테마 토큰(--fill-*)이
-- 정한다 — 라이트·다크에서 같은 이름이 각자 읽히는 색으로 나온다. NULL이면 채우지 않음(기본 면).

ALTER TABLE disp ADD COLUMN fill TEXT;
