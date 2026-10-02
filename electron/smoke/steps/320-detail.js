// 스모크 단계 'detail' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'detail',
  areas: ["panel"],
  requires: ['nesting'],   // 이 단계가 만든 문서 구조를 쓴다
  async run({ target }) {
    let progressCheck = null;
    // 상세 탭 '구성' — 조합한 이벤트마다 그 안의 카드가 자기 그룹에 뜨고(부품별 컨테이너),
    // 하위 카드와 같은 모양이며, 헤더를 눌러 접고 편다.
    // 상세(구성) — 이 이벤트가 품은 하위 이벤트(포함=조합 포함)가 트리로 나오고, 접기 그룹이 접힌다.
    progressCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        // 자식(포함)을 가진 최상위 카드 하나
        const host = r.store.items.find((x) => !x.parent && r.store.items.some((k) => k.parent === x.id));
        if (!host) return { error: 'no container card' };
        document.querySelector('[data-id="' + host.id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="task"]').click();
        await sleep(400);
        const childRows = document.querySelectorAll('#i-children .detail-row').length;
        const groups = [...document.querySelectorAll('#i-children .detail-group')];
        let collapsedHidden = true;
        if (groups.length) {
          groups[0].querySelector('.detail-parent').click();
          await sleep(60);
          collapsedHidden = getComputedStyle(groups[0].querySelector(':scope > .detail-kids')).display === 'none';
        }
        document.querySelector('#pItem [data-close]').click();
        return { childRows, groups: groups.length, showsChildren: childRows > 0, collapsedHidden };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 12000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] detail ' + JSON.stringify(progressCheck));
    return progressCheck;
  },
  check: (progressCheck) => progressCheck?.showsChildren === true
    && progressCheck?.collapsedHidden === true,
};
