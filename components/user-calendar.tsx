"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { ScheduleRecord, SpecialSchedule } from "@/lib/types";
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

export function UserCalendar() {
  const { employee, logout } = useAuth();
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
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
          .eq("staff_id", employee.staff_id)
          .gte("target_date", start)
          .lte("target_date", end),
        supabase
          .from("holidays")
          .select("locdate")
          .eq("is_holiday", "Y")
          .gte("locdate", start)
          .lte("locdate", end),
      ]);

      if (scheduleResult.error) throw scheduleResult.error;
      if (specialResult.error) throw specialResult.error;

      const rMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        if (row.staff_id === employee.staff_id) {
          const dateStr = row.date
            ? format(new Date(row.date), "yyyy-MM-dd")
            : "";
          if (dateStr) rMap.set(dateStr, row.turn);
        }
      }
      setRegularMap(rMap);

      const sMap = new Map<string, SpecialSchedule>();
      for (const row of (specialResult.data ?? []) as SpecialSchedule[]) {
        sMap.set(row.target_date, row);
      }
      setSpecialMap(sMap);

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
            const special = specialMap.get(date);
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[76px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col",
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
                  <span className="text-sm font-semibold mt-auto truncate text-foreground">
                    {turn}
                  </span>
                )}
                {special && (
                  <span
                    className={cn(
                      "text-xs font-bold rounded px-1 mt-0.5 text-center",
                      special.record_type === "지근"
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                        : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                    )}
                  >
                    {special.record_type}
                  </span>
                )}
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
        onClose={() => setSelectedDate(null)}
        onChanged={fetchData}
      />
    </div>
  );
}
