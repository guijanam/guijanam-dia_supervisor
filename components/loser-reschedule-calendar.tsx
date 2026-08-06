"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import type {
  RecordType,
  LotteryStatus,
  ScheduleRecord,
} from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

interface LoserEntry {
  id: string;
  staff_id: number;
  staff_name: string;
  staff_position: string;
  record_type: RecordType;
}

interface MyEntry {
  id: string;
  target_date: string;
  record_type: RecordType;
  lottery_status: LotteryStatus | null;
  regularTurn: string | null;
}

interface Props {
  open: boolean;
  entry: LoserEntry | null;
  originDate: string | null;
  initialMonth: string;
  weekendHolidayTurns: string[];
  jigeunNumberTurns: string[];
  onClose: () => void;
  onMoved: () => void;
}

export function LoserRescheduleCalendar({
  open,
  entry,
  originDate,
  initialMonth,
  weekendHolidayTurns,
  jigeunNumberTurns,
  onClose,
  onMoved,
}: Props) {
  const [monthValue, setMonthValue] = useState(initialMonth);
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [mineMap, setMineMap] = useState<Map<string, MyEntry>>(new Map());
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setMonthValue(initialMonth);
  }, [open, initialMonth]);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  const fetchData = useCallback(async () => {
    if (!entry) return;
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
          .select("id, target_date, record_type, lottery_status")
          .eq("staff_id", entry.staff_id)
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

      const rMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        if (row.staff_id !== entry.staff_id) continue;
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (dateStr) rMap.set(dateStr, row.turn);
      }
      setRegularMap(rMap);

      const mMap = new Map<string, MyEntry>();
      for (const row of (specialResult.data ?? []) as Array<{
        id: string;
        target_date: string;
        record_type: RecordType;
        lottery_status: LotteryStatus | null;
      }>) {
        mMap.set(row.target_date, {
          id: row.id,
          target_date: row.target_date,
          record_type: row.record_type,
          lottery_status: row.lottery_status,
          regularTurn: rMap.get(row.target_date) ?? null,
        });
      }
      setMineMap(mMap);

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
  }, [entry, monthValue]);

  useEffect(() => {
    if (open && entry) {
      void fetchData();
    } else {
      setError(null);
    }
  }, [open, entry, fetchData]);

  const shiftMonth = (delta: number) => {
    const [year, month] = monthValue.split("-").map(Number);
    const d = new Date(year, month - 1 + delta);
    setMonthValue(format(d, "yyyy-MM"));
  };

  const handleCellClick = async (date: string) => {
    if (!entry) return;
    if (!isSameMonth(date, monthValue)) return;
    if (date === originDate) return;
    if (mineMap.has(date)) return;
    if (busy) return;
    const dayName = getDayName(date);
    if (
      !confirm(
        `${entry.staff_name}님의 지근을 ${date}(${dayName})로 이동할까요?`
      )
    )
      return;

    setBusy(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("special_schedules")
        .update({
          target_date: date,
          lottery_status: null,
          lottery_at: null,
        })
        .eq("id", entry.id);
      if (upErr) throw upErr;
      onMoved();
      onClose();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        setError(
          `${entry.staff_name}님은 ${date}에 이미 신청 내역이 있어 이동할 수 없습니다.`
        );
      } else {
        setError(err instanceof Error ? err.message : "날짜 변경 실패");
      }
    } finally {
      setBusy(false);
    }
  };

  const sortedMineEntries = useMemo(() => {
    return [...mineMap.values()].sort((a, b) =>
      a.target_date.localeCompare(b.target_date)
    );
  }, [mineMap]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {entry?.staff_name} ({entry?.staff_position}) — 이동할 날짜 선택
          </DialogTitle>
          <DialogDescription>
            {originDate && (
              <>
                현재 탈락: <span className="font-semibold">{originDate}</span> (
                {getDayName(originDate)})
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
            {error}
          </p>
        )}

        <div className="rounded-md border bg-muted/30 p-2">
          <div className="mb-1 text-xs font-semibold">
            이 직원의 신청 내역 ({sortedMineEntries.length}건)
          </div>
          {sortedMineEntries.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              이 달에 다른 신청 내역이 없습니다.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {sortedMineEntries.map((m) => {
                const isOrigin = m.target_date === originDate;
                return (
                  <span
                    key={m.id}
                    className={cn(
                      "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
                      m.record_type === "지근"
                        ? "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/40 dark:text-green-200"
                        : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/40 dark:text-red-200",
                      isOrigin && "ring-2 ring-amber-500"
                    )}
                    title={`정규근무: ${m.regularTurn ?? "-"}`}
                  >
                    <span className="font-semibold tabular-nums">
                      {m.target_date.slice(5)}
                    </span>
                    <span>({getDayName(m.target_date)})</span>
                    <span className="font-bold">{m.record_type}</span>
                    {m.lottery_status === "won" && (
                      <span className="rounded bg-green-200 px-1 text-[10px] font-bold text-green-800 dark:bg-green-900 dark:text-green-200">
                        당첨
                      </span>
                    )}
                    {m.lottery_status === "lost" && (
                      <span className="rounded bg-red-200 px-1 text-[10px] font-bold text-red-800 dark:bg-red-900 dark:text-red-200">
                        탈락
                      </span>
                    )}
                    {isOrigin && <span>★</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftMonth(-1)}
            disabled={isLoading || busy}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-base font-bold tabular-nums">{monthValue}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftMonth(1)}
            disabled={isLoading || busy}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative">
          {(isLoading || busy) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
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
              const turn = regularMap.get(date);
              const mine = mineMap.get(date);
              const isOrigin = date === originDate;
              const turnBgClass = turn
                ? getTurnColorClass(
                    turn,
                    date,
                    holidays,
                    weekendHolidayTurns,
                    jigeunNumberTurns
                  )
                : "";
              const isRest = turnBgClass.includes("bg-red");
              const disabled =
                !inMonth || isOrigin || !!mine || busy || isLoading;

              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleCellClick(date)}
                  title={
                    !inMonth
                      ? ""
                      : isOrigin
                        ? "현재 탈락한 날짜"
                        : mine
                          ? `이미 ${mine.record_type} 신청됨`
                          : `${date} (${getDayName(date)})${
                              turn ? ` · ${turn}` : ""
                            }`
                  }
                  className={cn(
                    "min-h-[64px] rounded-md border p-1 text-left transition-colors flex flex-col gap-0.5",
                    !inMonth && "opacity-30 pointer-events-none",
                    isRest && "border-red-300 dark:border-red-800",
                    turnBgClass,
                    isOrigin && "ring-2 ring-amber-500",
                    !disabled && "hover:bg-accent cursor-pointer",
                    disabled && !isOrigin && "cursor-not-allowed opacity-70"
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-semibold leading-none",
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
                  {mine && (
                    <span
                      className={cn(
                        "self-start rounded px-1 text-[10px] font-bold leading-none",
                        mine.record_type === "지근"
                          ? "bg-green-200 text-green-800 dark:bg-green-900 dark:text-green-200"
                          : "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200"
                      )}
                    >
                      {mine.record_type}
                      {isOrigin && " ★"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          빨간 셀 = 휴무/운휴 · 주황 테두리 = 현재 탈락한 날짜 · 본인 신청
          있는 날짜는 클릭 불가 · 빈 셀 클릭 시 그 날짜로 이동
        </p>
      </DialogContent>
    </Dialog>
  );
}
