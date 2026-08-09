"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Employee,
  RecordType,
  ScheduleRecord,
  SpecialSchedule,
  HolidayTurnRule,
} from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_NUMBER_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  parseHolidayTurnRulesText,
} from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
  applyHolidayTurnRules,
  applyHolidayTurnRulesByStaffKey,
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
}

// 관리자가 특정 직원의 캘린더를 사용자 본인 시점으로 보고
// 그 직원의 지근/지휴를 등록·삭제할 수 있는 뷰.
// user-calendar의 캘린더 본문 로직을 staff prop 기반으로 일반화한 버전.
export function AdminEmployeeCalendarView({
  staff,
  monthValue,
}: AdminEmployeeCalendarViewProps) {
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
    new Map()
  );
  const [allEntriesMap, setAllEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunNumberTurns, setJigeunNumberTurns] = useState<string[]>(
    DEFAULT_JIGEUN_NUMBER_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  const monthStats = useMemo(() => {
    let hueCount = 0;
    let weekendTurnCount = 0;
    for (const [date, turn] of regularMap) {
      if (!isSameMonth(date, monthValue)) continue;
      if (turn.includes("휴") && !jigeunNumberTurns.includes(turn)) hueCount++;
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
  }, [regularMap, specialMap, holidays, monthValue, weekendHolidayTurns, jigeunNumberTurns]);

  // 화면 표시용 근무 맵(연휴 짝 치환 적용).
  // 위 monthStats 는 원본 regularMap 을 그대로 쓴다 — 집계는 원래 근무번호 기준.
  const displayTurnMap = useMemo(
    () => applyHolidayTurnRules(regularMap, holidays, holidayTurnRules),
    [regularMap, holidays, holidayTurnRules]
  );

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

    try {
      const [scheduleResult, specialResult, holidayResult, settingsResult] =
        await Promise.all([
          supabase
            .rpc("get_schedule_by_range", {
              p_start_date: start,
              p_end_date: end,
            })
            .range(0, 10000),
          supabase
            .from("special_schedules")
            .select("id, staff_id, target_date, record_type")
            .gte("target_date", start)
            .lte("target_date", end)
            .order("target_date", { ascending: true }),
          supabase
            .from("holidays")
            .select("locdate")
            .eq("is_holiday", "Y")
            .gte("locdate", start)
            .lte("locdate", end),
          supabase
            .from("app_settings")
            .select("weekend_holiday_turns, jigeun_number_turns, holiday_turn_rules")
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (scheduleResult.error) throw scheduleResult.error;
      if (specialResult.error) throw specialResult.error;

      const settings = settingsResult.data as {
        weekend_holiday_turns: string | null;
        jigeun_number_turns: string | null;
        holiday_turn_rules: string | null;
      } | null;
      setWeekendHolidayTurns(
        settings
          ? parseTurnsText(settings.weekend_holiday_turns)
          : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );
      setJigeunNumberTurns(
        settings
          ? parseTurnsText(settings.jigeun_number_turns)
          : DEFAULT_JIGEUN_NUMBER_TURNS
      );
      const holidayRules = settings
        ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      setHolidayTurnRules(holidayRules);

      // 연휴 짝 치환 판정에 필요 — holidays state 반영 전이라 로컬 Set 을 먼저 만든다.
      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

      const regularByStaff = new Map<string, string>();
      const rMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        regularByStaff.set(`${row.staff_id}|${dateStr}`, row.turn);
        if (row.staff_id === staff.staff_id) {
          rMap.set(dateStr, row.turn);
        }
      }
      setRegularMap(rMap);

      // 신청 내역에 표시되는 근무도 동일하게 치환한다.
      const displayByStaff = applyHolidayTurnRulesByStaffKey(
        regularByStaff,
        holidaySet,
        holidayRules
      );

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
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

      // 관리자가 직원 시점으로 보는 화면이므로 동료 신청은 숨기고
      // 해당 직원 본인의 지근/지휴만 표시한다.
      const aMap = new Map<string, DayEntry[]>();
      for (const row of list) {
        if (row.staff_id !== staff.staff_id) continue;
        const emp = empMap.get(row.staff_id);
        const position = emp?.staff_position ?? staff.staff_position;
        const entry: DayEntry = {
          id: row.id,
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: position,
          record_type: row.record_type,
          regularTurn:
            displayByStaff.get(`${row.staff_id}|${row.target_date}`) ?? null,
        };
        const arr = aMap.get(row.target_date);
        if (arr) arr.push(entry);
        else aMap.set(row.target_date, [entry]);
      }
      setAllEntriesMap(aMap);

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
      <p className="mx-2 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        관리자 권한으로 <b>{staff.staff_name}</b>({staff.staff_position}) 화면을
        보고 있습니다. 등록·삭제 시 해당 직원의 신청이 변경됩니다. (신청 마감일
        무시)
      </p>

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
            const turn = displayTurnMap.get(date);
            const entries = allEntriesMap.get(date) ?? [];
            const turnBgClass = turn
              ? getTurnColorClass(
                  turn,
                  date,
                  holidays,
                  weekendHolidayTurns,
                  jigeunNumberTurns
                )
              : "";
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
                    "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-800"
                )}
              >
                <span
                  className={cn(
                    "text-[10px] font-semibold leading-none -ml-0.5 -mt-0.5",
                    getDayColorClass(date, holidays)
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {turn && (
                  <span className="text-sm font-semibold truncate text-center text-foreground">
                    {turn}
                  </span>
                )}
                <div className="mt-auto flex flex-col gap-0.5">
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
          selectedDate ? displayTurnMap.get(selectedDate) ?? null : null
        }
        existing={selectedDate ? specialMap.get(selectedDate) ?? null : null}
        allEntries={selectedDate ? allEntriesMap.get(selectedDate) ?? [] : []}
        isFrozen={false}
        freezeDate={null}
        onClose={() => setSelectedDate(null)}
        onChanged={fetchData}
      />
    </>
  );
}
