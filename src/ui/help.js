/**
 * 도움말 — docs/HELP.md를 읽어 팝업으로 보여 준다. 문서 한 곳만 고치면 앱 도움말도 바뀐다.
 *
 * 마크다운은 도움말에 쓰는 만큼만 읽는다(작은 변환기): # 제목, 문단, - 목록, | 표 |, > 인용,
 * **굵게**, `코드`. 모두 textContent로 넣는다(innerHTML 안 씀 — 문서 내용이 스크립트가 되지 않게).
 * 왼쪽은 ## 절 목차, 오른쪽은 본문. 팝업은 끌어 옮길 수 있다(dialog.js makeMovable).
 */
import { el, clear } from './dom.js';
import { makeMovable, closeOnScrim, dialogOpen } from './dialog.js';

const HELP_URL = './docs/HELP.md';
let cache = null;

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
  const close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); };
  const onKey = (e) => {
    if (e.key !== 'Escape' || dialogOpen()) return;
    e.preventDefault(); e.stopPropagation(); close();
  };
  const box = el('div.dlg.help-dlg', { attrs: { role: 'dialog', 'aria-label': '도움말' }, on: { click: (e) => e.stopPropagation() } }, [
    el('div.help-head', {}, [
      heading,
      el('div.grow'),
      el('button.btn.outline.sm', { type: 'button', text: '닫기', on: { click: () => close() } }),
    ]),
    el('div.help-main', {}, [toc, body]),
  ]);
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
