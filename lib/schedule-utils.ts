import { eachDayOfInterval, format, getDay, parse, startOfMonth, endOfMonth, addDays, startOfWeek, endOfWeek } from "date-fns";
import type { ScheduleRecord, JigeunCaps, HolidayTurnRule } from "./types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_NUMBER_TURNS,
} from "./types";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 운휴 번호는 승무소마다 다르므로 app_settings.weekend_holiday_turns 에서 로드.
// 호출부에서 명시적으로 전달하지 않은 경우의 안전망 기본값만 여기에 둔다.
export { DEFAULT_WEEKEND_HOLIDAY_TURNS } from "./types";

export function getTodayDateStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getTodayMonthStr(): string {
  return format(new Date(), "yyyy-MM");
}

export function generateDateRange(start: string, end: string): string[] {
  const startDate = parse(start, "yyyy-MM-dd", new Date());
  const endDate = parse(end, "yyyy-MM-dd", new Date());
  return eachDayOfInterval({ start: startDate, end: endDate }).map((d) =>
    format(d, "yyyy-MM-dd")
  );
}

export function getDayName(dateString: string): string {
  const date = parse(dateString, "yyyy-MM-dd", new Date());
  return DAY_NAMES[getDay(date)];
}

export function getDayColorClass(dateString: string, holidays?: Set<string>): string {
  if (holidays?.has(dateString)) return "text-red-500";
  const dayName = getDayName(dateString);
  if (dayName === "토") return "text-blue-500";
  if (dayName === "일") return "text-red-500";
  return "";
}

// getDayColorClass 의 엑셀(ExcelJS) 버전. 색이 없으면 null.
export function getDayExcelColor(
  dateString: string,
  holidays?: Set<string>
): string | null {
  if (holidays?.has(dateString)) return "FFDC2626";
  const dayName = getDayName(dateString);
  if (dayName === "토") return "FF2563EB";
  if (dayName === "일") return "FFDC2626";
  return null;
}

// 요일/공휴일 구분별 지근 정원 (직책 공통).
// 우선순위: 공휴일 > 토 > 일 > 평일. caps 미전달 시 기본값 사용.
export function getPositionCap(
  dateString: string,
  holidays?: Set<string>,
  caps: JigeunCaps = DEFAULT_JIGEUN_CAPS
): number {
  if (holidays?.has(dateString)) return caps.holiday;
  const dayName = getDayName(dateString);
  if (dayName === "토") return caps.saturday;
  if (dayName === "일") return caps.sunday;
  return caps.weekday;
}

export function getTurnColorClass(
  turnText: string,
  dateString: string,
  holidays?: Set<string>,
  weekendHolidayTurns: string[] = DEFAULT_WEEKEND_HOLIDAY_TURNS,
  jigeunNumberTurns: string[] = DEFAULT_JIGEUN_NUMBER_TURNS
): string {
  const dayName = getDayName(dateString);
  const isHoliday = dayName === "토" || dayName === "일" || !!holidays?.has(dateString);

  if (isHoliday && weekendHolidayTurns.includes(turnText)) {
    return "bg-red-100 dark:bg-red-900/40";
  }
  if (jigeunNumberTurns.includes(turnText)) {
    return "bg-sky-100 dark:bg-sky-900/40";
  }
  if (turnText.includes("휴")) return "bg-red-100 dark:bg-red-900/40";
  if (turnText.includes("대")) return "bg-green-100 dark:bg-green-900/40";
  if (turnText.includes("~")) return "bg-gray-200 dark:bg-gray-700";

  return "";
}

export function computeScheduleRange(
  monthValue: string
): { start: string; end: string } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [year, month] = monthValue.split("-").map(Number);
  const selectedStart = startOfMonth(new Date(year, month - 1));
  const selectedEnd = endOfMonth(new Date(year, month - 1));

  if (selectedEnd < today) return null;

  const queryStart = selectedStart < today ? today : selectedStart;

  return {
    start: format(queryStart, "yyyy-MM-dd"),
    end: format(selectedEnd, "yyyy-MM-dd"),
  };
}

export function computeInitialRange(): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = addDays(today, 30);
  return {
    start: format(today, "yyyy-MM-dd"),
    end: format(end, "yyyy-MM-dd"),
  };
}

// 월간 달력용: 해당 월을 포함하는 주(일~토) 단위 날짜 그리드
export function getCalendarGrid(monthValue: string): string[] {
  const [year, month] = monthValue.split("-").map(Number);
  const firstOfMonth = startOfMonth(new Date(year, month - 1));
  const lastOfMonth = endOfMonth(new Date(year, month - 1));
  const gridStart = startOfWeek(firstOfMonth, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(lastOfMonth, { weekStartsOn: 0 });
  return eachDayOfInterval({ start: gridStart, end: gridEnd }).map((d) =>
    format(d, "yyyy-MM-dd")
  );
}

export function isSameMonth(dateString: string, monthValue: string): boolean {
  return dateString.slice(0, 7) === monthValue;
}

export function buildScheduleMap(
  data: ScheduleRecord[],
  position: string,
  searchFilter: string
): { names: string[]; scheduleMap: Map<string, Map<string, string>> } {
  const trimmedPosition = position.trim();
  const search = searchFilter.trim().toLowerCase();

  const filtered = data.filter(
    (record) =>
      record.staff_position?.trim() === trimmedPosition &&
      record.name.toLowerCase().includes(search)
  );

  const nameMap = new Map<string, Map<string, string>>();
  for (const item of filtered) {
    if (!nameMap.has(item.name)) {
      nameMap.set(item.name, new Map());
    }
    const dateStr = item.date ? format(new Date(item.date), "yyyy-MM-dd") : "";
    if (dateStr) {
      nameMap.get(item.name)!.set(dateStr, item.turn);
    }
  }

  const names = [...nameMap.keys()].sort();
  return { names, scheduleMap: nameMap };
}

// 토/일/공휴일 판정. 앱 전체에서 동일한 술어를 쓰기 위한 헬퍼.
function isWeekendOrHoliday(
  dateString: string,
  holidays?: Set<string>
): boolean {
  const dayName = getDayName(dateString);
  return dayName === "토" || dayName === "일" || !!holidays?.has(dateString);
}

// 연휴 짝 치환(표시 전용).
// (N일, N+1일) 이 모두 토/일/공휴일이고 두 날의 근무가 규칙의 (fromA, fromB) 와
// 정확히 일치할 때만 두 날을 (toA, toB) 로 바꾼 새 Map 을 반환한다.
// 한쪽만 휴일이거나 N+1일 데이터가 없으면(월말 경계 등) 치환하지 않는다.
//
// 주의: 통계(휴무/운휴/총휴/분기밸런스)는 반드시 원본 Map 을 계속 사용해야 한다.
// 규칙이 없으면 입력 Map 을 그대로(참조 동일) 반환하므로 미설정 시 완전 무동작.
export function applyHolidayTurnRules(
  turnByDate: Map<string, string>,
  holidays: Set<string> | undefined,
  rules: HolidayTurnRule[]
): Map<string, string> {
  if (rules.length === 0 || turnByDate.size === 0) return turnByDate;

  const result = new Map(turnByDate);
  const dates = [...turnByDate.keys()].sort();
  // 이미 짝으로 소비된 날짜는 다른 짝에 재사용하지 않는다(좌→우 greedy, 비중첩).
  const consumed = new Set<string>();

  for (const dateA of dates) {
    if (consumed.has(dateA)) continue;
    const turnA = turnByDate.get(dateA)!;
    const dateB = format(
      addDays(parse(dateA, "yyyy-MM-dd", new Date()), 1),
      "yyyy-MM-dd"
    );
    const turnB = turnByDate.get(dateB);
    if (turnB === undefined) continue; // N+1일 행 없음(조회 범위 밖 등)
    if (consumed.has(dateB)) continue;
    if (
      !isWeekendOrHoliday(dateA, holidays) ||
      !isWeekendOrHoliday(dateB, holidays)
    ) {
      continue; // 둘 다 휴일일 때만 치환
    }
    const rule = rules.find((r) => r.fromA === turnA && r.fromB === turnB);
    if (!rule) continue;
    result.set(dateA, rule.toA);
    result.set(dateB, rule.toB);
    consumed.add(dateA);
    consumed.add(dateB);
  }

  return result;
}

// 'staffId|date' 키 맵용 래퍼. staff 별로 쪼개 치환한 뒤 다시 합친다.
export function applyHolidayTurnRulesByStaffKey(
  turnByStaffDate: Map<string, string>,
  holidays: Set<string> | undefined,
  rules: HolidayTurnRule[]
): Map<string, string> {
  if (rules.length === 0 || turnByStaffDate.size === 0) return turnByStaffDate;

  const perStaff = new Map<string, Map<string, string>>();
  for (const [key, turn] of turnByStaffDate) {
    const i = key.indexOf("|");
    if (i < 0) continue;
    const staffId = key.slice(0, i);
    const date = key.slice(i + 1);
    let m = perStaff.get(staffId);
    if (!m) {
      m = new Map();
      perStaff.set(staffId, m);
    }
    m.set(date, turn);
  }

  const out = new Map(turnByStaffDate);
  for (const [staffId, m] of perStaff) {
    const sub = applyHolidayTurnRules(m, holidays, rules);
    if (sub === m) continue;
    for (const [date, turn] of sub) out.set(`${staffId}|${date}`, turn);
  }
  return out;
}
