// 분기(quarter) 상수와 날짜 범위 유틸.
//
// 분기는 DB 에 컬럼으로 존재하지 않는다 — 순수하게 날짜 범위로만 표현되며
// 클라이언트에서 계산한다. 분기휴무 검증 화면과 사용자 캘린더의 추가 신청
// 판정이 '똑같은 기준' 을 써야 하므로 여기로 모아 둔다.
import { format } from "date-fns";

// 분기별 휴무 목표치: 운휴 + 휴 + 지휴 − 지근 = 24
export const QUARTER_TARGET = 24;

export const QUARTERS = [
  { value: 1, label: "1분기 (1~3월)", startMonth: 1 },
  { value: 2, label: "2분기 (4~6월)", startMonth: 4 },
  { value: 3, label: "3분기 (7~9월)", startMonth: 7 },
  { value: 4, label: "4분기 (10~12월)", startMonth: 10 },
] as const;

/** 분기의 시작·종료 날짜(YYYY-MM-DD). 분기는 연 경계를 넘지 않는다. */
export function quarterRange(
  year: number,
  quarter: number
): { start: string; end: string } {
  const q = QUARTERS.find((x) => x.value === quarter)!;
  const startMonth = q.startMonth; // 1, 4, 7, 10
  const start = new Date(year, startMonth - 1, 1);
  // 분기 마지막 달의 말일
  const end = new Date(year, startMonth + 2, 0);
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

// get_schedule_by_range RPC 는 서버에서 10,000행으로 잘립니다(staff_id 오름차순).
// 분기 전체(약 23,000행)를 한 번에 부르면 낮은 staff_id(기관사)가 한도를
// 다 차지해 높은 staff_id(차장)가 누락됩니다. 그래서 월 단위(약 8,000행)로
// 나눠 호출합니다.
export function quarterMonths(
  year: number,
  quarter: number
): Array<{ start: string; end: string }> {
  const q = QUARTERS.find((x) => x.value === quarter)!;
  return [0, 1, 2].map((offset) => {
    const m = q.startMonth - 1 + offset;
    const start = new Date(year, m, 1);
    const end = new Date(year, m + 1, 0);
    return {
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    };
  });
}
