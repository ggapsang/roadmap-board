/**
 * 비고(메모) 마크다운 → DOM. 사람이 메모에 흔히 쓰는 만큼만 읽는다.
 *
 *   블록   # ## ### 제목 · 문단(줄바꿈 그대로) · - / * 목록 · 1. 번호 목록 · - [ ] / - [x] 체크 목록
 *          > 인용 · ``` 코드 블록 · | 표 | · --- 구분선
 *   인라인 **굵게** · *기울임* / _기울임_ · ~~취소선~~ · `코드` · [글자](주소)
 *
 * 모두 textContent·createElement로 만든다(innerHTML 안 씀) — 메모 내용이 스크립트가 되지 않게.
 * 링크는 http·https·mailto만 링크로 만들고 나머지는 글자로 둔다. 링크는 새 창 → 기본 브라우저로 연다
 * (main.js setWindowOpenHandler). 순수 변환이라 문서·저장과 무관하다 — 원문은 그대로 item.note에 있다.
 */
import { el } from './dom.js';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** 인라인 — 결과는 노드 배열 */
export function inline(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w]))/g;
  let at = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    if (m[2] != null) out.push(el('strong', {}, inline(m[2])));
    else if (m[3] != null) out.push(el('del', {}, inline(m[3])));
    else if (m[4] != null) out.push(el('code', { text: m[4] }));
    else if (m[5] != null) {
      out.push(SAFE_URL.test(m[6])
        ? el('a', { text: m[5], attrs: { href: m[6], target: '_blank', rel: 'noopener noreferrer', title: m[6] },
          // 카드 위 링크 — 누르면 링크만 연다(카드 편집창·끌기로 번지지 않게)
          on: { click: (e) => e.stopPropagation(), pointerdown: (e) => e.stopPropagation() } })
        : document.createTextNode(m[0]));
    } else out.push(el('em', {}, inline(m[7] ?? m[8])));
    at = re.lastIndex;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

/** 여러 줄 → 줄바꿈(<br>) 사이에 인라인 */
function lines(buf) {
  const out = [];
  buf.forEach((t, k) => { if (k) out.push(el('br')); out.push(...inline(t)); });
  return out;
}

const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const BULLET = /^\s*[-*+]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const BLOCK_START = /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>|```|\||\s*(-{3,}|\*{3,})\s*$)/;

/**
 * @param {string} md
 * @returns {Node[]} 블록 노드들
 */
export function renderMarkdown(md) {
  const src = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    if (!line.trim()) { i += 1; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)/.exec(line))) {                  // 제목 — 메모 안이라 크기는 세 단계만
      const lv = Math.min(3, m[1].length);
      out.push(el(`h${lv + 3}`, {}, inline(m[2].trim())));
      i += 1; continue;
    }
    if (/^```/.test(line)) {                                    // 코드 블록 — 그대로
      const buf = []; i += 1;
      while (i < src.length && !/^```/.test(src[i])) { buf.push(src[i]); i += 1; }
      i += 1;
      out.push(el('pre', {}, [el('code', { text: buf.join('\n') })]));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push(el('hr')); i += 1; continue; }
    if (/^\|/.test(line)) {                                     // 표 — 머리줄, 구분줄, 본문
      const head = cells(line); i += 1;
      if (i < src.length && /^\|?\s*:?-{3,}/.test(src[i])) i += 1;
      const body = [];
      while (i < src.length && /^\|/.test(src[i])) { body.push(cells(src[i])); i += 1; }
      out.push(el('table', {}, [
        el('thead', {}, [el('tr', {}, head.map((c) => el('th', {}, inline(c))))]),
        el('tbody', {}, body.map((r) => el('tr', {}, r.map((c) => el('td', {}, inline(c)))))),
      ]));
      continue;
    }
    if (BULLET.test(line) || NUMBER.test(line)) {               // 목록 — 같은 종류가 이어지는 동안
      const ordered = NUMBER.test(line);
      const mark = ordered ? NUMBER : BULLET;
      const items = [];
      while (i < src.length && (mark.test(src[i]) || (/^\s{2,}\S/.test(src[i]) && items.length))) {
        if (mark.test(src[i])) items.push(src[i].replace(mark, ''));
        else items[items.length - 1] += '\n' + src[i].trim();
        i += 1;
      }
      out.push(el(ordered ? 'ol' : 'ul', {}, items.map((t) => {
        const c = /^\[([ xX])\]\s+(.*)$/s.exec(t);                // 체크 목록 — 보기 전용 표시
        if (!c) return el('li', {}, lines(t.split('\n')));
        const done = c[1] !== ' ';
        return el('li.md-task' + (done ? '.done' : ''), {}, [
          el('span.md-box', { text: done ? '☑' : '☐', attrs: { 'aria-hidden': 'true' } }), ...lines(c[2].split('\n')),
        ]);
      })));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < src.length && /^>\s?/.test(src[i])) { buf.push(src[i].replace(/^>\s?/, '')); i += 1; }
      out.push(el('blockquote', {}, lines(buf)));
      continue;
    }
    const buf = [];                                             // 문단 — 줄바꿈은 그대로 살린다(메모라서)
    while (i < src.length && src[i].trim() && !BLOCK_START.test(src[i])) { buf.push(src[i]); i += 1; }
    if (!buf.length) { buf.push(src[i]); i += 1; }
    out.push(el('p', {}, lines(buf)));
  }
  return out;
}
