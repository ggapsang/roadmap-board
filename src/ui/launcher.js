/**
 * 프로젝트 목록 — 앱의 첫 화면.
 *
 * 이 도구는 Project Machina 전용이 아니다. 과제·연차마다 보드를 따로 두고
 * 여기서 골라 연다. 보드 하나가 프로젝트 하나이고, 서로 완전히 격리된다.
 */
import { SEED } from '../config/seed.js';
import { DEFAULT_ORGS } from '../config/index.js';
import { SCHEMA_VERSION } from '../core/schema.js';
import { $, el, clear, button, icon, ICONS } from './dom.js';
import { toast } from './toast.js';

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
  constructor({ adapter, onOpen }) {
    this.adapter = adapter;
    this.onOpen = onOpen;
    this.root = $('launcher');

    $('l-new-blank').addEventListener('click', () => this.#create('blank'));
    $('l-new-seed').addEventListener('click', () => this.#create('seed'));
    $('l-close').addEventListener('click', () => this.hide());
  }

  get visible() { return !this.root.hidden; }

  async show({ closable = false } = {}) {
    this.root.hidden = false;
    $('l-close').hidden = !closable;
    await this.render();
  }

  hide() { this.root.hidden = true; }

  async render() {
    const list = $('l-list');
    clear(list);

    let projects = [];
    try {
      projects = await this.adapter.listProjects();
    } catch (err) {
      list.append(el('p.note', { text: '목록을 읽지 못했습니다: ' + err.message }));
      return;
    }

    $('l-empty').hidden = projects.length > 0;

    for (const p of projects) {
      list.append(this.#card(p));
    }
  }

  #card(p) {
    const period = p.start && p.end
      ? `${String(p.start).replace(/-/g, '.')} — ${String(p.end).replace(/-/g, '.')}`
      : '기간 미설정';

    const open = () => this.#open(p.id);

    const card = el('div.pcard', {
      tabIndex: 0,
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
        button({ className: 'btn', label: '열기', onClick: open }),
        button({ className: 'mini', iconPath: ICONS.copy, title: '복제', onClick: () => this.#duplicate(p) }),
        button({ className: 'mini', iconPath: ICONS.pencil, title: '이름 변경', onClick: () => this.#rename(p) }),
        button({ className: 'mini', iconPath: ICONS.trash, title: '삭제', onClick: () => this.#delete(p) }),
      ]),
    ]);
    return card;
  }

  async #open(id) {
    try {
      await this.onOpen(id);
      this.hide();
    } catch (err) {
      toast('프로젝트를 열지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #create(kind) {
    const fallback = kind === 'seed' ? SEED.meta.name : '새 프로젝트';
    const name = (prompt('프로젝트 이름', fallback) ?? '').trim();
    if (!name) return;

    const doc = kind === 'seed'
      ? { ...structuredClone(SEED), meta: { ...SEED.meta, name } }
      : blankDoc(name);

    try {
      const id = await this.adapter.createProject(doc, name);
      await this.#open(id);
    } catch (err) {
      toast('만들지 못했습니다: ' + err.message, 'warn');
    }
  }

  async #rename(p) {
    const name = (prompt('프로젝트 이름', p.name) ?? '').trim();
    if (!name || name === p.name) return;
    await this.adapter.renameProject(p.id, name);
    await this.render();
  }

  async #duplicate(p) {
    const name = (prompt('사본 이름', `${p.name} 사본`) ?? '').trim();
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
    const detail = p.items ? `일정 ${p.items}건이 함께 사라집니다.` : '';
    if (!confirm(`'${p.name}'을(를) 삭제합니다. ${detail} 되돌릴 수 없습니다. 계속할까요?`)) return;
    await this.adapter.deleteProject(p.id);
    await this.render();
    toast('삭제했습니다');
  }
}
