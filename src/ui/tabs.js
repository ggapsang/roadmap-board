/**
 * 보드 탭 — 여러 보드를 동시에 열어 두고 오간다 (브라우저 탭 구성).
 *
 * 한 번에 하나의 보드만 그려지므로 Store/Board를 여럿 두지 않는다. 대신 열린 보드의
 * 문서(doc)를 **메모리에 그대로 들고** 있다가, 탭을 바꾸면 DB를 다시 읽지 않고 그 문서로
 * 즉시 갈아끼운다(리로드 없음 → 빠르고, 만지던 상태가 날아가지 않는다). 규칙 12.
 *
 * 실시간 반영: 저장이 다른 보드의 화면을 바꾸면(같은 이벤트가 여러 보드에 놓인 경우) 메인이
 * 그 보드들을 알려 주고, 그 탭 캐시를 '낡음'으로 표시한다. 낡은 탭은 돌아갈 때 DB에서 다시 읽는다.
 * 영향이 없으면 캐시로 즉시 전환한다 (docs/SAVE.md §6). 다른 탭 문서를 직접 고치지 않는다(규약 2).
 *
 *   +          새 보드 선택 탭
 *   탭 클릭    그 보드로 전환 (캐시가 있으면 즉시)
 *   탭 끌기    순서 바꾸기 (브라우저처럼)
 *   탭 ×       탭 닫기 (마지막 하나면 선택 화면으로)
 *
 * 탭은 세 종류다 — 보드 선택(boardId null), 보드(boardId), 그래프(kind 'graph'). 그래프 탭은 보드 탭이 아니다
 * (boardId는 늘 null — 보드 문서·낡음 표시와 무관). 범위(scope)마다 하나씩 연다: 첫 화면에서 연 전체(scope null),
 * 보드에서 연 '그 보드가 품은 것 + 한 걸음'(scope = 보드 id).
 */
import { $, el, clear, icon, ICONS } from './dom.js';
import { attachTabReorder } from './reorder.js';

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
  constructor({ mount, launcher, graph, openProject, adoptCached, getDoc, boardName }) {
    this.mount = mount;
    this.launcher = launcher;
    this.graph = graph;    // 그래프 뷰 — show()/hide({reset}) (보드와 무관)
    this.openProject = openProject;
    this.adoptCached = adoptCached;
    this.getDoc = getDoc;
    this.boardName = boardName;
    this.tabs = [];        // [{ key, boardId:number|null, name, kind?:'graph' }]
    this.active = -1;
    this.seq = 0;
    this.docs = new Map();  // boardId -> 메모리 문서(살아 있는 참조)
    this.stale = new Set(); // 다른 보드의 저장·합치기로 화면이 달라진 보드 — 돌아갈 때 다시 읽는다
    // 탭을 끌어 순서를 바꾼다. 탭 요소는 render마다 새로 그려지므로 컨테이너(mount)에 붙인다.
    attachTabReorder(mount, { item: '.tab', exclude: '.tab-x', onReorder: (from, to) => this.move(from, to) });
  }

  /** 탭 순서 바꾸기 — 활성 탭은 그대로 활성으로 따라간다. 보드 전환은 일어나지 않는다. */
  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length) return;
    const activeTab = this.tabs[this.active];
    const [t] = this.tabs.splice(from, 1);
    this.tabs.splice(to, 0, t);
    this.active = this.tabs.indexOf(activeTab);
    this.render();
  }

  /** 처음엔 보드 선택 탭 하나. */
  init() {
    this.tabs = [{ key: (this.seq += 1), boardId: null, name: '보드 선택' }];
    this.active = 0;
    this.#apply();
  }

  #cur() { return this.tabs[this.active]; }

  /** 보드 선택 탭인가 (그래프 탭은 아니다) */
  #isPicker(t) { return !!t && t.boardId == null && t.kind !== 'graph'; }

  /** 그래프 탭이 지금 보이는가 — 그 동안 보드 단축키(되돌리기 등)는 먹지 않는다 */
  get graphActive() { return this.#cur()?.kind === 'graph'; }

  /** 활성 탭을 떠나기 전, 그 보드의 현재 문서를 캐시에 붙들어 둔다. */
  #stash() {
    const t = this.#cur();
    if (t && t.boardId != null) this.docs.set(t.boardId, this.getDoc());
  }

  /** 활성 탭 상태에 맞춰 런처를 띄우거나 보드를 보인다. */
  async #apply() {
    const t = this.#cur();
    if (t?.kind === 'graph') {                 // 보드와 무관 — 보드 문서는 그대로 두고 그래프만 보인다
      this.launcher.hide();
      this.render();
      await this.graph?.show({ scope: t.scope ?? null, name: t.name });
      return;
    }
    this.graph?.hide();
    if (!t || t.boardId == null) {
      this.launcher.show({ closable: false });
      this.render();
      return;
    }
    const cached = this.stale.has(t.boardId) ? null : this.docs.get(t.boardId);
    if (cached) {
      this.adoptCached(cached, t.boardId);    // 즉시 — DB 안 읽음, 저장 대상만 맞춘다
    } else {
      this.launcher.hide();                   // 런처를 먼저 내리고 로딩 표시(빈 보드 대신)
      const doc = await this.openProject(t.boardId);
      this.docs.set(t.boardId, doc);
      this.stale.delete(t.boardId);
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
   * 그래프 탭 — 범위마다 하나. 그 범위의 탭이 있으면 그 탭으로, 활성 탭이 보드 선택 화면이면 그 자리에서,
   * 아니면 새 탭으로. scope = 보드 id면 그 보드가 품은 것 + 한 걸음, null이면 전체.
   * @param {{scope?:number|null, name?:string}} [o] name은 탭 이름(보드 이름)
   */
  async openGraph({ scope = null, name = '' } = {}) {
    const found = this.tabs.findIndex((t) => t.kind === 'graph' && (t.scope ?? null) === scope);
    if (found >= 0) { this.tabs[found].name = name || this.tabs[found].name; await this.activate(found); return; }
    this.#stash();
    const cur = this.#cur();
    if (this.#isPicker(cur)) { cur.kind = 'graph'; cur.scope = scope; cur.name = name; }
    else {
      this.tabs.push({ key: (this.seq += 1), boardId: null, kind: 'graph', scope, name });
      this.active = this.tabs.length - 1;
    }
    await this.#apply();
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
    if (this.#isPicker(cur)) {
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
    if (gone && gone.boardId != null) { this.docs.delete(gone.boardId); this.stale.delete(gone.boardId); }
    if (gone?.kind === 'graph') this.graph?.hide({ reset: true, scope: gone.scope ?? null });   // 닫으면 그 범위는 다음엔 처음부터(결정적 배치)
    if (!this.tabs.length) {
      this.tabs.push({ key: (this.seq += 1), boardId: null, name: '보드 선택' });
      this.active = 0;
    } else if (this.active > i || this.active >= this.tabs.length) {
      this.active = Math.max(0, this.active - 1);
    }
    this.#apply();
  }

  /** 다른 보드의 저장이 이 보드들의 화면을 바꿨다 — 돌아갈 때 다시 읽는다. */
  markStale(ids) {
    const active = this.#cur()?.boardId;
    for (const id of ids ?? []) if (id !== active) this.stale.add(id);
  }

  /** 합치기처럼 DB 전체를 바꾼 뒤 — 활성 보드 말고는 전부 다시 읽게 한다. */
  markAllStale() {
    const active = this.#cur()?.boardId;
    for (const id of this.docs.keys()) if (id !== active) this.stale.add(id);
  }

  /** 활성 보드를 DB에서 다시 읽는다(캐시도 갈아끼운다). 합치기·되돌리기 뒤에 쓴다. */
  async reloadActive() {
    const t = this.#cur();
    if (!t || t.boardId == null) return;
    const doc = await this.openProject(t.boardId);
    this.docs.set(t.boardId, doc);
    this.stale.delete(t.boardId);
  }

  /** 보드가 삭제되면 그 탭도 닫고 캐시도 버린다. */
  boardClosed(id) {
    this.docs.delete(id);
    this.stale.delete(id);
    const i = this.tabs.findIndex((t) => t.boardId === id);
    if (i >= 0) this.closeTab(i);
  }

  /** 보드 이름이 바뀌면 탭 이름도 맞춘다. */
  renameBoard(id, name) {
    let hit = false;
    for (const t of this.tabs) if (t.boardId === id || (t.kind === 'graph' && t.scope === id)) { t.name = name; hit = true; }
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
        className: 'tab' + (i === this.active ? ' active' : '') + (t.kind === 'graph' ? ' tab-graph' : ''),
        attrs: { role: 'tab', 'aria-selected': String(i === this.active) },
        dataset: { boardId: t.boardId == null ? '' : String(t.boardId) },
        // 인덱스가 아니라 탭 자체로 찾는다 — 끌어 순서를 바꾼 뒤 옛 요소에 늦게 온 click이 엉뚱한 탭을 열지 않게
        on: { click: (e) => { if (e.currentTarget.isConnected) this.activate(this.tabs.indexOf(t)); } },
      }, [
        t.kind === 'graph' ? icon(ICONS.graph) : null,
        el('span.tab-name', { text: t.kind === 'graph' ? (t.scope == null ? '그래프' : `그래프 · ${t.name || '보드'}`)
          : t.boardId == null ? '보드 선택' : (t.name || '보드') }),
        el('button.tab-x', {
          type: 'button', title: '탭 닫기', attrs: { 'aria-label': '탭 닫기' },
          on: { click: (e) => { e.stopPropagation(); if (e.currentTarget.isConnected) this.closeTab(this.tabs.indexOf(t)); } },
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
