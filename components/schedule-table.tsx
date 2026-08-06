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
import { getDayName, getDayColorClass, getTurnColorClass } from "@/lib/schedule-utils";
import { DEFAULT_WEEKEND_HOLIDAY_TURNS, DEFAULT_JIGEUN_NUMBER_TURNS } from "@/lib/types";

interface ScheduleTableProps {
  names: string[];
  dateRange: string[];
  scheduleMap: Map<string, Map<string, string>>;
  isLoading: boolean;
  error: string | null;
  emptyMessage: string | null;
  holidays: Set<string>;
  weekendHolidayTurns?: string[];
  jigeunNumberTurns?: string[];
}

export function ScheduleTable({
  names,
  dateRange,
  scheduleMap,
  isLoading,
  error,
  emptyMessage,
  holidays,
  weekendHolidayTurns = DEFAULT_WEEKEND_HOLIDAY_TURNS,
  jigeunNumberTurns = DEFAULT_JIGEUN_NUMBER_TURNS,
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
                const turn = scheduleMap.get(name)?.get(date) || "-";
                return (
                  <TableCell
                    key={date}
                    className={cn(
                      "text-center text-xs whitespace-nowrap px-2",
                      getTurnColorClass(turn, date, holidays, weekendHolidayTurns, jigeunNumberTurns)
                    )}
                  >
                    {turn}
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
