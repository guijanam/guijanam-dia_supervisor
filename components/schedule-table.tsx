"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getDayName,
  getDayColorClass,
  getTurnColorClass,
  getTurnDisplay,
} from "@/lib/schedule-utils";
import type { JigeunTurnSettings } from "@/lib/types";
import { DEFAULT_WEEKEND_HOLIDAY_TURNS, DEFAULT_JIGEUN_TURNS } from "@/lib/types";

interface ScheduleTableProps {
  names: string[];
  dateRange: string[];
  scheduleMap: Map<string, Map<string, string>>;
  // 치환 전 원본 근무 맵. 운휴대기 칸을 '원래근무/대치근무' 두 줄로 그리는 데 쓴다.
  // 넘기지 않으면 scheduleMap 을 원본으로 취급 — 두 줄 표시가 생기지 않는다.
  originalMap?: Map<string, Map<string, string>>;
  isLoading: boolean;
  error: string | null;
  emptyMessage: string | null;
  holidays: Set<string>;
  weekendHolidayTurns?: string[];
  // 배경색 판정에만 쓴다. 이 표는 한 줄짜리 셀이라 '지(주)'/'지(야)' 배지는 넣지 않는다.
  jigeunTurns?: JigeunTurnSettings;
}

export function ScheduleTable({
  names,
  dateRange,
  scheduleMap,
  originalMap,
  isLoading,
  error,
  emptyMessage,
  holidays,
  weekendHolidayTurns = DEFAULT_WEEKEND_HOLIDAY_TURNS,
  jigeunTurns = DEFAULT_JIGEUN_TURNS,
}: ScheduleTableProps) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-destructive font-bold text-sm">{error}</p>
      </div>
    );
  }

  if (emptyMessage) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-muted-foreground font-bold text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto h-full border rounded-md">
      <Table className="min-w-max">
        <TableHeader>
          <TableRow>
            <TableHead
              className="sticky top-0 left-0 z-20 bg-background font-bold text-center min-w-[70px]"
            >
              이름
            </TableHead>
            {dateRange.map((date) => (
              <TableHead
                key={date}
                className={cn(
                  "sticky top-0 z-10 bg-background text-center text-xs whitespace-nowrap px-2",
                  getDayColorClass(date, holidays)
                )}
              >
                {date.slice(5)}
                <br />
                ({getDayName(date)})
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {names.map((name) => (
            <TableRow key={name}>
              <TableCell className="sticky left-0 z-[5] bg-background font-bold text-center text-xs whitespace-nowrap">
                {name}
              </TableCell>
              {dateRange.map((date) => {
                const displayed = scheduleMap.get(name);
                const original = originalMap?.get(name) ?? displayed;
                // 운휴대기 치환 칸은 원래근무(위)/대치근무(아래)를 함께 보여준다.
                const display =
                  displayed && original
                    ? getTurnDisplay(date, original, displayed)
                    : null;
                const turn = displayed?.get(date) || "-";
                return (
                  <TableCell
                    key={date}
                    className={cn(
                      "text-center text-xs whitespace-nowrap px-2",
                      getTurnColorClass(
                        turn,
                        date,
                        holidays,
                        weekendHolidayTurns,
                        jigeunTurns,
                        display?.substituted != null
                      )
                    )}
                  >
                    {display?.substituted ? (
                      <span className="flex flex-col leading-tight">
                        <span>{display.original}</span>
                        <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300">
                          {display.substituted}
                        </span>
                      </span>
                    ) : (
                      turn
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
