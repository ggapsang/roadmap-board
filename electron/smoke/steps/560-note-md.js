// 스모크 단계 'note-md' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'note-md',
  areas: ["note","panel"],
  async run({ target, wrote }) {
    // 비고 — 옵시디언식 라이브 미리보기(CodeMirror). 원문은 마크다운 그대로 저장, 커서가 있는 줄만 원문이 보이고 나머지는 서식.
    // 할 일 상자를 누르면 원문 [ ]↔[x], Enter로 목록 이어 쓰기, Ctrl+B 굵게. 편집 중 Ctrl+Z는 **편집기 글자만** 되돌리고
    // 보드(카드) 되돌리기로 번지지 않는다. 편집 중 Backspace가 카드를 지우지 않는다. 다른 카드를 열면 되돌리기 기록이 새로.
    let noteMd = null;
    if (wrote) {
      noteMd = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && !r.store.items.some((k) => k.parent === x.id));
          const it = cards[0], other = cards[1];
          const id = it.id;
          const before = { note: it.note, show: it.place.showNote, ti: it.ti };
          // 보드 되돌리기 기록을 하나 만들어 둔다 — 비고 편집 중 Ctrl+Z가 이걸 되돌리면 안 된다
          r.store.commit('제목', () => { r.store.item(id).ti = before.ti + '·'; });
          document.querySelector('.col [data-id="' + id + '"]').click(); await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="attr"]').click(); await sleep(80);
          const ed = r.itemPanel.noteEditor, v = ed.view;
          const md = '# 제목\\n**굵게** *기울임* ~~취소~~ \`코드\`\\n- 하나\\n1. 첫째\\n- [x] 한 일\\n- [ ] 할 일\\n> 인용\\n[링크](https://example.com)\\n<img src=x onerror="window.__xss=1">';
          v.focus();
          v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: md }, selection: { anchor: 0 } });   // 커서는 1줄(제목)
          await sleep(80);
          const c = v.contentDOM;
          const lineText = (k) => c.querySelectorAll('.cm-line')[k]?.textContent ?? '';
          const live = {
            h1Raw: lineText(0).startsWith('# '),                        // 커서 줄 — 원문
            strongRendered: !!c.querySelector('.cm-md-strong') && !lineText(1).includes('**'),   // 다른 줄 — 기호 숨김
            em: !!c.querySelector('.cm-md-em'), strike: !!c.querySelector('.cm-md-strike'), code: !!c.querySelector('.cm-md-code'),
            bullet: !!c.querySelector('.cm-md-bullet'),
            boxes: [...c.querySelectorAll('input.cm-md-task')].map((b) => b.checked),
            quote: !!c.querySelector('.cm-md-quote'),
            link: c.querySelector('.cm-md-link')?.dataset.url ?? null, linkHidden: !lineText(7).includes('](') ,
            noImg: !c.querySelector('img:not(.cm-widgetBuffer)') && window.__xss !== 1 && c.textContent.includes('<img'),   // cm-widgetBuffer는 CodeMirror 자체 요소
          };
          // 커서를 굵게 줄로 옮기면 그 줄이 원문으로
          v.dispatch({ selection: { anchor: v.state.doc.line(2).from + 1 } }); await sleep(50);
          live.rawOnCursor = lineText(1).includes('**') && lineText(0) === '제목';
          // 할 일 상자 누르기 — 원문 [ ] → [x]
          v.dispatch({ selection: { anchor: 0 } }); await sleep(50);
          const box = [...c.querySelectorAll('input.cm-md-task')].find((b) => !b.checked);
          box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          await sleep(50);
          const toggled = ed.value.includes('- [x] 할 일');
          // Enter로 이어 쓰기 — '- 하나' 끝에서 Enter → '- '
          const l3 = v.state.doc.line(3);
          v.dispatch({ selection: { anchor: l3.to } });
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          await sleep(50);
          const cont = v.state.doc.line(4).text === '- ';
          // Ctrl+B — 고른 글자 굵게
          v.dispatch({ changes: { from: v.state.doc.line(4).to, insert: '중요' }, selection: { anchor: v.state.doc.line(4).to, head: v.state.doc.line(4).to + 2 } });
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
          await sleep(50);
          const bold = v.state.doc.line(4).text === '- **중요**';
          // Ctrl+Z — 편집기 글자만 되돌린다(굵게가 풀린다), 보드 되돌리기(제목)는 그대로
          const titleBefore = r.store.item(id).ti;
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
          await sleep(80);
          const undoLocal = !v.state.doc.toString().includes('**중요**') && r.store.item(id).ti === titleBefore;   // 편집기는 가까운 변경을 묶어 되돌린다
          // 편집 중 Backspace — 카드가 지워지지 않는다
          const n0 = r.store.items.length;
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
          await sleep(80);
          const cardKept = r.store.items.length === n0 && !!r.store.item(id);
          // 편집기에서 나가면 저장(원문 마크다운)
          const text = ed.value;
          v.contentDOM.blur(); v.dom.dispatchEvent(new FocusEvent('blur')); c.dispatchEvent(new FocusEvent('blur'));
          await sleep(150);
          const saved = r.store.item(id).note === text;
          const allRendered = !c.textContent.includes('**') || !v.hasFocus;
          // 다른 카드를 열면 되돌리기 기록이 새로 — Ctrl+Z로 앞 카드 비고가 나오지 않는다
          document.querySelector('.col [data-id="' + other.id + '"]').click(); await sleep(250);
          const otherNote = r.store.item(other.id).note ?? '';
          v.focus();
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
          await sleep(80);
          const freshHistory = ed.value === otherNote;
          // 카드 위 — 비고 표시를 켜면 마크다운으로 그린다
          r.store.commit('비고', () => { r.store.item(id).note = md; r.store.item(id).place.showNote = true; });
          r.board.render(); await sleep(150);
          const cn = document.querySelector('.col [data-id="' + id + '"] .card-note');
          const card = { strong: !!cn?.querySelector('strong'), li: cn?.querySelectorAll('li').length ?? 0, noImg: !cn?.querySelector('img'),
            // 카드가 가운데 정렬이어도 비고는 왼쪽·카드 폭을 다 쓴다(좁아 제목 우선으로 숨겨졌어도 스타일은 같다)
            left: !!cn && getComputedStyle(cn).textAlign === 'left' && getComputedStyle(cn).alignSelf === 'stretch' };   // 카드가 가운데 정렬이어도 비고는 왼쪽
          r.store.commit('원복', () => { const x = r.store.item(id); x.note = before.note; x.place.showNote = before.show; x.ti = before.ti; });
          document.querySelector('#pItem [data-close]').click();
          await sleep(100);
          return { live, toggled, cont, bold, undoLocal, cardKept, saved, allRendered, freshHistory, card };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
        return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
      })()`);
      console.log('[smoke] note-md ' + JSON.stringify(noteMd));
    }
    return noteMd;
  },
  check: (noteMd) => noteMd?.live?.h1Raw === true
    && noteMd?.live?.strongRendered === true
    && noteMd?.live?.em === true
    && noteMd?.live?.strike === true
    && noteMd?.live?.code === true
    && noteMd?.live?.bullet === true
    && JSON.stringify(noteMd?.live?.boxes) === '[true,false]'
    && noteMd?.live?.quote === true
    && noteMd?.live?.link === 'https://example.com'
    && noteMd?.live?.linkHidden === true
    && noteMd?.live?.noImg === true
    && noteMd?.live?.rawOnCursor === true
    && noteMd?.toggled === true
    && noteMd?.cont === true
    && noteMd?.bold === true
    && noteMd?.undoLocal === true
    && noteMd?.cardKept === true
    && noteMd?.saved === true
    && noteMd?.freshHistory === true
    && noteMd?.card?.strong === true
    && noteMd?.card?.li >= 4
    && noteMd?.card?.noImg === true
    && noteMd?.card?.left === true,
};
