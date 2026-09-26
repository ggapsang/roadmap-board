/**
 * 카드 드래그.
 *
 *   카드 본체     상하 = 일 단위 스냅 이동, 좌우 = 트랙 이동
 *   위 손잡이     시작일 조절
 *   아래 손잡이   종료일 조절
 *   오른쪽 손잡이 트랙 걸침 (칸 단위로 붙는다)
 *
 * 트랙 이동은 포인터가 실제로 올라가 있는 컬럼을 찾아 판정한다.
 * 레인 확장 때문에 컬럼 폭이 트랙마다 다르므로, 고정 폭으로 나눠 델타를 구하면
 * 폭이 넓은 트랙 위에서 커서와 카드가 어긋난다.
 */
import { dayIndex, dateAt } from '../../core/dates.js';

export function attachDrag(grid, {
  store, view, getOrigin, getTotalDays, getScale, getOrderMode, onDragEnd,
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
    if (getOrderMode?.()) return;     // 순서 모드(초안)에선 날짜 드래그 비활성
    if (view.textSelect) return;      // 텍스트 선택 모드에서는 이동하지 않는다
    const card = ev.target.closest('.ev');
    if (!card) return;
    const item = store.item(card.dataset.id);
    if (!item) return;

    const origin = getOrigin();
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
      startDay: dayIndex(item.s, origin),
      endDay: dayIndex(item.e, origin),
      startTrack: trackIndexAt(ev.clientX),
      homeTrack: store.trackIndex(item.place.t),
      hd0: item.place?.hd ?? null,
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
    // 접힌 구간에서는 1px이 하루보다 길다. 눈금을 거쳐 일수로 환산한다.
    const scale = getScale();
    const dDays = Math.round(scale.dayAt(scale.y(drag.startDay) + (ev.clientY - drag.y)) - drag.startDay);
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
        if (drag.mode === 'hw-right') {
          item.place.x = drag.x0;
          item.place.w = Math.min(1 - drag.x0, Math.max(MIN, drag.w0 + ratio));
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
        if (item) item.place.sp = nextSpan;
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

    const origin = getOrigin();

    store.commit('드래그', () => {
      const item = store.item(drag.id);
      if (!item) return;
      if (drag.mode === 'move') {
        const length = drag.endDay - drag.startDay;
        // 아래로는 막지 않는다 — 끌어 내리면 축이 그만큼 늘어난다(잘라낸 빈 구간 복구).
        const s = Math.max(0, drag.startDay + dDays);
        item.s = dateAt(origin, s);
        item.e = dateAt(origin, s + length);
        const maxTrack = store.tracks.length - item.place.sp;
        const k = Math.max(0, Math.min(maxTrack, drag.startTrack + dTrack));
        item.place.t = store.tracks[k].id;
      } else if (drag.mode === 'size-top') {
        if (drag.hd0 != null) {
          // 크기 강제: 위 가장자리를 끌면 바닥(아래)은 고정하고 위로/아래로 늘고 줄인다.
          const bottom = drag.startDay + drag.hd0;
          const newS = Math.max(0, Math.min(bottom - 1, drag.startDay + dDays));
          item.s = dateAt(origin, newS);
          item.place.hd = Math.max(1, bottom - newS);
        } else {
          // 보통 카드: 위쪽을 끌면 시작일이 움직인다. 종료일은 그대로.
          const s = Math.max(0, Math.min(drag.endDay, drag.startDay + dDays));
          item.s = dateAt(origin, s);
        }
      } else if (drag.hd0 != null) {
        // 세로 크기 강제 — 날짜는 그대로, 세로 길이(일)만 늘리고 줄인다
        item.place.hd = Math.max(1, Math.round(drag.hd0 + dDays));
      } else {
        // 종료일도 아래로는 막지 않는다 — 끌어 내리면 축이 늘어난다.
        item.e = dateAt(origin, Math.max(drag.startDay, drag.endDay + dDays));
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
