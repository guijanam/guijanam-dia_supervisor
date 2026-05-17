"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { RecordType, ScheduleRecord, SpecialSchedule } from "@/lib/types";
import {
  getTodayMonthStr,
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { DayModal } from "@/components/day-modal";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
    new Map()
  );
  const [allEntriesMap, setAllEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  const fetchData = useCallback(async () => {
    if (!employee) return;
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

    try {
      const [scheduleResult, specialResult, holidayResult] = await Promise.all([
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
      ]);

      if (scheduleResult.error) throw scheduleResult.error;
      if (specialResult.error) throw specialResult.error;

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

      const aMap = new Map<string, DayEntry[]>();
      for (const row of list) {
        const emp = empMap.get(row.staff_id);
        const entry: DayEntry = {
          id: row.id,
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: emp?.staff_position ?? "",
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
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={logout} title="로그아웃">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex items-center justify-center gap-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-bold text-lg tabular-nums">{monthValue}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium text-center px-4 pb-2">
          {error}
        </p>
      )}

      <div className="relative flex-1 px-2 pb-6">
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
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[64px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col",
                  !inMonth && "opacity-35",
                  turn &&
                    getTurnColorClass(turn, date, holidays).includes("bg-red") &&
                    "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-800"
                )}
              >
                <span
                  className={cn(
                    "text-sm font-semibold",
                    getDayColorClass(date, holidays)
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {turn && (
                  <span className="text-sm font-semibold truncate text-foreground">
                    {turn}
                  </span>
                )}
                <div className="mt-auto flex flex-col gap-0.5">
                  {entries.map((e) => (
                    <span
                      key={e.id}
                      title={`${e.staff_name} (${e.staff_position}) ${e.record_type}`}
                      className={cn(
                        "text-[10px] font-bold rounded px-1 truncate",
                        e.record_type === "지휴"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                          : e.staff_position === "차장"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                            : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
                        e.staff_id === employee.staff_id &&
                          "ring-1 ring-primary"
                      )}
                    >
                      {e.staff_name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <DayModal
        employee={employee}
        date={selectedDate}
        regularTurn={selectedDate ? regularMap.get(selectedDate) ?? null : null}
        existing={selectedDate ? specialMap.get(selectedDate) ?? null : null}
        allEntries={selectedDate ? allEntriesMap.get(selectedDate) ?? [] : []}
        onClose={() => setSelectedDate(null)}
        onChanged={fetchData}
      />
    </div>
  );
}
