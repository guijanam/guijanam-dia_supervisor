// 근무표 엑셀의 '한 직원 · 한 달' 셀 생성 로직.
//
// 월간 근무표(admin-calendar 의 exportExcel)와 분기 병합 근무표
// (exportQuarterExcel)가 이 함수들을 공유한다. 셀 텍스트 규칙(지근 병기,
// 지휴·운휴대기 두 줄)과 휴무 집계 공식이 두 벌로 갈라지면 같은 직원의 같은 날이
// 두 파일에서 다르게 보이므로, 반드시 여기 한 곳만 쓴다.
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import type {
  RecordType,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import { getJigeunKind, getJigeunBadgeLabel } from "@/lib/types";
import {
  getDayName,
  padDateRange,
  applyHolidayTurnRulesByStaffKey,
  getTurnDisplay,
  isHueTurnOnDate,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";

/** 엑셀 한 칸. text 는 그대로 쓰고, 나머지는 getTurnExcelFill 인자로 쓴다. */
export interface ExcelCell {
  text: string;
  isRest: boolean;
  isSubstituted: boolean;
  // 지정근무 배경색 판정용(치환 후 값). 셀의 지(주)/지(야) 배지와 기준이 같다.
  turn: string;
  // 사용자가 신청한 지근/지휴. 배경색에서 가장 우선한다.
  special: RecordType | null;
}

/** 한 직원 · 한 달의 휴무 집계 원재료. */
export interface MonthTotals {
  hueCount: number;
  weekendTurnCount: number;
  jigeunCount: number;
  jihyuCount: number;
}

/** 총휴무 = 휴무 + 운휴 + 지휴 − 지근 (분기휴무 검증 화면과 동일 공식). */
export function monthRestTotal(t: MonthTotals): number {
  return t.hueCount + t.weekendTurnCount + t.jihyuCount - t.jigeunCount;
}

/** 한 달치 근무·신청·공휴일 맵. buildMonthMaps 의 결과. */
export interface MonthMaps {
  /** 그 달의 날짜 목록(yyyy-MM-dd, 1일~말일). */
  dates: string[];
  /** 'staffId|date' → 원본 교번. 통계는 이 원본을 쓴다. */
  regularByStaff: Map<string, string>;
  /** 'staffId|date' → 운휴대기 치환 후 교번. 표시는 이 쪽을 쓴다. */
  displayByStaff: Map<string, string>;
  /** 'staffId|date' → 지근/지휴 신청. */
  specialByStaff: Map<string, RecordType>;
  /** 그 달(+패딩)의 공휴일. */
  holidaySet: Set<string>;
}

/**
 * 한 달치 근무·신청·공휴일을 조회해 맵으로 만든다.
 *
 * 근무는 월 경계에 걸친 연휴 짝을 판정하려고 앞뒤로 패딩해서 받되, 패딩 날짜는
 * context 로만 쓰고 결과 맵에는 넣지 않는다 — 집계에 섞이면 휴무 수가 부풀려진다.
 */
export async function buildMonthMaps(
  monthValue: string,
  holidayTurnRules: HolidayTurnRule[]
): Promise<MonthMaps> {
  const [year, month] = monthValue.split("-").map(Number);
  const monthStart = startOfMonth(new Date(year, month - 1));
  const monthEnd = endOfMonth(monthStart);
  const start = format(monthStart, "yyyy-MM-dd");
  const end = format(monthEnd, "yyyy-MM-dd");
  const padded = padDateRange(start, end);

  const [scheduleRows, specialResult, holidayResult] = await Promise.all([
    fetchScheduleByRange(padded.start, padded.end),
    supabase
      .from("special_schedules")
      .select("staff_id, target_date, record_type")
      .gte("target_date", start)
      .lte("target_date", end),
    supabase
      .from("holidays")
      .select("locdate")
      .eq("is_holiday", "Y")
      .gte("locdate", padded.start)
      .lte("locdate", padded.end),
  ]);

  if (specialResult.error) throw specialResult.error;
  if (holidayResult.error) throw holidayResult.error;

  const holidaySet = new Set<string>(
    (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
  );

  const dates: string[] = [];
  for (
    let d = monthStart;
    d <= monthEnd;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  ) {
    dates.push(format(d, "yyyy-MM-dd"));
  }

  const regularByStaff = new Map<string, string>();
  const contextByStaff = new Map<string, string>();
  for (const row of scheduleRows) {
    const dateStr = row.date ? format(new Date(row.date), "yyyy-MM-dd") : "";
    if (!dateStr) continue;
    const key = `${row.staff_id}|${dateStr}`;
    if (dateStr >= start && dateStr <= end) regularByStaff.set(key, row.turn);
    else contextByStaff.set(key, row.turn);
  }
  const displayByStaff = applyHolidayTurnRulesByStaffKey(
    regularByStaff,
    holidaySet,
    holidayTurnRules,
    contextByStaff
  );

  const specialByStaff = new Map<string, RecordType>();
  for (const row of (specialResult.data ?? []) as Array<{
    staff_id: number;
    target_date: string;
    record_type: RecordType;
  }>) {
    specialByStaff.set(`${row.staff_id}|${row.target_date}`, row.record_type);
  }

  return { dates, regularByStaff, displayByStaff, specialByStaff, holidaySet };
}

/**
 * 한 직원 · 한 달치 셀 배열과 휴무 집계를 만든다.
 *
 * 각 칸은 정규 교번에 신청 구분을 병기한다. 지근은 한 줄(예: 58(지근)),
 * 지휴는 운휴대기와 같이 두 줄(원래근무 / 지휴).
 * 집계는 연휴 치환 전 원본 교번 기준(휴무만 치환 후 값으로 판정).
 */
export function buildEmployeeMonthCells(args: {
  staffId: number;
  maps: MonthMaps;
  jigeunTurns: JigeunTurnSettings;
  weekendHolidayTurns: string[];
}): { cells: ExcelCell[]; totals: MonthTotals } {
  const { staffId, maps, jigeunTurns, weekendHolidayTurns } = args;
  const { dates, regularByStaff, displayByStaff, specialByStaff, holidaySet } =
    maps;

  const totals: MonthTotals = {
    hueCount: 0,
    weekendTurnCount: 0,
    jigeunCount: 0,
    jihyuCount: 0,
  };

  const cells = dates.map((date): ExcelCell => {
    const key = `${staffId}|${date}`;
    const rawTurn = regularByStaff.get(key);
    // 휴무는 운휴대기 치환 후 값으로 판정한다(화면·달력 집계와 동일).
    // 운휴는 계속 원본 근무번호 기준.
    // 지정근무 번호(예: 휴(지))는 화면에서 하늘색이므로 휴무에서 제외한다.
    let isHue = false;
    let isWeekendTurn = false;
    if (rawTurn) {
      isHue = isHueTurnOnDate(key, regularByStaff, displayByStaff, jigeunTurns);
      if (isHue) totals.hueCount++;
      const dayName = getDayName(date);
      const isHoliday =
        dayName === "토" || dayName === "일" || holidaySet.has(date);
      isWeekendTurn = isHoliday && weekendHolidayTurns.includes(rawTurn);
      if (isWeekendTurn) totals.weekendTurnCount++;
    }

    const special = specialByStaff.get(key);
    if (special === "지근") totals.jigeunCount++;
    else if (special === "지휴") totals.jihyuCount++;

    const turn = displayByStaff.get(key) ?? "";
    // 운휴대기 치환 칸은 원래근무(윗줄)/대치근무(아랫줄) 두 줄로 적는다.
    const substituted =
      getTurnDisplay(key, regularByStaff, displayByStaff)?.substituted ?? null;
    const turnText = substituted ? `${rawTurn}\n${substituted}` : turn;
    // 지정근무면 근무번호 뒤에 지(주)/지(야)를 덧붙인다. 신청(지근/지휴)이
    // 있는 날은 그 신청 구분을 우선 표시한다.
    const kind = turn ? getJigeunKind(turn, jigeunTurns) : null;
    // 지휴 신청 칸은 운휴대기와 같은 방식으로 원래근무(윗줄)/지휴(아랫줄)
    // 두 줄로 적는다. 지근은 기존처럼 한 줄로 병기한다(예: 58(지근)).
    const text = !special
      ? kind
        ? `${turnText} ${getJigeunBadgeLabel(kind)}`
        : turnText
      : special === "지휴"
        ? turnText
          ? `${turnText}\n${special}`
          : special
        : turnText
          ? `${turnText}(${special})`
          : special;

    return {
      text,
      isRest: isHue || isWeekendTurn,
      isSubstituted: substituted != null,
      turn,
      special: special ?? null,
    };
  });

  return { cells, totals };
}
