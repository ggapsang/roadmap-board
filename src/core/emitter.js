/** 최소 pub/sub. 구독 해제 함수를 돌려준다. */
export class Emitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.#handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.#handlers.get(event) ?? []) {
      try { fn(payload); } catch (err) { console.error(`[${event}] 핸들러 오류`, err); }
    }
  }
}
