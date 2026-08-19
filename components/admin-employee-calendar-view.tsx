"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import type {
  Employee,
  RecordType,
  SpecialSchedule,
  HolidayTurnRule,
  JigeunTurnSettings,
  JigeunCaps,
  LotteryStatus,
} from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_JIGEUN_CAPS,
  parseTurnsText,
  parseHolidayTurnRulesText,
  getJigeunKind,
  getJigeunBadgeLabel,
} from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
  getPositionCap,
  countJigeunSlots,
  applyHolidayTurnRules,
  applyHolidayTurnRulesByStaffKey,
  padDateRange,
  getTurnDisplay,
  isHueTurnOnDate,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { DayModal } from "@/components/day-modal";
import type { DayEntry } from "@/components/user-calendar";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface AdminEmployeeCalendarViewProps {
  staff: {
    staff_id: number;
    staff_name: string;
    staff_position: string;
  };
  monthValue: string;
  // 지근/지휴가 등록·삭제됐을 때 부모에게 알린다. 이 뷰를 감싼 화면(분기 휴무
  // 검증 등)이 자기 집계를 다시 계산할 수 있도록 하기 위한 선택적 콜백.
  onDataChanged?: () => void;
  // 관리자 권한 안내 배너 표시 여부. 이미 "누구의 캘린더인지" 를 헤더에서
  // 밝히는 모달 안에서는 중복이라 끌 수 있게 한다.
  showAdminNotice?: boolean;
}

// 관리자가 특정 직원의 캘린더를 사용자 본인 시점으로 보고
// 그 직원의 지근/지휴를 등록·삭제할 수 있는 뷰.
// user-calendar의 캘린더 본문 로직을 staff prop 기반으로 일반화한 버전.
export function AdminEmployeeCalendarView({
  staff,
  monthValue,
  onDataChanged,
  showAdminNotice = true,
}: AdminEmployeeCalendarViewProps) {
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  // 월 밖(전월 말일·익월 1일) 근무. 연휴 짝 판정에만 쓰고 집계·표시에는 쓰지 않는다.
  const [regularContext, setRegularContext] = useState<Map<string, string>>(
    new Map()
  );
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
    new Map()
  );
  const [allEntriesMap, setAllEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  // 정원 카운트 전용 맵. allEntriesMap 은 화면에 동료 이름을 띄우지 않으려고
  // 대상 직원 것만 담으므로 정원을 셀 수 없다. 이쪽은 같은 직책 전원을 담는다.
  const [slotEntriesMap, setSlotEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  // 요일/공휴일별 지근 정원. 관리자에게는 표시만 하고 등록을 막지는 않는다.
  const [caps, setCaps] = useState<JigeunCaps>(DEFAULT_JIGEUN_CAPS);
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  // 화면 표시용 근무 맵(운휴대기 치환 적용). 아래 monthStats 의 휴무 판정에도 쓴다.
  const displayTurnMap = useMemo(
    () =>
      applyHolidayTurnRules(
        regularMap,
        holidays,
        holidayTurnRules,
        regularContext
      ),
    [regularMap, holidays, holidayTurnRules, regularContext]
  );

  // 휴무는 치환 후 근무번호로 세고(화면 표시와 일치), 운휴·지근·지휴는 원본 기준.
  const monthStats = useMemo(() => {
    let hueCount = 0;
    let weekendTurnCount = 0;
    for (const [date, turn] of regularMap) {
      if (!isSameMonth(date, monthValue)) continue;
      // 휴무는 운휴대기 치환 후 값으로 판정한다(화면 표시와 일치).
      if (isHueTurnOnDate(date, regularMap, displayTurnMap, jigeunTurns)) {
        hueCount++;
      }
      // 운휴는 계속 원본 근무번호 기준.
      const dayName = getDayName(date);
      const isHoliday =
        dayName === "토" || dayName === "일" || holidays.has(date);
      if (isHoliday && weekendHolidayTurns.includes(turn)) weekendTurnCount++;
    }

    let jigeunCount = 0;
    let jihyuCount = 0;
    for (const [date, sp] of specialMap) {
      if (!isSameMonth(date, monthValue)) continue;
      if (sp.record_type === "지근") jigeunCount++;
      else if (sp.record_type === "지휴") jihyuCount++;
    }

    const totalRest = hueCount + weekendTurnCount + jihyuCount - jigeunCount;
    return { hueCount, weekendTurnCount, jigeunCount, jihyuCount, totalRest };
  }, [
    regularMap,
    displayTurnMap,
    specialMap,
    holidays,
    monthValue,
    weekendHolidayTurns,
    jigeunTurns,
  ]);

  // 날짜별 지근 정원 현황(대상 직원의 직책 기준). 관리자가 날짜를 고르기 전에
  // 어느 날이 이미 찼는지 보이게 하는 것이 목적이라, 그리드에 그려지는 날짜를
  // 전부 돌아야 한다 — slotEntriesMap 만 돌면 신청이 없는 날(0/4)이 빠진다.
  //
  // isLoading 중에는 holidays 가 아직 비어 있어 공휴일이 평일 정원으로 잘못
  // 계산되므로 판정을 보류한다(빈 맵 → 뱃지 숨김).
  const slotByDate = useMemo(() => {
    const m = new Map<string, { cap: number; used: number }>();
    if (isLoading) return m;
    for (const date of grid) {
      m.set(date, {
        cap: getPositionCap(date, holidays, caps),
        used: countJigeunSlots(slotEntriesMap.get(date) ?? []),
      });
    }
    return m;
  }, [grid, isLoading, holidays, caps, slotEntriesMap]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    // 월 경계에 걸친 연휴 짝을 판정하려면 앞뒤 하루가 더 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [scheduleRows, specialResult, holidayResult, settingsResult] =
        await Promise.all([
          fetchScheduleByRange(padded.start, padded.end),
          supabase
            .from("special_schedules")
            .select("id, staff_id, target_date, record_type, lottery_status")
            .gte("target_date", start)
            .lte("target_date", end)
            .order("target_date", { ascending: true }),
          supabase
            .from("holidays")
            .select("locdate")
            .eq("is_holiday", "Y")
            .gte("locdate", padded.start)
            .lte("locdate", padded.end),
          supabase
            .from("app_settings")
            .select("weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules, jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday")
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (specialResult.error) throw specialResult.error;

      const settings = settingsResult.data as {
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
      } | null;
      setCaps(
        settings
          ? {
              weekday: settings.jigeun_cap_weekday,
              saturday: settings.jigeun_cap_saturday,
              sunday: settings.jigeun_cap_sunday,
              holiday: settings.jigeun_cap_holiday,
            }
          : DEFAULT_JIGEUN_CAPS
      );
      setWeekendHolidayTurns(
        settings
          ? parseTurnsText(settings.weekend_holiday_turns)
          : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );
      setJigeunTurns(
        settings
          ? {
              dayTurns: parseTurnsText(settings.jigeun_day_turns),
              nightTurns: parseTurnsText(settings.jigeun_night_turns),
            }
          : DEFAULT_JIGEUN_TURNS
      );
      const holidayRules = settings
        ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      setHolidayTurnRules(holidayRules);

      // 연휴 짝 치환 판정에 필요 — holidays state 반영 전이라 로컬 Set 을 먼저 만든다.
      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

      // 조회는 앞뒤 하루를 더 받지만, 월 밖의 날짜는 짝 판정용 context 로만 쓰고
      // 화면·집계용 맵에는 넣지 않는다.
      const regularByStaff = new Map<string, string>();
      const contextByStaff = new Map<string, string>();
      const rMap = new Map<string, string>();
      const rContext = new Map<string, string>();
      for (const row of scheduleRows) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const inMonth = dateStr >= start && dateStr <= end;
        const key = `${row.staff_id}|${dateStr}`;
        if (inMonth) regularByStaff.set(key, row.turn);
        else contextByStaff.set(key, row.turn);
        if (row.staff_id === staff.staff_id) {
          if (inMonth) rMap.set(dateStr, row.turn);
          else rContext.set(dateStr, row.turn);
        }
      }
      setRegularMap(rMap);
      setRegularContext(rContext);

      // 신청 내역에 표시되는 근무도 동일하게 치환한다.
      const displayByStaff = applyHolidayTurnRulesByStaffKey(
        regularByStaff,
        holidaySet,
        holidayRules,
        contextByStaff
      );

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
        lottery_status: LotteryStatus | null;
      }>;

      const sMap = new Map<string, SpecialSchedule>();
      for (const row of list) {
        if (row.staff_id === staff.staff_id) {
          sMap.set(row.target_date, {
            id: row.id,
            staff_id: row.staff_id,
            target_date: row.target_date,
            record_type: row.record_type,
          });
        }
      }
      setSpecialMap(sMap);

      const empMap = new Map<
        number,
        { staff_name: string; staff_position: string }
      >();
      const ids = [...new Set(list.map((s) => s.staff_id))];
      if (ids.length > 0) {
        const { data: emps, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position")
          .in("staff_id", ids);
        if (eErr) throw eErr;
        for (const e of emps ?? []) {
          empMap.set(e.staff_id, {
            staff_name: e.staff_name,
            staff_position: e.staff_position,
          });
        }
      }

      // aMap: 화면 표시용. 관리자가 직원 시점으로 보는 화면이므로 동료 신청은
      //       숨기고 해당 직원 본인의 지근/지휴만 담는다.
      // slotMap: 정원 카운트용. 정원은 직책별로 따로 적용되므로 대상 직원과
      //          같은 직책인 전원을 담는다(countJigeunSlots 가 탈락 건은 알아서 뺀다).
      const aMap = new Map<string, DayEntry[]>();
      const slotMap = new Map<string, DayEntry[]>();
      for (const row of list) {
        const isSelf = row.staff_id === staff.staff_id;
        const emp = empMap.get(row.staff_id);
        // 본인은 coworker_list 조회가 비어도 prop 의 직책을 믿을 수 있지만,
        // 동료는 직책을 모르면 정원 카운트에 넣을 수 없다.
        const position = isSelf
          ? emp?.staff_position ?? staff.staff_position
          : emp?.staff_position;
        if (!isSelf && position !== staff.staff_position) continue;
        const entry: DayEntry = {
          id: row.id,
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: position ?? staff.staff_position,
          record_type: row.record_type,
          regularTurn:
            displayByStaff.get(`${row.staff_id}|${row.target_date}`) ?? null,
          lottery_status: row.lottery_status ?? null,
        };

        // 본인이라도 직책이 다르게 조회되면(데이터 불일치) 정원에서는 뺀다.
        if (entry.staff_position === staff.staff_position) {
          const slots = slotMap.get(row.target_date);
          if (slots) slots.push(entry);
          else slotMap.set(row.target_date, [entry]);
        }

        if (!isSelf) continue;
        const arr = aMap.get(row.target_date);
        if (arr) arr.push(entry);
        else aMap.set(row.target_date, [entry]);
      }
      setAllEntriesMap(aMap);
      setSlotEntriesMap(slotMap);

      setHolidays(holidaySet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [monthValue, staff.staff_id, staff.staff_position]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // DayModal 은 Employee 타입을 요구하지만 등록·삭제에는 staff_id 만 사용한다.
  // 관리자 자신이 아닌 대상 직원을 주입해 그 직원의 row 가 변경되도록 함.
  const targetEmployee: Employee = {
    staff_id: staff.staff_id,
    staff_name: staff.staff_name,
    staff_position: staff.staff_position,
    employee_number: null,
    phone_number: null,
    role: "user",
    reference_date: null,
    reference_shift: null,
    device_id: null,
  };

  return (
    <>
      {showAdminNotice && (
        <p className="mx-2 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          관리자 권한으로 <b>{staff.staff_name}</b>({staff.staff_position})
          화면을 보고 있습니다. 등록·삭제 시 해당 직원의 신청이 변경됩니다.
          (신청 마감일 무시)
        </p>
      )}

      <div className="flex items-center justify-center gap-2 flex-wrap py-3 text-base font-bold">
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          휴무 {monthStats.hueCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          운휴 {monthStats.weekendTurnCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
          지근 {monthStats.jigeunCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          지휴 {monthStats.jihyuCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-primary/10 text-primary border border-primary/30">
          총휴 {monthStats.totalRest}
        </span>
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium text-center px-4 pb-2">
          {error}
        </p>
      )}

      <div className="relative px-2 pb-6">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        )}

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((wd, i) => (
            <div
              key={wd}
              className={cn(
                "text-center text-xs font-bold py-1",
                i === 0 && "text-red-500",
                i === 6 && "text-blue-500"
              )}
            >
              {wd}
            </div>
          ))}
          {grid.map((date) => {
            const inMonth = isSameMonth(date, monthValue);
            // 운휴대기 치환 칸은 원래근무(위)/대치근무(아래)를 함께 보여준다.
            const display = getTurnDisplay(date, regularMap, displayTurnMap);
            const turn = displayTurnMap.get(date);
            const entries = allEntriesMap.get(date) ?? [];
            const turnBgClass = turn
              ? getTurnColorClass(
                  turn,
                  date,
                  holidays,
                  weekendHolidayTurns,
                  jigeunTurns,
                  display?.substituted != null
                )
              : "";
            // 배경색과 같은 값(연휴 치환 후 turn)으로 판정해야 색과 배지가 어긋나지 않는다.
            const jigeunKind = turn ? getJigeunKind(turn, jigeunTurns) : null;
            // 정원 경계는 관리자 달력과 같은 규칙을 쓴다 — 마감은 >=, 초과는 >.
            // (admin-calendar 의 overCapByDate / day-modal 의 jigeunFull 참고)
            const slot = slotByDate.get(date);
            const slotFull = !!slot && slot.used >= slot.cap;
            const slotOver = !!slot && slot.used > slot.cap;
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[48px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col",
                  !inMonth && "opacity-35",
                  turnBgClass.includes("bg-red") &&
                    "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-800",
                  turnBgClass.includes("bg-sky") &&
                    "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-800",
                  slotOver && "ring-2 ring-amber-500"
                )}
                title={
                  slot
                    ? `${staff.staff_position} 지근 정원 ${slot.used}/${slot.cap}${
                        slotOver ? " (초과)" : slotFull ? " (마감)" : ""
                      }`
                    : undefined
                }
              >
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-none -ml-0.5 -mt-0.5",
                    getDayColorClass(date, holidays)
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {display && (
                  <span className="text-sm font-semibold truncate text-center text-foreground">
                    {display.original}
                  </span>
                )}
                {display?.substituted && (
                  <span className="text-[10px] font-bold leading-none text-center text-sky-700 dark:text-sky-300 truncate">
                    {display.substituted}
                  </span>
                )}
                {jigeunKind && (
                  <span className="text-[9px] font-bold leading-none text-center text-sky-700 dark:text-sky-300">
                    {getJigeunBadgeLabel(jigeunKind)}
                  </span>
                )}
                <div className="mt-auto flex flex-col gap-0.5">
                  {slot && (
                    <span
                      className={cn(
                        "text-[9px] font-bold rounded px-1 text-center tabular-nums",
                        slotOver
                          ? "bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200"
                          : slotFull
                            ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                            : "text-muted-foreground"
                      )}
                    >
                      {slot.used}/{slot.cap}
                    </span>
                  )}
                  {entries.map((e) => {
                    const isSelf = e.staff_id === staff.staff_id;
                    return (
                      <span
                        key={e.id}
                        title={
                          isSelf
                            ? `${e.staff_name} ${e.record_type}`
                            : e.record_type
                        }
                        className={cn(
                          "text-[9px] font-bold rounded px-1 truncate",
                          e.record_type === "지휴"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                            : e.staff_position === "차장"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                              : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
                          isSelf && "ring-1 ring-primary"
                        )}
                      >
                        {isSelf ? e.staff_name : e.record_type}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <DayModal
        employee={targetEmployee}
        date={selectedDate}
        regularTurn={
          selectedDate
            ? getTurnDisplay(selectedDate, regularMap, displayTurnMap)
                ?.original ?? null
            : null
        }
        substitutedTurn={
          selectedDate
            ? getTurnDisplay(selectedDate, regularMap, displayTurnMap)
                ?.substituted ?? null
            : null
        }
        existing={selectedDate ? specialMap.get(selectedDate) ?? null : null}
        allEntries={selectedDate ? allEntriesMap.get(selectedDate) ?? [] : []}
        // 관리자는 신청 마감일·추가 신청일과 무관하게 등록·삭제 모두 가능하다.
        phase="open"
        canRegister
        canDelete
        // 정원은 현황과 경고만 보여주고 등록은 막지 않는다 — 관리자가 정원을
        // 넘겨 배치해야 하는 예외가 있고, 그 판단은 관리자 몫이다.
        jigeunSlot={selectedDate ? slotByDate.get(selectedDate) ?? null : null}
        enforceJigeunCap={false}
        freezeDate={null}
        extraDeadline={null}
        onClose={() => setSelectedDate(null)}
        onChanged={() => {
          fetchData();
          onDataChanged?.();
        }}
      />
    </>
  );
}
