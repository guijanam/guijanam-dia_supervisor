"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { lostWarningSuffix } from "@/lib/lottery-warning";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import type {
  RecordType,
  LotteryStatus,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import { getJigeunKind, getJigeunBadgeLabel } from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
  applyHolidayTurnRules,
  padDateRange,
  getTurnDisplay,
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
  // 운휴대기(연휴 짝 치환) 대치근무. 치환이 없으면 null.
  substitutedTurn: string | null;
}

interface Props {
  open: boolean;
  entry: LoserEntry | null;
  originDate: string | null;
  initialMonth: string;
  weekendHolidayTurns: string[];
  jigeunTurns: JigeunTurnSettings;
  holidayTurnRules: HolidayTurnRule[];
  onClose: () => void;
  onMoved: () => void;
}

export function LoserRescheduleCalendar({
  open,
  entry,
  originDate,
  initialMonth,
  weekendHolidayTurns,
  jigeunTurns,
  holidayTurnRules,
  onClose,
  onMoved,
}: Props) {
  const [monthValue, setMonthValue] = useState(initialMonth);
  // regularMap = 치환 전 원본, displayMap = 운휴대기 치환 결과.
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  const [displayMap, setDisplayMap] = useState<Map<string, string>>(new Map());
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
    // 월 경계에 걸친 연휴 짝을 판정하려면 앞뒤 하루가 더 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [scheduleRows, specialResult, holidayResult] = await Promise.all([
        fetchScheduleByRange(padded.start, padded.end),
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
          .gte("locdate", padded.start)
          .lte("locdate", padded.end),
      ]);

      if (specialResult.error) throw specialResult.error;

      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

      // 조회는 앞뒤 하루를 더 받지만, 월 밖의 날짜는 짝 판정용 context 로만 쓴다.
      const rMap = new Map<string, string>();
      const rContext = new Map<string, string>();
      for (const row of scheduleRows) {
        if (row.staff_id !== entry.staff_id) continue;
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        if (dateStr >= start && dateStr <= end) rMap.set(dateStr, row.turn);
        else rContext.set(dateStr, row.turn);
      }
      // 운휴대기 칸은 원래근무/대치근무를 함께 보여줘야 하므로 원본도 같이 보관한다.
      const displayMap = applyHolidayTurnRules(
        rMap,
        holidaySet,
        holidayTurnRules,
        rContext
      );
      setRegularMap(rMap);
      setDisplayMap(displayMap);

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
          substitutedTurn:
            getTurnDisplay(row.target_date, rMap, displayMap)?.substituted ??
            null,
        });
      }
      setMineMap(mMap);

      setHolidays(holidaySet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [entry, monthValue, holidayTurnRules]);

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
    // 이 화면은 탈락자 재배치 전용이라 대상은 항상 탈락 건이다.
    // 옮기면 lottery_status 가 NULL 로 초기화되어 추가 신청 대상에서 빠진다.
    if (
      !confirm(
        `${entry.staff_name}님의 지근을 ${date}(${dayName})로 이동할까요?` +
          lostWarningSuffix({ lottery_status: "lost" }, "옮기면")
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
                    title={`정규근무: ${m.regularTurn ?? "-"}${
                      m.substitutedTurn ? ` → ${m.substitutedTurn}` : ""
                    }`}
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
              // 운휴대기 치환 칸은 원래근무(위)/대치근무(아래)를 함께 보여준다.
              const display = getTurnDisplay(date, regularMap, displayMap);
              const turn = displayMap.get(date) ?? regularMap.get(date);
              const mine = mineMap.get(date);
              const isOrigin = date === originDate;
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
              // 배경색과 같은 turn 으로 판정해야 색과 배지가 어긋나지 않는다.
              const jigeunKind = turn ? getJigeunKind(turn, jigeunTurns) : null;
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
                              display
                                ? ` · ${display.original}${
                                    display.substituted
                                      ? ` → ${display.substituted}`
                                      : ""
                                  }`
                                : ""
                            }`
                  }
                  className={cn(
                    "min-h-[48px] rounded-md border p-1 text-left transition-colors flex flex-col gap-0.5",
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
                  {mine && (
                    <span
                      className={cn(
                        "self-start rounded px-1 text-[9px] font-bold leading-none",
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
