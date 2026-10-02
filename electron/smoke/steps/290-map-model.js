// 스모크 단계 'map-model' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'map-model',
  areas: ["panel"],
  async run({ target }) {
    let combineCheck = null;
    // 매핑 — 동일(합치기)·조합(포함)은 팝업 버튼으로 다룬다(인라인 목록 아님). 실제 트리 팝업·
    // 크로스보드 조합=포함·동일 합치기 왕복은 --repro가 실제 데이터로 검증한다.
    combineCheck = await target.webContents.executeJavaScript(`(async () => {
      const run = (async () => {
        const r = window.__roadmap;
        const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
        const id = r.store.items[0].id;
        document.querySelector('[data-id="' + id + '"]').click();
        await sleep(350);
        document.querySelector('#pItem .ptab[data-tab="rel"]').click();
        await sleep(120);
        const sameBtn = !!document.querySelector('#i-same button');
        const combBtn = !!document.querySelector('#i-combine button');
        const noInlineOpts = document.querySelectorAll('#i-same .fl-opt, #i-combine .fl-opt').length === 0;
        document.querySelector('#pItem [data-close]').click();
        return { sameBtn, combBtn, noInlineOpts };
      })();
      const guard = new Promise((res) => setTimeout(() => res({ error: 'timeout' }), 8000));
      return Promise.race([run.catch((e) => ({ error: String(e) })), guard]);
    })()`);
    console.log('[smoke] map-model ' + JSON.stringify(combineCheck));
    return combineCheck;
  },
  check: (combineCheck) => combineCheck?.sameBtn === true
    && combineCheck?.combBtn === true
    && combineCheck?.noInlineOpts === true,
};
