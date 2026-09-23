/**
 * 트랙 관리 패널 — 이름·분류 라벨 편집, 순서 변경, 추가·삭제.
 * 트랙 개수와 이름은 런타임 편집 대상이다 (기획안 D-6).
 */
import { newId } from '../../core/schema.js';
import { $, el, clear, button, ICONS } from '../dom.js';
import { toast } from '../toast.js';

export class TrackPanel {
  constructor({ store, view, panels }) {
    Object.assign(this, { store, view, panels });
    $('t-add').addEventListener('click', () => this.add());
  }

  open(trackId = null) {
    this.view.selectedTrack = trackId;
    this.view.selectedItem = null;
    this.render();
    this.panels.open('pTrack');
  }

  render() {
    const list = $('tlist');
    clear(list);

    this.store.tracks.forEach((track, i) => {
      const name = el('input', {
        value: track.name, attrs: { 'aria-label': '트랙 이름' },
        on: { input: (e) => this.store.commit('트랙 이름', () => { track.name = e.target.value; }) },
      });
      const lab = el('input.lab', {
        value: track.lab ?? '', attrs: { 'aria-label': '분류 라벨', placeholder: '분류 (예: 요구사항 4)' },
        on: { input: (e) => this.store.commit('트랙 라벨', () => { track.lab = e.target.value; }) },
      });

      const row = el('div.trow', { className: track.id === this.view.selectedTrack ? 'trow active' : 'trow' }, [
        el('div.names', {}, [lab, name]),
        button({ className: 'mini', iconPath: ICONS.up, title: '위로', onClick: () => this.move(i, -1) }),
        button({ className: 'mini', iconPath: ICONS.down, title: '아래로', onClick: () => this.move(i, +1) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.remove(i) }),
      ]);
      list.append(row);
    });
  }

  move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= this.store.tracks.length) return;
    this.store.commit('트랙 순서', (doc) => {
      const [t] = doc.tracks.splice(index, 1);
      doc.tracks.splice(to, 0, t);
      // 순서가 바뀌면 병합 폭이 보드 밖으로 나갈 수 있다
      doc.items.forEach((it) => {
        const ti = doc.tracks.findIndex((x) => x.id === it.t);
        it.sp = Math.min(it.sp, doc.tracks.length - ti);
      });
    });
    this.render();
  }

  remove(index) {
    const track = this.store.tracks[index];
    if (this.store.tracks.length === 1) { toast('마지막 트랙은 삭제할 수 없습니다', 'warn'); return; }

    const count = this.store.items.filter((x) => x.t === track.id).length;
    const msg = count
      ? `'${track.name}' 트랙과 일정 ${count}건을 삭제합니다. 계속할까요?`
      : `'${track.name}' 트랙을 삭제합니다. 계속할까요?`;
    if (!confirm(msg)) return;

    this.store.commit('트랙 삭제', (doc) => {
      const removed = new Set(doc.items.filter((x) => x.t === track.id).map((x) => x.id));
      doc.items = doc.items.filter((x) => x.t !== track.id);
      for (const x of doc.items) x.dp = x.dp.filter((d) => !removed.has(d));
      doc.tracks.splice(index, 1);
      doc.items.forEach((it) => {
        const ti = doc.tracks.findIndex((x) => x.id === it.t);
        it.sp = Math.min(it.sp, doc.tracks.length - ti);
      });
    });
    this.view.selectedTrack = null;
    this.render();
    toast(count ? `트랙과 일정 ${count}건을 삭제했습니다` : '트랙을 삭제했습니다');
  }

  add() {
    const track = { id: newId('t'), lab: '', name: `새 트랙 ${this.store.tracks.length + 1}` };
    this.store.commit('트랙 추가', (doc) => { doc.tracks.push(track); });
    this.view.selectedTrack = track.id;
    this.render();
    this.panels.open('pTrack');
  }
}
