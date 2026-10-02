// 스모크 단계 'del-key' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'del-key',
  areas: ["board","panel"],
  async run({ target }) {
    let delKey = null;
    // Delete/Backspace 단축키로 선택한 카드 삭제 — 입력 칸에 있을 땐 안 먹는다
    delKey = await target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const item = r.board.createItem(r.store.tracks[0].id, 5);   // 임시 카드 + 선택
      await new Promise((res) => setTimeout(res, 120));
      const id = item.id;
      const existsBefore = !!r.store.item(id);
      // 제목 입력 칸에 포커스 → Delete가 무시돼야 한다
      document.getElementById('i-title').focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      await new Promise((res) => setTimeout(res, 80));
      const survivedWhileTyping = !!r.store.item(id);
      // 입력 칸 밖에서 Backspace(⌫) → 삭제된다
      document.getElementById('i-title').blur();
      r.view.selectedItem = id;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      await new Promise((res) => setTimeout(res, 120));
      const deleted = !r.store.item(id);
      return { existsBefore, survivedWhileTyping, deleted };
    })()`);
    console.log('[smoke] del-key ' + JSON.stringify(delKey));
    return delKey;
  },
  check: (delKey) => delKey?.existsBefore === true
    && delKey?.survivedWhileTyping === true
    && delKey?.deleted === true,
};
