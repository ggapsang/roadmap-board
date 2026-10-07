// 스모크 단계 'dep-edit' — 선행관계설정은 모자관계처럼 두 탭(선행 설정 · 후행 설정)이고, 화살표를 눌러 고른 뒤 Delete로 지운다.
// 후행 설정으로 이 카드 다음 카드를 고르면 이 카드 → 그 카드 화살표가 생긴다. 순환이 되면 적용하지 않는다. 되돌리기 1단계.
export default {
  name: 'dep-edit',
  areas: ['panel', 'arrows', 'board'],
  async run({ target }) {
    const r1 = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const deps = () => r.store.relations.filter((x) => x.type === 'dep');
        const cards = r.store.items.filter((x) => !x.parent && x.ty !== 'ms');
        // 선행·후행이 아직 없는 두 카드
        const free = cards.filter((x) => !deps().some((d) => d.from === x.id || d.to === x.id));
        const [a, b] = free.length >= 2 ? free : cards.slice(-2);
        const n0 = deps().length;
        document.querySelector('[data-id="' + a.id + '"]').click(); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(200);
        document.querySelector('#i-deps > button.btn').click(); await sleep(250);
        const tabs = [...document.querySelectorAll('.dlg-tabs .dlg-tab')].map((x) => x.textContent.replace(/\\s*\\d+$/, '').trim());
        // 후행 설정 — b를 고른다(a가 끝나야 b)
        document.querySelector('.dlg-tab[data-tab="succ"]').click(); await sleep(100);
        document.querySelector('.dlg-tree-row[data-id="' + b.id + '"] input[type=checkbox]').click(); await sleep(50);
        [...document.querySelectorAll('.dlg-actions .btn.cta')].pop().click(); await sleep(250);
        const made = deps().find((d) => d.from === a.id && d.to === b.id);
        const summary = [...document.querySelectorAll('#i-deps .pc-head')].map((x) => x.textContent.replace(/\\s*\\d+$/, '').trim());
        const succChip = [...document.querySelectorAll('#i-deps .combine-chip-name')].some((x) => x.textContent === (b.ti || '(제목 없음)'));
        // 순환 — b를 열어 a를 후행으로 고르면(b → a) a → b → a가 되어 적용하지 않는다
        document.querySelector('[data-id="' + b.id + '"]').click(); await sleep(250);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click(); await sleep(150);
        document.querySelector('#i-deps > button.btn').click(); await sleep(250);
        document.querySelector('.dlg-tab[data-tab="succ"]').click(); await sleep(100);
        document.querySelector('.dlg-tree-row[data-id="' + a.id + '"] input[type=checkbox]').click(); await sleep(50);
        [...document.querySelectorAll('.dlg-actions .btn.cta')].pop().click(); await sleep(250);
        const toastText = document.getElementById('toast')?.textContent ?? '';
        const cycleRejected = !deps().some((d) => d.from === b.id && d.to === a.id) && /순환/.test(toastText);
        document.querySelector('#pItem [data-close]')?.click(); await sleep(150);
        // 화살표를 눌러 고르고 Delete — 선행관계가 지워진다(카드는 그대로)
        const path = () => document.querySelector('.arrows .arrow[data-rel="' + made?.id + '"]');
        path()?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(120);
        const selected = r.view.selectedRel === made?.id && path()?.classList.contains('selected');
        const nItems = r.store.items.length;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await sleep(200);
        const deleted = !deps().some((d) => d.id === made?.id) && !path() && r.store.items.length === nItems && r.view.selectedRel === null;
        r.store.undo(); await sleep(200);
        const undone = deps().some((d) => d.id === made?.id) && !!path();
        // Esc는 고른 화살표를 풀고, 빈 곳을 누르면 풀린다
        path()?.dispatchEvent(new MouseEvent('click', { bubbles: true })); await sleep(80);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(80);
        const escCleared = r.view.selectedRel === null && !document.querySelector('.arrows .arrow.selected');
        // 원복
        r.store.commit('스모크 원복', (doc) => { doc.relations = doc.relations.filter((d) => d.id !== made?.id); });
        await sleep(150);
        return { toastText, tabs, made: !!made, summary, succChip, cycleRejected, selected, deleted, undone, escCleared, back: deps().length === n0 };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
      return Promise.race([run.catch((e) => ({ error: String(e && e.stack || e) })), guard]);
    })()`);
    console.log('[smoke] dep-edit ' + JSON.stringify(r1));
    return r1;
  },
  check: (x) => JSON.stringify(x?.tabs) === JSON.stringify(['선행 설정', '후행 설정']) && x?.made === true
    && JSON.stringify(x?.summary) === JSON.stringify(['선행', '후행']) && x?.succChip === true && x?.cycleRejected === true
    && x?.selected === true && x?.deleted === true && x?.undone === true && x?.escCleared === true && x?.back === true,
};
