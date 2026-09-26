/**
 * 보드 탭 — 여러 보드를 동시에 열어 두고 오간다 (브라우저 탭 구성).
 *
 * 한 번에 하나의 보드만 그려지므로 Store/Board를 여럿 두지 않는다. 대신 열린 보드의
 * 문서(doc)를 **메모리에 그대로 들고** 있다가, 탭을 바꾸면 DB를 다시 읽지 않고 그 문서로
 * 즉시 갈아끼운다(리로드 없음 → 빠르고, 만지던 상태가 날아가지 않는다). 규칙 12.
 *
 * 실시간 반영: 같은 이벤트(동일 id)가 여러 보드에 놓여 있으면, 활성 보드에서 바꾼 본질을
 * 열려 있는 다른 탭의 같은 이벤트에도 즉시 퍼뜨린다(협업 도구의 공유 상태처럼). 동일(same)
 * 관계는 서로 다른 이벤트를 잇는 것이라 본질을 복사하지 않는다 — 각자 제목을 지킨다.
 *
 *   +          새 보드 선택 탭
 *   탭 클릭    그 보드로 전환 (캐시가 있으면 즉시)
 *   탭 ×       탭 닫기 (마지막 하나면 선택 화면으로)
 */
import { $, el, clear, icon, ICONS } from './dom.js';

/** 본질(공유되는 것). 별칭·좌표·부모는 배치라 제외. */
const ESSENCE = ['ti', 's', 'e', 'ty', 'st', 'og', 'pg', 'note'];

export class BoardTabs {
  /**
   * @param {object} o
   * @param {HTMLElement} o.mount        탭줄 컨테이너 (#tabbar)
   * @param {import('./launcher.js').Launcher} o.launcher
   * @param {(id:number)=>Promise<object>} o.openProject  DB에서 열고 adopt, 그 문서를 반환
   * @param {(doc:object)=>void} o.adoptCached           메모리 문서로 즉시 전환(DB 안 읽음)
   * @param {()=>object} o.getDoc         현재 활성 문서
   * @param {()=>string} o.boardName      현재 열린 보드 이름
   */
  constructor({ mount, launcher, openProject, adoptCached, getDoc, boardName }) {
    this.mount = mount;
    this.launcher = launcher;
    this.openProject = openProject;
    this.adoptCached = adoptCached;
    this.getDoc = getDoc;
    this.boardName = boardName;
    this.tabs = [];        // [{ key, boardId:number|null, name }]
    this.active = -1;
    this.seq = 0;
    this.docs = new Map();  // boardId -> 메모리 문서(살아 있는 참조)
  }

  /** 처음엔 보드 선택 탭 하나. */
  init() {
    this.tabs = [{ key: (this.seq += 1), boardId: null, name: '보드 선택' }];
    this.active = 0;
    this.#apply();
  }

  #cur() { return this.tabs[this.active]; }

  /** 활성 탭을 떠나기 전, 그 보드의 현재 문서를 캐시에 붙들어 둔다. */
  #stash() {
    const t = this.#cur();
    if (t && t.boardId != null) this.docs.set(t.boardId, this.getDoc());
  }

  /** 활성 탭 상태에 맞춰 런처를 띄우거나 보드를 보인다. */
  async #apply() {
    const t = this.#cur();
    if (!t || t.boardId == null) {
      this.launcher.show({ closable: false });
      this.render();
      return;
    }
    const cached = this.docs.get(t.boardId);
    if (cached) {
      this.adoptCached(cached, t.boardId);    // 즉시 — DB 안 읽음, 저장 대상만 맞춘다
    } else {
      this.launcher.hide();                   // 런처를 먼저 내리고 로딩 표시(빈 보드 대신)
      const doc = await this.openProject(t.boardId);
      this.docs.set(t.boardId, doc);
    }
    t.name = this.boardName() || t.name;
    this.launcher.hide();
    this.render();
  }

  async activate(i) {
    if (i < 0 || i >= this.tabs.length) return;
    if (i === this.active) return;
    this.#stash();
    this.active = i;
    await this.#apply();
  }

  /** '+' — 새 보드 선택 탭. */
  newLauncherTab() {
    this.#stash();
    this.tabs.push({ key: (this.seq += 1), boardId: null, name: '보드 선택' });
    this.active = this.tabs.length - 1;
    this.#apply();
  }

  /**
   * 보드를 연다. 이미 열려 있으면 그 탭으로, 활성 탭이 선택 화면이면 그 자리에서,
   * 아니면 새 탭으로. (런처에서 고르거나, 카드에서 링크된 보드로 드릴인할 때.)
   */
  async openBoard(id) {
    const found = this.tabs.findIndex((t) => t.boardId === id);
    if (found >= 0) { await this.activate(found); return; }
    this.#stash();
    const cur = this.#cur();
    if (cur && cur.boardId == null) {
      cur.boardId = id;
    } else {
      this.tabs.push({ key: (this.seq += 1), boardId: id, name: '보드' });
      this.active = this.tabs.length - 1;
    }
    await this.#apply();
  }

  closeTab(i) {
    if (i < 0 || i >= this.tabs.length) return;
    const [gone] = this.tabs.splice(i, 1);
    if (gone && gone.boardId != null) this.docs.delete(gone.boardId);
    if (!this.tabs.length) {
      this.tabs.push({ key: (this.seq += 1), boardId: null, name: '보드 선택' });
      this.active = 0;
    } else if (this.active > i || this.active >= this.tabs.length) {
      this.active = Math.max(0, this.active - 1);
    }
    this.#apply();
  }

  /** 보드가 삭제되면 그 탭도 닫고 캐시도 버린다. */
  boardClosed(id) {
    this.docs.delete(id);
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

  /**
   * 실시간 반영 — 활성 보드에서 바뀐 이벤트 본질을, 열려 있는 다른 탭의 '같은 이벤트'(동일
   * id)에만 퍼뜨린다. 동일(same) 관계로 묶인 다른 이벤트는 각자 이름을 지키므로 건드리지
   * 않는다(덮어쓰기 금지). 좌표·부모는 배치라 놔둔다.
   */
  syncFromActive() {
    const src = this.getDoc();
    if (!src || !Array.isArray(src.items)) return;
    const cur = this.#cur();
    const activeBoardId = cur ? cur.boardId : null;

    // '진짜 같은 이벤트'(같은 id로 여러 보드에 놓인 것)만 맞춘다. 동일(same) 관계는 서로 다른
    // 이벤트를 잇는 것이라 본질을 복사하지 않는다 — 각자 제목을 지킨다(덮어쓰기 금지).
    const essenceById = new Map();
    for (const it of src.items) essenceById.set(it.id, it);

    for (const [boardId, doc] of this.docs) {
      if (boardId === activeBoardId || !doc || !Array.isArray(doc.items)) continue;
      for (const it of doc.items) {
        const srcItem = essenceById.get(it.id);   // 오직 같은 id
        if (!srcItem || srcItem === it) continue;
        for (const k of ESSENCE) if (it[k] !== srcItem[k]) it[k] = srcItem[k];
      }
    }
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
