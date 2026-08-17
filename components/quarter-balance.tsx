"use client";

import { useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { QUARTER_TARGET, QUARTERS } from "@/lib/quarter";
import {
  fetchQuarterTotals,
  quarterTotal,
  type QuarterTotals,
} from "@/lib/quarter-balance-calc";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuarterBalanceCalendarModal } from "@/components/quarter-balance-calendar-modal";
import { Loader2, LogOut, Download } from "lucide-react";

const POSITIONS = ["기관사", "차장"] as const;
type Position = (typeof POSITIONS)[number];

// 기존 import 를 깨지 않도록 re-export (quarter-balance-calendar-modal 등).
export { QUARTERS };

interface StaffRow extends QuarterTotals {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  employee_number: string | null;
}

export function QuarterBalance() {
  const { employee, logout } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(
    Math.floor(now.getMonth() / 3) + 1
  );
  const [position, setPosition] = useState<Position>("기관사");
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 캘린더 팝업으로 들여다볼 직원. null 이면 팝업이 닫힌 상태.
  const [selectedStaff, setSelectedStaff] = useState<StaffRow | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setHasFetched(true);

    try {
      // 집계는 공용 함수가 담당한다(사용자 캘린더의 추가 신청 판정과 동일 기준).
      // 여기서는 이름·직책·사번만 덧붙인다.
      const [totalsByStaff, empResult] = await Promise.all([
        fetchQuarterTotals(year, quarter),
        supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position, employee_number"),
      ]);
      if (empResult.error) throw empResult.error;

      // staff_id → 직원 정보
      const empMap = new Map<
        number,
        { staff_name: string; staff_position: string; employee_number: string | null }
      >();
      for (const e of empResult.data ?? []) {
        empMap.set(e.staff_id, {
          staff_name: e.staff_name,
          staff_position: e.staff_position,
          employee_number: e.employee_number,
        });
      }

      const merged: StaffRow[] = [];
      for (const [staffId, t] of totalsByStaff) {
        const emp = empMap.get(staffId);
        merged.push({
          staff_id: staffId,
          staff_name: emp?.staff_name ?? `(미상 ${staffId})`,
          staff_position: emp?.staff_position ?? "",
          employee_number: emp?.employee_number ?? null,
          ...t,
        });
      }

      // 이름에 "결원"이 포함된 가상 직원은 검증 대상에서 제외
      setRows(merged.filter((r) => !r.staff_name.includes("결원")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [year, quarter]);

  // 합계 = 휴무 + 운휴 + 지휴 − 지근. 24 가 아닌 직원만 표시.
  const total = (r: StaffRow) => quarterTotal(r);

  const mismatched = useMemo(() => {
    return rows
      .filter(
        (r) =>
          r.staff_position === position && total(r) !== QUARTER_TARGET
      )
      .sort((a, b) => a.staff_name.localeCompare(b.staff_name, "ko"));
  }, [rows, position]);

  const summary = useMemo(() => {
    const inPosition = rows.filter((r) => r.staff_position === position);
    let shortage = 0;
    let excess = 0;
    for (const r of mismatched) {
      if (total(r) < QUARTER_TARGET) shortage++;
      else excess++;
    }
    return { shortage, excess, checked: inPosition.length };
  }, [mismatched, rows, position]);

  const exportExcel = () => {
    const sheetData = mismatched.map((r) => {
      const t = total(r);
      return {
        사번: r.employee_number ?? "",
        직책: r.staff_position,
        이름: r.staff_name,
        휴무: r.hueCount,
        운휴: r.weekendTurnCount,
        지휴: r.jihyuCount,
        지근: r.jigeunCount,
        합계: t,
        "목표(24)대비": t - QUARTER_TARGET,
        상태: t < QUARTER_TARGET ? "부족" : "초과",
      };
    });
    const ws = XLSX.utils.json_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${quarter}분기_${position}`);
    XLSX.writeFile(
      wb,
      `분기휴무검증_${year}_${quarter}분기_${position}.xlsx`
    );
  };

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="text-sm">
          <span className="font-bold">{employee?.staff_name}</span>
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

      <div className="flex border-b">
        {POSITIONS.map((p) => (
          <button
            key={p}
            className={cn(
              "flex-1 py-3 font-bold text-sm transition-colors",
              position === p
                ? "border-b-2 border-primary bg-accent"
                : "text-muted-foreground"
            )}
            onClick={() => setPosition(p)}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-3 flex-wrap">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(
            (y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            )
          )}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {QUARTERS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <Button size="sm" onClick={fetchData} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "조회"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={mismatched.length === 0}
        >
          <Download className="h-4 w-4" /> Excel 다운로드
        </Button>
      </div>

      <div className="px-3 pb-2 text-sm text-muted-foreground">
        목표: <span className="font-semibold text-foreground">휴무 + 운휴 + 지휴 − 지근 = {QUARTER_TARGET}</span>
        {" · "}검증 직원 {summary.checked}명 중{" "}
        <span className="font-semibold text-red-600 dark:text-red-400">
          부족 {summary.shortage}명
        </span>
        {" / "}
        <span className="font-semibold text-amber-600 dark:text-amber-400">
          초과 {summary.excess}명
        </span>
        {mismatched.length > 0 && (
          <>
            {" · "}
            <span className="text-foreground">
              행을 클릭하면 해당 직원의 근무 캘린더가 열립니다.
            </span>
          </>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium px-4 pb-2">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-auto px-2 pb-20">
        {!hasFetched && !isLoading && (
          <div className="text-center text-muted-foreground py-12">
            분기를 선택하고 <span className="font-semibold text-foreground">조회</span> 버튼을 누르면 검증 결과가 표시됩니다.
          </div>
        )}
        {hasFetched && !isLoading && mismatched.length === 0 && !error && (
          <div className="text-center text-muted-foreground py-12">
            {position} 전원이 분기 휴무 {QUARTER_TARGET}개를 정확히 충족했습니다. ✅
          </div>
        )}

        {mismatched.length > 0 && (
          <div className="border rounded-md overflow-auto">
            <Table className="min-w-max">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">사번</TableHead>
                  <TableHead className="text-center">이름</TableHead>
                  <TableHead className="text-center">휴무</TableHead>
                  <TableHead className="text-center">운휴</TableHead>
                  <TableHead className="text-center">지휴</TableHead>
                  <TableHead className="text-center">지근</TableHead>
                  <TableHead className="text-center">합계</TableHead>
                  <TableHead className="text-center">24 대비</TableHead>
                  <TableHead className="text-center">상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mismatched.map((r) => {
                  const t = total(r);
                  const diff = t - QUARTER_TARGET;
                  const isShort = diff < 0;
                  return (
                    <TableRow
                      key={r.staff_id}
                      role="button"
                      tabIndex={0}
                      title={`${r.staff_name} 근무 캘린더 열기`}
                      onClick={() => setSelectedStaff(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedStaff(r);
                        }
                      }}
                      className={cn(
                        "cursor-pointer",
                        isShort
                          ? "bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50"
                          : "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
                      )}
                    >
                      <TableCell className="text-center text-sm whitespace-nowrap">
                        {r.employee_number ?? "-"}
                      </TableCell>
                      <TableCell className="text-center text-sm whitespace-nowrap font-medium">
                        {r.staff_name}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {r.hueCount}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {r.weekendTurnCount}
                      </TableCell>
                      <TableCell className="text-center text-sm text-blue-600 dark:text-blue-400">
                        +{r.jihyuCount}
                      </TableCell>
                      <TableCell className="text-center text-sm text-green-700 dark:text-green-400">
                        −{r.jigeunCount}
                      </TableCell>
                      <TableCell className="text-center text-sm font-bold">
                        {t}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-center text-sm font-bold",
                          isShort
                            ? "text-red-600 dark:text-red-400"
                            : "text-amber-600 dark:text-amber-400"
                        )}
                      >
                        {diff > 0 ? `+${diff}` : diff}
                      </TableCell>
                      <TableCell className="text-center text-sm font-medium">
                        {isShort ? (
                          <span className="text-red-600 dark:text-red-400">
                            부족
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            초과
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <QuarterBalanceCalendarModal
        staff={selectedStaff}
        year={year}
        quarter={quarter}
        onClose={() => setSelectedStaff(null)}
        onChanged={fetchData}
      />
    </div>
  );
}
