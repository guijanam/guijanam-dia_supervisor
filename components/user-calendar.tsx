"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { RecordType, ScheduleRecord, SpecialSchedule } from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_NUMBER_TURNS,
  parseTurnsText,
} from "@/lib/types";
import {
  getTodayMonthStr,
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { DayModal } from "@/components/day-modal";
import { AnnouncementBoard } from "@/components/announcement-board";
import { DocumentBoard } from "@/components/document-board";
import { ReferenceEditor } from "@/components/reference-editor";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type UserView = "notice" | "calendar";

export interface DayEntry {
  id: string;
  staff_id: number;
  staff_name: string;
  staff_position: string;
  record_type: RecordType;
  regularTurn: string | null;
}

export function UserCalendar() {
  const { employee, logout } = useAuth();
  const [view, setView] = useState<UserView>("calendar");
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
    new Map()
  );
  const [allEntriesMap, setAllEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [requestFreezeDate, setRequestFreezeDate] = useState<string | null>(
    null
  );
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunNumberTurns, setJigeunNumberTurns] = useState<string[]>(
    DEFAULT_JIGEUN_NUMBER_TURNS
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const isFrozen = useMemo(() => {
    if (!requestFreezeDate) return false;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    return todayStr > requestFreezeDate;
  }, [requestFreezeDate]);

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

  const fetchData = useCallback(async () => {
    if (!employee) return;
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
            .select("request_freeze_date, weekend_holiday_turns, jigeun_number_turns")
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (scheduleResult.error) throw scheduleResult.error;
      if (specialResult.error) throw specialResult.error;

      const settings = settingsResult.data as {
        request_freeze_date: string | null;
        weekend_holiday_turns: string | null;
        jigeun_number_turns: string | null;
      } | null;
      setRequestFreezeDate(settings?.request_freeze_date ?? null);
      setWeekendHolidayTurns(
        settings ? parseTurnsText(settings.weekend_holiday_turns) : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );
      setJigeunNumberTurns(
        settings ? parseTurnsText(settings.jigeun_number_turns) : DEFAULT_JIGEUN_NUMBER_TURNS
      );

      // (staff_id, 날짜) → 원래 근무(turn) 매핑 (전 직원)
      const regularByStaff = new Map<string, string>();
      const rMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        regularByStaff.set(`${row.staff_id}|${dateStr}`, row.turn);
        if (row.staff_id === employee.staff_id) {
          rMap.set(dateStr, row.turn);
        }
      }
      setRegularMap(rMap);

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
      }>;

      // 본인 신청 내역 맵 (기존 기능 유지)
      const sMap = new Map<string, SpecialSchedule>();
      for (const row of list) {
        if (row.staff_id === employee.staff_id) {
          sMap.set(row.target_date, {
            id: row.id,
            staff_id: row.staff_id,
            target_date: row.target_date,
            record_type: row.record_type,
          });
        }
      }
      setSpecialMap(sMap);

      // staff_id → 직원 정보 매핑
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

      // 본인과 같은 직책(기관사/차장)의 신청만 노출.
      const aMap = new Map<string, DayEntry[]>();
      for (const row of list) {
        const emp = empMap.get(row.staff_id);
        const position = emp?.staff_position ?? "";
        if (position !== employee.staff_position) continue;
        const entry: DayEntry = {
          id: row.id,
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: position,
          record_type: row.record_type,
          regularTurn:
            regularByStaff.get(`${row.staff_id}|${row.target_date}`) ?? null,
        };
        const arr = aMap.get(row.target_date);
        if (arr) arr.push(entry);
        else aMap.set(row.target_date, [entry]);
      }
      setAllEntriesMap(aMap);

      setHolidays(
        new Set<string>(
          (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [employee, monthValue]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shiftMonth = (delta: number) => {
    const [year, month] = monthValue.split("-").map(Number);
    const d = new Date(year, month - 1 + delta);
    setMonthValue(format(d, "yyyy-MM"));
  };

  if (!employee) return null;

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="text-sm">
          <span className="font-bold">{employee.staff_name}</span>
          <span className="text-muted-foreground">
            {" "}
            ({employee.staff_position})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ReferenceEditor />
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={logout} title="로그아웃">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 pb-14">
        {view === "notice" && <DocumentBoard />}

        {view === "calendar" && (
          <>
            <AnnouncementBoard />

            <p className="mx-2 mt-3 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-center text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
              교번 순서가 다르면 오른쪽 상단의 *나의정보 수정*을 통해 수정하시면 됩니다.
            </p>

            <div className="flex items-center justify-center gap-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-bold text-xl tabular-nums">{monthValue}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 flex-wrap pb-2 text-base font-bold">
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          휴무 {monthStats.hueCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          운휴 {monthStats.weekendTurnCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
          지근 {monthStats.jigeunCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          지휴 {monthStats.jihyuCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-primary/10 text-primary border border-primary/30">
          총휴 {monthStats.totalRest}
        </span>
      </div>

      {isFrozen && (
        <p className="mx-2 mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          관리자가 지정한 신청 마감일({requestFreezeDate})이 지났습니다.
          지근/지휴 신청·삭제가 제한됩니다.
        </p>
      )}

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
                "text-center text-sm font-bold py-1",
                i === 0 && "text-red-500",
                i === 6 && "text-blue-500"
              )}
            >
              {wd}
            </div>
          ))}
          {grid.map((date) => {
            const inMonth = isSameMonth(date, monthValue);
            const turn = regularMap.get(date);
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
                  "min-h-[64px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col",
                  !inMonth && "opacity-35",
                  turnBgClass.includes("bg-red") &&
                    "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-800",
                  turnBgClass.includes("bg-sky") &&
                    "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-800"
                )}
              >
                <span
                  className={cn(
                    "text-base font-semibold",
                    getDayColorClass(date, holidays)
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {turn && (
                  <span className="text-base font-semibold truncate text-foreground">
                    {turn}
                  </span>
                )}
                <div className="mt-auto flex flex-col gap-0.5">
                  {entries.map((e) => {
                    const isSelf = e.staff_id === employee.staff_id;
                    return (
                      <span
                        key={e.id}
                        title={
                          isSelf
                            ? `${e.staff_name} ${e.record_type}`
                            : e.record_type
                        }
                        className={cn(
                          "text-[10px] font-bold rounded px-1 truncate",
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
          </>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 w-full z-50 flex border-t bg-background">
        {(
          [
            { label: "근무 달력", value: "calendar" },
            { label: "문서", value: "notice" },
          ] as { label: string; value: UserView }[]
        ).map((tab) => (
          <button
            key={tab.value}
            className={cn(
              "flex-1 py-3 font-bold text-sm transition-colors",
              view === tab.value
                ? "border-b-2 border-primary bg-accent"
                : "text-muted-foreground"
            )}
            onClick={() => setView(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <DayModal
        employee={employee}
        date={selectedDate}
        regularTurn={selectedDate ? regularMap.get(selectedDate) ?? null : null}
        existing={selectedDate ? specialMap.get(selectedDate) ?? null : null}
        allEntries={selectedDate ? allEntriesMap.get(selectedDate) ?? [] : []}
        isFrozen={isFrozen}
        freezeDate={requestFreezeDate}
        onClose={() => setSelectedDate(null)}
        onChanged={fetchData}
      />
    </div>
  );
}
