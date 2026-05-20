import { eachDayOfInterval, format, getDay, parse, startOfMonth, endOfMonth, addDays, startOfWeek, endOfWeek } from "date-fns";
import type { ScheduleRecord, JigeunCaps } from "./types";
import { DEFAULT_JIGEUN_CAPS, DEFAULT_WEEKEND_HOLIDAY_TURNS } from "./types";

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
  weekendHolidayTurns: string[] = DEFAULT_WEEKEND_HOLIDAY_TURNS
): string {
  const dayName = getDayName(dateString);
  const isHoliday = dayName === "토" || dayName === "일" || !!holidays?.has(dateString);

  if (isHoliday && weekendHolidayTurns.includes(turnText)) {
    return "bg-red-100 dark:bg-red-900/40";
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
