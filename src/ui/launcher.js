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
import { askText, askConfirm, askChoice } from './dialog.js';
import { openTrash } from './trash.js';
import { openHelp } from './help.js';

/**
 * 빈 보드 — 오늘이 속한 달부터 6개월, 트랙 3개.
 * scale이 'none'이면 날짜 없는 보드(일정은 칸만 가진다, docs/SCALE.md). 기간(meta)은 형식상 둔다.
 */
function blankDoc(name, scale = 'month-week') {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 6, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return {
    version: SCHEMA_VERSION,
    meta: {
      start: iso(start), end: iso(end), name,
      display: { scale, dated: scale !== 'none', slotUnit: null },
    },
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
  constructor({ adapter, onOpen, onRenamed, onDeleted, onGraph }) {
    this.adapter = adapter;
    this.onOpen = onOpen;
    this.onRenamed = onRenamed;
    this.onDeleted = onDeleted;
    this.root = $('launcher');
    this._query = '';
    this._sort = 'recent';       // recent | name | manual
    this._projects = [];

    $('l-new-blank').addEventListener('click', () => this.#create());
    $('l-close').addEventListener('click', () => this.hide());
    // 보드에 들어가지 않아도 테마를 바꿀 수 있어야 한다
    $('l-theme').addEventListener('click', () => toggleTheme());
    // 휴지통 — 목록을 바로 펼치지 않고 팝업으로만 (docs/SAVE.md §7)
    $('l-trash').hidden = !adapter.hasTrash;
    $('l-trash').addEventListener('click', () => openTrash(this.adapter));
    // 도움말 — 프로그램 사용법(docs/HELP.md)을 팝업으로
    $('l-help').addEventListener('click', () => openHelp());
    // 그래프 — 보드를 열지 않아도 모든 이벤트를 본다(그래프는 보드가 아니라 저장소 전체를 그린다)
    $('l-graph').hidden = !onGraph;
    $('l-graph').addEventListener('click', () => onGraph?.());

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
    const period = p.dated === false ? '날짜 없는 보드'
      : p.start && p.end
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
    // 눈금 — 표시 방식이라 나중에 설정에서 바꿀 수 있다. 단 '눈금 없음'은 날짜 없는 보드가 된다.
    const scale = await askChoice({
      title: '세로축 눈금',
      message: '나중에 설정 › 표시에서 바꿀 수 있습니다.',
      choices: [
        { key: 'month-week', label: '월-주 (기본)', sub: '한 줄 = 1주 · 왼쪽 칸 = 월' },
        { key: 'week-day', label: '주-일', sub: '한 줄 = 1일 · 왼쪽 칸 = 주' },
        { key: 'quarter-month', label: '분기-월', sub: '한 줄 = 1개월 · 왼쪽 칸 = 분기' },
        { key: 'none', label: '눈금 없음', sub: '날짜 없이 순서(칸)만. 나중에 눈금 설정으로 날짜를 매길 수 있습니다' },
      ],
    });
    if (!scale) return;

    try {
      const id = await this.adapter.createProject(blankDoc(name, scale), name);
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
    // 이 보드에만 담긴 일정은 함께 지우고, 다른 보드에도 놓인 일정은 남긴다(docs/SAVE.md §7).
    let pre = null;
    try { pre = await this.adapter.deletePreview?.(p.id); } catch { pre = null; }
    const items = pre ? pre.items : p.items;
    const kept = pre?.shared ? `다른 보드에도 있는 ${pre.shared}건은 남습니다. ` : '';
    const detail = (items ? `일정 ${items}건이 함께 사라집니다. ` : '') + kept;
    const ok = await askConfirm({
      title: '보드 삭제', confirmLabel: '삭제', danger: true,
      message: `'${p.name}'을(를) 삭제합니다. ${detail}되돌릴 수 없습니다.`,
    });
    if (!ok) return;
    await this.adapter.deleteProject(p.id);
    this.onDeleted?.(p.id);
    await this.render();
    toast('삭제했습니다');
  }
}
