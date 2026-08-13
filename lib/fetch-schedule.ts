// get_schedule_by_range RPC 호출 래퍼.
//
// 이 RPC 는 '전 직원 × 조회기간' 을 한 번에 돌려준다. 직원 261명 기준으로
// 한 달(연휴 짝 판정용 앞뒤 패딩 5일 포함 = 최대 41일)이면 1만 행을 넘긴다.
//   261명 × 41일 ≈ 10,700행
// 예전 호출부는 .range(0, 10000) 을 썼는데, PostgREST 의 range 는 초과분을
// 에러 없이 잘라 버린다. 그래서 staff_id 가 뒤쪽인 직원(244번째 이후)의
// 근무가 화면에서 조용히 사라졌다 — 달력이 '정상 로딩된 빈 화면' 이 됐다.
//
// 여기서는 PAGE_SIZE 씩 끝까지 받아 이어붙인다. 인원이 더 늘어도 안전하고,
// 한계에 걸려도 조용히 잘리지 않는다.
import { supabase } from "@/lib/supabase";
import type { ScheduleRecord } from "@/lib/types";

// PostgREST 기본 max-rows 가 1000 인 배포가 흔하므로 그보다 크게 잡지 않는다.
// 한 번에 더 받으려 해도 서버가 잘라서 주면 아래 루프가 조기 종료된다.
const PAGE_SIZE = 1000;

// 무한 루프 방지용 상한. 직원 수 × 조회일수가 이 값을 넘길 일은 없다.
const MAX_PAGES = 100;

/**
 * 지정 기간의 근무순서를 전 직원분 모두 가져온다.
 * 페이지네이션으로 끝까지 읽으므로 행 수 제한에 잘리지 않는다.
 */
export async function fetchScheduleByRange(
  startDate: string,
  endDate: string
): Promise<ScheduleRecord[]> {
  const all: ScheduleRecord[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .rpc("get_schedule_by_range", {
        p_start_date: startDate,
        p_end_date: endDate,
      })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    const rows = (data ?? []) as ScheduleRecord[];
    all.push(...rows);

    // 요청한 만큼 못 받았으면 마지막 페이지다.
    if (rows.length < PAGE_SIZE) break;
  }

  return all;
}
