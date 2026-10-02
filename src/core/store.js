/**
 * 문서 상태 저장소.
 *
 * 분리 원칙: 여기 담기는 것은 **저장·공유되는 문서**뿐이다.
 * 선택·필터·검색어·확대 배율 같은 화면 상태는 ViewState(view.js)로 뺀다.
 * 그래야 되돌리기가 "내가 고친 일정"만 되돌리고 화면 상태를 흔들지 않는다.
 *
 * 변경은 전부 commit()/transaction()을 통과한다. 그 지점에서만
 *   스냅샷 push → 변경 → 저장 → 'change' 발행
 * 이 일어나므로, 나중에 서버 동기화나 부분 렌더를 붙일 자리가 한 곳으로 모인다.
 */
import { Emitter } from './emitter.js';
import { prepare, SCHEMA_VERSION } from './schema.js';
import { UNDO_LIMIT } from '../config/index.js';

export class Store extends Emitter {
  #doc;
  #undo = [];
  #redo = [];
  #tx = null;          // 진행 중인 트랜잭션 {label, snapshot}
  #group = null;       // 마지막 commit의 묶음 이름 — 같은 이름이 이어지면 되돌리기 한 단계로 합친다
  #adapter;

  constructor({ adapter, doc }) {
    super();
    /** 문서가 바뀐 횟수 — 'change'마다 하나씩(되돌리기·교체 포함). 화면 크기만 바뀐 그리기와 가를 때 쓴다(화살표 모양 유지). */
    this.rev = 0;
    this.on('change', () => { this.rev += 1; });
    this.#adapter = adapter;
    this.#doc = doc;
  }

  /** 읽기 전용으로 다루는 게 원칙. 변경은 commit() 안에서만. */
  get doc() { return this.#doc; }
  get version() { return SCHEMA_VERSION; }
  get readonly() { return this.#adapter.readonly; }

  get tracks() { return this.#doc.tracks; }
  get orgs() { return this.#doc.orgs; }
  get items() { return this.#doc.items; }
  get relations() { return this.#doc.relations ?? []; }
  get meta() { return this.#doc.meta; }

  item(id) { return this.#doc.items.find((i) => i.id === id) ?? null; }
  track(id) { return this.#doc.tracks.find((t) => t.id === id) ?? null; }
  trackIndex(id) { return this.#doc.tracks.findIndex((t) => t.id === id); }

  // ── 변경 ────────────────────────────────────────────────

  /**
   * 되돌리기 1단위 변경.
   * 아무것도 바꾸지 않은 commit은 되돌리기 기록에 남기지 않는다 — 남기면 Ctrl+Z가 '아무 일도 안 하는' 단계를 먹는다
   * (예: 제목을 입력하는 동안 이미 반영했는데 칸을 떠날 때 패널이 같은 값으로 한 번 더 commit).
   * @param {string} label 되돌리기 설명 (향후 변경 이력/P2용)
   * @param {(doc: object) => void} mutate
   * @param {{group?: string|null}} [opts] group — 같은 이름의 commit이 다른 변경 없이 이어지면 되돌리기 한 단계로 합친다.
   *   입력 칸 하나를 한 번 고친 것(들어가서 나올 때까지, 글자마다 commit) = 한 단계. ui/dom.js editGroup()이 이름을 준다.
   */
  commit(label, mutate, { group = null } = {}) {
    if (this.readonly) return;
    if (this.#tx) { mutate(this.#doc); this.#touch(label); return; }
    const before = JSON.stringify(this.#doc);
    mutate(this.#doc);
    if (JSON.stringify(this.#doc) === before) { this.emit('change', { label, reason: 'commit' }); return; }
    if (!group || group !== this.#group) this.#pushSnapshot(before);
    this.#group = group;
    this.#touch(label);
  }

  /**
   * 드래그처럼 연속 변경을 되돌리기 1단계로 묶는다.
   * begin() 시점에 스냅샷 1회만 남긴다 (기획안 §5 저장 규칙).
   */
  begin(label) {
    if (this.readonly || this.#tx) return;
    this.#group = null;
    this.#pushUndo();
    this.#tx = { label };
  }

  end() {
    if (!this.#tx) return;
    const { label } = this.#tx;
    this.#tx = null;
    this.#persist();
    this.emit('change', { label, reason: 'commit' });
  }

  /** 트랜잭션 중이면 저장·발행을 미룬다 (드래그 중 매 프레임 저장 방지) */
  #touch(label) {
    if (this.#tx) { this.emit('change', { label, reason: 'transient' }); return; }
    this.#persist();
    this.emit('change', { label, reason: 'commit' });
  }

  // ── 되돌리기 ────────────────────────────────────────────

  #pushUndo() { this.#pushSnapshot(JSON.stringify(this.#doc)); }

  #pushSnapshot(json) {
    this.#undo.push(json);
    if (this.#undo.length > UNDO_LIMIT) this.#undo.shift();
    this.#redo.length = 0;
  }

  get canUndo() { return this.#undo.length > 0; }
  get canRedo() { return this.#redo.length > 0; }

  undo() {
    if (!this.#undo.length) return false;
    this.#group = null;
    this.#redo.push(JSON.stringify(this.#doc));
    this.#doc = JSON.parse(this.#undo.pop());
    this.#persist();
    this.emit('change', { reason: 'undo' });
    return true;
  }

  redo() {
    if (!this.#redo.length) return false;
    this.#group = null;
    this.#undo.push(JSON.stringify(this.#doc));
    this.#doc = JSON.parse(this.#redo.pop());
    this.#persist();
    this.emit('change', { reason: 'redo' });
    return true;
  }

  // ── 문서 교체 ───────────────────────────────────────────

  /**
   * JSON 붙여넣기 / 기본 로드맵 복원 등 문서 전체 교체.
   * @returns {{ok: boolean, error: string|null, warnings: string[]}}
   */
  replace(raw, label = '문서 교체') {
    if (this.readonly) return { ok: false, error: '읽기 전용입니다.', warnings: [] };
    const { doc, warnings, error } = prepare(raw);
    if (error) return { ok: false, error, warnings };
    this.#group = null;
    this.#pushUndo();
    this.#doc = doc;
    this.#persist();
    this.emit('change', { label, reason: 'replace' });
    return { ok: true, error: null, warnings };
  }

  /**
   * 다른 프로젝트를 연다. 문서를 통째로 갈아끼우고 되돌리기 스택을 비운다.
   * replace()와 달리 되돌리기 대상이 아니다 — 프로젝트 A에서 Ctrl+Z를 눌렀을 때
   * 프로젝트 B의 내용이 나오면 안 된다.
   */
  adopt(doc) {
    this.#doc = doc;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#tx = null;
    this.#group = null;
    this.emit('change', { label: '프로젝트 열기', reason: 'adopt' });
  }

  /** 직렬화 — 데이터 패널 · 반출용 */
  toJSON(space = 1) { return JSON.stringify(this.#doc, null, space); }

  #persist() {
    this.#adapter.save(this.#doc).catch((err) => {
      this.emit('error', err instanceof Error ? err.message : String(err));
    });
  }
}
