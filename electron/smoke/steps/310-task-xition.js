// 스모크 단계 'task-xition' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'task-xition',
  areas: ["panel"],
  async run({ target }) {
    let xition = null;
    // 태스크↔하위카드 전환 — id를 유지한 채 순서축 위/아래로 (규칙 5). 진행도 탭 버튼을 누른다.
    xition = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const host = r.store.items.find((x) => !x.parent && x.ty !== 'ms');
        const hid = host.id;
        const kid = 'kXITION';
        r.store.commit('smoke 태스크', (doc) => {
          const h = doc.items.find((x) => x.id === hid);
          if (!Array.isArray(h.tasks)) h.tasks = [];
          h.tasks.push({ id: kid, text: '전환테스트', done: false });
        });
        document.querySelector('[data-id="' + hid + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="task"]').click();
        await sleep(80);
        const proms = [...document.querySelectorAll('#i-tasks .task-promote')];
        proms[proms.length - 1].click();
        await sleep(150);
        const asCard = r.store.items.find((x) => x.id === kid);
        const promoted = { isCard: !!asCard, parent: asCard ? asCard.parent : null,
          notTask: !(r.store.item(hid).tasks || []).some((t) => t.id === kid) };
        const dems = [...document.querySelectorAll('#i-children .task-demote')];
        dems[dems.length - 1].click();
        await sleep(150);
        const backTask = (r.store.item(hid).tasks || []).some((t) => t.id === kid);
        const stillCard = !!r.store.items.find((x) => x.id === kid);
        document.querySelector('#pItem [data-close]').click();
        r.store.commit('smoke 원복', (doc) => {
          const h = doc.items.find((x) => x.id === hid);
          if (h) h.tasks = (h.tasks || []).filter((t) => t.id !== kid);
          doc.items = doc.items.filter((x) => x.id !== kid);
        });
        // 태스크 보이는 순서 — 손잡이를 끌어 바꾼다(저장되는 건 순서뿐)
        let reorder = null;
        {
          r.store.commit('smoke 태스크 셋', (doc) => {
            const h = doc.items.find((x) => x.id === hid);
            h.tasks = [...(h.tasks || []), { id: 'kR1', text: '하나', done: false }, { id: 'kR2', text: '둘', done: false }, { id: 'kR3', text: '셋', done: false }];
          });
          r.itemPanel.open(hid);
          await sleep(200);
          document.querySelector('#pItem .ptab[data-tab="task"]').click();
          await sleep(80);
          const rows = [...document.querySelectorAll('#i-tasks .task')];
          const n = rows.length;
          const grip = rows[n - 1].querySelector('.task-grip').getBoundingClientRect();
          const tgt = rows[n - 3].getBoundingClientRect();
          const at = (x, y) => ({ bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 41 });
          const cx = grip.left + grip.width / 2;
          rows[n - 1].querySelector('.task-grip').dispatchEvent(new PointerEvent('pointerdown', at(cx, grip.top + 4)));
          window.dispatchEvent(new PointerEvent('pointermove', at(cx, grip.top - 10)));
          window.dispatchEvent(new PointerEvent('pointermove', at(cx, tgt.top + 2)));
          const marked = !!document.querySelector('#i-tasks .list-drop');
          window.dispatchEvent(new PointerEvent('pointerup', at(cx, tgt.top + 2)));
          await sleep(120);
          const ids = (r.store.item(hid).tasks || []).map((t) => t.id).filter((id) => id.startsWith('kR'));
          const shown = [...document.querySelectorAll('#i-tasks .task-text')].slice(-3).map((x) => x.value);
          const checkedNone = (r.store.item(hid).tasks || []).filter((t) => t.id.startsWith('kR')).every((t) => !t.done);
          r.store.undo(); await sleep(60);
          const undone = (r.store.item(hid).tasks || []).map((t) => t.id).filter((id) => id.startsWith('kR')).join(',') === 'kR1,kR2,kR3';
          // 종류 바꾸기 버튼은 화살표 아이콘이 아니라 글자
          const promoteText = document.querySelector('#i-tasks .task-promote')?.textContent;
          reorder = { marked, order: ids.join(','), shown: shown.join(','), checkedNone, undone, promoteText };
          document.querySelector('#pItem [data-close]').click();
          r.store.commit('smoke 원복', (doc) => {
            const h = doc.items.find((x) => x.id === hid);
            if (h) h.tasks = (h.tasks || []).filter((t) => !t.id.startsWith('kR'));
          });
        }
        return { promoted, backTask, stillCard, reorder };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] task-xition ' + JSON.stringify(xition));
    return xition;
  },
  check: (xition) => xition?.promoted?.isCard === true
    && xition?.promoted?.notTask === true
    && xition?.backTask === true
    && xition?.stillCard === false
    && xition?.reorder?.marked === true
    && xition?.reorder?.order === 'kR3,kR1,kR2'
    && xition?.reorder?.shown === '셋,하나,둘'
    && xition?.reorder?.checkedNone === true
    && xition?.reorder?.undone === true
    && xition?.reorder?.promoteText === '카드로',
};
