// 분기 휴무 합계 계산.
//
// 분기휴무 검증 화면(quarter-balance.tsx)과 사용자 캘린더의 추가 신청 판정
// (user-calendar.tsx)이 공유한다. 두 곳이 각자 계산하면 "검증 화면엔 떴는데
// 신청은 안 열린다" 는 식으로 판정이 갈리므로 반드시 이 함수 하나만 쓴다.
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import type { RecordType, ScheduleRecord } from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  parseHolidayTurnRulesText,
} from "@/lib/types";
import {
  getDayName,
  padDateRange,
  applyHolidayTurnRulesByStaffKey,
  isHueTurnOnDate,
} from "@/lib/schedule-utils";
import { quarterRange, quarterMonths } from "@/lib/quarter";
import { format } from "date-fns";

export interface QuarterTotals {
  hueCount: number; // 휴무 (turn 에 '휴')
  weekendTurnCount: number; // 운휴 (주말/공휴일 & 운휴 번호)
  jihyuCount: number; // 지휴 (+) — 추첨 탈락 건 제외
  jigeunCount: number; // 지근 (−) — 추첨 탈락 건 제외
  // 추첨에서 탈락한(lottery_status='lost') 신청 건수.
  // 탈락 건은 근무가 취소된 것이라 위 지근/지휴 카운트에서 빠져 있고, 여기서만
  // 센다. 분기휴무 검증 화면의 '탈락' 열과 추가 신청 자격 판정에 쓴다.
  lostCount: number;
}

/** 합계 = 휴무 + 운휴 + 지휴 − 지근 */
export function quarterTotal(t: QuarterTotals): number {
  return t.hueCount + t.weekendTurnCount + t.jihyuCount - t.jigeunCount;
}

export function emptyQuarterTotals(): QuarterTotals {
  return {
    hueCount: 0,
    weekendTurnCount: 0,
    jihyuCount: 0,
    jigeunCount: 0,
    lostCount: 0,
  };
}

/**
 * 해당 분기의 직원별 휴무 집계를 계산한다.
 *
 * staffId 를 주면 그 직원 한 명만 담긴 Map 을 돌려준다. 근무순서 RPC 는
 * 기간 조회라 staff 필터가 없어 전 직원분을 받고 클라이언트에서 거른다 —
 * 즉 한 명만 계산해도 RPC 비용은 동일하다. 사용자 화면에서는 꼭 필요할 때만
 * (추가 신청 기간일 때만) 호출할 것.
 */
export async function fetchQuarterTotals(
  year: number,
  quarter: number,
  staffId?: number
): Promise<Map<number, QuarterTotals>> {
  const { start, end } = quarterRange(year, quarter);
  const months = quarterMonths(year, quarter);
  // 분기 경계에 걸친 운휴대기 짝도 판정하려면 앞뒤로 여유가 필요하다.
  const padded = padDateRange(start, end);

  let specialQuery = supabase
    .from("special_schedules")
    .select("staff_id, target_date, record_type, lottery_status")
    .gte("target_date", start)
    .lte("target_date", end);
  if (staffId !== undefined) {
    specialQuery = specialQuery.eq("staff_id", staffId);
  }

  const [monthlySchedules, specialResult, holidayResult, settingsResult] =
    await Promise.all([
      // 월 단위로 나눠 호출 후 합산. 각 호출은 내부에서 페이지네이션되므로
      // 행 수 한도에 잘리지 않는다.
      Promise.all(
        months.map((m, i) =>
          fetchScheduleByRange(
            // 첫 달은 앞으로, 마지막 달은 뒤로 여유를 둔다(분기 경계 짝 판정용).
            i === 0 ? padded.start : m.start,
            i === months.length - 1 ? padded.end : m.end
          )
        )
      ),
      specialQuery,
      supabase
        .from("holidays")
        .select("locdate")
        .eq("is_holiday", "Y")
        .gte("locdate", padded.start)
        .lte("locdate", padded.end),
      supabase
        .from("app_settings")
        .select(
          "weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules"
        )
        .eq("id", 1)
        .maybeSingle(),
    ]);

  const scheduleData: ScheduleRecord[] = [];
  for (const rows of monthlySchedules) {
    scheduleData.push(...rows);
  }
  if (specialResult.error) throw specialResult.error;
  if (holidayResult.error) throw holidayResult.error;

  const settings = settingsResult.data as {
    weekend_holiday_turns: string | null;
    jigeun_day_turns: string | null;
    jigeun_night_turns: string | null;
    holiday_turn_rules: string | null;
  } | null;
  const holidayRules = settings
    ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
    : DEFAULT_HOLIDAY_TURN_RULES;
  const weekendHolidayTurns = settings
    ? parseTurnsText(settings.weekend_holiday_turns)
    : DEFAULT_WEEKEND_HOLIDAY_TURNS;
  const jigeunTurns = settings
    ? {
        dayTurns: parseTurnsText(settings.jigeun_day_turns),
        nightTurns: parseTurnsText(settings.jigeun_night_turns),
      }
    : DEFAULT_JIGEUN_TURNS;

  const holidays = new Set<string>(
    (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
  );

  const acc = new Map<number, QuarterTotals>();
  const ensure = (id: number): QuarterTotals => {
    let r = acc.get(id);
    if (!r) {
      r = emptyQuarterTotals();
      acc.set(id, r);
    }
    return r;
  };

  // 운휴대기 치환 맵. 분기 밖(패딩) 날짜는 짝 판정용 context 로만 쓴다 —
  // 집계에 섞이면 분기 휴무 수가 부풀려진다.
  const regularByStaff = new Map<string, string>();
  const contextByStaff = new Map<string, string>();
  for (const row of scheduleData) {
    if (staffId !== undefined && row.staff_id !== staffId) continue;
    const dateStr = row.date ? format(new Date(row.date), "yyyy-MM-dd") : "";
    if (!dateStr) continue;
    const key = `${row.staff_id}|${dateStr}`;
    if (dateStr >= start && dateStr <= end) regularByStaff.set(key, row.turn);
    else contextByStaff.set(key, row.turn);
  }
  const displayByStaff = applyHolidayTurnRulesByStaffKey(
    regularByStaff,
    holidays,
    holidayRules,
    contextByStaff
  );

  // 정규 근무표: 휴무 / 운휴 집계.
  // 휴무는 치환 후 근무번호 기준, 운휴는 원본 기준.
  for (const row of scheduleData) {
    if (staffId !== undefined && row.staff_id !== staffId) continue;
    const dateStr = row.date ? format(new Date(row.date), "yyyy-MM-dd") : "";
    if (!dateStr) continue;
    if (dateStr < start || dateStr > end) continue; // 패딩 날짜는 집계 제외
    const r = ensure(row.staff_id);
    const key = `${row.staff_id}|${dateStr}`;
    if (isHueTurnOnDate(key, regularByStaff, displayByStaff, jigeunTurns)) {
      r.hueCount++;
    }
    const dayName = getDayName(dateStr);
    const isHoliday =
      dayName === "토" || dayName === "일" || holidays.has(dateStr);
    if (isHoliday && weekendHolidayTurns.includes(row.turn)) {
      r.weekendTurnCount++;
    }
  }

  // 지근/지휴 신청 내역. 추첨에서 떨어진 건은 근무가 취소된 것이라 실제로
  // 그날 일하지 않는다. 지근은 합계에서 1을 빼는 항목이므로(= 그날 나와서
  // 일했다) 탈락 건을 세면 일하지도 않은 날을 근무로 쳐서 합계가 1 적게
  // 나온다 — 탈락으로 휴무가 늘어난 직원이 24 로 보여 검증 목록에서 빠졌다.
  // 그래서 지근/지휴 카운트에서 제외하고, 탈락 건수는 lostCount 로만 센다.
  //
  // 추첨은 지근만 대상으로 하므로(admin-calendar 의 runLottery) 지휴가 lost
  // 가 될 일은 없지만, 관리자가 record_type 을 나중에 바꿀 수 있어 둘 다
  // 방어적으로 제외한다.
  for (const sp of (specialResult.data ?? []) as Array<{
    staff_id: number;
    target_date: string;
    record_type: RecordType;
    lottery_status: string | null;
  }>) {
    const r = ensure(sp.staff_id);
    if (sp.lottery_status === "lost") {
      r.lostCount++;
      continue;
    }
    if (sp.record_type === "지휴") r.jihyuCount++;
    else if (sp.record_type === "지근") r.jigeunCount++;
  }

  return acc;
}
