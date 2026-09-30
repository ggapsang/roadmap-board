/**
 * 비고 편집기 — 옵시디언식 라이브 미리보기 (2026-09-30 사용자 결정).
 *
 * 원문은 마크다운 그대로(item.note)이고, 편집기 안에서 **커서가 있는 줄만 원문**(**, #, -, [ ] …)을 보이고 나머지 줄은
 * 서식이 입혀진 모습으로 보인다. 편집기 밖으로 나가면 모든 줄이 서식으로 보인다.
 *   제목 # · 굵게 ** · 기울임 * _ · 취소선 ~~ · 코드 ` · 링크 [글](주소) · 글머리 - · 번호 1. · 할 일 [ ] [x] · 인용 > · 구분선 ---
 * 할 일 상자는 눌러서 체크한다(원문의 [ ]↔[x]를 바꾼다). 링크는 Ctrl+클릭으로 연다(http·https·mailto만).
 * Enter는 목록·번호·할 일·인용을 이어 쓴다(빈 항목이면 끝낸다). Ctrl+B 굵게, Ctrl+I 기울임.
 *
 * 되돌리기(Ctrl+Z / Ctrl+Y)는 **이 편집기 안의 글자만** 되돌린다 — 보드(카드) 되돌리기로 번지지 않는다(main.js 전역 단축키가
 * 편집 중이면 비켜 준다). 카드를 바꿔 열면 되돌리기 기록도 새로 시작한다(다른 카드의 비고로 되돌아가지 않게).
 *
 * CodeMirror 6(구문 트리)를 쓴다 — 번들러 없이 index.html의 import map으로 잇는다. 모양은 styles/panel.css .note-editor.
 */
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, WidgetType, keymap, placeholder, drawSelection } from '@codemirror/view';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** 할 일 상자 — 누르면 원문 [ ]↔[x] */
class TaskBox extends WidgetType {
  constructor(done) { super(); this.done = done; }
  eq(o) { return o.done === this.done; }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-task';
    box.checked = this.done;
    box.setAttribute('aria-label', this.done ? '한 일' : '할 일');
    return box;
  }
  ignoreEvent() { return false; }
}

/** 글머리표 — 원문 '-' 대신 */
class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-md-bullet'; s.textContent = '•'; return s; }
}

/** 구분선 — 원문 '---' 대신 */
class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-md-hr'; return s; }
}

const hide = Decoration.replace({});
const mark = (cls, attrs) => Decoration.mark({ class: cls, attributes: attrs });
const line = (cls) => Decoration.line({ class: cls });

/** 편집 중인가 — 입력 초점이 이 편집기 안에 있다(창 자체의 포커스와 무관하게) */
const editing = (view) => view.dom.contains(document.activeElement);

/** 커서(선택)가 걸친 줄 번호들 — 편집 중이 아니면 없다(전부 서식으로) */
function activeLines(view) {
  const out = new Set();
  if (!editing(view)) return out;
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number, b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n += 1) out.add(n);
  }
  return out;
}

function build(view) {
  const { doc } = view.state;
  const active = activeLines(view);
  const isActive = (pos) => active.has(doc.lineAt(pos).number);
  const deco = [];
  const add = (from, to, d) => { if (to > from) deco.push(d.range(from, to)); };
  const addLine = (from, cls) => deco.push(line(cls).range(doc.lineAt(from).from));

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (n) => {
        const name = n.name;
        const h = /^ATXHeading(\d)$/.exec(name);
        if (h) { addLine(n.from, `cm-md-h${Math.min(3, Number(h[1]))}`); return; }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(n.from)) return;
            // '# ' — 뒤 공백까지 숨긴다(줄 끝의 닫는 #는 그대로)
            const end = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
            if (n.from === doc.lineAt(n.from).from) deco.push(hide.range(n.from, end));
            return;
          }
          case 'StrongEmphasis': add(n.from, n.to, mark('cm-md-strong')); return;
          case 'Emphasis': add(n.from, n.to, mark('cm-md-em')); return;
          case 'Strikethrough': add(n.from, n.to, mark('cm-md-strike')); return;
          case 'InlineCode': add(n.from, n.to, mark('cm-md-code')); return;
          case 'EmphasisMark': case 'StrikethroughMark': case 'CodeMark': {
            // 코드 블록(```)의 표식은 그대로 둔다 — 인라인 코드의 ` 만 숨긴다
            if (name === 'CodeMark' && n.node.parent?.name !== 'InlineCode') return;
            if (!isActive(n.from)) deco.push(hide.range(n.from, n.to));
            return;
          }
          case 'Link': {
            const url = n.node.getChild('URL');
            const href = url ? doc.sliceString(url.from, url.to) : '';
            const marks = n.node.getChildren('LinkMark');
            if (!url || marks.length < 2) return;
            const textFrom = marks[0].to, textTo = marks[1].from;
            add(textFrom, textTo, mark('cm-md-link', SAFE_URL.test(href) ? { 'data-url': href, title: `${href} — Ctrl+클릭으로 열기` } : undefined));
            if (!isActive(n.from)) { deco.push(hide.range(n.from, textFrom)); deco.push(hide.range(textTo, n.to)); }
            return false;
          }
          case 'ListMark': {
            if (isActive(n.from)) return;
            const item = n.node.parent;
            const isTask = !!item?.getChild('Task');
            if (isTask) { deco.push(hide.range(n.from, Math.min(n.to + 1, doc.lineAt(n.from).to))); return; }
            if (item?.parent?.name === 'BulletList') deco.push(Decoration.replace({ widget: new Bullet() }).range(n.from, n.to));
            return;
          }
          case 'TaskMarker': {
            const done = /x/i.test(doc.sliceString(n.from, n.to));
            if (done) addLine(n.from, 'cm-md-done');
            if (!isActive(n.from)) deco.push(Decoration.replace({ widget: new TaskBox(done) }).range(n.from, n.to));
            return;
          }
          case 'Blockquote': {
            for (let p = n.from; p <= n.to;) { const l = doc.lineAt(p); addLine(l.from, 'cm-md-quote'); p = l.to + 1; }
            return;
          }
          case 'QuoteMark': {
            if (isActive(n.from)) return;
            const end = doc.sliceString(n.to, n.to + 1) === ' ' ? n.to + 1 : n.to;
            deco.push(hide.range(n.from, end));
            return;
          }
          case 'HorizontalRule': {
            if (!isActive(n.from)) deco.push(Decoration.replace({ widget: new Rule() }).range(n.from, n.to));
            return;
          }
          case 'FencedCode': case 'CodeBlock': {
            for (let p = n.from; p <= n.to;) { const l = doc.lineAt(p); addLine(l.from, 'cm-md-codeblock'); p = l.to + 1; }
            return false;
          }
          case 'Table': {
            for (let p = n.from; p <= n.to;) { const l = doc.lineAt(p); addLine(l.from, 'cm-md-table'); p = l.to + 1; }
            return false;
          }
          default: return undefined;
        }
      },
    });
  }
  return Decoration.set(deco, true);
}

const livePreview = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = build(view); }
  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view);
  }
}, {
  decorations: (v) => v.decorations,
  eventHandlers: {
    mousedown(e, view) {
      // 할 일 상자 — 원문 [ ]↔[x]
      if (e.target instanceof HTMLInputElement && e.target.classList.contains('cm-md-task')) {
        const pos = view.posAtDOM(e.target);
        const s = view.state.doc.sliceString(pos, pos + 3);
        if (/^\[[ xX]\]$/.test(s)) {
          view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: s[1] === ' ' ? 'x' : ' ' } });
          e.preventDefault();
          return true;
        }
      }
      // 링크 — Ctrl(⌘)+클릭으로 연다
      const a = e.target.closest?.('.cm-md-link[data-url]');
      if (a && (e.ctrlKey || e.metaKey)) { window.open(a.dataset.url, '_blank'); e.preventDefault(); return true; }
      return false;
    },
  },
});

/** 고른 글자를 표식으로 감싼다(없으면 표식 사이에 커서) — Ctrl+B / Ctrl+I */
const wrap = (m) => (view) => {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to);
    return {
      changes: { from: r.from, to: r.to, insert: `${m}${text}${m}` },
      range: r.empty ? EditorSelection.cursor(r.from + m.length) : EditorSelection.range(r.from + m.length, r.to + m.length),
    };
  }));
  return true;
};

const PLACEHOLDER = '# 제목 · **굵게** · *기울임* · - 목록 · 1. 번호 · - [ ] 할 일 · > 인용 · [링크](https://…)';

/**
 * @param {HTMLElement} host
 * @param {{ onChange?: (text:string)=>void, onBlur?: ()=>void }} o
 * @returns {{ view: EditorView, value: string, setValue(text:string, {resetHistory?}):void, focus():void }}
 */
export function createNoteEditor(host, { onChange = () => {}, onBlur = () => {} } = {}) {
  const extensions = [
    history(),
    drawSelection(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage }),
    livePreview,
    placeholder(PLACEHOLDER),
    keymap.of([
      { key: 'Mod-b', run: wrap('**') },
      { key: 'Mod-i', run: wrap('*') },
      ...markdownKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
    ]),
    EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
    EditorView.domEventHandlers({ blur: () => { onBlur(); return false; } }),
    EditorView.contentAttributes.of({ 'aria-label': '비고', spellcheck: 'false' }),
  ];
  const view = new EditorView({ parent: host, state: EditorState.create({ doc: '', extensions }) });
  return {
    view,
    get value() { return view.state.doc.toString(); },
    /** 내용을 바꾼다. resetHistory면 되돌리기 기록도 새로(다른 카드를 열 때) */
    setValue(text, { resetHistory = true } = {}) {
      const t = text ?? '';
      if (t === view.state.doc.toString()) return;
      if (resetHistory) view.setState(EditorState.create({ doc: t, extensions }));
      else view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t } });
    },
    focus() { view.focus(); },
  };
}
