/**
 * 보드 내보내기 — PNG / PDF.
 *
 * 화면에 보이는 부분이 아니라 **트랙 헤더부터 마지막 일정까지 전체**를 한 장으로
 * 담는다. 그러려면 캡처 직전에 스크롤 컨테이너의 제약을 잠시 풀어
 * 내용 전체가 펼쳐진 상태로 만들어야 한다.
 */
import { $ } from './dom.js';
import { toast } from './toast.js';

/**
 * 내보내기에 메모(포스트잇)를 담을지 — PNG·PDF·인쇄·JSON 반출이 같은 값을 쓴다. 이 PC에 기억한다(보는 사람의 편의 설정이라
 * 문서에 두지 않는다). 기본은 담는다.
 */
const MEMO_PREF = 'wolfpack.export.memos';
export const exportMemos = {
  get() { try { return localStorage.getItem(MEMO_PREF) !== '0'; } catch { return true; } },
  set(on) {
    try { localStorage.setItem(MEMO_PREF, on ? '1' : '0'); } catch { /* 저장 못 해도 이번엔 쓴다 */ }
    this.on = !!on;
    syncExportMemos();
  },
};

/** 메뉴 체크·데이터 패널 체크·body 표식(인쇄·PDF·PNG에서 메모를 숨기는 CSS)을 값에 맞춘다 */
export function syncExportMemos() {
  const on = exportMemos.on ?? exportMemos.get();
  exportMemos.on = on;
  document.body.classList.toggle('no-memo-export', !on);
  document.getElementById('ex-memos')?.setAttribute('aria-checked', String(on));
  const box = document.getElementById('d-memos');
  if (box) box.checked = on;
}

/** JSON 반출 글 — 메모를 빼라면 meta.memos를 걷어 낸다(메모는 보드 표시 값이라 빼도 이벤트·관계는 그대로) */
export function exportJsonText(store, { memos = exportMemos.on ?? exportMemos.get() } = {}) {
  if (memos || !(store.meta.memos ?? []).length) return store.toJSON(2);
  const doc = JSON.parse(store.toJSON(0));
  delete doc.meta.memos;
  return JSON.stringify(doc, null, 2);
}

/** 내보내는 동안 보드를 펼치고, 끝나면 되돌린다. */
async function withExpandedBoard(fn) {
  const body = document.body;
  const scroll = $('scroll');
  const saved = { scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };

  const cal = document.querySelector('.cal');
  const savedWidth = cal.style.width;
  // 보드 배율(Ctrl+휠)은 화면 보기일 뿐 — 내보내기는 늘 100%로 찍는다(아래 좌표 계산도 100% 기준)
  const savedZoom = cal.style.zoom;
  cal.style.zoom = '';

  body.classList.add('exporting');
  // 레이아웃이 확정될 때까지 두 프레임 기다린다
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    // 폭을 px로 못 박는다. 캡처(captureBeyondViewport)가 뷰포트를 늘리는 순간 문서
    // 스크롤바가 사라져 보드가 그만큼 넓어지고, fr 트랙이 다시 흘러 여기서 잰 좌표
    // (자를 위치·걸침 카드 px·화살표)와 찍히는 그림이 어긋난다.
    cal.style.width = `${cal.getBoundingClientRect().width}px`;
    const rect = cal.getBoundingClientRect();
    // 맨 뒤 빈 구간을 담지 않도록 마지막 카드 아래까지만 자른다 — 내보내기 여백이
    // 줄고, 매우 큰 보드에서 캡처가 (이미지 크기 한계로) 실패하는 것도 막는다.
    let contentBottom = 0;
    // 메모를 담으면 메모 아래 끝까지(카드보다 아래 붙인 메모가 잘리지 않게)
    const boxes = (exportMemos.on ?? exportMemos.get()) ? '.ev, .memo' : '.ev';
    for (const c of cal.querySelectorAll(boxes)) {
      const b = c.getBoundingClientRect().bottom - rect.top;
      if (b > contentBottom) contentBottom = b;
    }
    const fullH = Math.ceil(cal.scrollHeight);
    const height = contentBottom > 0 ? Math.min(fullH, Math.ceil(contentBottom + 24)) : fullH;
    // 가로도 마지막 트랙 오른쪽 끝까지만 — 그 뒤의 '트랙 추가(+)' 칸과, 트랙 너비를
    // 고정했을 때 남는 빈 공간은 보드 내용이 아니다. +1은 마지막 트랙을 닫는 세로선.
    // 카드가 트랙 밖으로 삐져나온 경우(크기 강제)에도 잘리지 않게 카드 오른쪽 끝도 본다.
    let contentRight = 0;
    for (const c of cal.querySelectorAll(`.body > .col, ${boxes}`)) {
      const r = c.getBoundingClientRect().right - rect.left;
      if (r > contentRight) contentRight = r;
    }
    const fullW = Math.ceil(cal.scrollWidth);
    const width = contentRight > 0 ? Math.min(fullW, Math.ceil(contentRight + 1)) : fullW;
    return await fn({
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width,
      height,
      fullWidth: fullW,
    });
  } finally {
    cal.style.width = savedWidth;
    cal.style.zoom = savedZoom;
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
    const saved = await withExpandedBoard(({ x, y, width, height }) =>
      adapter.exportPng({ x, y, width, height, scale: 2 }, `${fileBase(store)}-${stamp()}.png`));
    if (saved) toast('저장했습니다: ' + saved);
  } catch (err) {
    toast('PNG로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}

export async function exportPdf(adapter, store) {
  if (!adapter.exportPdf) { window.print(); return; }
  try {
    // PDF는 인쇄 경로라 페이지 폭에 맞춰 다시 흐른다. 마지막 트랙에서 자른 폭을 주면
    // 보드가 페이지보다 넓어져 통째로 축소되므로 전체 폭을 준다 ('+'는 CSS로 감춘다).
    const saved = await withExpandedBoard((box) =>
      adapter.exportPdf({ width: box.fullWidth, height: box.height }, `${fileBase(store)}-${stamp()}.pdf`));
    if (saved) toast('저장했습니다: ' + saved);
  } catch (err) {
    toast('PDF로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}
