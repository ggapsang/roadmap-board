// 스모크 단계 'layout' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'layout',
  areas: ["board","panel"],
  async run({ target, capture, shotDir }) {
    let layout = null;
    // 패널을 열면 본문이 밀리는가 / 텍스트 선택 모드가 걸리는가
    layout = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const scroll = document.getElementById('scroll');
      const before = scroll.getBoundingClientRect().width;
      document.querySelector('.ev').click();
      await new Promise((res) => setTimeout(res, 300));
      const after = scroll.getBoundingClientRect().width;
      const panelOpen = document.body.classList.contains('panel-open');
      document.getElementById('btnSelect').click();
      await new Promise((res) => setTimeout(res, 100));
      const selectable = getComputedStyle(document.querySelector('.ev')).userSelect;
      document.getElementById('btnSelect').click();
      return { before, after, shrunk: before - after, panelOpen, selectable };
    })()`);
    console.log('[smoke] layout ' + JSON.stringify(layout));
    await capture(target, 'board-panel');
    // 탭별 패널 모습도 남긴다 (관계=검색 리스트, 표시=아이콘 툴바)
    if (shotDir()) {
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="rel"]').click()`);
      await new Promise((res) => setTimeout(res, 200));
      await capture(target, 'panel-rel');
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="disp"]').click()`);
      await new Promise((res) => setTimeout(res, 150));
      await capture(target, 'panel-disp');
      await target.webContents.executeJavaScript(`document.querySelector('#pItem .ptab[data-tab="attr"]').click()`);
    }
    await target.webContents.executeJavaScript(
      `document.querySelector('#pItem [data-close]').click()`,
    );
    return layout;
  },
  check: (layout) => layout?.panelOpen === true
    && layout?.shrunk > 280
    && layout?.selectable === 'text',
};
