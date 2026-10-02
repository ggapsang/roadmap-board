// 스모크 단계 'parent-child' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'parent-child',
  areas: ["panel"],
  async run({ target, wrote }) {
    // 모자관계설정 — 부모 설정 / 자식 설정 탭, 같은 트랙 카드만 후보, 자식을 한꺼번에 넣기, 순환 거부
    let parentChild = null;
    if (wrote) {
      parentChild = await target.webContents.executeJavaScript(`(async () => {
        const run = (async () => {
          const r = window.__roadmap;
          const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
          const tops = (t) => r.store.items.filter((x) => !x.parent && x.ty !== 'ms' && x.place.t === t && !r.store.items.some((k) => k.parent === x.id));
          const track = r.store.tracks.find((t) => tops(t.id).length >= 3);
          const [host, c1, c2] = tops(track.id);
          document.querySelector('[data-id="' + host.id + '"]').click();
          await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="rel"]').click();
          await sleep(300);
          document.querySelector('#i-parent > button.btn').click();
          await sleep(250);
          const tabs = [...document.querySelectorAll('.dlg-tabs .dlg-tab')].map((b) => b.textContent.replace(/\\s*\\d+$/, '').trim());
          const rowIds = () => [...document.querySelectorAll('.dlg-tree-row')].map((x) => x.dataset.id);
          const inTrack = (id) => id === track.id || r.store.items.some((x) => x.id === id && x.place.t === track.id);
          const childOnlyTrack = rowIds().length > 1 && rowIds().every(inTrack);
          // 자식 설정(처음 탭) — 둘을 체크하고 적용
          for (const id of [c1.id, c2.id]) document.querySelector('.dlg-tree-row[data-id="' + id + '"] input[type=checkbox]').click();
          await sleep(50);
          document.querySelector('.dlg-tab[data-tab="parent"]').click();
          await sleep(100);
          const parentOnlyTrack = rowIds().every(inTrack);
          const radios = document.querySelectorAll('.dlg-tree-row input[type=radio]').length > 0;
          const hostNotParentCandidate = !document.querySelector('.dlg-tree-row[data-id="' + host.id + '"] input');
          [...document.querySelectorAll('.dlg-actions .btn.cta')].pop().click();
          await sleep(200);
          const bulk = [c1.id, c2.id].every((id) => r.store.item(id).parent === host.id);
          const summary = document.querySelectorAll('#i-parent .combine-chip').length === 2;
          // 순환 — 자식(c1)을 열어 host를 자식으로 넣으려 하면 거부(host는 c1의 조상이라 후보에도 없다)
          document.querySelector('[data-id="' + c1.id + '"]').click();
          await sleep(250);
          document.querySelector('#pItem .ptab[data-tab="rel"]').click();
          await sleep(200);
          document.querySelector('#i-parent > button.btn').click();
          await sleep(250);
          const ancestorBlocked = !document.querySelector('.dlg-tree-row[data-id="' + host.id + '"] input');
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await sleep(100);
          document.querySelector('#pItem [data-close]')?.click();
          r.store.undo();                                  // 원복 — 모자관계 설정은 되돌리기 1단계
          await sleep(150);
          const undone = [c1.id, c2.id].every((id) => !r.store.item(id).parent);
          return { tabs, childOnlyTrack, parentOnlyTrack, radios, hostNotParentCandidate, bulk, summary, ancestorBlocked, undone };
        })();
        const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 10000));
        return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
      })()`);
      console.log('[smoke] parent-child ' + JSON.stringify(parentChild));
    }
    return parentChild;
  },
  check: (parentChild) => JSON.stringify(parentChild?.tabs) === JSON.stringify(['부모 설정', '자식 설정'])
    && parentChild?.childOnlyTrack === true
    && parentChild?.parentOnlyTrack === true
    && parentChild?.radios === true
    && parentChild?.hostNotParentCandidate === true
    && parentChild?.bulk === true
    && parentChild?.summary === true
    && parentChild?.ancestorBlocked === true
    && parentChild?.undone === true,
};
