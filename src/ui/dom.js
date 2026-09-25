/** DOM 헬퍼 — 프레임워크 없이 쓰기 위한 최소 도구. */

export const $ = (id) => document.getElementById(id);

/**
 * 엘리먼트 생성.
 * @param {string} tag  'div.cls.cls2' 형태 허용
 * @param {object} [props]  {class, text, html, style, dataset, attrs, on, ...직접속성}
 * @param {(Node|string|null)[]} [children]
 */
export function el(tag, props = {}, children = []) {
  const [name, ...classes] = tag.split('.');
  const node = document.createElement(name || 'div');
  if (classes.length) node.classList.add(...classes);

  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'attrs') for (const [a, b] of Object.entries(v)) { if (b != null) node.setAttribute(a, b); }
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else node[k] = v;
  }

  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c);
  }
  return node;
}

/** 자식 전부 제거 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Lucide 계열 인라인 SVG — 24px 그리드, 1.5px centered stroke (기획안 §6) */
export function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ic');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tracks: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  undo:   '<path d="M3 10h11a5 5 0 0 1 0 10H9"/><path d="m7 6-4 4 4 4"/>',
  redo:   '<path d="M21 10H10a5 5 0 0 0 0 10h5"/><path d="m17 6 4 4-4 4"/>',
  theme:  '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/>',
  print:  '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
  data:   '<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 21h16"/>',
  plus:   '<path d="M12 5v14M5 12h14"/>',
  close:  '<path d="m6 6 12 12M18 6 6 18"/>',
  up:     '<path d="m6 15 6-6 6 6"/>',
  down:   '<path d="m6 9 6 6 6-6"/>',
  trash:  '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/>',
  copy:   '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>',
  back:   '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  check:  '<path d="m5 12 5 5 9-11"/>',
  // 글자 세로 정렬 — 기준선 + 블록 위치로 위/가운데/아래를 나타낸다
  alignTop:    '<path d="M5 4h14"/><rect x="8" y="8" width="8" height="5" rx="1"/>',
  alignMiddle: '<path d="M4 12h3M17 12h3"/><rect x="8" y="9" width="8" height="6" rx="1"/>',
  alignBottom: '<path d="M5 20h14"/><rect x="8" y="11" width="8" height="5" rx="1"/>',
  // 비고를 카드에 표시 — 텍스트 줄이 있는 카드
  note:   '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h6"/>',
  // 카드 크기 강제 — 자유 리사이즈(대각 화살표)
  resize: '<path d="M21 15v6h-6"/><path d="m21 21-6-6"/><path d="M3 9V3h6"/><path d="M3 3l6 6"/>',
  // 다른 보드로 진입(별칭 포털)
  external: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5"/>',
};

/** 버튼 한 줄 생성 헬퍼 */
export function button({ label, iconPath, className = 'btn', title, onClick, id }) {
  const b = el('button', { className, title, id, type: 'button' });
  if (iconPath) b.append(icon(iconPath));
  if (label) b.append(label);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
