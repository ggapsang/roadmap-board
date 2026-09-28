/**
 * 가로로 늘어선 탭을 끌어 순서를 바꾼다 — 보드 탭줄, 편집 패널 탭(속성·매핑·스타일·상세) 공용.
 *
 * 살짝 눌렀다 떼면(DRAG_SLOP 미만) 그냥 클릭이다 — 탭 전환은 원래대로. 그 이상 끌면 드래그가 되고,
 * 놓는 자리를 세로 표시선으로 보여 준 뒤 놓을 때 onReorder(from, to)를 한 번 부른다. 드래그 끝의
 * click은 삼켜서 탭이 선택되지 않게 한다. 글자가 긁히지 않게 끄는 동안 선택을 막는다.
 *
 * 리스너는 컨테이너(재렌더돼도 남는 것)와 window에만 붙인다. 탭 요소는 재렌더로 통째로 바뀔 수 있어
 * 거기 붙이면 드래그 중에 끊긴다(CLAUDE.md 규약 14와 같은 이유).
 *
 * @param {HTMLElement} container 탭들을 담은 요소
 * @param {{ item: string, exclude?: string, onReorder: (from:number, to:number) => void }} o
 *   item     탭 선택자(컨테이너의 자식)
 *   exclude  여기서 누르면 드래그를 시작하지 않는다(닫기 버튼 등)
 *   to       '끌어낸 자리를 뺀' 뒤의 새 인덱스
 */
const DRAG_SLOP = 5;

export function attachTabReorder(container, { item, exclude = null, onReorder }) {
  let swallowClick = false;
  container.addEventListener('click', (e) => {
    if (swallowClick) { e.stopPropagation(); e.preventDefault(); swallowClick = false; }
  }, true);

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const tab = e.target.closest(item);
    if (!tab || !container.contains(tab) || (exclude && e.target.closest(exclude))) return;
    const tabs = [...container.querySelectorAll(item)];
    const from = tabs.indexOf(tab);
    if (from < 0) return;
    const startX = e.clientX;
    let dragging = false;
    let to = from;
    const mark = document.createElement('div');
    mark.className = 'tab-drop';
    mark.setAttribute('aria-hidden', 'true');

    const place = (clientX) => {
      const rects = tabs.map((t) => t.getBoundingClientRect());
      let idx = rects.findIndex((r) => clientX < r.left + r.width / 2);
      if (idx < 0) idx = rects.length;
      to = idx;
      const box = container.getBoundingClientRect();
      const x = idx >= rects.length ? rects[rects.length - 1].right : rects[idx].left;
      mark.style.left = `${x - box.left + container.scrollLeft - 1}px`;
    };
    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - startX) < DRAG_SLOP) return;
      if (!dragging) {
        dragging = true;
        tab.classList.add('dragging');
        container.classList.add('reordering');
        document.body.classList.add('reordering-tabs');
        container.append(mark);
      }
      ev.preventDefault();
      place(ev.clientX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!dragging) return;
      mark.remove();
      tab.classList.remove('dragging');
      container.classList.remove('reordering');
      document.body.classList.remove('reordering-tabs');
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 0);
      const next = to > from ? to - 1 : to;          // 끌어낸 자리를 빼면 뒤쪽이 하나 당겨진다
      if (next !== from) onReorder(from, next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
}
