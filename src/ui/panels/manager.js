/**
 * 우측 슬라이드 패널 전환. 한 번에 하나만 열린다.
 *
 * 패널은 본문을 덮지 않고 밀어내므로 모달이 아니다. 따라서 클릭 차단막(scrim)을
 * 두지 않는다. 차단막이 있으면 보드의 첫 클릭이 카드가 아니라 차단막에 먹혀
 * 패널이 닫히고, 같은 카드를 두 번 눌러야 열리는 것처럼 보인다.
 */
import { $ } from '../dom.js';

const PANEL_WIDTH_KEY = 'wolfpack-panel-width';

export class PanelManager {
  constructor(onClose, onReflow) {
    this.onClose = onClose;
    this.onReflow = onReflow;
    this.current = null;
    /** 고정하면 빈 곳을 눌러도, Esc를 눌러도 닫히지 않는다 */
    this.pinned = false;

    for (const btn of document.querySelectorAll('[data-close]')) {
      btn.addEventListener('click', () => this.close({ force: true }));
    }
    for (const btn of document.querySelectorAll('[data-pin]')) {
      btn.addEventListener('click', () => this.togglePin());
    }
    this.#attachResize();
  }

  /**
   * 패널 폭 조절. 트랙 이름처럼 긴 값이 잘리면 넓혀 쓴다.
   * 폭은 화면 상태라 문서에 저장하지 않고 브라우저에만 기억한다.
   */
  #attachResize() {
    const MIN = 300, MAX = 720;
    let saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN && saved <= MAX) this.#setWidth(saved);

    for (const panel of document.querySelectorAll('.panel')) {
      const handle = document.createElement('div');
      handle.className = 'panel-resize';
      handle.title = '끌어서 패널 폭 조절';
      panel.prepend(handle);

      handle.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        handle.setPointerCapture(ev.pointerId);
        handle.classList.add('dragging');
        const startX = ev.clientX;
        const startW = panel.getBoundingClientRect().width;

        const move = (e) => {
          const next = Math.min(MAX, Math.max(MIN, startW + (startX - e.clientX)));
          this.#setWidth(next);
        };
        const up = () => {
          handle.classList.remove('dragging');
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          try { localStorage.setItem(PANEL_WIDTH_KEY, String(this.width)); } catch { /* noop */ }
          this.#reflow();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    }
  }

  #setWidth(px) {
    this.width = Math.round(px);
    document.body.style.setProperty('--panel-size', this.width + 'px');
  }

  togglePin() {
    this.pinned = !this.pinned;
    for (const btn of document.querySelectorAll('[data-pin]')) {
      btn.setAttribute('aria-pressed', String(this.pinned));
      btn.title = this.pinned ? '고정 해제' : '패널 고정 (닫히지 않게)';
    }
    return this.pinned;
  }

  open(id) {
    const wasOpen = this.current !== null;
    for (const p of document.querySelectorAll('.panel')) p.classList.toggle('open', p.id === id);
    document.body.classList.add('panel-open');
    this.current = id;
    // 이미 열려 있었다면 폭이 그대로라 다시 잴 필요가 없다
    if (!wasOpen) this.#reflow();
  }

  /** @param {{force?: boolean}} opts force면 고정 상태여도 닫는다 */
  close({ force = false } = {}) {
    if (this.pinned && !force) return false;
    for (const p of document.querySelectorAll('.panel')) p.classList.remove('open');
    document.body.classList.remove('panel-open');
    this.current = null;
    this.onClose?.();
    this.#reflow();
    return true;
  }

  /** 본문 폭이 바뀌었으니 좌표를 다시 읽어야 하는 것들에 알린다 (화살표 등) */
  #reflow() {
    this.onReflow?.();
    // 트랜지션이 끝난 뒤 최종 폭으로 한 번 더
    clearTimeout(this._t);
    this._t = setTimeout(() => this.onReflow?.(), 200);
  }

  get isOpen() { return this.current !== null; }
}
