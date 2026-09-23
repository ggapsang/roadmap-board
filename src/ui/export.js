/**
 * 보드 내보내기 — PNG / PDF.
 *
 * 화면에 보이는 부분이 아니라 **트랙 헤더부터 마지막 일정까지 전체**를 한 장으로
 * 담는다. 그러려면 캡처 직전에 스크롤 컨테이너의 제약을 잠시 풀어
 * 내용 전체가 펼쳐진 상태로 만들어야 한다.
 */
import { $ } from './dom.js';
import { toast } from './toast.js';

/** 내보내는 동안 보드를 펼치고, 끝나면 되돌린다. */
async function withExpandedBoard(fn) {
  const body = document.body;
  const scroll = $('scroll');
  const saved = { scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };

  body.classList.add('exporting');
  // 레이아웃이 확정될 때까지 두 프레임 기다린다
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    const cal = document.querySelector('.cal');
    const rect = cal.getBoundingClientRect();
    return await fn({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: Math.ceil(cal.scrollWidth),
      height: Math.ceil(cal.scrollHeight),
    });
  } finally {
    body.classList.remove('exporting');
    await new Promise((r) => requestAnimationFrame(r));
    scroll.scrollTop = saved.scrollTop;
    scroll.scrollLeft = saved.scrollLeft;
  }
}

const stamp = () => new Date().toISOString().slice(0, 10);

const fileBase = (store) =>
  (store.meta.name || 'roadmap').replace(/[\/:*?"<>|]/g, '_');

/**
 * 주의: PNG 캡처는 창이 화면에 보이는 상태여야 한다. Chromium이 숨겨진 창에는
 * 프레임을 만들지 않아 캡처가 응답하지 않는다.
 */
export async function exportPng(adapter, store) {
  if (!adapter.exportPng) { toast('PNG 내보내기는 앱에서만 됩니다', 'warn'); return; }
  try {
    const saved = await withExpandedBoard((box) =>
      adapter.exportPng({ ...box, scale: 2 }, `${fileBase(store)}-${stamp()}.png`));
    if (saved) toast('저장했습니다: ' + saved);
  } catch (err) {
    toast('PNG로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}

export async function exportPdf(adapter, store) {
  if (!adapter.exportPdf) { window.print(); return; }
  try {
    const saved = await withExpandedBoard((box) =>
      adapter.exportPdf({ width: box.width, height: box.height }, `${fileBase(store)}-${stamp()}.pdf`));
    if (saved) toast('저장했습니다: ' + saved);
  } catch (err) {
    toast('PDF로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}
