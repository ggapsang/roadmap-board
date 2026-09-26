/**
 * 프로젝트 목록 — 앱의 첫 화면.
 *
 * 무엇을 프로젝트 단위로 삼을지는 쓰는 사람이 정한다. 과제별로 나누든
 * 연차별로 나누든 상관없다. 목록의 항목끼리는 서로 완전히 격리된다.
 *
 * 이름을 묻는 자리는 window.prompt가 아니라 askText를 쓴다 —
 * Electron은 prompt()를 지원하지 않는다.
 */
import { DEFAULT_ORGS } from '../config/index.js';
import { SCHEMA_VERSION } from '../core/schema.js';
import { $, el, clear, button, icon, ICONS } from './dom.js';
import { toast } from './toast.js';
import { toggleTheme } from './theme.js';
import { askText, askConfirm } from './dialog.js';

/** 빈 보드 — 오늘이 속한 달부터 6개월, 트랙 3개 */
function blankDoc(name) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 6, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return {
    version: SCHEMA_VERSION,
    meta: { start: iso(start), end: iso(end), name },
    orgs: [...DEFAULT_ORGS],
    tracks: [
      { id: 't0', lab: '', name: '트랙 1' },
      { id: 't1', lab: '', name: '트랙 2' },
      { id: 't2', lab: '', name: '트랙 3' },
    ],
    items: [],
  };
}

export class Launcher {
  /**
   * @param {object} opts
   * @param {import('../core/storage.js').StorageAdapter} opts.adapter
   * @param {(id:number) => Promise<void>} opts.onOpen
   */
  constructor({ adapter, onOpen, onRenamed }) {
    this.adapter = adapter;
    this.onOpen = onOpen;
    this.onRenamed = onRenamed;
    this.root = $('launcher');
    this._query = '';
    this._sort = 'recent';       // recent | name | manual
    this._projects = [];

    $('l-new-blank').addEventListener('click', () => this.#create());
    $('l-close').addEventListener('click', () => this.hide());
    // 보드에 들어가지 않아도 테마를 바꿀 수 있어야 한다
    $('l-theme').addEventListener('click', () => toggleTheme());

    $('l-search').addEventListener('input', (e) => { this._query = e.target.value; this.#paint(); });
    $('l-sort').addEventListener('change', (e) => { this._sort = e.target.value; this.#paint(); });
  }

  get visible() { return !this.root.hidden; }

  async show({ closable = false } = {}) {
    this.root.hidden = false;
    $('l-close').hidden = !closable;
    await this.render();
  }

  hide() { this.root.hidden = true; }

  async render() {
    try {
      this._projects = await this.adapter.listProjects();
    } catch (err) {
      clear($('l-list'));
      $('l-list').append(el('p.note', { text: '목록을 읽지 못했습니다: ' + err.message }));
      return;
    }
    this.#paint();
  }

  /** 검색·정렬을 적용해 목록을 다시 그린다 (네트워크 없이 즉석). */
  #paint() {
    const list = $('l-list');
    clear(list);
    $('l-empty').hidden = this._projects.length > 0;

    const q = this._query.trim().toLowerCase();
    let rows = this._projects.filter((p) => !q || (p.name || '').toLowerCase().includes(q));
    if (this._sort === 'name') {
      rows = rows.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    } else if (this._sort === 'manual') {
      rows = rows.slice().sort((a, b) => (a.ord ?? 1e9) - (b.ord ?? 1e9) || a.id - b.id);
    } else {
      rows = rows.slice().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    }

    // 드래그는 항상 가능하다 — 끌어 옮기는 순간 그게 수동 순서가 된다(수동 옵션을 따로 두지 않음).
    list.classList.add('reorder');
    for (const p of rows) list.append(this.#card(p));
  }

  #card(p) {
    const period = p.start && p.end
      ? `${String(p.start).replace(/-/g, '.')} — ${String(p.end).replace(/-/g, '.')}`
      : '기간 미설정';

    const open = () => this.#open(p.id);

    const card = el('div.pcard', {
      tabIndex: 0,
      dataset: { id: String(p.id) },
      on: {
        click: (e) => { if (!e.target.closest('.pcard-actions')) open(); },
        keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } },
      },
    }, [
      el('div.pcard-main', {}, [
        el('div.pcard-name', { text: p.name || '이름 없는 프로젝트' }),
        el('div.pcard-meta', { text: `${period} · 일정 ${p.items ?? 0}건 · 트랙 ${p.tracks ?? 0}개` }),
        p.updatedAt ? el('div.pcard-meta', { text: `마지막 저장 ${p.updatedAt}` }) : null,
      ]),
      el('div.pcard-actions', {}, [
        button({ className: 'btn outline', label: '열기', onClick: open }),
        button({ className: 'mini', iconPath: ICONS.copy, title: '복제', onClick: () => this.#duplicate(p) }),
        button({ className: 'mini', iconPath: ICONS.pencil, title: '이름 변경', onClick: () => this.#rename(p) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.#delete(p) }),
      ]),
    ]);
    this.#makeDraggable(card);
    return card;
  }

  /** 카드를 끌어 재배치. 끌어 옮기는 순간 정렬이 '수동'이 되고, 놓으면 순서를 저장한다. */
  #makeDraggable(card) {
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      this._sort = 'manual';   // 드래그한 순간부터 이 순서가 수동 순서다
      $('l-sort').selectedIndex = -1;
      const ids = [...$('l-list').querySelectorAll('.pcard')].map((c) => Number(c.dataset.id));
      // 화면 순서를 캐시에도 반영하고 저장한다.
      this._projects.forEach((p) => { p.ord = ids.indexOf(p.id); });
      this.adapter.reorderProjects(ids).catch((err) => toast('순서 저장 실패: ' + err.message, 'warn'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = $('l-list').querySelector('.pcard.dragging');
      if (!dragging || dragging === card) return;
      const rect = card.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      card.parentNode.insertBefore(dragging, after ? card.nextSibling : card);
    });
  }

  async #open(id) {
    try {
      await this.onOpen(id);
      this.hide();
    } catch (err) {
      toast('프로젝트를 열지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #create() {
    const name = await askText({
      title: '새 보드',
      label: '이름',
      value: '새 보드',
      confirmLabel: '만들기',
    });
    if (!name) return;

    try {
      const id = await this.adapter.createProject(blankDoc(name), name);
      await this.#open(id);
    } catch (err) {
      toast('만들지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #rename(p) {
    const name = await askText({
      title: '이름 변경', label: '보드 이름', value: p.name, confirmLabel: '변경',
    });
    if (!name || name === p.name) return;
    try {
      await this.adapter.renameProject(p.id, name);
      // 열려 있는 프로젝트라면 화면의 문서도 맞춰 준다.
      // 안 그러면 다음 저장 때 옛 이름이 다시 덮어쓴다.
      this.onRenamed?.(p.id, name);
      await this.render();
      toast('이름을 바꿨습니다');
    } catch (err) {
      toast('바꾸지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #duplicate(p) {
    const name = await askText({
      title: '보드 복제', label: '사본 이름', value: `${p.name} 사본`, confirmLabel: '복제',
    });
    if (!name) return;
    try {
      await this.adapter.duplicateProject(p.id, name);
      await this.render();
      toast('복제했습니다');
    } catch (err) {
      toast('복제하지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #delete(p) {
    const detail = p.items ? `일정 ${p.items}건이 함께 사라집니다. ` : '';
    const ok = await askConfirm({
      title: '보드 삭제', confirmLabel: '삭제', danger: true,
      message: `'${p.name}'을(를) 삭제합니다. ${detail}되돌릴 수 없습니다.`,
    });
    if (!ok) return;
    await this.adapter.deleteProject(p.id);
    await this.render();
    toast('삭제했습니다');
  }
}
