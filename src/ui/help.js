/**
 * 도움말 — docs/HELP.md를 읽어 팝업으로 보여 준다. 문서 한 곳만 고치면 앱 도움말도 바뀐다.
 *
 * 마크다운은 도움말에 쓰는 만큼만 읽는다(작은 변환기): # 제목, 문단, - 목록, | 표 |, > 인용,
 * **굵게**, `코드`. 모두 textContent로 넣는다(innerHTML 안 씀 — 문서 내용이 스크립트가 되지 않게).
 * 왼쪽은 ## 절 목차, 오른쪽은 본문. 팝업은 끌어 옮길 수 있다(dialog.js makeMovable).
 * 오른쪽 아래 모서리를 끌어 크기를, 가−/가＋(또는 열려 있는 동안 Ctrl +/-/0)로 글자 크기를 바꾼다.
 * 크기·글자 배율은 이 PC의 사용자 설정으로 기억한다(문서가 아니다).
 */
import { el, clear } from './dom.js';
import { makeMovable, closeOnScrim, dialogOpen } from './dialog.js';

const HELP_URL = './docs/HELP.md';
const PREF_KEY = 'wolfpack:help-view';          // { w, h, fs } — 사용자 설정
const FS = { min: 0.8, max: 1.8, step: 0.1 };
const MIN_W = 520, MIN_H = 360;
let cache = null;

function loadPref() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') ?? {}; } catch { return {}; }
}
function savePref(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* 이번엔 적용 */ }
}

/** style.transform의 translate(x, y) — 끌어 옮긴 위치(dialog.js makeMovable) */
function translateOf(node) {
  const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(node.style.transform || '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

/** `**굵게**`와 `` `코드` ``만 알아보는 인라인 변환 — 결과는 노드 배열 */
function inline(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let at = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    out.push(m[2] != null ? el('strong', { text: m[2] }) : el('code', { text: m[3] }));
    at = re.lastIndex;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** 마크다운 → { title, sections: [{ id, title, nodes }] } — ## 마다 한 절 */
export function renderHelp(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let title = '도움말';
  const sections = [];
  let cur = { id: 'intro', title: '', nodes: [] };
  const push = (n) => cur.nodes.push(n);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    let m;
    if ((m = /^#\s+(.*)/.exec(line))) { title = m[1].trim(); i += 1; continue; }
    if ((m = /^##\s+(.*)/.exec(line))) {
      if (cur.nodes.length || cur.title) sections.push(cur);
      cur = { id: `h${sections.length}`, title: m[1].trim(), nodes: [] };
      i += 1; continue;
    }
    if ((m = /^###\s+(.*)/.exec(line))) { push(el('h4', {}, inline(m[1].trim()))); i += 1; continue; }
    if (/^\|/.test(line)) {                                   // 표 — 머리줄, 구분줄, 본문
      const head = cells(line); i += 1;
      if (i < lines.length && /^\|?\s*:?-{3,}/.test(lines[i])) i += 1;
      const body = [];
      while (i < lines.length && /^\|/.test(lines[i])) { body.push(cells(lines[i])); i += 1; }
      push(el('table', {}, [
        el('thead', {}, [el('tr', {}, head.map((c) => el('th', {}, inline(c))))]),
        el('tbody', {}, body.map((r) => el('tr', {}, r.map((c) => el('td', {}, inline(c)))))),
      ]));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {                           // 목록 — 들여쓴 이어짐 줄은 앞 항목에 붙인다
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (/^\s*[-*]\s+/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
        i += 1;
      }
      push(el('ul', {}, items.map((t) => el('li', {}, inline(t)))));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      push(el('blockquote', {}, inline(buf.join(' '))));
      continue;
    }
    const buf = [];                                           // 문단 — 빈 줄·다른 블록 전까지
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\||\s*[-*]\s|>)/.test(lines[i])) { buf.push(lines[i].trim()); i += 1; }
    push(el('p', {}, inline(buf.join(' '))));
  }
  if (cur.nodes.length || cur.title) sections.push(cur);
  return { title, sections };
}

async function loadHelp() {
  if (cache) return cache;
  const res = await fetch(HELP_URL);
  if (!res.ok) throw new Error(`도움말을 읽지 못했습니다 (${res.status})`);
  cache = await res.text();
  return cache;
}

/** 도움말 팝업을 연다. 이미 열려 있으면 그대로 둔다. @returns 닫기 함수 */
export async function openHelp() {
  const open = document.querySelector('.help-scrim');
  if (open) return () => open.remove();
  const scrim = el('div.dlg-scrim.help-scrim');
  const toc = el('nav.help-toc', { attrs: { 'aria-label': '도움말 목차' } });
  const body = el('div.help-body', { attrs: { tabindex: '0' } }, [el('p.note', { text: '불러오는 중…' })]);
  const heading = el('h2', { text: '도움말' });
  const pref = loadPref();
  let fs = Math.min(FS.max, Math.max(FS.min, Number(pref.fs) || 1));
  const fsOut = el('span.help-fs');
  const setFs = (v) => {
    fs = Math.round(Math.min(FS.max, Math.max(FS.min, v)) * 10) / 10;
    body.style.setProperty('--help-fs', String(fs));
    fsOut.textContent = `${Math.round(fs * 100)}%`;
    savePref({ ...loadPref(), fs });
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); };
  const onKey = (e) => {
    if (!scrim.isConnected) { document.removeEventListener('keydown', onKey, true); return; }
    if (dialogOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    // 열려 있는 동안 Ctrl +/-/0은 도움말 글자 — 뒤의 보드 글자 크기를 바꾸지 않게 가로챈다
    if ((e.ctrlKey || e.metaKey) && ['=', '+', '-', '_', '0'].includes(e.key)) {
      e.preventDefault(); e.stopPropagation();
      setFs(e.key === '0' ? 1 : fs + (e.key === '-' || e.key === '_' ? -FS.step : FS.step));
    }
  };
  const grip = el('div.help-resize', { attrs: { 'aria-hidden': 'true' }, title: '끌어서 크기 조절' });
  const box = el('div.dlg.help-dlg', { attrs: { role: 'dialog', 'aria-label': '도움말' }, on: { click: (e) => e.stopPropagation() } }, [
    el('div.help-head', {}, [
      heading,
      el('div.grow'),
      el('div.seg.help-zoom', { attrs: { role: 'group', 'aria-label': '글자 크기' } }, [
        el('button.seg-btn', { type: 'button', text: '가−', title: '글자 작게 (Ctrl -)', on: { click: () => setFs(fs - FS.step) } }),
        el('button.seg-btn', { type: 'button', title: '원래 크기 (Ctrl 0)', on: { click: () => setFs(1) } }, [fsOut]),
        el('button.seg-btn', { type: 'button', text: '가＋', title: '글자 크게 (Ctrl +)', on: { click: () => setFs(fs + FS.step) } }),
      ]),
      el('button.btn.outline.sm', { type: 'button', text: '닫기', on: { click: () => close() } }),
    ]),
    el('div.help-main', {}, [toc, body]),
    grip,
  ]);
  // 저장해 둔 크기 — 화면보다 크면 화면 안으로
  if (pref.w) { box.style.width = `${Math.min(innerWidth - 32, Math.max(MIN_W, pref.w))}px`; box.style.maxWidth = 'none'; }
  if (pref.h) box.style.height = `${Math.min(innerHeight - 32, Math.max(MIN_H, pref.h))}px`;
  setFs(fs);
  // 크기 조절 — 오른쪽 아래 모서리. 팝업은 가운데 정렬이라 커진 만큼 양쪽으로 퍼지므로, 왼쪽·위 가장자리가
  // 제자리에 있도록 변화량의 절반만큼 옮긴다(끌어 옮긴 위치 위에 더한다). 리스너는 window에(규약 14).
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r0 = box.getBoundingClientRect();
    const t0 = translateOf(box);
    const sx = e.clientX, sy = e.clientY;
    box.classList.add('resizing');
    const move = (ev) => {
      const w = Math.min(innerWidth - 16, Math.max(MIN_W, r0.width + (ev.clientX - sx)));
      const h = Math.min(innerHeight - 16, Math.max(MIN_H, r0.height + (ev.clientY - sy)));
      box.style.width = `${w}px`; box.style.maxWidth = 'none';
      box.style.height = `${h}px`;
      box.style.transform = `translate(${t0.x + (w - r0.width) / 2}px, ${t0.y + (h - r0.height) / 2}px)`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      box.classList.remove('resizing');
      const r = box.getBoundingClientRect();
      savePref({ ...loadPref(), w: Math.round(r.width), h: Math.round(r.height) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });
  scrim.append(makeMovable(box));
  closeOnScrim(scrim, close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);

  try {
    const { title, sections } = renderHelp(await loadHelp());
    heading.textContent = title;
    clear(body); clear(toc);
    for (const s of sections) {
      const sec = el('section.help-sec', { dataset: { sec: s.id } }, [s.title ? el('h3', { text: s.title }) : null, ...s.nodes]);
      body.append(sec);
      if (s.title) {
        toc.append(el('button.help-toc-item', {
          type: 'button', text: s.title,
          on: { click: () => { body.scrollTo({ top: sec.offsetTop - body.offsetTop, behavior: 'smooth' }); } },
        }));
      }
    }
    body.focus();
  } catch (err) {
    clear(body);
    body.append(el('p.note', { text: String(err?.message ?? err) }));
  }
  return close;
}
