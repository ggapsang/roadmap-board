# WOLFPACK Dark UI Design Guide --- Revised

> WOLFPACK 프로젝트 관리 보드의 Dark Theme 세부 디자인 가이드\
> 목적: 현재 구현 화면의 낮은 시인성과 높은 시각적 밀도를 개선하되, 기존
> WOLFPACK 디자인 가이드의 원칙을 유지한다.\
> 핵심 방향: 더 어둡게가 아니라, 더 명확하게.

------------------------------------------------------------------------

## 1. 결론

현재 Dark UI의 가장 큰 문제는 색상이 어둡다는 사실 자체가 아니다.

문제는 다음 요소들이 비슷한 명도 범위에 몰려 있다는 것이다.

``` text
Canvas
Track
Schedule Card
Border
Grid
Secondary Text
Dependency Line
```

그 결과 일정 카드와 배경 구조의 우선순위가 약해지고, 사용자가 화면을
읽기 위해 계속 경계를 찾아야 한다.

WOLFPACK Dark UI의 개선 방향은 다음과 같다.

``` text
1. Canvas와 Schedule의 명도 차이를 명확하게 만든다.
2. Schedule Card를 Border가 아니라 Surface로 인식하게 만든다.
3. Secondary Text의 시인성을 높인다.
4. Grid는 무조건 약화하지 않고, 정보 구조를 방해하지 않는 수준으로 조정한다.
5. Dependency Line은 평시에도 관계가 보일 정도로 유지하되 Hover/선택 시 강하게 강조한다.
6. Orange는 브랜드 장식이 아니라 중요한 상태와 현재 위치를 표시하는 신호로 제한한다.
7. Light/Dark에서 동일한 정보 구조와 컴포넌트 계층을 유지한다.
```

------------------------------------------------------------------------

## 2. 기존 디자인 가이드와의 관계

기존 가이드에서 정의한 다음 원칙은 유지한다.

``` text
Primary Orange: #F86517
Neutral / Stone 기반 색상 체계
6:3:1 색상 비율
Pretendard
Lucide
4px Base Grid
Status 색상
접근성 중심의 대비
```

Dark UI를 별도의 색상 체계로 다시 만드는 것이 아니라, 기존 Neutral 단계
사이의 명도 차이를 실제 컴포넌트 계층에 적용하는 것이 핵심이다.

------------------------------------------------------------------------

# 3. Surface Hierarchy

현재 구현에서 가장 먼저 수정할 부분이다.

권장 계층:

``` text
Canvas
  ↓
Track / Section
  ↓
Schedule Card
  ↓
Schedule Card Hover
  ↓
Selected / Focused
```

예시:

``` text
Canvas        #0F0E0D
Track         #151311
Card          #211E1C
Card Hover    #292522
Selected      #30261F
```

정확한 최종 HEX는 기존 Neutral 토큰에 맞춰 조정한다.

핵심은 각 단계가 실제 화면에서 육안으로 구분되어야 한다는 것이다.

------------------------------------------------------------------------

# 4. Canvas

Canvas는 가장 어두운 영역으로 유지한다.

권장:

``` text
Canvas = neutral-950 계열
```

하지만 완전한 Black에 가까운 화면 전체를 만드는 것은 피한다.

현재 화면처럼 Canvas와 Card의 명도 차이가 작으면 Card를 구분하기 위해
Border를 강하게 만들게 된다.

목표는 다음과 같다.

``` text
검은 배경
+
밝은 테두리
=
X

어두운 배경
+
한 단계 밝은 Surface
=
O
```

WOLFPACK의 Dark UI는 후자의 방식을 사용한다.

------------------------------------------------------------------------

# 5. Track / Section

Track 영역은 Canvas보다 한 단계 밝게 한다.

Track 자체가 별도의 거대한 패널처럼 보일 필요는 없다.

목적은 다음 두 가지다.

``` text
1. Track의 공간적 영역을 인식
2. Schedule Card와 Canvas 사이의 중간 Surface 제공
```

따라서 Track Background는 Card보다 어둡고 Canvas보다는 밝게 한다.

------------------------------------------------------------------------

# 6. Schedule Card

Schedule Card는 Dark UI의 핵심이다.

현재 화면에서 카드가 너무 어두워 Border를 통해서만 존재감이 생기는
문제가 있다.

이를 다음 구조로 변경한다.

``` text
Canvas
┌─────────────────────────────┐
│                             │
│  Schedule Card              │
│                             │
└─────────────────────────────┘
```

Card는 Canvas보다 확실하게 밝아야 한다.

### 기본 카드

``` text
Background    neutral-800 계열
Border        neutral-700~800 계열
Text          neutral-50
Secondary     neutral-400~500
```

### Hover

``` text
Background    Card보다 한 단계 밝게
Border        neutral-600
```

### Selected

``` text
Background    Card보다 약간 밝게
Border        Primary Orange
Accent        Primary Orange
```

Card의 선택 상태를 Orange 전체 배경으로 표현하지 않는다.

------------------------------------------------------------------------

# 7. Card Border

Border는 존재해야 하지만 Card를 만드는 주된 수단이 되어서는 안 된다.

우선순위:

``` text
Surface 차이
>
Spacing
>
Border
```

강한 Border는 다음 상태에서만 사용한다.

``` text
Selected
Focus
Drag Target
Important State
```

------------------------------------------------------------------------

# 8. Schedule Card Typography

현재 화면에서 가장 개선 효과가 큰 부분 중 하나다.

### Primary

일정 제목:

``` text
neutral-50 ~ neutral-100
SemiBold
```

### Secondary

기간 / 담당 / 카테고리:

``` text
neutral-300 ~ neutral-400
```

### Tertiary

보조 정보:

``` text
neutral-500
```

Dark UI에서도 다음 정보는 항상 읽을 수 있어야 한다.

``` text
기간
담당
상태
카테고리
마일스톤 정보
```

------------------------------------------------------------------------

# 9. Schedule Card Layout

현재처럼 중앙 정렬된 카드는 큰 일정이나 강조된 일정에서는 사용할 수
있다.

하지만 기본 Schedule Card는 다음 구조를 권장한다.

``` text
┌─────────────────────────┐
│ 일정 제목                │
│ 기간 · 담당              │
│ 상태 / 관련 정보         │
└─────────────────────────┘
```

기본 정렬:

``` text
Left
```

큰 대표 일정:

``` text
Center도 허용
```

즉 모든 카드를 강제로 같은 정렬로 만들기보다 정보 밀도에 따라 사용한다.

------------------------------------------------------------------------

# 10. Dependency Line

Dependency Line은 실제 데이터 관계를 표현한다는 전제로 한다.

따라서 평시에도 관계가 존재한다는 사실은 보여야 한다.

사용자 의견을 반영하여 다음을 기준으로 한다.

``` text
평시:
관계가 충분히 인식될 정도의 낮은 대비

Hover:
관련 Line과 연결된 Card를 명확하게 강조

Selected:
가장 강한 대비 + Primary 또는 상태 색상
```

### Normal

``` text
Line
neutral-600 ~ neutral-700
1px
```

### Hover

``` text
Line
neutral-400 ~ neutral-500
1.5px
```

필요하면 연결된 카드에도 약한 Highlight를 적용한다.

### Selected

``` text
Line
Primary Orange 또는 관계 상태 색상
2px 수준
```

핵심은 "평소에는 숨기고 Hover에서만 보여준다"가 아니다.

``` text
평시 = 관계의 존재를 보여준다.
Hover = 어떤 관계인지 보여준다.
Selected = 해당 관계를 집중해서 보여준다.
```

------------------------------------------------------------------------

# 11. Dependency Arrow

화살표 역시 Card보다 눈에 띄면 안 된다.

평시:

``` text
Stroke 낮은 대비
Fill 없음 또는 최소화
```

Hover:

``` text
Stroke 강화
Arrow Head 강화
연결된 Card Highlight
```

Selected:

``` text
Primary Orange
```

연결선이 많은 구간에서도 화면 전체가 선으로 가득 차 보이지 않아야 한다.

------------------------------------------------------------------------

# 12. Grid

Grid는 무조건 약하게 만드는 것이 목표가 아니다.

현재 사용자가 느끼는 문제는 Grid 자체보다 "Grid와 다른 정보의 대비
관계"일 가능성이 높다.

따라서 다음 원칙을 사용한다.

``` text
일반 Grid:
존재를 인식할 수 있지만 읽기의 주체가 되지 않는 수준

주요 시간 경계:
일반 Grid보다 한 단계 강함

오늘:
Primary Orange

선택된 시간:
강한 강조
```

즉 Grid를 일괄적으로 약화하기보다는 계층을 만든다.

### 권장 계층

``` text
Minor Grid       neutral-900 ~ neutral-800
Major Grid       neutral-800 ~ neutral-700
Today            Primary-500
Selected         Primary-500 + 강조
```

실제 대비는 화면 크기와 확대 수준에 따라 조정한다.

------------------------------------------------------------------------

# 13. Today Line

Today Line은 WOLFPACK에서 중요한 Navigation Anchor다.

기존 Primary Orange를 유지한다.

하지만 전체 화면을 가로지르는 선이 지나치게 강하면 다른 정보와 충돌한다.

권장:

``` text
Line       Primary Orange
Label      Primary Orange
Label BG   Dark Surface
```

Today Label은 선 위에 떠 있는 작은 Anchor처럼 만든다.

``` text
────────── [ 오늘 9.27 ] ──────────
```

현재처럼 오늘 날짜를 바로 찾을 수 있는 구조는 유지한다.

------------------------------------------------------------------------

# 14. Orange Usage

Primary Orange:

``` text
#F86517
```

사용 우선순위:

``` text
1. Today
2. Selected
3. Active / Progress
4. Primary CTA
5. Focus
6. Brand
```

사용하지 않는 영역:

``` text
일반 Card
일반 Track
일반 Grid
일반 Dependency
모든 Status
장식
```

Orange가 많아질수록 Orange 하나하나의 정보 가치가 떨어진다.

WOLFPACK에서 Orange는 "예쁜 색"이 아니라 "현재 중요한 것"을 의미해야
한다.

------------------------------------------------------------------------

# 15. Status Color

기존 Status Color 체계를 유지한다.

``` text
Success
Warning
Error
Primary
Neutral
```

Dark UI에서는 Status Color를 그대로 큰 면적으로 사용하지 않는다.

예:

``` text
X
████████████████
완료 일정

O
● 완료
```

또는

``` text
┌──────────────────┐
│ 일정 제목         │
│ ● 완료            │
└──────────────────┘
```

상태는 Indicator와 Label 중심으로 표현한다.

------------------------------------------------------------------------

# 16. Status Summary

상단의 상태 요약은 현재 구조를 유지한다.

다만 Dark UI에서는 숫자와 Label의 대비를 조금 더 명확하게 한다.

``` text
계획 22
진행중 6
완료 0
지연 0
보류 2
```

숫자:

``` text
neutral-100
```

Label:

``` text
neutral-400
```

Status Indicator:

``` text
각 상태 색상
```

상단 전체를 여러 색의 Badge로 만들지 않는다.

------------------------------------------------------------------------

# 17. Track Header

Track Header는 Schedule보다 상위 구조다.

따라서 Card보다 더 강한 텍스트 계층을 가질 수 있다.

권장:

``` text
Track 번호 / 그룹
Track 제목
일정 수
```

Background는 과도하게 강조하지 않는다.

Track Header 전체를 별도의 강한 Card처럼 만들지 않는다.

------------------------------------------------------------------------

# 18. Toolbar

Toolbar는 Dark UI에서 가장 쉽게 무거워지는 영역이다.

모든 버튼을 Border Button으로 만들지 않는다.

권장:

``` text
Primary:
Orange Filled

Secondary:
Neutral Surface

Low Priority:
Ghost

Icon:
Ghost
```

검색창은 충분한 명도 차이를 가진 Surface를 사용한다.

``` text
Background = neutral-800
Border = neutral-700
Placeholder = neutral-500
Text = neutral-100
```

------------------------------------------------------------------------

# 19. Toolbar Control Density

현재 화면은 상단에 기능이 많기 때문에 모든 컨트롤을 동일한 시각적 무게로
표현하면 복잡해진다.

다음 우선순위를 적용한다.

``` text
Primary Action
>
Context Control
>
View Control
>
Utility
```

예:

``` text
+ 일정       Primary

기본 / 확대   View Control

구성          Context

Undo / Redo   Utility
```

Utility는 최대한 조용하게 만든다.

------------------------------------------------------------------------

# 20. Hover

Hover는 단순히 Border를 밝게 만드는 것이 아니라 "현재 마우스가 무엇을
보고 있는지"를 알려주는 상태다.

Schedule Card:

``` text
Surface ↑
Border ↑
Shadow 또는 Elevation 약간 ↑
```

Dependency:

``` text
Line ↑
Arrow ↑
Related Card Highlight
```

Track:

``` text
Track Surface ↑
```

Hover 상태에서도 Orange를 남발하지 않는다.

------------------------------------------------------------------------

# 21. Selected

Selected는 Hover보다 명확해야 한다.

권장:

``` text
Card Surface 상승
+
Primary Border
+
약한 Primary Tint
```

예:

``` text
┌──────────────────────────┐
│▌ 일정 제목               │
│  기간 · 담당             │
└──────────────────────────┘
  ↑
  Primary Accent
```

전체 Card를 Orange로 채우지 않는다.

------------------------------------------------------------------------

# 22. Focus

Keyboard Focus도 명확하게 표시한다.

``` text
Primary Orange
2px Focus Ring
```

Focus Ring과 Selected Border가 충돌하지 않도록 외부 Ring을 사용하는
방식을 권장한다.

------------------------------------------------------------------------

# 23. Drag & Drop

Drag 상태에서는 대상 영역이 명확해야 한다.

Dragged Card:

``` text
Elevation ↑
Opacity 약간 조정
```

Drop Target:

``` text
Primary Tint
Primary Border
```

화면 전체에 Orange Highlight를 만들지 않는다.

------------------------------------------------------------------------

# 24. Empty / Hold / Placeholder

현재 화면처럼 `HOLD` 영역이나 비어 있는 일정 영역이 존재하는 경우, 일반
Card와 같은 강도로 표현하지 않는다.

Placeholder:

``` text
Background = Canvas와 유사
Border = Dashed
Text = Tertiary
```

실제 일정:

``` text
Surface = 명확한 Card Surface
Text = Primary
```

이를 통해 실제 작업과 아직 결정되지 않은 작업을 구분한다.

------------------------------------------------------------------------

# 25. Elevation

Dark UI에서 Shadow를 많이 사용하면 오히려 화면이 탁해질 수 있다.

따라서 Elevation은 Surface 차이를 우선한다.

``` text
Level 0
Canvas

Level 1
Card

Level 2
Hover / Floating

Level 3
Popover / Dialog
```

Shadow는 Level 2 이상에서 제한적으로 사용한다.

------------------------------------------------------------------------

# 26. Radius

기존 4px Base Grid 원칙을 유지한다.

권장:

``` text
Toolbar control   6px
Schedule Card     8px
Panel             8px
Dialog            12px
Pill              9999px
```

Dark UI에서 지나치게 큰 Radius를 사용하면 게임 UI 또는 소비자용 SaaS
느낌이 강해질 수 있으므로 절제한다.

------------------------------------------------------------------------

# 27. FENRIR

FENRIR는 브랜드 자산이다.

실제 작업 화면에서 반복적으로 등장시키지 않는다.

사용 권장:

``` text
App Icon
Splash
About
Empty State
Onboarding
Brand presentation
```

일반 기능 아이콘은 Lucide를 유지한다.

``` text
FENRIR = Brand
Lucide = Function
```

------------------------------------------------------------------------

# 28. Dark UI Color Token

WOLFPACK 구현에서 사용할 수 있는 Semantic Token 예시:

``` css
:root {
  --wp-dark-bg-canvas: var(--neutral-950);
  --wp-dark-bg-section: var(--neutral-900);
  --wp-dark-bg-panel: var(--neutral-900);
  --wp-dark-bg-card: var(--neutral-800);
  --wp-dark-bg-card-hover: var(--neutral-700);
  --wp-dark-bg-selected: var(--neutral-700);

  --wp-dark-border-subtle: var(--neutral-800);
  --wp-dark-border-default: var(--neutral-700);
  --wp-dark-border-strong: var(--neutral-600);

  --wp-dark-text-primary: var(--neutral-50);
  --wp-dark-text-secondary: var(--neutral-300);
  --wp-dark-text-tertiary: var(--neutral-500);
  --wp-dark-text-disabled: var(--neutral-600);

  --wp-dark-accent: var(--primary-500);
  --wp-dark-accent-hover: var(--primary-400);

  --wp-dark-success: var(--success-500);
  --wp-dark-warning: var(--warning-500);
  --wp-dark-error: var(--error-500);

  --wp-dark-dependency: var(--neutral-600);
  --wp-dark-dependency-hover: var(--neutral-400);
}
```

실제 Neutral 변수의 값은 기존 디자인 토큰을 사용한다.

------------------------------------------------------------------------

# 29. 화면 개선 우선순위

현재 구현 화면을 기준으로 다음 순서로 수정한다.

## P0 --- 가독성

``` text
1. Card Surface 밝기 상승
2. Secondary Text 밝기 상승
3. Card와 Canvas의 명도 차이 확보
4. 일반 Border 대비 조정
```

## P1 --- 정보 계층

``` text
5. Dependency Line 계층화
6. Hover Dependency Highlight
7. Selected State 정의
8. Today Line 정리
```

## P2 --- 밀도

``` text
9. Grid 계층화
10. Toolbar 시각적 무게 조정
11. Card 내부 정보 계층 정리
```

## P3 --- 브랜드

``` text
12. FENRIR Brand 영역 적용
13. Empty State
14. Splash / About
```

------------------------------------------------------------------------

# 30. 현재 화면에 대한 구체적 수정안

현재 화면을 기준으로 한다면 다음 변경을 우선 적용한다.

### 변경 1

현재의 매우 어두운 Schedule Card를 한 단계 밝게 한다.

``` text
현재
Canvas ≈ Card

개선
Canvas < Track < Card
```

### 변경 2

Card Border를 더 강하게 만드는 방식으로 가독성을 해결하지 않는다.

``` text
Surface 차이를 먼저 만든다.
```

### 변경 3

기간과 담당 정보의 명도를 올린다.

현재 작은 카드에서 metadata가 쉽게 사라지는 문제를 해결한다.

### 변경 4

Dependency Line은 제거하지 않는다.

평시:

``` text
낮은 대비
```

Hover:

``` text
관련 Line + 관련 Card 강조
```

Selected:

``` text
Primary
```

### 변경 5

Grid는 일괄적으로 약화하지 않는다.

현재 화면의 실제 인식성을 확인하면서 Minor / Major / Today의 계층을
만든다.

### 변경 6

Orange Accent는 유지한다.

다만 Today, Selected, Active, Primary CTA 등 중요한 의미에 집중시킨다.

------------------------------------------------------------------------

# 31. Light / Dark의 관계

Light와 Dark는 서로 다른 제품처럼 보이면 안 된다.

정보 구조는 동일하다.

``` text
Header
Status Summary
Track
Timeline
Schedule
Dependency
Interaction
```

Light:

``` text
Canvas → neutral-50
Card   → white
```

Dark:

``` text
Canvas → neutral-950
Card   → neutral-800
```

Theme가 바뀌어도 사용자가 정보를 찾는 위치와 방법은 동일해야 한다.

------------------------------------------------------------------------

# 32. 최종 원칙

WOLFPACK Dark UI의 목표는 "더 어두운 화면"이 아니다.

목표는 다음이다.

``` text
어두운 Canvas
+
명확한 Surface
+
읽을 수 있는 Text
+
조용한 Grid
+
관계를 보여주는 Dependency
+
필요할 때 강해지는 Interaction
+
절제된 Orange
```

특히 Dependency는 다음 세 단계로 기억한다.

``` text
Normal
관계의 존재를 보여준다.

Hover
어떤 관계인지 보여준다.

Selected
어떤 관계를 집중해서 보고 있는지 보여준다.
```

WOLFPACK은 브랜드는 강하게, 작업 화면은 차분하게 가져간다.

FENRIR와 Orange는 제품을 기억하게 만드는 장치이고, 실제 일정 보드에서는
시간·일정·관계가 가장 먼저 읽혀야 한다.
