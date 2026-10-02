// 스모크 단계 'save-model' — electron/smoke/index.js가 순서대로 부른다. areas: 어느 코드를 고쳤을 때 돌릴지(index.js AREAS).
export default {
  name: 'save-model',
  areas: ["db"],
  async run({ target, BoardRepository, SMOKE_SEED, db, wrote }) {
    // 저장 = 보드가 본 것만 고친다 (docs/SAVE.md). 메인에서 저장소를 따로 하나 열어 확인한다 —
    // 탭 캐시 재현 2건, 조합(구성)이 태스크와 따로 저장되는지, 순환 거부, 공유 이벤트를 지키는 보드 삭제,
    // 휴지통(옛 것은 휴지통, 방금 만든 것은 바로 삭제, 구조째, 영구 삭제·비우기), 예시 로드맵 id 충돌.
    let saveModel = null;
    if (wrote) {
      try {
        const { prepare } = await import('../../../src/core/schema.js');
        const t = new BoardRepository(db);
        const openV = (id) => prepare(t.openView(id)).doc;              // 렌더러가 여는 것과 같게(기준 설정)
        const peek = (id) => { t.open(id); return prepare(t.load()).doc; };  // 기준을 안 건드리는 확인
        const save = (id, doc) => { t.open(id); return t.save(doc, 'smoke'); };
        const has = (id) => !!db.prepare('SELECT 1 FROM event WHERE id = ?').get(id);
        const A = t.createProject(prepare(structuredClone(SMOKE_SEED)).doc, 'S-A');
        const B = t.duplicateProject(A, 'S-B');
        let a = openV(A);
        const seedCollision = !a.items.some((i) => i.id === 'e10');   // 스모크 보드가 이미 e10을 쓴다
        const X = a.items.find((i) => i.ti === '1년차 과제 제출용 화면 구성');
        for (const it of a.items) if (['DT 개발', '3D 모델링'].includes(it.ti)) it.parent = X.id;
        save(A, a);
        const kidsOf = (d) => d.items.filter((i) => i.parent === X.id).length;

        // 재현 1 — 합치기 전의 B 캐시로 저장해도 A의 X 구조가 남고 없앤 Z가 되살아나지 않는다
        const bStale = openV(B);
        const Z = bStale.items.find((i) => !i.parent && i.ty !== 'ms');
        const bOnly = bStale.items.find((i) => i.id !== Z.id && !i.parent && i.ty !== 'ms').id;
        const merged = t.mergeEvents(X.id, Z.id).ok;
        bStale.items.find((i) => i.id === bOnly).note = 'stale';
        save(B, bStale);
        const stale1 = { merged, kids: kidsOf(peek(A)), zGone: !has(Z.id), xOnB: peek(B).items.some((i) => i.id === X.id) };

        // 재현 2 — 공유 X 안에 A에서 하위 추가 → B가 영향받음 표시, 낡은 B 저장이 그 하위를 안 지운다
        a = openV(A);
        const b = openV(B);
        a.items.push({ ...structuredClone(a.items.find((i) => i.id === X.id)), id: 'eSMOKEKID', ti: '공유 하위', parent: X.id, tasks: [] });
        const rA = save(A, a);
        b.items.find((i) => i.id === bOnly).note = 'stale2';
        save(B, b);
        const stale2 = { affectedB: rA.affected.includes(B), kept: db.prepare("SELECT count(*) n FROM containment WHERE child_id = 'eSMOKEKID'").get().n === 1 };

        // 조합(구성) — 다른 보드(B)의 이벤트 둘로 X를 이룬다. 구성으로 저장(태스크 아님), 다시 읽어도 doc.compose.
        // 같은 보드(A)의 이벤트는 조합할 수 없다 — 이미 A의 그래프 안이다(SYSTEM.md §7.1).
        a = openV(A);
        const bNow = peek(B);
        const parts = bNow.items.filter((i) => !i.parent && i.ty !== 'ms' && i.id !== bOnly && !a.items.some((k) => k.id === i.id)).slice(0, 2).map((i) => i.id);
        const sameA = a.items.filter((i) => !i.parent && i.id !== X.id && i.ty !== 'ms').slice(0, 2).map((i) => i.id);
        a.compose = [...(a.compose ?? []), ...parts.map((c) => ({ parent: X.id, child: c })), ...sameA.map((c) => ({ parent: X.id, child: c }))];
        const normalized = prepare(structuredClone(a)).doc;                  // 정규화가 같은 보드 조합을 끊는다
        save(A, a);                                                          // 정규화 없이 저장해도 저장이 뺀다
        const edgesC = db.prepare('SELECT ordered, compose FROM containment WHERE parent_id = ? AND child_id IN (?, ?)').all(X.id, ...parts);
        const back = peek(A);
        const compose = {
          stored: parts.length === 2 && edgesC.length === 2 && edgesC.every((e) => e.compose === 1 && e.ordered === 0),
          inDoc: parts.every((c) => back.compose.some((x) => x.parent === X.id && x.child === c)),
          notTasks: !back.items.find((i) => i.id === X.id).tasks.some((k) => parts.includes(k.id)),
          sameBoardDropped: !normalized.compose.some((x) => sameA.includes(x.child))
            && db.prepare('SELECT count(*) n FROM containment WHERE parent_id = ? AND compose = 1 AND child_id IN (?, ?)').get(X.id, ...sameA).n === 0,
        };
        // 같은 보드 조합이 옛 데이터로 DB에 남아 있으면 그 보드를 저장할 때 걷어 낸다
        db.prepare('INSERT OR IGNORE INTO containment (parent_id, child_id, ordered, compose, ord) VALUES (?, ?, 0, 1, 99)').run(X.id, sameA[0]);
        a = openV(A);
        a.items.find((i) => i.id === X.id).note = 'cleanup';
        save(A, a);
        compose.legacyCleaned = db.prepare('SELECT count(*) n FROM containment WHERE parent_id = ? AND child_id = ?').get(X.id, sameA[0]).n === 0;
        // 보드를 넘는 순환 — X를 품은 A 트랙을, B 카드가 조합으로 품고 그 B 카드를 X가 품으면 순환 → 거부
        const bb = openV(B);
        const loopCard = parts[0];
        bb.compose = [...(bb.compose ?? []), { parent: loopCard, child: a.items.find((i) => i.id === X.id).place.t }];
        compose.cycleRejected = save(B, bb).rejected.length === 1;

        // 보드 삭제 — B에만 있던 것은 지우고, A와 공유한 X와 그 안쪽 구조는 그대로
        const pre = t.deletePreview(B);
        t.deleteProject(B);
        a = peek(A);
        const del = { preShared: pre.shared >= 1, xKept: a.items.some((i) => i.id === X.id), kids: kidsOf(a), bOnlyGone: !has(bOnly) };

        // 휴지통 — 옛 카드를 빼면 휴지통, 방금 만든 카드를 빼면 바로 삭제, 카드를 빼면 구조째
        a = openV(A);
        const old = a.items.find((i) => !i.parent && i.ty !== 'ms' && i.id !== X.id && !parts.includes(i.id) && !a.items.some((k) => k.parent === i.id));
        a.items.push({ ...structuredClone(old), id: 'eSMOKEFRESH', ti: '실수로 만든 것', tasks: [], alias: null });
        save(A, a);
        a.items = a.items.filter((i) => i.id !== old.id && i.id !== 'eSMOKEFRESH');
        save(A, a);
        let trash = t.listTrash();
        const tr = { oldInTrash: trash.some((r) => r.id === old.id), freshGone: !has('eSMOKEFRESH') };
        a = openV(A);
        const inner = a.items.filter((i) => i.parent === X.id).map((i) => i.id);
        a.items = a.items.filter((i) => i.id !== X.id && !inner.includes(i.id));
        save(A, a);
        trash = t.listTrash();
        const xEntry = trash.find((r) => r.id === X.id);
        tr.structure = !!xEntry && xEntry.inside >= inner.length && !trash.some((r) => inner.includes(r.id));
        t.purgeTrash([old.id]);
        tr.purged = !has(old.id);
        t.emptyTrash();
        tr.emptied = t.listTrash().length === 0 && !has(X.id) && inner.every((id) => !has(id));
        t.deleteProject(A);
        const schema = db.pragma('user_version', { simple: true });
        saveModel = { seedCollision, stale1, stale2, compose, del, tr, schema };
        console.log('[smoke] save-model ' + JSON.stringify(saveModel));
      } catch (err) { console.log('[smoke] save-model FAIL ' + (err?.stack ?? err)); saveModel = { error: String(err) }; }
    }
    return saveModel;
  },
  check: (saveModel) => saveModel?.seedCollision === true
    && saveModel?.schema === 21
    && saveModel?.stale1?.merged === true
    && saveModel?.stale1?.kids === 2
    && saveModel?.stale1?.zGone === true
    && saveModel?.stale1?.xOnB === true
    && saveModel?.stale2?.affectedB === true
    && saveModel?.stale2?.kept === true
    && saveModel?.compose?.stored === true
    && saveModel?.compose?.inDoc === true
    && saveModel?.compose?.notTasks === true
    && saveModel?.compose?.sameBoardDropped === true
    && saveModel?.compose?.legacyCleaned === true
    && saveModel?.compose?.cycleRejected === true
    && saveModel?.del?.preShared === true
    && saveModel?.del?.xKept === true
    && saveModel?.del?.kids >= 2
    && saveModel?.del?.bOnlyGone === true
    && saveModel?.tr?.oldInTrash === true
    && saveModel?.tr?.freshGone === true
    && saveModel?.tr?.structure === true
    && saveModel?.tr?.purged === true
    && saveModel?.tr?.emptied === true,
};
