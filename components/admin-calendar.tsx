"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { RecordType } from "@/lib/types";
import {
  getTodayMonthStr,
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getDayName,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Loader2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface SpecialEntry {
  id: string;
  staff_name: string;
  staff_position: string;
  record_type: RecordType;
}

export function AdminCalendar() {
  const { employee, logout } = useAuth();
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

    try {
      const [specialResult, holidayResult] = await Promise.all([
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

      if (specialResult.error) throw specialResult.error;

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
      }>;

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

      const sMap = new Map<string, SpecialEntry[]>();
      for (const row of list) {
        const emp = empMap.get(row.staff_id);
        const entry: SpecialEntry = {
          id: row.id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: emp?.staff_position ?? "",
          record_type: row.record_type,
        };
        const arr = sMap.get(row.target_date);
        if (arr) arr.push(entry);
        else sMap.set(row.target_date, [entry]);
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
  }, [monthValue]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shiftMonth = (delta: number) => {
    const [year, month] = monthValue.split("-").map(Number);
    const d = new Date(year, month - 1 + delta);
    setMonthValue(format(d, "yyyy-MM"));
  };

  const changeType = async (id: string, recordType: RecordType) => {
    setBusyId(id);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("special_schedules")
        .update({ record_type: recordType })
        .eq("id", id);
      if (upErr) throw upErr;
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 실패");
    } finally {
      setBusyId(null);
    }
  };

  const deleteEntry = async (entry: SpecialEntry) => {
    if (
      !confirm(
        `${entry.staff_name}님의 ${selectedDate} ${entry.record_type} 신청을 삭제할까요?`
      )
    )
      return;
    setBusyId(entry.id);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from("special_schedules")
        .delete()
        .eq("id", entry.id);
      if (delErr) throw delErr;
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusyId(null);
    }
  };

  const selectedEntries = selectedDate
    ? specialMap.get(selectedDate) ?? []
    : [];

  if (!employee) return null;

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="text-sm">
          <span className="font-bold">{employee.staff_name}</span>
          <span className="text-muted-foreground"> · 관리자</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={logout}
            title="로그아웃"
          >
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
            const entries = specialMap.get(date) ?? [];
            const geunCount = entries.filter(
              (e) => e.record_type === "지근"
            ).length;
            const hyuCount = entries.filter(
              (e) => e.record_type === "지휴"
            ).length;
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[64px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col gap-0.5",
                  !inMonth && "opacity-35"
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold",
                    getDayColorClass(date, holidays)
                  )}
                >
                  {Number(date.slice(8, 10))}
                </span>
                {geunCount > 0 && (
                  <span className="text-[10px] font-bold rounded px-1 text-center bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                    지근 {geunCount}
                  </span>
                )}
                {hyuCount > 0 && (
                  <span className="text-[10px] font-bold rounded px-1 text-center bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                    지휴 {hyuCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Dialog
        open={!!selectedDate}
        onOpenChange={(open) => !open && setSelectedDate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDate} {selectedDate && `(${getDayName(selectedDate)})`}
            </DialogTitle>
            <DialogDescription>
              총 {selectedEntries.length}건의 신청
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          {selectedEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              신청 내역이 없습니다.
            </p>
          ) : (
            <div className="flex flex-col gap-1 max-h-[60vh] overflow-auto">
              {selectedEntries.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{e.staff_name}</span>
                    {e.staff_position && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({e.staff_position})
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <select
                      value={e.record_type}
                      disabled={busyId === e.id}
                      onChange={(ev) =>
                        changeType(e.id, ev.target.value as RecordType)
                      }
                      className="h-8 rounded-md border bg-background px-2 text-xs"
                    >
                      <option value="지근">지근</option>
                      <option value="지휴">지휴</option>
                    </select>
                    <Button
                      size="icon-sm"
                      variant="destructive"
                      disabled={busyId === e.id}
                      onClick={() => deleteEntry(e)}
                      title="삭제"
                    >
                      {busyId === e.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
