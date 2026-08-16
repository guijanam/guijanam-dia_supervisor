"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { getTodayMonthStr } from "./schedule-utils";

// 선택한 달(yyyy-MM)을 sessionStorage 에 유지하는 훅.
//
// [왜 필요한가]
// 예전에는 각 화면이 useState(getTodayMonthStr()) 로만 달을 들고 있었다.
// 그래서 새로고침하거나(개발 중 HMR, 사용자의 F5), 폰에서 앱을 백그라운드로
// 보냈다 돌아와 탭이 복원되면 보고 있던 달이 사라지고 현재 달로 튀었다.
// 10월 근무를 확인하던 중에 8월로 돌아가 버리는 식이다.
//
// [왜 sessionStorage 인가]
// - localStorage: 탭을 닫았다 며칠 뒤 다시 열어도 옛 달이 남아 혼란스럽다.
//   "지난달 신청 화면인 줄 모르고 신청" 같은 사고로 이어질 수 있다.
// - sessionStorage: 탭이 살아있는 동안만 유지된다. 새로고침·복원에는 살아남고,
//   탭을 닫으면 깨끗이 사라져 다음에 열면 현재 달로 시작한다. 이 화면들의
//   성격(그때그때 특정 달을 들여다봄)에 맞다.
//
// [왜 URL 쿼리가 아닌가]
// 이 앱은 라우트가 '/' 하나뿐이고 화면 전환을 전부 state 로 한다.
// 달을 URL 에 넣으면 어느 화면의 달인지 표현할 수 없고(4곳이 각자 달을 가짐),
// 뒤로가기가 화면이 아니라 달만 바꾸는 어색한 동작이 된다.
//
// [키를 나누는 이유]
// 사용자 달력·근무표·관리자 달력·신청목록이 각각 다른 달을 볼 수 있어야 한다.
// 한 키를 공유하면 화면을 옮길 때마다 달이 딸려가 서로 간섭한다.

// yyyy-MM 형식만 통과시킨다. 저장값이 손상됐거나 사람이 손댔을 때
// 잘못된 값으로 달력이 깨지는 것을 막는다.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export type MonthScope =
  | "user-calendar"
  | "schedule-viewer"
  | "admin-calendar"
  | "requests-panel";

function storageKey(scope: MonthScope): string {
  return `dia_month_${scope}`;
}

function readSaved(scope: MonthScope): string | null {
  try {
    const saved = sessionStorage.getItem(storageKey(scope));
    return saved && MONTH_PATTERN.test(saved) ? saved : null;
  } catch {
    // 사파리 프라이빗 모드 등에서 sessionStorage 접근이 막힐 수 있다.
    // 달 유지는 편의 기능이므로 실패해도 현재 달로 그냥 동작시킨다.
    return null;
  }
}

// 서버 렌더와 클라이언트 첫 렌더의 HTML 이 어긋나면 hydration 오류가 난다.
// useSyncExternalStore 로 "서버에서는 false, 마운트 후 true" 를 만들어
// 저장값은 마운트 이후에만 쓴다. effect 안에서 setState 하는 방식과 달리
// 렌더가 한 번 더 돌지 않아 현재 달이 깜빡였다 바뀌는 일이 없다.
const emptySubscribe = () => () => {};
function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export function useMonthState(
  scope: MonthScope
): [string, (next: string) => void] {
  const isMounted = useIsMounted();

  // 초기화 함수는 첫 렌더에서 한 번만 실행된다. 서버에서는 sessionStorage 가
  // 없으므로 readSaved 가 null 을 돌려주고 현재 달로 시작한다.
  const [monthValue, setMonthValue] = useState(
    () => readSaved(scope) ?? getTodayMonthStr()
  );

  const setMonth = useCallback(
    (next: string) => {
      setMonthValue(next);
      try {
        if (MONTH_PATTERN.test(next)) {
          sessionStorage.setItem(storageKey(scope), next);
        }
      } catch {
        // 위와 같음 — 저장 실패해도 화면 동작에는 영향이 없다.
      }
    },
    [scope]
  );

  // 마운트 전(서버 HTML 과 맞춰야 하는 첫 렌더)에는 항상 현재 달을 보여주고,
  // 마운트 후부터 저장된 달을 반영한다.
  return [isMounted ? monthValue : getTodayMonthStr(), setMonth];
}
