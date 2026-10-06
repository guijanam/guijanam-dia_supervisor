---
version: alpha
name: 근무 운영 콘솔
description: 일정과 신청 현황을 빠르게 읽고 처리하는 차분한 운영 화면.
colors:
  primary: "#533afd"
  secondary: "#f6f8fc"
  neutral: "#ffffff"
  ink: "#0d253d"
  muted: "#64748d"
  border: "#e3e8ee"
typography:
  heading:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: 6px
  md: 10px
spacing:
  sm: 8px
  md: 16px
  lg: 24px
components:
  action-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    padding: 12px
  surface:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 16px
  helper-text:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.muted}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
---

## Overview

기존 서비스의 인디고 브랜드를 유지하면서, 홍보용 랜딩 페이지가 아닌 근무 운영 도구로 표현한다. 정보 밀도가 높은 표와 달력을 주인공으로 두고 장식은 줄인다.

## Colors

밝은 중립 배경 위에 진한 잉크로 가독성을 확보한다. 인디고색은 선택 상태·주요 작업에만 사용하고, 빨강·초록은 기존 근무 및 신청 상태의 의미를 보존한다. 다크 모드는 기존 시맨틱 토큰을 따른다.

## Typography

한글은 Apple SD Gothic Neo/Pretendard 시스템 대체 글꼴을 사용한다. 날짜와 집계 수치는 tabular numerals로 정렬한다.

## Layout

관리자 화면은 데스크톱에서 좁은 사이드바와 넓은 작업 영역, 모바일에서는 수평으로 넘길 수 있는 메뉴를 쓴다. 직원 달력은 넓은 화면에서 읽기 폭을 제한하되 작은 화면에서는 7열 그리드를 유지한다.

## Elevation & Depth

표면과 1px 경계로 구획한다. 그림자는 겹치는 팝오버 등에만 사용한다.

## Shapes

6–10px의 절제된 모서리를 사용한다. 상태 배지만 알약형을 허용한다.

## Components

내비게이션의 현재 항목은 색상 외에 선과 aria-current로 표시한다. 입력 필드에는 항상 보이는 레이블과 포커스 링을 둔다.

## Do's and Don'ts

- 중요한 신청 상태와 마감일을 헤더 가까이에 둔다.
- 보조 링크와 로그아웃에 명확한 접근성 이름을 제공한다.
- 장식용 그라디언트, 반복 카드, 의미 없는 통계는 추가하지 않는다.