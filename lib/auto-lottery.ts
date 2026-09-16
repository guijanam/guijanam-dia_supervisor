// 지근 추첨 공용 로직.
//
// 추첨 알고리즘(drawIds)과 정원 초과 대상 수집(collectBulkTargets)은 원래
// admin-calendar.tsx 의 모듈 비공개 함수였다. 개별/월 일괄 추첨이 공유한다.
// 서버 자동 추첨은 supabase/migrations/20260916000000_auto_lottery_cron.sql에서
// 동일한 정원 판정과 이미 추첨한 조합 제외 규칙을 구현한다.
//
// 관리자 화면의 개별/월 일괄 추첨은 종전과 동일하게 동작한다(로직을 옮겼을 뿐).
import { getPositionCap, countJigeunSlots } from "@/lib/schedule-utils";
import type { RecordType, LotteryStatus, JigeunCaps } from "@/lib/types";

export const POSITIONS = ["기관사", "차장"] as const;
export type Position = (typeof POSITIONS)[number];

// 추첨 대상이 되기 위해 필요한 최소 정보. admin-calendar 의 SpecialEntry 는
// 화면용 필드(regularTurn 등)를 더 갖지만 구조적으로 이 타입을 만족한다.
export interface LotteryPoolEntry {
  id: string;
  staff_id: number;
  staff_position: string;
  record_type: RecordType;
  lottery_status: LotteryStatus | null;
}

// 추첨 한 건의 단위 = (날짜 × 직책). 정원은 직책별로 따로 적용된다.
export interface BulkTarget<T extends LotteryPoolEntry = LotteryPoolEntry> {
  date: string;
  pos: Position;
  cap: number;
  pool: T[]; // 그 날 그 직책의 지근 신청 전체
}

/**
 * pool 에서 cap 명을 무작위로 당첨시키고 나머지를 탈락으로 가른다 (Fisher-Yates).
 * 관리자 화면의 개별 추첨·월 일괄 추첨이 공유한다.
 */
export function drawIds<T extends { id: string }>(
  pool: T[],
  cap: number
): { wonIds: string[]; lostIds: string[] } {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const winners = new Set(shuffled.slice(0, cap).map((e) => e.id));
  return {
    wonIds: pool.filter((e) => winners.has(e.id)).map((e) => e.id),
    lostIds: pool.filter((e) => !winners.has(e.id)).map((e) => e.id),
  };
}

/**
 * '아직 추첨하지 않은' 정원 초과 (날짜 × 직책) 목록.
 *
 * 추첨 흔적(lottery_status)이 하나라도 있는 조합은 제외한다 — 일괄/자동 실행으로
 * 기존 당첨자가 뒤집히는 사고를 막기 위해서다. 재추첨이 필요하면 관리자 달력의
 * 개별 '재추첨' 버튼을 쓴다.
 */
export function collectBulkTargets<T extends LotteryPoolEntry>(
  entriesByDate: Map<string, T[]>,
  holidays: Set<string>,
  caps: JigeunCaps
): Array<BulkTarget<T>> {
  const list: Array<BulkTarget<T>> = [];
  for (const [date, entries] of entriesByDate) {
    const cap = getPositionCap(date, holidays, caps);
    for (const pos of POSITIONS) {
      const group = entries.filter((e) => e.staff_position === pos);
      if (group.some((e) => e.lottery_status != null)) continue;
      // 날짜 다이얼로그의 isOver 와 같은 기준으로 초과를 판정한다.
      if (countJigeunSlots(group) <= cap) continue;
      list.push({
        date,
        pos,
        cap,
        pool: group.filter((e) => e.record_type === "지근"),
      });
    }
  }
  // 날짜 오름차순 → 같은 날짜면 POSITIONS 순서
  list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos)
  );
  return list;
}
