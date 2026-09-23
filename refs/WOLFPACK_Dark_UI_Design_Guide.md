# WOLFPACK Dark UI Design Guide

> WOLFPACK 프로젝트 관리 보드의 다크 테마 세부 디자인 가이드\
> 기준 문서: 다임리서치 UI/UX 가이드라인 v1.0\
> 상태: WOLFPACK 화면 구현을 위한 제안안\
> 원칙: 기존 디자인 시스템을 대체하지 않고, 기존 토큰과 원칙을 제품
> 특성에 맞게 구체화한다.

## 1. 디자인 방향

WOLFPACK의 다크 모드는 "검은 화면 위에 패널을 쌓는 방식"이 아니라
"따뜻한 Stone 계열의 깊이를 가진 작업 공간"으로 정의한다.

현재 화면의 가장 큰 문제는 정보가 부족해서가 아니라,
배경·패널·카드·구분선의 명도 차이가 지나치게 작아 화면이 하나의 어두운
면처럼 보인다는 점이다. 그 결과 카드의 경계는 강한 선으로 표시하게 되고,
일정 카드가 서로 분리되지 않으며, 전체 화면이 무겁고 평면적으로
느껴진다.

WOLFPACK은 다음의 시각적 구조를 기본으로 한다.

`Canvas → Section → Track → Schedule → State`

각 계층은 색을 많이 추가하는 방식이 아니라 밝기, 표면 깊이, 여백, 테두리
강도의 차이로 구분한다.

브랜드 컬러인 Primary Orange는 전체 화면을 장식하는 색이 아니라 사용자가
현재 보고 있거나 조작해야 하는 지점을 알려주는 신호로만 사용한다.

## 2. 핵심 원칙

### 2.1 Dark ≠ Black

다크 테마의 기본 배경은 순수한 검정색이 아니라 Neutral / Stone 계열을
사용한다.

가이드의 Neutral-950을 최하위 Canvas로 사용하고, Neutral-900을 주요
Panel 계층으로 사용한다.

권장 계층:

``` text
Canvas       neutral-950
Section      neutral-900
Panel        neutral-900 또는 neutral-800
Input        neutral-800
Hover        neutral-800 → neutral-700
Border       neutral-800
Strong line  neutral-700
```

중요한 것은 각 계층에 명확한 역할을 부여하는 것이다. 단순히 모든 영역을
#0C0A09 근처로 만드는 것은 금지한다.

### 2.2 Surface를 선보다 먼저 사용한다

현재 화면처럼 모든 카드에 강한 외곽선을 두르면 일정 보드가 표 형태로
보인다.

WOLFPACK에서는 다음 우선순위를 적용한다.

``` text
1. Surface 차이
2. 여백
3. 얇은 Border
4. Accent
```

Border는 영역을 만드는 주 수단이 아니라 영역의 끝을 보조하는 수단으로
사용한다.

Schedule Card의 기본 상태에는 강한 외곽선을 사용하지 않는다.

### 2.3 Orange는 정보다

Primary-500 `#F86517`은 브랜드 색상이면서 현재 선택·진행·행동을 나타내는
정보 색이다.

따라서 다음에는 Primary를 사용하지 않는다.

``` text
일반 카드 배경
모든 일정 카드
일반 구분선
일반 텍스트
모든 hover 상태
장식용 그라디언트
```

다음과 같은 경우에만 사용한다.

``` text
현재 날짜
현재 선택된 일정
주요 CTA
진행 상태의 핵심 표시
Focus ring
사용자가 현재 보고 있는 시간축
```

가이드의 6:3:1 원칙에 따라 화면 전체에서 Accent 영역은 제한한다.

## 3. WOLFPACK의 화면 레이어

### Layer 0 --- Canvas

전체 작업 영역.

색상:

`bg-canvas = neutral-950`

특징:

아주 어둡지만 완전한 검정처럼 보이지 않아야 한다.

### Layer 1 --- Navigation / Header

상단 Toolbar와 프로젝트 컨텍스트 영역.

색상:

`bg-header = neutral-900`

Border:

`border-subtle = neutral-800`

헤더는 Canvas와 확실히 구분하되 별도의 강한 박스처럼 보이지 않게 한다.

### Layer 2 --- Timeline / Track

시간축과 트랙의 기본 영역.

배경은 Panel보다 아주 조금 어둡거나 같은 수준으로 유지한다.

트랙 사이에는 강한 세로선을 사용하지 않는다.

세로 구분은 다음 순서로 표현한다.

``` text
트랙 간 여백
→ 매우 낮은 대비의 Border
→ 필요할 때만 Strong Border
```

### Layer 3 --- Schedule Card

일정의 실제 정보가 담기는 가장 중요한 표면.

기본 카드:

`bg-surface = neutral-900`

Hover:

`bg-surface-hover = neutral-800`

Border:

`border = neutral-800`

선택:

`border = primary-500`

진행:

카드 전체를 주황색으로 칠하지 않고 좌측 또는 상단의 얇은 Accent
indicator로 표현한다.

## 4. Schedule Card 디자인

현재 화면에서 가장 먼저 개선해야 할 컴포넌트다.

기본 일정 카드는 "테두리 박스"가 아니라 "정보가 놓인 표면"처럼 보여야
한다.

### 기본 구조

``` text
┌─────────────────────────────────────┐
│ 일정 제목                           │
│                                     │
│ 기간 · 담당/조직                    │
└─────────────────────────────────────┘
```

불필요한 장식선은 제거한다.

제목은 `text-sm` 또는 `text-base`를 사용하고 SemiBold를 기본으로 한다.

메타 정보는 `text-xs` 또는 `text-sm` Regular를 사용한다.

카드 내부 패딩은 12 / 16 / 20 / 24px 계열에서 선택한다.

### 상태 표현

기본:

중립적인 Stone surface.

진행:

왼쪽에 4px Accent indicator.

완료:

Blue 상태 색상을 사용하되 면적을 최소화한다.

경고:

Amber 상태 색상을 사용한다.

오류:

Red 상태 색상을 사용한다.

상태 색상은 카드 전체 배경으로 확장하지 않는다.

## 5. Timeline 디자인

타임라인은 화면의 주인공이지만 시각적으로 가장 조용해야 한다.

현재 날짜선은 Primary-500을 사용한다.

단, 현재 날짜선 전체를 두꺼운 주황색으로 강조하지 않는다.

권장 형태:

``` text
──────────────●────────────────────
              오늘
```

날짜선:

2px 이하.

오늘 라벨:

Primary 색상의 작은 Pill.

일반 날짜 구분선:

Neutral 계열의 낮은 대비.

월 경계:

일반 날짜보다 한 단계 강한 선.

주말:

배경을 별도의 색으로 칠하지 않고 필요한 경우 매우 약한 Surface 차이만
사용한다.

## 6. Track Header

트랙 헤더는 일정 카드보다 한 단계 높은 정보 구조다.

트랙 이름은 `text-sm / SemiBold`.

트랙 설명이나 담당 정보는 `text-xs / Regular`.

숫자나 상태 Badge는 색보다 형태와 위치를 우선한다.

현재 선택된 Track만 Primary를 사용한다.

모든 Track Header에 주황색을 넣지 않는다.

## 7. Header / Toolbar

상단 Toolbar는 현재 화면보다 더 단순해져야 한다.

브랜드 영역:

`WOLFPACK`

현재 프로젝트나 문서 이름:

Secondary text.

현재 기간:

Primary가 아닌 Neutral text.

주요 액션:

Primary CTA.

검색:

Neutral-800 surface.

Toolbar의 모든 버튼을 동일한 박스 형태로 만들지 않는다.

Primary action만 명확한 버튼으로 표현하고 나머지는 Ghost / Quiet
action으로 처리한다.

## 8. Status Summary

상단의 `계획 / 진행중 / 완료 / 지연 / 보류` 영역은 작은 Dashboard가
아니라 "현재 상태를 빠르게 읽는 요약 정보"로 취급한다.

각 상태에 색을 강하게 채우지 않는다.

권장 형태:

``` text
계획   23
진행중 5
완료   0
지연   0
보류   2
```

숫자는 강조하고 Label은 낮은 대비로 처리한다.

상태 색상은 숫자 옆의 작은 Indicator 또는 상태 Dot 정도로 제한한다.

## 9. Border 규칙

Border가 현재 화면의 시각적 무게를 크게 만드는 요소이므로 명확한 계층을
둔다.

### Subtle

일반적인 영역 경계.

`neutral-800`

### Default

입력이나 명확한 컴포넌트 경계.

`neutral-700`

### Strong

선택, 포커스, 중요한 구분.

`primary-500` 또는 상황별 기능 색상.

모든 카드에 Strong Border를 사용하는 것은 금지한다.

## 10. Radius

WOLFPACK은 지나치게 둥근 SaaS 스타일을 피한다.

권장 범위:

``` text
Toolbar control   6px
Card              8px
Panel             8px
Dialog            12px
Pill              9999px
```

단, 4px base grid 원칙을 우선하므로 실제 컴포넌트 규격 확정 시 4px
단위에 맞춰 조정한다.

## 11. Shadow

다크 테마에서 강한 그림자는 사용하지 않는다.

배경 자체의 명도 차이로 깊이를 표현한다.

Shadow가 필요한 경우:

``` text
Dropdown
Popover
Dialog
Floating toolbar
```

정도로 제한한다.

Schedule Card에는 기본적으로 Shadow를 사용하지 않는다.

## 12. Typography

기존 가이드의 Pretendard와 타입 스케일을 그대로 사용한다.

특히 일정 보드에서는 텍스트 크기를 작게 만드는 것보다 계층을 명확하게
만드는 것이 중요하다.

권장:

``` text
Page title       text-lg / SemiBold
Track title      text-sm / SemiBold
Schedule title   text-sm / SemiBold
Metadata         text-xs / Regular
Status label     text-xs / Medium
Timeline label   text-xs / Regular
```

중요한 제목을 Bold로 과도하게 처리하지 않는다.

## 13. Icon

일반 UI 아이콘은 기존 가이드대로 Lucide를 사용한다.

24 × 24px grid, 1.5px centered stroke를 유지한다.

WOLFPACK/FENRIR 브랜드 아이콘은 예외적인 Brand Asset으로 취급한다.

즉, FENRIR 로고를 일반 UI 아이콘처럼 사용하지 않는다.

브랜드 영역:

FENRIR / WOLFPACK Mark

기능 영역:

Lucide

이 둘의 시각 언어를 섞지 않는다.

## 14. FENRIR Brand Mark

FENRIR는 WOLFPACK의 마스코트다.

UI 전체에 늑대 이미지를 반복해서 넣지 않는다.

권장 사용 위치:

``` text
Application icon
Splash screen
About
Empty state
Brand presentation
Login / launch screen
```

일반 일정 카드나 Toolbar의 장식 요소로 반복 사용하지 않는다.

UI가 브랜드 캐릭터에 종속되는 것을 피한다.

## 15. Empty State

Empty State는 FENRIR를 사용할 수 있는 대표적인 영역이다.

다만 큰 일러스트를 배경처럼 배치하지 않는다.

권장:

``` text
[작은 FENRIR Mark]

등록된 일정이 없습니다

새 일정을 추가하면
시간축에 프로젝트 흐름이 표시됩니다.

[일정 추가]
```

브랜드 캐릭터보다 사용자가 해야 할 행동을 우선한다.

## 16. 색상 사용 예시

### Canvas

`neutral-950`

### Main Panel

`neutral-900`

### Elevated Panel

`neutral-800`

### Primary CTA

`primary-500`

### Primary Hover

`primary-600`

### Primary Selected Surface

다크 환경에서는 Primary-50을 그대로 사용하지 않고 Primary 색상의 12\~18%
수준의 Alpha Overlay를 사용한다.

### Success

`success-500`

### Warning

`warning-500`

### Error

`error-500`

가이드에서 정의한 상태 색상 체계를 유지한다.

## 17. 다크 모드의 핵심 변화

현재 화면에서 다음 변화가 가장 중요하다.

``` text
기존
검은 Canvas
+
어두운 Card
+
강한 Border
+
많은 구분선
+
Orange 강조

↓

WOLFPACK
Stone Canvas
+
Layered Surface
+
약한 Border
+
넓은 여백
+
최소한의 Orange Signal
```

즉, 더 밝게 만드는 것이 목표가 아니다.

"어두운데 잘 보이는 화면"이 아니라

"깊이가 있어서 정보가 잘 분리되는 화면"

을 목표로 한다.

## 18. 일정 보드의 시각적 우선순위

사용자가 화면을 열었을 때 다음 순서로 정보가 읽혀야 한다.

``` text
1. 현재 날짜 / 현재 위치
2. Track 구조
3. 일정의 시작과 종료
4. 일정 제목
5. 상태
6. 담당 / 부가 정보
```

이 순서를 색상과 크기로 모두 표현하지 않는다.

위계는 위치, 크기, 굵기, 표면 깊이를 우선 사용하고 색상은 상태와
선택에만 사용한다.

## 19. 금지 사항

다음 패턴은 WOLFPACK에서 사용하지 않는다.

``` text
모든 카드에 주황색 Border
모든 카드에 강한 Shadow
모든 영역을 박스화
순수 Black + Pure White의 강한 대비
카드마다 서로 다른 색상
상태마다 강한 배경색
장식용 Gradient 남용
늑대 이미지 반복 배치
기능 아이콘을 FENRIR 스타일로 변형
임의 HEX 추가
임의 Pixel 값 사용
```

## 20. 구현 우선순위

현재 화면을 개선할 때는 기능을 다시 만드는 것보다 시각 계층을 먼저
수정한다.

### P0

Canvas / Panel / Card의 Surface 계층 재정의.

Border 대비 낮추기.

Schedule Card의 구조 변경.

Primary Orange 사용량 축소.

Timeline grid 대비 낮추기.

### P1

Toolbar 정리.

Status Summary 재구성.

Track Header 계층 정리.

Hover / Selected 상태 정의.

### P2

Empty State.

Popover / Dialog.

Drag & Drop 상태.

Schedule interaction.

### P3

FENRIR 브랜드 요소 적용.

Splash / About / App Icon.

## 21. 구현용 Semantic Token 제안

아래 매핑은 기존 가이드의 §8.2가 "확정 전 참고 매핑"으로 정의되어 있다는
점을 전제로 한 WOLFPACK용 구체화 제안이다.

``` css
:root {
  --wp-bg-canvas: var(--neutral-950);
  --wp-bg-header: var(--neutral-900);
  --wp-bg-section: var(--neutral-900);
  --wp-bg-panel: var(--neutral-900);
  --wp-bg-elevated: var(--neutral-800);
  --wp-bg-input: var(--neutral-800);

  --wp-border-subtle: var(--neutral-800);
  --wp-border-default: var(--neutral-700);
  --wp-border-strong: var(--neutral-600);

  --wp-text-primary: var(--neutral-50);
  --wp-text-secondary: var(--neutral-300);
  --wp-text-tertiary: var(--neutral-500);
  --wp-text-disabled: var(--neutral-600);

  --wp-accent: var(--primary-500);
  --wp-accent-hover: var(--primary-600);

  --wp-success: var(--success-500);
  --wp-warning: var(--warning-500);
  --wp-error: var(--error-500);
}
```

이 토큰은 기존 디자인 시스템의 HEX 값을 대체하는 것이 아니라, WOLFPACK
화면에서 의미를 명확하게 하기 위한 Semantic Layer다.

## 22. 최종 디자인 문장

WOLFPACK의 다크 테마는 "강한 다크 UI"가 아니라 "정돈된 작업 공간"이어야
한다.

색상은 최소화하고, 정보의 계층은 Surface와 Spacing으로 만들며, Orange는
사용자의 현재 위치와 행동을 알려주는 신호로만 사용한다.

FENRIR는 UI를 장식하는 캐릭터가 아니라 WOLFPACK이라는 제품을 대표하는
브랜드 자산으로 존재한다.

기존 다임리서치 가이드의 신뢰성, 명확성, 전문성이라는 어조를 유지하면서
WOLFPACK에서는 여기에 "집중감"과 "공간감"을 추가한다.
