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

/**
 * 내보낼 크기(보드 px) — 아래는 마지막 카드(메모를 담으면 메모까지) 밑 24px, 옆은 마지막 트랙 오른쪽 끝까지.
 * 맨 뒤 빈 구간을 담지 않아 여백이 줄고, 매우 큰 보드에서 캡처가 (이미지 크기 한계로) 실패하는 것도 막는다.
 * 옆은 그 뒤의 '트랙 추가(+)' 칸과 트랙 너비를 고정했을 때 남는 빈 공간을 뺀다 — 보드 내용이 아니다. +1은 마지막 트랙을
 * 닫는 세로선. 카드가 트랙 밖으로 삐져나온 경우(크기 강제)에도 잘리지 않게 카드 오른쪽 끝도 본다.
 * 화면 좌표(×배율)로 재므로 z(보드 배율)로 나눈다 — 미리보기는 줄인 채로 잰다.
 */
function measureContent(cal, z = 1) {
  const rect = cal.getBoundingClientRect();
  // 메모를 담으면 메모 아래 끝까지(카드보다 아래 붙인 메모가 잘리지 않게)
  const boxes = (exportMemos.on ?? exportMemos.get()) ? '.ev, .memo' : '.ev';
  let contentBottom = 0;
  for (const c of cal.querySelectorAll(boxes)) {
    const b = (c.getBoundingClientRect().bottom - rect.top) / z;
    if (b > contentBottom) contentBottom = b;
  }
  // 줄인 채로(미리보기) 잴 때는 scroll*가 배율을 어떻게 타는지에 기대지 않고 상자 크기로 — .cal 자식(머리·본문)이 내용 폭이다
  const fullH = Math.ceil(z === 1 ? cal.scrollHeight : rect.height / z);
  const height = contentBottom > 0 ? Math.min(fullH, Math.ceil(contentBottom + 24)) : fullH;
  let contentRight = 0;
  for (const c of cal.querySelectorAll(`.body > .col, ${boxes}`)) {
    const r = (c.getBoundingClientRect().right - rect.left) / z;
    if (r > contentRight) contentRight = r;
  }
  const fullWidth = Math.ceil(z === 1 ? cal.scrollWidth
    : Math.max(rect.width, ...[...cal.children].map((c) => c.getBoundingClientRect().width)) / z);
  const width = contentRight > 0 ? Math.min(fullWidth, Math.ceil(contentRight + 1)) : fullWidth;
  return { width, height, fullWidth };
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
    const { width, height, fullWidth: fullW } = measureContent(cal);
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
 * 내보내기 미리보기(2026-10-26 사용자, 10-28 오피스 인쇄 미리보기처럼) — 왼쪽은 설정 칸(형식·트랙 색·메모·저장), 오른쪽은 회색 책상
 * 위에 **내보낼 그림 한 장**을 종이처럼 줄여 보여 준다(기본은 한 장이 다 보이게). 그림은 따로 그리지 않고 보드 자체를 쓴다 —
 * body.export-preview가 툴바·탭·상태 줄을 감추고 내보내기와 같은 CSS(트랙 색 범위·메모·'+' 칸)를 먹이고 보드를 고칠 수 없게 하며,
 * .cal을 내보낼 크기(measureContent — 내보내기와 같은 자르기)로 잘라 종이로 보인다(print.css). 안쪽 폭은 100%일 때 잰 값으로 못 박아
 * 줄여 보여도 칸이 다시 흐르지 않는다. 배율은 view.boardZoom을 잠시 빌리고(zoom.set — 저장하지 않는다) 나올 때 되돌린다.
 * 저장·인쇄는 미리보기를 닫고 원래 길(atFullSize → exportPng/exportPdf/print)로 — 저장 창에서 취소하면 다시 연다.
 */
const FORMATS = [
  { key: 'png', label: 'PNG 이미지', go: '저장…', desc: '2배 해상도 이미지 한 장' },
  { key: 'pdf', label: 'PDF', go: '저장…', desc: '잘리지 않는 PDF 한 쪽' },
  { key: 'print', label: '인쇄', go: '인쇄…', desc: '프린터로 — 용지 설정은 인쇄 창에서' },
];
const FILL_CHOICES = [
  { key: 'col', label: '칸 전체', title: '트랙 색을 화면처럼 트랙 칸 전체에' },
  { key: 'head', label: '머리만', title: '트랙 색을 트랙 머리(이름 칸)에만 — 칸은 색 없이' },
];
const FIT_CHOICES = [
  { key: 'page', label: '한 장 보기', title: '그림 한 장이 다 보이게' },
  { key: 'width', label: '폭 맞춤', title: '그림 폭을 창에 맞게' },
  { key: 'actual', label: '100%', title: '실제 크기' },
];
/** 책상 여백(px) — 종이와 창 가장자리 사이. print.css의 책상 padding과 같게(위는 배지 자리까지 u10+u2, 나머지 u8) */
const DESK_PAD = 32, DESK_TOP = 48;

let preview = null;
let lastFit = 'page';

export const exportPreview = {
  get active() { return !!preview; },
  get format() { return preview?.format ?? null; },
  close() { preview?.close(); },
  /** Ctrl+휠 — 미리보기 안에서만 배율을 바꾼다(보드 배율 설정은 건드리지 않는다) */
  wheel(dir) { preview?.wheel(dir); },
};

/**
 * @param {object} opts
 * @param {'png'|'pdf'|'print'} [opts.format]  처음 고른 형식(내보내기 메뉴에서 누른 것)
 * @param {(fn: () => any) => Promise<any>} [opts.atFullSize]  보드 확대를 100%로 두고 fn을 부른다(src/main.js)
 * @param {{ get: () => number, set: (z: number) => void }} [opts.zoom]  보드 배율 — 미리보기 동안 빌려 쓴다(저장하지 않는 set)
 */
export function openExportPreview(opts) {
  const { adapter, store, atFullSize = (fn) => fn(), zoom } = opts;
  let format = opts.format ?? 'png';
  const canPng = !!adapter.exportPng;
  if (format === 'png' && !canPng) format = 'pdf';
  if (preview) { preview.pick(format); return; }

  const cal = document.querySelector('.cal');
  const scroll = $('scroll');
  const z0 = zoom?.get() ?? 1;
  const saved = { scrollTop: scroll.scrollTop, scrollLeft: scroll.scrollLeft };
  // 100%에서 보드 폭을 잰다 — 내보내기도 이 폭으로 찍는다. 줄여 보여도 이 폭으로 못 박아 칸이 다시 흐르지 않게
  if (z0 !== 1) zoom?.set(1);
  const fullW = Math.ceil(cal.getBoundingClientRect().width);

  const pressed = (box, key) => {
    for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.key === key));
  };
  const seg = (label, choices, onPick) => el('div.seg.xp-seg', { attrs: { role: 'group', 'aria-label': label } },
    choices.map((c) => el('button', {
      type: 'button', text: c.label, title: c.title ?? null, dataset: { key: c.key }, disabled: !!c.off,
      on: { click: () => onPick(c.key) },
    })));

  const fmtSeg = seg('형식', FORMATS.map((f) => ({ ...f, off: f.key === 'png' && !canPng,
    title: f.key === 'png' && !canPng ? 'PNG 내보내기는 앱에서만 됩니다' : f.desc })), (k) => pick(k));
  const fmtDesc = el('div.xp-desc');
  const fillSeg = seg('트랙 색', FILL_CHOICES, (k) => { exportTrackFill.set(k); pressed(fillSeg, k); });
  pressed(fillSeg, exportTrackFill.value ?? exportTrackFill.get());
  const memoBox = el('input', { type: 'checkbox', id: 'xp-memos', checked: exportMemos.on ?? exportMemos.get(),
    on: { change: (e) => { exportMemos.set(e.target.checked); crop(); } } });
  const sizeText = el('div.xp-desc', { id: 'xp-size' });
  const goBtn = el('button.btn.cta.wide', { type: 'button', id: 'xp-go', on: { click: () => go() } });
  const side = el('aside.xp-side', { id: 'xpSide', attrs: { 'aria-label': '내보내기' } }, [
    el('header.xp-head', {}, [
      el('button.btn.icon', { type: 'button', id: 'xp-back', title: '보드로 돌아가기 (Esc)', attrs: { 'aria-label': '보드로 돌아가기' },
        on: { click: () => close() } }, [backIcon()]),
      el('div', {}, [el('div.xp-kicker', { text: '미리보기' }), el('h2', { text: '내보내기' })]),
    ]),
    el('p.xp-note', { text: '오른쪽은 내보낼 그림입니다. 미리보기 동안에는 보드를 고칠 수 없습니다.' }),
    el('div.xp-sect', { text: '형식' }), fmtSeg, fmtDesc,
    el('div.xp-sect', { text: '트랙 색' }), fillSeg,
    el('div.xp-desc', { text: '트랙에 칠한 색을 칸 전체에, 또는 트랙 이름 칸에만' }),
    el('div.xp-sect', { text: '담을 것' }),
    el('label.xp-chk', { title: '메모(포스트잇)를 함께 — JSON 반출과 같은 설정' }, [memoBox, ' 메모(포스트잇)']),
    el('div.xp-sect', { text: '크기' }), sizeText,
    el('div.grow'),
    goBtn,
    el('button.btn.outline.wide', { type: 'button', id: 'xp-close', text: '닫기', title: '보드로 돌아가기 (Esc)', on: { click: () => close() } }),
  ]);
  const zoomLabel = el('span.xp-zoom-val');
  const fitSeg = seg('보기 크기', FIT_CHOICES, (k) => fit(k));
  const zoomBar = el('div.xp-zoom', { id: 'xpZoom' }, [fitSeg, zoomLabel]);
  const badge = el('div.xp-badge', { text: '내보내기 미리보기 — 고칠 수 없음' });

  let fitMode = lastFit;
  let page = { width: fullW, height: 0 };
  /** 종이(.cal)를 내보낼 크기로 자른다 — 메모를 빼고 넣으면 아래 끝이 달라진다 */
  function crop() {
    cal.style.setProperty('--xp-w', `${fullW}px`);
    cal.style.width = ''; cal.style.height = '';
    page = measureContent(cal, zoom?.get() ?? 1);
    cal.style.width = `${page.width}px`;
    cal.style.height = `${page.height}px`;
    const mul = preview?.format === 'png' ? 2 : 1;
    sizeText.textContent = `${page.width.toLocaleString()} × ${page.height.toLocaleString()} px`
      + (mul > 1 ? ` · 저장은 2배(${(page.width * mul).toLocaleString()} × ${(page.height * mul).toLocaleString()})` : '');
    if (fitMode !== 'custom') fit(fitMode);
  }
  function setZ(z) {
    zoom?.set(Math.min(3, Math.max(0.05, z)));
    zoomLabel.textContent = `${Math.round((zoom?.get() ?? 1) * 100)}%`;
  }
  function fit(mode) {
    fitMode = mode;
    if (mode !== 'custom') lastFit = mode;
    pressed(fitSeg, mode);
    const aw = scroll.clientWidth - DESK_PAD * 2, ah = scroll.clientHeight - DESK_TOP - DESK_PAD;
    const z = mode === 'actual' ? 1
      : mode === 'width' ? Math.min(2, aw / page.width)
      : mode === 'page' ? Math.min(1, aw / page.width, ah / page.height)
      : (zoom?.get() ?? 1);
    setZ(z);
    if (mode !== 'custom') { scroll.scrollTop = 0; scroll.scrollLeft = 0; }
  }
  function wheel(dir) {
    fitMode = 'custom';
    pressed(fitSeg, null);
    setZ((zoom?.get() ?? 1) * (dir > 0 ? 1.1 : 1 / 1.1));
  }
  function pick(key) {
    if (key === 'png' && !canPng) return;
    preview.format = key;
    const f = FORMATS.find((x) => x.key === key);
    pressed(fmtSeg, key);
    fmtDesc.textContent = f.desc;
    goBtn.textContent = f.go;
    crop();
  }
  const onResize = () => { if (fitMode !== 'custom') fit(fitMode); };
  let busy = false;
  async function go() {
    if (busy) return;
    busy = true;
    const f = preview.format;
    close();                                 // 원래 보드로 돌아가 늘 쓰던 길로 내보낸다(그림이 미리보기와 같다)
    let done;
    try {
      if (f === 'print') { window.print(); done = true; }
      else done = await atFullSize(() => (f === 'png' ? exportPng(adapter, store) : exportPdf(adapter, store)));
    } finally { busy = false; }
    if (!done) openExportPreview({ ...opts, format: f });     // 저장 창에서 취소 — 미리보기로 돌아간다
  }
  function close() {
    if (!preview) return;
    preview = null;
    removeEventListener('resize', onResize);
    side.remove(); zoomBar.remove(); badge.remove();
    document.body.classList.remove('export-preview');
    cal.style.width = ''; cal.style.height = ''; cal.style.removeProperty('--xp-w');
    zoom?.set(z0);
    scroll.scrollTop = saved.scrollTop;
    scroll.scrollLeft = saved.scrollLeft;
  }

  preview = { format, pick, close, wheel };
  syncExportMemos();
  syncExportTrackFill();
  document.body.append(side, zoomBar, badge);
  document.body.classList.add('export-preview');
  addEventListener('resize', onResize);
  pick(format);
  goBtn.focus();
}

function backIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>';
  return svg;
}
