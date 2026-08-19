import { eachDayOfInterval, format, getDay, parse, startOfMonth, endOfMonth, addDays, startOfWeek, endOfWeek } from "date-fns";
import type {
  ScheduleRecord,
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
  RecordType,
  LotteryStatus,
} from "./types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  HOLIDAY_PAIR_REQUIRED_DAYS,
  isJigeunTurn,
} from "./types";

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

// 규칙을 모르는 상태에서 조회 범위를 넓힐 때 쓰는 여유 일수.
// 6일짜리 규칙(연휴 + 이어지는 근무)까지 커버한다. 이보다 긴 규칙을 쓰면
// 월 경계에 걸린 짝이 치환되지 않을 수 있으므로 이 값을 올려야 한다.
export const HOLIDAY_RULE_MAX_PAD_DAYS = 5;

// 운휴 번호는 승무소마다 다르므로 app_settings.weekend_holiday_turns 에서 로드.
// 호출부에서 명시적으로 전달하지 않은 경우의 안전망 기본값만 여기에 둔다.
export { DEFAULT_WEEKEND_HOLIDAY_TURNS } from "./types";

export function getTodayDateStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getTodayMonthStr(): string {
  return format(new Date(), "yyyy-MM");
}

// 연휴 근무 치환은 연속된 여러 날을 함께 봐야 하므로, 조회 범위 양끝에 여유를
// 둬야 월 경계에 걸친 짝(말일+익월 1~2일, 전월 말일~+1일)도 판정할 수 있다.
// 넓힌 범위의 날짜는 applyHolidayTurnRules 의 context 로만 쓰고 화면·집계에는
// 넣지 않는다.
//
// rules 를 넘기면 가장 긴 규칙에 맞춰 여유 일수를 정한다. 3일 규칙이면 말일에서
// 시작한 짝이 익월 2일까지 이어지므로 하루만 넓히면 매칭에 실패한다.
//
// 대부분의 호출부는 근무·공휴일·설정을 한 번에(Promise.all) 조회해서 이 시점에
// 규칙을 아직 모른다. 그래서 rules 를 생략하면 HOLIDAY_RULE_MAX_PAD_DAYS 만큼
// 넉넉히 넓힌다 — 조회 범위만 조금 늘 뿐, 넓힌 날짜는 context 로만 쓰이므로
// 화면·집계에는 영향이 없다.
export function padDateRange(
  start: string,
  end: string,
  rules?: HolidayTurnRule[]
): { start: string; end: string } {
  const days = rules
    ? Math.max(1, rules.reduce((m, r) => Math.max(m, r.from.length), 0) - 1)
    : HOLIDAY_RULE_MAX_PAD_DAYS;
  return {
    start: format(
      addDays(parse(start, "yyyy-MM-dd", new Date()), -days),
      "yyyy-MM-dd"
    ),
    end: format(
      addDays(parse(end, "yyyy-MM-dd", new Date()), days),
      "yyyy-MM-dd"
    ),
  };
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

// 정원 한 자리를 차지한 지근 신청인지.
//
// 추첨 탈락(lost)은 그 날 근무하지 않기로 확정된 건이므로 자리를 비운 것으로
// 본다. 이 규칙 하나가 두 가지를 동시에 해결한다:
//  - 추첨 직후 '정원 초과' 표시가 풀린다(5명 신청 → 당첨 4 + 탈락 1 = 4/4).
//  - 그 날은 꽉 찬 상태가 되어 탈락자가 같은 날에 다시 신청하지 못한다.
// 반대로 lost 를 포함해 세면, 정원이 줄었거나 당첨자가 삭제되어 실제로는
// 자리가 비었는데도 영원히 막히게 된다.
//
// 주의: lottery_status 를 select 하지 않은 호출부에서는 undefined 가 되어
// 모두 '자리 차지'로 계산된다(= 추첨 이전과 같은 동작).
export function occupiesJigeunSlot(entry: {
  record_type: RecordType;
  lottery_status?: LotteryStatus | null;
}): boolean {
  return entry.record_type === "지근" && entry.lottery_status !== "lost";
}

// 그 날짜에서 정원을 차지한 지근 인원수.
// entries 는 호출부에서 직책별로 걸러 넘긴다(정원은 직책별로 따로 적용된다).
export function countJigeunSlots(
  entries: Array<{
    record_type: RecordType;
    lottery_status?: LotteryStatus | null;
  }>
): number {
  return entries.filter(occupiesJigeunSlot).length;
}

// isSubstituted: 운휴대기(연휴 짝 치환)가 적용된 칸이면 true.
// 이때 turnText 는 '치환 후' 근무번호여야 한다.
// 치환 칸의 색은 휴무 카운트 기준과 일치시킨다:
//   - 치환 결과에 '휴' 가 있으면(휴77 등) 다른 휴무처럼 빨강 — 휴무로 집계되므로.
//   - 그 외(지(야), 지(야)~ 등)는 하늘색 — 집계에서 빠지므로.
// 인자를 생략하면 기존 동작 그대로.
export function getTurnColorClass(
  turnText: string,
  dateString: string,
  holidays?: Set<string>,
  weekendHolidayTurns: string[] = DEFAULT_WEEKEND_HOLIDAY_TURNS,
  jigeunTurns: JigeunTurnSettings = DEFAULT_JIGEUN_TURNS,
  isSubstituted = false
): string {
  if (isSubstituted) {
    return isHueTurn(turnText, jigeunTurns)
      ? "bg-red-100 dark:bg-red-900/40"
      : "bg-sky-100 dark:bg-sky-900/40";
  }

  const dayName = getDayName(dateString);
  const isHoliday = dayName === "토" || dayName === "일" || !!holidays?.has(dateString);

  if (isHoliday && weekendHolidayTurns.includes(turnText)) {
    return "bg-red-100 dark:bg-red-900/40";
  }
  // 주간/야간 지정근무는 배경색이 동일하다. 구분은 호출부의 '지(주)'/'지(야)' 배지로.
  if (isJigeunTurn(turnText, jigeunTurns)) {
    return "bg-sky-100 dark:bg-sky-900/40";
  }
  if (turnText.includes("휴")) return "bg-red-100 dark:bg-red-900/40";
  if (turnText.includes("대")) return "bg-green-100 dark:bg-green-900/40";
  if (turnText.includes("~")) return "bg-gray-200 dark:bg-gray-700";

  return "";
}

// getTurnColorClass 의 엑셀(ExcelJS) 버전. 색이 없으면 null.
// 우선순위: 사용자가 신청한 지근/지휴 > 휴무·운휴(빨강) > 운휴대기 치환(하늘) > 지정근무(하늘).
//
// 신청(special)이 가장 우선이다. 신청 칸은 옅은 색과 확실히 구별되도록 진한 색을 쓴다:
//   - 지근: 진한 파랑(sky-300) — 지정근무·운휴대기의 옅은 하늘색(sky-100)과 구별.
//   - 지휴: 진한 빨강(red-300) — 일반 휴무·운휴의 옅은 빨강(red-100)과 구별.
// 진한 바탕에서도 검은 글씨가 읽히도록 300 계열까지만 쓴다.
//
// isRest 는 호출부에서 isHueTurnOnDate + 주말운휴로 이미 판정한 값을 넘긴다.
// turnText 는 '치환 후' 근무번호여야 셀의 지(주)/지(야) 배지와 기준이 일치한다.
// 주간/야간 지정근무는 배경색이 동일하다. 구분은 셀 텍스트의 '지(주)'/'지(야)' 배지로.
// 화면의 '대'(초록)/'~'(회색)은 엑셀에서는 색을 넣지 않는다(기존 동작 유지).
export function getTurnExcelFill(
  turnText: string,
  isRest: boolean,
  isSubstituted: boolean,
  jigeunTurns: JigeunTurnSettings = DEFAULT_JIGEUN_TURNS,
  special?: RecordType | null
): string | null {
  if (special === "지근") return "FF7DD3FC"; // sky-300
  if (special === "지휴") return "FFFCA5A5"; // red-300
  if (isRest) return "FFFEE2E2"; // red-100
  if (isSubstituted) return "FFE0F2FE"; // sky-100
  if (isJigeunTurn(turnText, jigeunTurns)) return "FFE0F2FE"; // sky-100
  return null;
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

// 연휴 근무 치환(표시 전용).
// 규칙의 from 과 연속된 날들의 근무가 순서대로 정확히 일치하고, '앞 2일'이 모두
// 토/일/공휴일일 때 그 날들을 to 로 바꾼 새 Map 을 반환한다.
// 3일 이상 규칙의 3일째부터는 휴일 여부를 보지 않는다 — 연휴 다음 근무일까지
// 이어지는 근무를 표현하기 위함(HOLIDAY_PAIR_REQUIRED_DAYS 참고).
// 앞 2일 중 하나라도 휴일이 아니면 치환하지 않는다.
//
// context 는 turnByDate 범위 밖(예: 전월 말일·익월 1일)의 근무를 짝 판정에만
// 쓰기 위한 보조 맵이다. 월 경계에 걸친 짝도 치환되게 하되, context 의 날짜는
// 결과 Map 에 절대 넣지 않는다 — 호출부의 월 단위 집계·순회를 오염시키지 않기 위함.
// (turnByDate 에 있는 날짜는 언제나 turnByDate 값이 우선한다.)
//
// 주의: 통계(휴무/운휴/총휴/분기밸런스)는 반드시 원본 Map 을 계속 사용해야 한다.
// 규칙이 없으면 입력 Map 을 그대로(참조 동일) 반환하므로 미설정 시 완전 무동작.
export function applyHolidayTurnRules(
  turnByDate: Map<string, string>,
  holidays: Set<string> | undefined,
  rules: HolidayTurnRule[],
  context?: Map<string, string>
): Map<string, string> {
  if (rules.length === 0 || turnByDate.size === 0) return turnByDate;

  const result = new Map(turnByDate);
  // 짝 판정에는 context 를 포함해 보되, 실제 치환 기록은 turnByDate 날짜에만 남긴다.
  const lookup = (date: string): string | undefined =>
    turnByDate.get(date) ?? context?.get(date);
  const dates = [
    ...new Set([...turnByDate.keys(), ...(context?.keys() ?? [])]),
  ].sort();
  // 이미 짝으로 소비된 날짜는 다른 짝에 재사용하지 않는다(좌→우 greedy, 비중첩).
  const consumed = new Set<string>();
  // 긴 규칙을 먼저 시도한다 — 3일 규칙이 2일 규칙의 접두사와 겹칠 때 긴 쪽이 이겨야
  // 사용자가 의도한 '더 구체적인' 규칙이 적용된다.
  const ordered = [...rules].sort((a, b) => b.from.length - a.from.length);

  const nextDate = (date: string): string =>
    format(addDays(parse(date, "yyyy-MM-dd", new Date()), 1), "yyyy-MM-dd");

  for (const startDate of dates) {
    if (consumed.has(startDate)) continue;

    for (const rule of ordered) {
      // 규칙 길이만큼 연속된 날짜를 모으며 근무번호가 순서대로 맞는지 본다.
      const runDates: string[] = [];
      let date = startDate;
      let matched = true;
      for (let i = 0; i < rule.from.length; i++) {
        if (consumed.has(date) || lookup(date) !== rule.from[i]) {
          matched = false;
          break;
        }
        // 앞 2일만 휴일이어야 한다. 3일째부터는 휴일 여부와 무관.
        if (
          i < HOLIDAY_PAIR_REQUIRED_DAYS &&
          !isWeekendOrHoliday(date, holidays)
        ) {
          matched = false;
          break;
        }
        runDates.push(date);
        date = nextDate(date);
      }
      if (!matched) continue;

      // context 전용 날짜는 짝 성립에만 기여하고 결과에는 남기지 않는다.
      runDates.forEach((d, i) => {
        if (turnByDate.has(d)) result.set(d, rule.to[i]);
        consumed.add(d);
      });
      break; // 이 시작일은 소비됨 — 다른 규칙은 시도하지 않는다.
    }
  }

  return result;
}

// 운휴대기(연휴 짝 치환) 표시용 한 칸 정보.
// substituted 가 null 이면 치환이 없었던 날 — 기존처럼 original 한 줄만 표시한다.
// 치환된 날은 위에 original(원래근무), 아래에 substituted(대치근무)를 함께 보여준다.
export interface TurnDisplay {
  original: string;
  substituted: string | null;
}

// 원본 Map 과 치환 Map 을 비교해 한 날짜(또는 'staffId|date' 키)의 표시 정보를 만든다.
// 렌더 지점마다 비교 로직을 새로 쓰지 않도록 이 헬퍼 하나만 쓴다.
// 원본에 값이 없으면 null(빈 칸).
export function getTurnDisplay(
  key: string,
  originalMap: Map<string, string>,
  displayMap: Map<string, string>
): TurnDisplay | null {
  const original = originalMap.get(key);
  if (original === undefined) return null;
  const display = displayMap.get(key);
  return {
    original,
    substituted: display !== undefined && display !== original ? display : null,
  };
}

// 휴무 카운트 대상인지 판정.
// 중요: 운휴대기 치환이 걸린 날은 '치환 후' 근무번호로 판정한다 —
// 화면에 지(야)~ 로 보이는데 휴무로 세거나, 휴79 로 보이는데 안 세면 어긋난다.
// (운휴 카운트는 이와 달리 계속 원본 근무번호를 쓴다.)
// 지정근무 번호는 '휴' 를 포함해도 휴무가 아니다.
export function isHueTurn(
  turn: string,
  jigeunTurns: JigeunTurnSettings
): boolean {
  return turn.includes("휴") && !isJigeunTurn(turn, jigeunTurns);
}

// 원본/치환 Map 을 받아 그 날짜의 휴무 여부를 판정한다.
// 치환이 없으면 원본 근무번호로 판정하므로 기존 동작과 동일하다.
export function isHueTurnOnDate(
  key: string,
  originalMap: Map<string, string>,
  displayMap: Map<string, string>,
  jigeunTurns: JigeunTurnSettings
): boolean {
  const d = getTurnDisplay(key, originalMap, displayMap);
  if (!d) return false;
  return isHueTurn(d.substituted ?? d.original, jigeunTurns);
}

// 치환 여부만 필요할 때(배경색 판정 등).
export function isSubstitutedTurn(
  key: string,
  originalMap: Map<string, string>,
  displayMap: Map<string, string>
): boolean {
  return getTurnDisplay(key, originalMap, displayMap)?.substituted != null;
}

// 'staffId|date' 키 맵용 래퍼. staff 별로 쪼개 치환한 뒤 다시 합친다.
// context 도 같은 'staffId|date' 형식이며, 월 경계 짝 판정용으로만 쓰인다
// (결과 Map 에는 turnByStaffDate 의 키만 남는다 — applyHolidayTurnRules 참고).
export function applyHolidayTurnRulesByStaffKey(
  turnByStaffDate: Map<string, string>,
  holidays: Set<string> | undefined,
  rules: HolidayTurnRule[],
  context?: Map<string, string>
): Map<string, string> {
  if (rules.length === 0 || turnByStaffDate.size === 0) return turnByStaffDate;

  const splitByStaff = (src: Map<string, string>) => {
    const perStaff = new Map<string, Map<string, string>>();
    for (const [key, turn] of src) {
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
    return perStaff;
  };

  const perStaff = splitByStaff(turnByStaffDate);
  const perStaffContext = context ? splitByStaff(context) : undefined;

  const out = new Map(turnByStaffDate);
  for (const [staffId, m] of perStaff) {
    const sub = applyHolidayTurnRules(
      m,
      holidays,
      rules,
      perStaffContext?.get(staffId)
    );
    if (sub === m) continue;
    for (const [date, turn] of sub) out.set(`${staffId}|${date}`, turn);
  }
  return out;
}
