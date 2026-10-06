/**
 * 카드 드래그.
 *
 *   카드 본체     상하 = 정밀도 단위로 스냅 이동, 좌우 = 트랙 이동
 *   위 손잡이     시작 조절
 *   아래 손잡이   끝 조절
 *   오른쪽 손잡이 트랙 걸침 (칸 단위로 붙는다)
 *
 * 세로 위치는 timeline(core/timeline.js)을 거친다 — 날짜 있는 보드는 일 인덱스, 날짜 없는 보드는
 * 칸 인덱스. 정밀도 단위(step)는 눈금 모드가 정한다: 주-일·월-주 1일 · 분기-월 1주 · 눈금 없음 1칸.
 * 월 단위(눈금 없음의 한 칸이 월)는 달력 산술이라, 끝은 '다음 칸의 시작 − 1'로 옮긴다(말일 보정).
 *
 * 트랙 이동은 포인터가 실제로 올라가 있는 컬럼을 찾아 판정한다.
 * 레인 확장 때문에 컬럼 폭이 트랙마다 다르므로, 고정 폭으로 나눠 델타를 구하면
 * 폭이 넓은 트랙 위에서 커서와 카드가 어긋난다.
 */
import { UNIT_DAYS, LAYOUT } from '../../config/index.js';

/** 크기 강제 높이(hd)의 하한(위치 단위) — 0이면 카드가 사라진다. 화면에선 카드 최소 높이가 먼저 막는다 */
const HD_MIN = 0.05;

export function attachDrag(grid, {
  store, view, getScale, getTimeline, getZoom = () => 1, onDragEnd,
}) {
  let drag = null;

  /** clientX가 올라가 있는 트랙 인덱스. 범위를 벗어나면 가장 가까운 쪽. */
  function trackIndexAt(clientX) {
    const cols = [...grid.querySelectorAll('.col')];
    if (!cols.length) return 0;
    for (let i = 0; i < cols.length; i++) {
      const r = cols[i].getBoundingClientRect();
      if (clientX < r.right) return i;
    }
    return cols.length - 1;
  }

  grid.addEventListener('pointerdown', (ev) => {
    if (store.readonly || ev.button !== 0) return;
    if (view.textSelect) return;      // 텍스트 선택 모드에서는 이동하지 않는다
    const card = ev.target.closest('.ev');
    if (!card) return;
    const item = store.item(card.dataset.id);
    if (!item) return;

    // 드래그 동안은 누른 순간의 timeline을 쓴다 — 끄는 사이 축 시작이 바뀌어도 위치 기준이 흔들리지 않게
    const tl = getTimeline();
    const pos = tl.pos(item);
    if (!pos) return;
    const cls = ev.target.classList;
    const mode = cls.contains('grip') ? 'size'
      : cls.contains('grip-top') ? 'size-top'
      : cls.contains('grip-span') ? 'span'
      : cls.contains('grip-hw') ? 'hw-left'
      : cls.contains('grip-he') ? 'hw-right'
      : 'move';

    // 자식 카드의 가로 폭은 상위 카드에 대한 비율로 다룬다
    const host = card.parentElement;
    const hostWidth = host?.getBoundingClientRect().width || 1;
    const rect = card.getBoundingClientRect();
    const hostLeft = host?.getBoundingClientRect().left ?? 0;

    drag = {
      id: item.id,
      mode,
      x: ev.clientX,
      y: ev.clientY,
      tl,
      startDay: pos.s,
      endDay: pos.e,
      startTrack: trackIndexAt(ev.clientX),
      homeTrack: store.trackIndex(item.place.t),
      hd0: item.place?.hd ?? null,
      oy0: item.place?.hd != null ? Math.max(0, Number(item.place?.oy) || 0) : 0,
      hostWidth,
      x0: item.place?.x ?? (rect.left - hostLeft) / hostWidth,
      w0: item.place?.w ?? rect.width / hostWidth,
      moved: false,
    };
    card.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  grid.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    // 접힌 구간에서는 1px이 하루보다 길다. 눈금을 거쳐 위치로 환산한 뒤 정밀도 단위 개수(n)로.
    const scale = getScale();
    const tl = drag.tl;
    // 마우스 이동은 화면 px — 보드 배율(Ctrl+휠)로 나눠 보드 px로
    const raw = scale.dayAt(scale.y(drag.startDay) + (ev.clientY - drag.y) / getZoom()) - drag.startDay;
    const n = Math.round(raw / (UNIT_DAYS[tl.step] ?? 1));
    const dDays = n;                  // 0이 아니면 움직였다
    const pointerTrack = trackIndexAt(ev.clientX);
    const dTrack = pointerTrack - drag.startTrack;

    // 상위 카드 안에서의 가로 위치·폭
    if (drag.mode.startsWith('hw')) {
      const dx = ev.clientX - drag.x;
      if (Math.abs(dx) < 2 && !drag.moved) return;
      if (!drag.moved) { store.begin('가로 폭'); drag.moved = true; }
      const MIN = 0.08;
      const ratio = dx / drag.hostWidth;
      store.commit('가로 폭', () => {
        const item = store.item(drag.id);
        if (!item) return;
        // 자식은 부모 안(≤1)으로 가둔다. 최상위 강제 카드는 트랙 여러 개까지(≤트랙 수)
        // 넓힐 수 있어 옆 트랙을 넘나든다 — w>1이면 컬럼을 넘어 걸친다.
        const max = item.parent ? 1 : store.tracks.length;
        if (drag.mode === 'hw-right') {
          item.place.x = drag.x0;
          item.place.w = Math.max(MIN, Math.min(max - drag.x0, drag.w0 + ratio));
        } else {
          const right = drag.x0 + drag.w0;
          const nextX = Math.min(right - MIN, Math.max(0, drag.x0 + ratio));
          item.place.x = nextX;
          item.place.w = right - nextX;
        }
      });
      return;
    }

    // 걸침은 트랙 칸 단위로만 바뀐다. 커서가 올라간 트랙까지 덮는다.
    if (drag.mode === 'span') {
      const nextSpan = Math.max(1, Math.min(
        store.tracks.length - drag.homeTrack,
        pointerTrack - drag.homeTrack + 1,
      ));
      const item0 = store.item(drag.id);
      if (!drag.moved && item0 && nextSpan === item0.place.sp) return;
      if (!drag.moved) { store.begin('트랙 걸침'); drag.moved = true; }
      store.commit('트랙 걸침', () => {
        const item = store.item(drag.id);
        if (!item) return;
        item.place.sp = nextSpan;
        // 걸침 손잡이는 연속 확장 — 소속 트랙을 홈부터 연속 범위로 채운다.
        const home = store.trackIndex(item.place.t);
        const ids = [];
        for (let k = 0; k < nextSpan && home + k < store.tracks.length; k += 1) ids.push(store.tracks[home + k].id);
        item.place.tracks = ids;
      });
      return;
    }

    // 크기 강제의 아래 가장자리 — 세로 길이를 단위(일·주·칸)에 붙이지 않고 끈 만큼 늘리고 줄인다. 같은 칸·같은 주 안에서도
    // 높이를 맞출 수 있게(2026-10-06 사용자). 시작(날짜·칸)은 그대로. 위치 단위의 소수로 저장해 배율·접힌 구간을 탄다.
    if (drag.mode === 'size' && drag.hd0 != null) {
      const dy = (ev.clientY - drag.y) / getZoom();
      if (!drag.moved && Math.abs(dy) < 2) return;
      if (!drag.moved) { store.begin('기간 조절'); drag.moved = true; }
      const topPos = drag.startDay + drag.oy0;
      const top = scale.y(topPos);
      const want = Math.max(LAYOUT.minCardHeight, scale.extent(topPos, drag.hd0) + dy);
      // 축 끝 너머는 기본 일당(칸당) 픽셀로 센다(extent와 같은 규칙)
      const px = top + want;
      const bottom = px >= scale.height ? scale.totalDays + (px - scale.height) / scale.ppd : scale.dayAt(px);
      store.commit('드래그', () => {
        const item = store.item(drag.id);
        if (item) item.place.hd = Math.max(HD_MIN, Math.round((bottom - topPos) * 100) / 100);
      });
      return;
    }

    // 크기 강제의 위 가장자리 — 바닥은 그대로 두고 윗변을 끈 만큼(단위에 붙이지 않는다). 같은 칸(날짜) 안이면 윗변 여백(oy)만
    // 바뀌고, 다른 칸으로 넘어가면 시작 칸(날짜)이 그 칸으로 바뀐다(2026-10-06 사용자).
    if (drag.mode === 'size-top' && drag.hd0 != null) {
      const dy = (ev.clientY - drag.y) / getZoom();
      if (!drag.moved && Math.abs(dy) < 2) return;
      if (!drag.moved) { store.begin('기간 조절'); drag.moved = true; }
      const topPos0 = drag.startDay + drag.oy0;
      const bottomPos = topPos0 + drag.hd0;
      const bottomPx = scale.y(topPos0) + scale.extent(topPos0, drag.hd0);
      const px = Math.max(0, Math.min(bottomPx - LAYOUT.minCardHeight, scale.y(topPos0) + dy));
      const newTop = Math.min(scale.dayAt(px), bottomPos - HD_MIN);
      const s = Math.max(0, tl.snap(Math.floor(newTop)));
      store.commit('드래그', () => {
        const item = store.item(drag.id);
        if (!item) return;
        tl.set(item, s, Math.max(s, drag.endDay));
        item.place.oy = newTop - s > 0.005 ? Math.round((newTop - s) * 100) / 100 : null;
        item.place.hd = Math.max(HD_MIN, Math.round((bottomPos - newTop) * 100) / 100);
      });
      return;
    }

    if (!dDays && !dTrack && !drag.moved) return;

    // 드래그 전체를 되돌리기 1단계로 묶는다 (기획안 §5)
    if (!drag.moved) {
      const label = drag.mode.startsWith('size') ? '기간 조절'
        : drag.mode === 'span' ? '트랙 걸침'
        : drag.mode.startsWith('hw') ? '가로 폭' : '일정 이동';
      store.begin(label);
      drag.moved = true;
    }

    // 끝(포함) 옮기기 — 다음 칸의 시작을 n단위 옮기고 하루(한 칸) 뺀다. 월 단위도 말일이 맞다.
    const endAdd = (e, k) => tl.add(e + 1, k) - 1;

    store.commit('드래그', () => {
      const item = store.item(drag.id);
      if (!item) return;
      if (drag.mode === 'move') {
        // 아래로는 막지 않는다 — 끌어 내리면 축이 그만큼 늘어난다(잘라낸 빈 구간 복구).
        // 위로는 0에서 멈춘다 — 길이를 지키며 멈추도록 n을 줄인다.
        let dn = n;
        while (dn < 0 && tl.add(drag.startDay, dn) < 0) dn += 1;
        tl.set(item, tl.add(drag.startDay, dn), endAdd(drag.endDay, dn));
        const sp = item.place.sp ?? 1;
        const maxTrack = store.tracks.length - sp;
        const k = Math.max(0, Math.min(maxTrack, drag.startTrack + dTrack));
        item.place.t = store.tracks[k].id;
        // 옮기면 소속 트랙도 새 홈부터 연속 범위로 (비연속은 패널에서 편집).
        const ids = [];
        for (let j = 0; j < sp && k + j < store.tracks.length; j += 1) ids.push(store.tracks[k + j].id);
        item.place.tracks = ids;
      } else if (drag.mode === 'size-top') {
        if (drag.hd0 != null) {
          // 크기 강제: 위 가장자리를 끌면 바닥(아래)은 고정하고 위로/아래로 늘고 줄인다.
          // 바닥은 소수일 수 있다(아래 가장자리를 단위 없이 끈 높이) — 시작은 단위대로, 높이는 남은 만큼
          const bottom = drag.startDay + drag.hd0;
          const newS = Math.max(0, Math.min(Math.ceil(bottom) - 1, tl.add(drag.startDay, n)));
          tl.set(item, newS, Math.max(newS, drag.endDay));
          item.place.hd = Math.max(HD_MIN, Math.round((bottom - newS) * 100) / 100);
        } else {
          // 보통 카드: 위쪽을 끌면 시작이 움직인다. 끝은 그대로.
          const s = Math.max(0, Math.min(drag.endDay, tl.add(drag.startDay, n)));
          tl.set(item, s, drag.endDay);
        }
      } else {
        // 끝도 아래로는 막지 않는다 — 끌어 내리면 축이 늘어난다.
        tl.set(item, drag.startDay, Math.max(drag.startDay, endAdd(drag.endDay, n)));
      }
    });
  });

  const finish = () => {
    if (!drag) return;
    const { id, moved } = drag;
    drag = null;
    if (moved) { store.end(); onDragEnd?.(id); }
  };

  grid.addEventListener('pointerup', finish);
  grid.addEventListener('pointercancel', finish);

  return { get dragging() { return !!drag && drag.moved; } };
}
