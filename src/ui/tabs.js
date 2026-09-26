/**
 * 보드 탭 — 여러 보드를 동시에 열어 두고 오간다 (브라우저 탭 구성).
 *
 * 한 번에 하나의 보드만 그려지므로 Store/Board를 여럿 두지 않는다. 탭은 '열린 보드
 * 목록 + 활성 탭'일 뿐이고, 탭을 바꾸면 그 보드를 openProject(=store.adopt)로 갈아끼운다
 * (규칙 12). boardId가 null인 탭은 '보드 선택' 화면(런처)을 띄운다.
 *
 *   +          새 보드 선택 탭
 *   탭 클릭    그 보드로 전환
 *   탭 ×       탭 닫기 (마지막 하나면 선택 화면으로)
 */
import { $, el, clear, icon, ICONS } from './dom.js';

export class BoardTabs {
  /**
   * @param {object} o
   * @param {HTMLElement} o.mount        탭줄 컨테이너 (#tabbar)
   * @param {import('./launcher.js').Launcher} o.launcher
   * @param {(id:number)=>Promise<void>} o.openProject  보드 문서를 adopt+렌더
   * @param {()=>string} o.boardName     현재 열린 보드 이름
   */
  constructor({ mount, launcher, openProject, boardName }) {
    this.mount = mount;
    this.launcher = launcher;
    this.openProject = openProject;
    this.boardName = boardName;
    this.tabs = [];        // [{ key, boardId:number|null, name }]
    this.active = -1;
    this.seq = 0;
  }

  /** 처음엔 보드 선택 탭 하나. */
  init() {
    this.tabs = [{ key: (this.seq += 1), boardId: null, name: '보드 선택' }];
    this.active = 0;
    this.#apply();
  }

  #cur() { return this.tabs[this.active]; }

  /** 활성 탭 상태에 맞춰 런처를 띄우거나 보드를 보인다. */
  async #apply() {
    const t = this.#cur();
    if (!t || t.boardId == null) {
      this.launcher.show({ closable: false });
    } else {
      await this.openProject(t.boardId);
      t.name = this.boardName() || t.name;
      this.launcher.hide();
    }
    this.render();
  }

  async activate(i) {
    if (i < 0 || i >= this.tabs.length || i === this.active) { if (i === this.active) return; }
    this.active = i;
    await this.#apply();
  }

  /** '+' — 새 보드 선택 탭. */
  newLauncherTab() {
    this.tabs.push({ key: (this.seq += 1), boardId: null, name: '보드 선택' });
    this.activate(this.tabs.length - 1);
  }

  /**
   * 보드를 연다. 이미 열려 있으면 그 탭으로, 활성 탭이 선택 화면이면 그 자리에서,
   * 아니면 새 탭으로. (런처에서 고르거나, 카드에서 링크된 보드로 드릴인할 때 쓴다.)
   */
  async openBoard(id) {
    const found = this.tabs.findIndex((t) => t.boardId === id);
    if (found >= 0) { await this.activate(found); return; }
    const cur = this.#cur();
    if (cur && cur.boardId == null) {
      cur.boardId = id;
      await this.activate(this.active);
    } else {
      this.tabs.push({ key: (this.seq += 1), boardId: id, name: '보드' });
      await this.activate(this.tabs.length - 1);
    }
  }

  closeTab(i) {
    if (i < 0 || i >= this.tabs.length) return;
    this.tabs.splice(i, 1);
    if (!this.tabs.length) {
      this.tabs.push({ key: (this.seq += 1), boardId: null, name: '보드 선택' });
      this.active = 0;
    } else if (this.active > i || this.active >= this.tabs.length) {
      this.active = Math.max(0, this.active - 1);
    }
    this.#apply();
  }

  /** 보드가 삭제되면 그 탭도 닫는다. */
  boardClosed(id) {
    const i = this.tabs.findIndex((t) => t.boardId === id);
    if (i >= 0) this.closeTab(i);
  }

  /** 보드 이름이 바뀌면 탭 이름도 맞춘다. */
  renameBoard(id, name) {
    let hit = false;
    for (const t of this.tabs) if (t.boardId === id) { t.name = name; hit = true; }
    if (hit) this.render();
  }

  /** 현재 활성 보드 이름을 탭에 반영 (저장·이름변경 후). */
  syncActiveName() {
    const t = this.#cur();
    if (t && t.boardId != null) { t.name = this.boardName() || t.name; this.render(); }
  }

  render() {
    clear(this.mount);
    this.tabs.forEach((t, i) => {
      const tab = el('div', {
        className: 'tab' + (i === this.active ? ' active' : ''),
        attrs: { role: 'tab', 'aria-selected': String(i === this.active) },
        dataset: { boardId: t.boardId == null ? '' : String(t.boardId) },
        on: { click: () => this.activate(i) },
      }, [
        el('span.tab-name', { text: t.boardId == null ? '보드 선택' : (t.name || '보드') }),
        el('button.tab-x', {
          type: 'button', title: '탭 닫기', attrs: { 'aria-label': '탭 닫기' },
          on: { click: (e) => { e.stopPropagation(); this.closeTab(i); } },
        }, [icon(ICONS.close)]),
      ]);
      this.mount.append(tab);
    });
    this.mount.append(el('button.tab-add', {
      type: 'button', title: '새 보드 탭', attrs: { 'aria-label': '새 보드 탭' },
      on: { click: () => this.newLauncherTab() },
    }, [icon(ICONS.plus)]));
  }
}
