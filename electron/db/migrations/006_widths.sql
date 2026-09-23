-- 006 · 트랙 너비 + 구간 세로 압축
--
-- track.width : 컬럼 너비(px). NULL이면 겹침 계산이 자동으로 정한다.
-- band.scale  : 묶은 구간의 세로 압축 배율. 1이면 기간 그대로, 0.4면 40% 높이.
--               "1Q로 묶었는데 높이가 그대로면 압축해 보여 주는 의미가 없다"는
--               요청에 따른 것.

ALTER TABLE track ADD COLUMN width REAL;
ALTER TABLE band  ADD COLUMN scale REAL NOT NULL DEFAULT 1;
