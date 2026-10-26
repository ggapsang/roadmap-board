/**
 * 보드 내보내기 — PNG / PDF.
 *
 * 화면에 보이는 부분이 아니라 **트랙 헤더부터 마지막 일정까지 전체**를 한 장으로
 * 담는다. 그러려면 캡처 직전에 스크롤 컨테이너의 제약을 잠시 풀어
 * 내용 전체가 펼쳐진 상태로 만들어야 한다.
 */
import { $, el } from './dom.js';
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
  for (const id of ['d-memos', 'xp-memos']) {
    const box = document.getElementById(id);
    if (box) box.checked = on;
  }
}

/**
 * 내보내기에서 트랙 채우기 색을 어디까지 칠할지 — 'col' 칸 전체(화면과 같다) | 'head' 트랙 머리만. 메모와 같은 까닭으로 이 PC에
 * 기억한다. 화면은 늘 칸 전체이고, body 표식(export-fill-head)은 내보내기·미리보기·인쇄에서만 먹는다(print.css).
 */
const FILL_PREF = 'wolfpack.export.trackFill';
export const exportTrackFill = {
  get() { try { return localStorage.getItem(FILL_PREF) === 'head' ? 'head' : 'col'; } catch { return 'col'; } },
  set(v) {
    const next = v === 'head' ? 'head' : 'col';
    try { localStorage.setItem(FILL_PREF, next); } catch { /* 저장 못 해도 이번엔 쓴다 */ }
    this.value = next;
    syncExportTrackFill();
  },
};

export function syncExportTrackFill() {
  exportTrackFill.value ??= exportTrackFill.get();
  document.body.classList.toggle('export-fill-head', exportTrackFill.value === 'head');
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
    return saved;
  } catch (err) {
    toast('PNG로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}

export async function exportPdf(adapter, store) {
  if (!adapter.exportPdf) { window.print(); return true; }
  try {
    // PDF는 인쇄 경로라 페이지 폭에 맞춰 다시 흐른다. 마지막 트랙에서 자른 폭을 주면
    // 보드가 페이지보다 넓어져 통째로 축소되므로 전체 폭을 준다 ('+'는 CSS로 감춘다).
    const saved = await withExpandedBoard((box) =>
      adapter.exportPdf({ width: box.fullWidth, height: box.height }, `${fileBase(store)}-${stamp()}.pdf`));
    if (saved) toast('저장했습니다: ' + saved);
    return saved;
  } catch (err) {
    toast('PDF로 내보내지 못했습니다: ' + err.message, 'warn');
  }
}

/**
 * 내보내기 미리보기(2026-10-26 사용자) — 보드를 내보낼 모습 그대로 보여 주고, 위쪽 막대에서 형식(PNG·PDF·인쇄)과 설정(트랙 색·메모)을
 * 고른 뒤 내보낸다. 따로 그리지 않고 **보드 자체가 미리보기**다 — body.export-preview가 툴바·탭·상태 줄을 감추고 내보내기와 같은
 * CSS(트랙 색 범위·메모·'+' 칸)를 먹이고 보드를 고칠 수 없게 한다(print.css). 스크롤·Ctrl+휠 확대는 그대로. Esc·닫기로 나온다.
 */
const FORMATS = [
  { key: 'png', label: 'PNG 이미지', go: '저장…' },
  { key: 'pdf', label: 'PDF', go: '저장…' },
  { key: 'print', label: '인쇄', go: '인쇄…' },
];
const FILL_CHOICES = [
  { key: 'col', label: '칸 전체', title: '트랙 색을 화면처럼 트랙 칸 전체에' },
  { key: 'head', label: '머리만', title: '트랙 색을 트랙 머리(이름 칸)에만 — 칸은 색 없이' },
];

let preview = null;

export const exportPreview = {
  get active() { return !!preview; },
  get format() { return preview?.format ?? null; },
  close() { preview?.close(); },
};

/**
 * @param {object} o
 * @param {'png'|'pdf'|'print'} [o.format]  처음 고른 형식(내보내기 메뉴에서 누른 것)
 * @param {(fn: () => any) => Promise<any>} [o.atFullSize]  보드 확대를 100%로 두고 fn을 부른다(src/main.js)
 */
export function openExportPreview({ format = 'png', adapter, store, atFullSize = (fn) => fn() }) {
  const canPng = !!adapter.exportPng;
  if (format === 'png' && !canPng) format = 'pdf';
  if (preview) { preview.pick(format); return; }

  const pressed = (box, key) => {
    for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.key === key));
  };
  const fmtSeg = el('div.seg', { attrs: { role: 'group', 'aria-label': '형식' } },
    FORMATS.map((f) => el('button', {
      type: 'button', text: f.label, dataset: { key: f.key }, disabled: f.key === 'png' && !canPng,
      title: f.key === 'png' && !canPng ? 'PNG 내보내기는 앱에서만 됩니다' : null,
      on: { click: () => pick(f.key) },
    })));
  const fillSeg = el('div.seg', { attrs: { role: 'group', 'aria-label': '트랙 색' } },
    FILL_CHOICES.map((c) => el('button', {
      type: 'button', text: c.label, title: c.title, dataset: { key: c.key },
      on: { click: () => { exportTrackFill.set(c.key); pressed(fillSeg, c.key); } },
    })));
  pressed(fillSeg, exportTrackFill.value ?? exportTrackFill.get());
  const memoBox = el('input', { type: 'checkbox', id: 'xp-memos', checked: exportMemos.on ?? exportMemos.get(),
    on: { change: (e) => exportMemos.set(e.target.checked) } });
  const goBtn = el('button.btn.cta', { type: 'button', id: 'xp-go', on: { click: () => go() } });
  const bar = el('div.xp-bar', { id: 'xpBar', attrs: { role: 'toolbar', 'aria-label': '내보내기 미리보기' } }, [
    el('b.xp-title', { text: '내보내기 미리보기' }),
    el('span.xp-lbl', { text: '형식' }), fmtSeg,
    el('span.xp-lbl', { text: '트랙 색' }), fillSeg,
    el('label.xp-chk', { title: '메모(포스트잇)를 함께 — JSON 반출과 같은 설정' }, [memoBox, ' 메모']),
    el('span.xp-hint', { text: '보이는 그대로 내보냅니다 · 확대는 100%로' }),
    el('div.grow'),
    el('button.btn', { type: 'button', id: 'xp-close', text: '닫기', title: '미리보기 닫기 (Esc)', on: { click: () => close() } }),
    goBtn,
  ]);

  function pick(key) {
    if (key === 'png' && !canPng) return;
    preview.format = key;
    pressed(fmtSeg, key);
    goBtn.textContent = FORMATS.find((f) => f.key === key).go;
  }
  let busy = false;
  async function go() {
    if (busy) return;
    busy = true; goBtn.disabled = true;
    try {
      const f = preview.format;
      let done;
      if (f === 'print') { window.print(); done = true; }
      else done = await atFullSize(() => (f === 'png' ? exportPng(adapter, store) : exportPdf(adapter, store)));
      if (done) close();        // 저장 창에서 취소하면 미리보기에 남는다
    } finally {
      busy = false; goBtn.disabled = false;
    }
  }
  function close() {
    if (!preview) return;
    bar.remove();
    document.body.classList.remove('export-preview');
    preview = null;
  }

  preview = { format, pick, close };
  syncExportMemos();
  syncExportTrackFill();
  (document.querySelector('.bar') ?? document.body.firstChild).after(bar);
  document.body.classList.add('export-preview');
  pick(format);
  goBtn.focus();
}
