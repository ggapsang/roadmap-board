# Roadmap Board — 개발 규약

Project Machina 1차년도 실행계획을 시간축 위에서 편집·공유하는 보드.
기획안은 `refs/roadmap-board_기획안.md`, P0 단일 파일 시안은 `refs/index.html`에 있다.
**refs/ 는 읽기 전용 참고 자료다. 수정하지 않는다.**

## 실행

```
npm install
npm start          # 앱 실행
npm run dev        # 개발자 도구 함께
npm test           # 스모크 — 창을 띄워 렌더/저장 왕복을 확인하고 종료
npm start -- --db ./other.db   # DB 파일 지정
```

## 구조

```
electron/          메인 프로세스 — 창, IPC, SQLite
  main.js            app:// 프로토콜, IPC 핸들러, 메뉴, 스모크
  preload.cjs        contextBridge로 window.roadmapDB만 노출 (sandbox:true라 CJS)
  db/index.js        연결 + PRAGMA user_version 기반 마이그레이션
  db/repository.js   문서 <-> 정규화 테이블
  db/migrations/     NNN_*.sql — 번호 순 적용

src/               렌더러 (프레임워크 없음, ES 모듈)
  config/            상태·조직·배율 등 런타임 설정, 기본 로드맵(seed)
  core/              DOM을 모르는 순수 로직
    dates.js           날짜 (로컬 타임존 고정)
    schema.js          문서 버전 · 마이그레이션 · 정규화
    store.js           문서 상태 + 되돌리기 + 저장
    view.js            화면 상태 (필터/검색/배율/선택) — 저장도 undo도 안 됨
    layout.js          레인(겹침) 배치 — 순수 함수
    storage.js         저장소 어댑터 (Local / Electron / Memory)
  ui/                DOM 렌더
    board/             축 · 헤더 · 카드 · 화살표 · 드래그
    panels/            일정 편집 · 보드 구성(트랙+조직) · 데이터
```

## 지켜야 할 것

1. **문서 상태와 화면 상태를 섞지 않는다.** 저장·공유되는 것만 `Store`에.
   필터·검색어·배율·선택은 `ViewState`. 되돌리기가 화면을 흔들면 안 된다.
2. **변경은 전부 `store.commit()` / `store.begin()~end()`를 통과한다.**
   스냅샷·저장·이벤트 발행이 그 한 곳에만 있다.
3. **날짜는 로컬 타임존 `Date` + 일 단위 정수.** UTC 혼용 금지 (하루 밀림).
   종료일은 inclusive.
4. **사용자가 정하는 것을 코드에 박지 않는다.** 트랙 구성과 담당 조직 목록은
   문서 안에 있고 보드에서 편집한다. config의 `DEFAULT_ORGS`는 새 프로젝트
   초기값일 뿐이다. 트랙 축에 의미(요구사항/WP 등)를 강제하지 않는다.
5. **조직명을 바꾸면 참조도 바꾼다.** 트랙은 id 참조지만 조직은 `item.og`에
   문자열 값으로 들어간다 (반출 JSON 가독성을 위한 선택). 이름 변경·삭제 시
   해당 일정의 `og`를 함께 갱신해야 한다 — `ConfigPanel`이 그 일을 한다.
6. **색상은 시맨틱 토큰으로만.** `--accent`, `--text-secondary` 등.
   HEX 직접 사용 금지. 트랙별 임의 색상 금지 — 색은 상태를 뜻한다.
7. **간격·크기는 `--u1`~`--u10`에서만 고른다.** 4px 그리드.
8. **스키마를 바꾸면** `src/core/schema.js`의 `SCHEMA_VERSION`을 올리고
   `MIGRATIONS`에 함수를 추가한다. DB 스키마는 `migrations/`에 파일을 **추가**한다
   (기존 파일 수정 금지).
9. **화살표는 렌더 마지막에.** DOM 좌표를 읽으므로 컬럼 폭이 확정된 뒤여야 한다.
10. 저장소를 늘릴 때는 `StorageAdapter`를 구현하고 `createAdapter()`에 끼운다.
   그 아래 코드는 저장 위치를 몰라야 한다.

## 데이터

`src/config/seed.js`의 기본 로드맵은 실제 과제 일정이다. 임의로 바꾸지 않는다.
