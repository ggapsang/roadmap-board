// 스모크 단계 'new-track' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'new-track',
  areas: ["board","config"],
  async run({ target, withTimeout }) {
    let newTrack = null;
    // 트랙을 새로 추가하면 그 트랙에 카드가 들어가는가
    newTrack = await withTimeout(target.webContents.executeJavaScript(`(async () => {
      const r = window.__roadmap;
      const before = document.querySelectorAll('.col').length;
      document.getElementById('t-add').click();
      await new Promise((res) => setTimeout(res, 250));
      const after = document.querySelectorAll('.col').length;
      const id = r.store.tracks[r.store.tracks.length - 1].id;
      const hasColumn = !!document.querySelector('.col[data-t="' + id + '"]');
      // 그 트랙에 일정을 만들어 본다
      const item = r.board.createItem(id, 10);
      await new Promise((res) => setTimeout(res, 200));
      const drawn = !!document.querySelector('.col[data-t="' + id + '"] [data-id="' + item.id + '"]');
      return { before, after, hasColumn, drawn };
    })()`), 20000, 'new-track');
    console.log('[smoke] new-track ' + JSON.stringify(newTrack));
    return newTrack;
  },
  check: (newTrack) => newTrack?.after === newTrack?.before + 1
    && newTrack?.hasColumn === true
    && newTrack?.drawn === true,
};
