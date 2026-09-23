# WOLFPACK Light UI Design Guide

> WOLFPACK 프로젝트 관리 보드의 Light Theme 세부 디자인 가이드\
> 기준 문서: 다임리서치 UI/UX 가이드라인 v1.0\
> 상태: WOLFPACK 화면 구현을 위한 제안안\
> 원칙: 기존 디자인 시스템을 대체하지 않고, 기존 토큰과 원칙을 제품
> 특성에 맞게 구체화한다.

## 1. 디자인 방향

WOLFPACK의 Light UI는 "하얀 배경 위에 회색 박스를 배치한 관리 화면"이
아니라 "밝은 작업 공간 안에서 일정과 시간축이 자연스럽게 떠 있는 화면"을
목표로 한다.

기존 디자인 가이드의 핵심 원칙인 신뢰성, 명확성, 전문성, 접근성을
유지하면서 WOLFPACK에서는 다음 세 가지를 특히 강화한다.

``` text
1. 넓은 Canvas와 명확한 정보 계층
2. Border보다 Surface와 Spacing을 우선
3. Primary Orange를 장식이 아니라 현재 상태를 알려주는 신호로 사용
```

Light UI에서는 Dark UI와 반대로 "밝은 면이 너무 많아 정보 계층이
사라지는 문제"를 주의한다.

## 2. 현재 Light UI에서 예상되는 주요 문제

기존 디자인 가이드에는 Light/Dark의 기본 Semantic Mapping이 제시되어
있지만, 실제 컴포넌트별 규격은 아직 정의되지 않았다. 따라서
WOLFPACK에서는 이 매핑을 일정 보드에 맞게 구체화할 필요가 있다.

현재와 같은 일정 보드에서는 다음 문제가 발생하기 쉽다.

``` text
순백색 Canvas
+
순백색 Card
+
회색 Border
+
많은 Grid Line
=
정보 계층이 평평해짐
```

또한 일정 카드마다 Border가 강하면 Light UI에서도 화면이 표 형태로
변한다.

따라서 Light UI의 핵심은 "흰색을 더 많이 쓰는 것"이 아니라 "흰색을 여러
단계의 표면으로 나누는 것"이다.

## 3. Light Theme Surface Hierarchy

기본 계층은 다음과 같이 정의한다.

``` text
Canvas        neutral-50
Section       white
Panel         white
Elevated      white + subtle shadow 또는 neutral-100
Input         white
Hover         neutral-100
Selected      primary 계열의 매우 약한 tint
```

중요한 점은 모든 영역을 white로 만들지 않는 것이다.

가이드의 Neutral 팔레트는 `neutral-50`부터 `neutral-950`까지 충분한 명도
단계를 제공하므로, Light UI에서는 이 계층을 적극적으로 활용한다.

## 4. Canvas

전체 일정 보드의 배경은 순수 White보다 `neutral-50`을 기본으로 사용하는
것을 권장한다.

Canvas가 완전히 흰색이면 Schedule Card 역시 흰색일 때 경계가 사라지므로
Border를 강하게 만들 수밖에 없다.

`neutral-50` Canvas 위에 White Schedule Card를 배치하면 Border를 약하게
해도 자연스럽게 카드가 구분된다.

``` text
Canvas       neutral-50
Schedule     white
Card hover   neutral-50
```

이 정도의 차이만으로도 화면이 훨씬 가벼워진다.

## 5. Header / Toolbar

Header는 Canvas와 다른 영역임을 보여주되 별도의 무거운 Bar처럼 만들지
않는다.

권장 구조:

``` text
Canvas / neutral-50
┌────────────────────────────────────────────────┐
│ WOLFPACK    기간 / 프로젝트        검색  액션 │
└────────────────────────────────────────────────┘
```

Header 배경은 white를 사용할 수 있지만 강한 Border-bottom은 피한다.

대신 다음을 사용한다.

``` text
높이
좌우 Padding
정보 그룹 간 여백
아주 약한 Border
```

브랜드명 WOLFPACK은 Neutral 계열을 기본으로 하고, 브랜드 Mark 또는 주요
CTA에서 Primary Orange를 사용한다.

Toolbar의 모든 버튼을 회색 박스로 만들지 않는다.

Primary Action:

`primary-500`

Secondary Action:

Ghost / Neutral

Low Priority Action:

텍스트 버튼

## 6. Status Summary

상단의 상태 요약 영역은 Light UI에서 특히 "Badge가 너무 많아지는 것"을
피해야 한다.

권장:

``` text
계획       23
진행중      5
완료        0
지연        0
보류        2
```

각 상태를 색이 들어간 커다란 Pill로 만들기보다는 Label + 숫자 + 작은
Indicator 구조를 사용한다.

색상은 상태를 구분하는 최소 단위로 사용한다.

``` text
계획       Neutral
진행중     Primary
완료       Success
지연       Error
보류       Warning
```

숫자는 `text-base` 또는 `text-lg`, Label은 `text-xs` 또는 `text-sm`
수준에서 정보 계층을 만든다.

## 7. Track Header

Track Header는 일정 Card와 동일한 시각적 무게를 가져서는 안 된다.

Track은 일정들을 묶는 구조이므로 "상위 정보"로 보이되, 큰 색상 면을
사용하지 않는다.

권장:

``` text
Track 이름       담당/설명       상태/수량
```

Track Header는 `neutral-900` 또는 `neutral-800` 텍스트를 사용한다.

선택된 Track만 Primary를 사용할 수 있다.

모든 Track Header에 주황색을 넣지 않는다.

## 8. Timeline

Light UI에서 Grid Line을 많이 사용하는 것은 특히 주의한다.

현재 일정 보드의 시간축이 강한 선으로 가득 차면 카드보다 Grid가 먼저
보이게 된다.

기본 원칙:

``` text
일반 날짜       아주 약한 line
주/월 경계      한 단계 강한 line
오늘            Primary line
현재 선택       Primary 강조
```

일반 Grid는 `neutral-200` 또는 상황에 따라 `neutral-100` 수준의 낮은
대비로 처리한다.

월 경계나 중요한 시간 구간만 한 단계 강하게 한다.

오늘 표시:

``` text
──────────●────────────────
          오늘
```

오늘의 세로선은 Primary-500을 사용할 수 있지만, 화면 전체에서 가장 강한
선이 되지 않도록 한다.

## 9. Schedule Card

WOLFPACK의 핵심 컴포넌트다.

Light UI에서 Schedule Card를 다음처럼 만드는 것을 피한다.

``` text
┌────────────────────┐
│ 강한 회색 Border    │
│                    │
│ 일정 제목           │
│ 기간                │
└────────────────────┘
```

이 구조는 일정이 너무 무겁고 문서 카드처럼 보이게 한다.

대신:

``` text
Canvas / neutral-50

┌────────────────────┐
│ 일정 제목           │
│ 기간 · 담당         │
└────────────────────┘

white surface
subtle border
```

카드의 존재감은 Border보다 Surface와 여백으로 만든다.

### 기본 카드

Background:

`white`

Border:

`neutral-200`

Text:

`neutral-900`

Secondary:

`neutral-600`

### Hover

Background:

`neutral-50`

Border:

`neutral-300`

### Selected

Background:

White

Border:

`primary-500`

또는 매우 약한 Primary tint

### Progress

카드 전체를 Orange로 채우지 않는다.

좌측 4px Accent bar 또는 제목 옆의 작은 Indicator를 사용한다.

## 10. Schedule Card 내부 계층

카드 안에서 가장 중요한 것은 제목이다.

권장 순서:

``` text
일정 제목
기간 / 담당 / 관련 정보
상태
```

제목:

`text-sm / SemiBold`

Metadata:

`text-xs / Regular`

Status:

작은 Indicator + Label

카드가 작아질수록 정보를 줄이지 않고 글자를 무작정 작게 만들기보다
Metadata를 우선 숨기는 방식을 고려한다.

## 11. 카드의 색상 전략

Light UI에서는 일정마다 다른 배경색을 넣는 방식이 특히 쉽게 산만해진다.

기본 Schedule은 White를 유지한다.

상태는 Border나 Indicator로 표현한다.

``` text
기본      Neutral
진행      Primary
완료      Success
경고      Warning
오류      Error
```

상태 배경이 필요한 경우에도 전체 카드가 아니라 작은 Status Chip 또는
8\~16% 수준의 매우 약한 tint만 사용한다.

## 12. Project / Category Tag

프로젝트나 카테고리를 Tag로 표시할 경우 모든 Tag를 서로 다른 색으로
만들지 않는다.

기본 Tag:

Neutral

현재 선택된 Tag:

Primary

상태 Tag:

Success / Warning / Error

Tag의 색은 프로젝트를 장식하기 위한 색이 아니라 정보를 분류하기 위한
색이다.

## 13. Border 전략

Light UI에서는 Border가 너무 진하면 화면이 복잡해지고, 너무 약하면
카드가 사라진다.

권장 단계:

``` text
Subtle     neutral-200
Default    neutral-300
Strong     neutral-400
Selected   primary-500
```

기본 카드에는 Subtle Border를 사용한다.

Strong Border는 선택, Focus, 중요한 영역에만 사용한다.

## 14. Shadow 전략

Light UI에서는 Shadow를 Dark UI보다 조금 더 사용할 수 있지만, 카드마다
그림자를 넣는 것은 피한다.

Schedule Card:

기본 Shadow 없음.

Hover:

아주 약한 Elevation 가능.

Dropdown / Popover:

명확한 Shadow.

Dialog:

강한 Elevation.

Floating Toolbar:

중간 Elevation.

즉, Shadow는 "모든 카드가 떠 있다"는 느낌을 만드는 장식이 아니라 "현재
떠 있는 계층"을 표현하는 수단으로만 사용한다.

## 15. Radius

WOLFPACK은 일반적인 SaaS 카드처럼 지나치게 둥글게 만들지 않는다.

권장:

``` text
Toolbar control   6px
Schedule Card     8px
Panel             8px
Dialog            12px
Pill              9999px
```

실제 구현 시 기존 4px base grid 원칙과 조정한다.

## 16. Orange 사용 규칙

기존 디자인 가이드의 Primary-500 `#F86517`을 그대로 유지한다.

Light UI에서 Orange는 Dark UI보다 훨씬 눈에 띄기 때문에 사용량을 더
엄격하게 제한한다.

Orange를 사용하는 대표적인 요소:

``` text
Primary CTA
현재 날짜
선택된 일정
진행 상태 Indicator
Focus ring
주요 링크 또는 강조
```

Orange를 사용하지 않는 요소:

``` text
일반 카드
일반 Grid
모든 Track Header
모든 Status Badge
일반 Hover
장식용 배경
```

특히 화면 상단부터 일정 영역까지 주황색 선이 계속 이어지는 디자인은
피한다.

## 17. 6:3:1 적용

기존 가이드의 6:3:1 원칙을 Light UI에서도 유지한다.

``` text
6 — Canvas / Surface / 여백
3 — Text / Content
1 — Primary / CTA / 상태 강조
```

다만 Light UI에서는 White 자체가 많은 영역을 차지하므로 "흰색 = 모든
영역"으로 해석하지 않는다.

Neutral-50과 White의 차이를 사용해 Base와 Content 영역을 분리한다.

## 18. Typography

기존 Pretendard와 타입 스케일을 그대로 사용한다.

권장 계층:

``` text
Page title       text-lg / SemiBold
Track title      text-sm / SemiBold
Schedule title   text-sm / SemiBold
Metadata         text-xs / Regular
Status label     text-xs / Medium
Timeline label   text-xs / Regular
```

Light UI에서는 텍스트가 너무 검게 보이는 것을 피하기 위해 모든 텍스트를
Neutral-900으로 만들지 않는다.

``` text
Primary text     neutral-900
Secondary text   neutral-600
Tertiary text    neutral-500
Disabled         neutral-400
```

## 19. Empty State

Light UI에서 Empty State는 FENRIR 브랜드를 사용할 수 있는 대표적인
영역이다.

다만 일러스트를 크게 넣어 화면을 장식하지 않는다.

권장 구조:

``` text
       FENRIR Mark

등록된 일정이 없습니다

새 일정을 추가하면
시간축에 표시됩니다.

       [일정 추가]
```

브랜드 요소보다 사용자의 다음 행동을 우선한다.

## 20. FENRIR 사용 규칙

FENRIR는 WOLFPACK의 마스코트이지만 일반 UI 아이콘을 대체하지 않는다.

브랜드:

FENRIR

기능:

Lucide

FENRIR를 Toolbar, Schedule Card, Status Badge에 반복적으로 삽입하지
않는다.

사용 권장 영역:

``` text
Application Icon
Splash
About
Empty State
Brand presentation
Onboarding
```

## 21. Light / Dark 공통 구조

Light와 Dark는 완전히 다른 디자인으로 만들지 않는다.

구조는 동일하게 유지한다.

``` text
Header
Status Summary
Timeline
Track
Schedule
Interaction
```

달라지는 것은 Surface와 대비다.

Light:

``` text
neutral-50
→ white
→ neutral-100
→ neutral-200
```

Dark:

``` text
neutral-950
→ neutral-900
→ neutral-800
→ neutral-700
```

이렇게 대응시키면 테마가 달라도 동일한 제품이라는 인상을 유지할 수 있다.

## 22. Light UI에서 특히 피해야 할 것

``` text
모든 카드에 강한 Border
모든 카드에 Shadow
순백색 Canvas + 순백색 Card
강한 Grid Line
모든 상태에 색상 배경
모든 버튼을 박스화
Orange의 과도한 사용
Track마다 서로 다른 색상
Schedule마다 서로 다른 배경색
과도하게 둥근 SaaS 스타일
회색 텍스트의 과도한 사용
FENRIR 이미지의 반복 배치
```

## 23. 구현 우선순위

### P0

Canvas를 `neutral-50` 중심으로 정리.

Schedule Card를 White Surface로 재정의.

Card Border를 `neutral-200` 중심으로 낮춤.

Grid Line 대비 낮춤.

Orange 사용 영역 축소.

### P1

Header / Toolbar 계층 정리.

Status Summary를 색상 중심에서 숫자 중심으로 변경.

Track Header와 Schedule Card의 계층 분리.

Hover / Selected 상태 정의.

### P2

Popover / Dialog / Dropdown Elevation 정의.

Drag & Drop 상태 정의.

Empty State 정의.

### P3

FENRIR 브랜드 요소 적용.

Application Icon.

Splash.

About.

## 24. 구현용 Semantic Token 제안

기존 디자인 가이드의 Semantic Mapping을 WOLFPACK Light UI에 맞게
구체화한다.

``` css
:root {
  --wp-light-bg-canvas: var(--neutral-50);
  --wp-light-bg-header: var(--white);
  --wp-light-bg-section: var(--white);
  --wp-light-bg-panel: var(--white);
  --wp-light-bg-elevated: var(--white);
  --wp-light-bg-hover: var(--neutral-50);
  --wp-light-bg-input: var(--white);

  --wp-light-border-subtle: var(--neutral-200);
  --wp-light-border-default: var(--neutral-300);
  --wp-light-border-strong: var(--neutral-400);

  --wp-light-text-primary: var(--neutral-900);
  --wp-light-text-secondary: var(--neutral-600);
  --wp-light-text-tertiary: var(--neutral-500);
  --wp-light-text-disabled: var(--neutral-400);

  --wp-light-accent: var(--primary-500);
  --wp-light-accent-hover: var(--primary-600);

  --wp-light-success: var(--success-500);
  --wp-light-warning: var(--warning-500);
  --wp-light-error: var(--error-500);
}
```

이 토큰은 기존 디자인 시스템의 값을 추가하는 것이 아니라 WOLFPACK
화면에서 의미를 명확하게 하기 위한 Semantic Layer다.

## 25. 최종 디자인 문장

WOLFPACK Light UI는 "흰색으로 밝게 만든 관리 화면"이 아니라 "밝은 작업
공간 위에서 일정과 시간축이 자연스럽게 떠 있는 화면"이어야 한다.

Dark UI가 Surface의 깊이로 정보를 분리한다면, Light UI는 Neutral-50
Canvas와 White Surface의 대비, 여백, 낮은 대비의 Border를 이용해 정보를
분리한다.

두 테마 모두 Primary Orange는 장식이 아니라 사용자의 현재 위치와 중요한
행동을 알려주는 신호로 사용한다.

WOLFPACK의 브랜드는 강하지만 UI는 조용해야 한다.

FENRIR는 제품을 기억하게 만드는 브랜드 자산이고, 실제 작업 화면에서는
정보 자체가 주인공이어야 한다.
