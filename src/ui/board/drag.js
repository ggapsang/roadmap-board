/**
 * 카드 드래그.
 *
 *   카드 본체   상하 = 일 단위 스냅 이동, 좌우 = 트랙 이동
 *   아래 손잡이 기간 조절 (종료일)
 *
 * 트랙 이동은 포인터가 실제로 올라가 있는 컬럼을 찾아 판정한다.
 * 레인 확장 때문에 컬럼 폭이 트랙마다 다르므로, 고정 폭으로 나눠 델타를 구하면
 * 폭이 넓은 트랙 위에서 커서와 카드가 어긋난다.
 */
import { dayIndex, dateAt } from '../../core/dates.js';

export function attachDrag(grid, {
  store, view, getOrigin, getTotalDays, getScale, onDragEnd,
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

    const origin = getOrigin();
    const mode = ev.target.classList.contains('grip') ? 'size' : 'move';

    drag = {
      id: item.id,
      mode,
      x: ev.clientX,
      y: ev.clientY,
      startDay: dayIndex(item.s, origin),
      endDay: dayIndex(item.e, origin),
      startTrack: trackIndexAt(ev.clientX),
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
    const dTrack = trackIndexAt(ev.clientX) - drag.startTrack;
    if (!dDays && !dTrack && !drag.moved) return;

    // 드래그 전체를 되돌리기 1단계로 묶는다 (기획안 §5)
    if (!drag.moved) {
      store.begin(drag.mode === 'size' ? '기간 조절' : '일정 이동');
      drag.moved = true;
    }

    const origin = getOrigin();
    const total = getTotalDays();

    store.commit('드래그', () => {
      const item = store.item(drag.id);
      if (!item) return;
      if (drag.mode === 'move') {
        const length = drag.endDay - drag.startDay;
        const s = Math.max(0, Math.min(total - 1 - length, drag.startDay + dDays));
        item.s = dateAt(origin, s);
        item.e = dateAt(origin, s + length);
        const maxTrack = store.tracks.length - item.sp;
        const k = Math.max(0, Math.min(maxTrack, drag.startTrack + dTrack));
        item.t = store.tracks[k].id;
      } else {
        item.e = dateAt(origin, Math.max(drag.startDay, Math.min(total - 1, drag.endDay + dDays)));
        if (item.ty === 'ms') item.e = item.s;
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
