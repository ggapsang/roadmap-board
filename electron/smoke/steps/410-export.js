// 스모크 단계 'export' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'export',
  areas: ["data"],
  async run({ target, withTimeout }) {
    let exported = null;
    // 내보내기 — 보드 전체가 한 장으로 나오는지
    exported = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const cal = document.querySelector('.cal');
      const before = { w: cal.scrollWidth, h: cal.scrollHeight };
      const mod = await import('./src/ui/export.js');
      await mod.exportPng(r.adapter, r.store);
      await mod.exportPdf(r.adapter, r.store);
      return { boardW: before.w, boardH: before.h,
               restored: !document.body.classList.contains('exporting') };
    })()`), 30000, 'export');
    console.log('[smoke] export ' + JSON.stringify(exported));
    return exported;
  },
  check: (exported) => exported != null && !exported?.error,
};
