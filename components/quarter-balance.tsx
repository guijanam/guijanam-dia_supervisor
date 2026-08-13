"use client";

import { useState, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import { useAuth } from "@/lib/auth-context";
import type { RecordType, ScheduleRecord } from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  parseHolidayTurnRulesText,
} from "@/lib/types";
import {
  getDayName,
  padDateRange,
  applyHolidayTurnRulesByStaffKey,
  isHueTurnOnDate,
} from "@/lib/schedule-utils";
import { format } from "date-fns";
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
import { Loader2, LogOut, Download } from "lucide-react";

// 분기별 휴무 목표치: 운휴 + 휴 + 지휴 − 지근 = 24
const QUARTER_TARGET = 24;

const POSITIONS = ["기관사", "차장"] as const;
type Position = (typeof POSITIONS)[number];

const QUARTERS = [
  { value: 1, label: "1분기 (1~3월)", startMonth: 1 },
  { value: 2, label: "2분기 (4~6월)", startMonth: 4 },
  { value: 3, label: "3분기 (7~9월)", startMonth: 7 },
  { value: 4, label: "4분기 (10~12월)", startMonth: 10 },
] as const;

interface StaffRow {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  employee_number: string | null;
  hueCount: number; // 휴무 (turn 에 '휴')
  weekendTurnCount: number; // 운휴 (주말/공휴일 & 31~37번)
  jihyuCount: number; // 지휴 (+)
  jigeunCount: number; // 지근 (−)
}

function quarterRange(year: number, quarter: number): { start: string; end: string } {
  const q = QUARTERS.find((x) => x.value === quarter)!;
  const startMonth = q.startMonth; // 1, 4, 7, 10
  const start = new Date(year, startMonth - 1, 1);
  // 분기 마지막 달의 말일
  const end = new Date(year, startMonth + 2, 0);
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}

// get_schedule_by_range RPC 는 서버에서 10,000행으로 잘립니다(staff_id 오름차순).
// 분기 전체(약 23,000행)를 한 번에 부르면 낮은 staff_id(기관사)가 한도를
// 다 차지해 높은 staff_id(차장)가 누락됩니다. 그래서 월 단위(약 8,000행)로
// 나눠 호출합니다.
function quarterMonths(
  year: number,
  quarter: number
): Array<{ start: string; end: string }> {
  const q = QUARTERS.find((x) => x.value === quarter)!;
  return [0, 1, 2].map((offset) => {
    const m = q.startMonth - 1 + offset;
    const start = new Date(year, m, 1);
    const end = new Date(year, m + 1, 0);
    return {
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    };
  });
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

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setHasFetched(true);
    const { start, end } = quarterRange(year, quarter);
    const months = quarterMonths(year, quarter);
    // 분기 경계에 걸친 운휴대기 짝도 판정하려면 앞뒤로 여유가 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [
        monthlySchedules,
        specialResult,
        holidayResult,
        empResult,
        settingsResult,
      ] = await Promise.all([
        // 월 단위로 나눠 호출 후 합산. 각 호출은 내부에서 페이지네이션되므로
        // 행 수 한도에 잘리지 않는다.
        Promise.all(
          months.map((m, i) =>
            fetchScheduleByRange(
              // 첫 달은 앞으로, 마지막 달은 뒤로 여유를 둔다(분기 경계 짝 판정용).
              i === 0 ? padded.start : m.start,
              i === months.length - 1 ? padded.end : m.end
            )
          )
        ),
        supabase
          .from("special_schedules")
          .select("staff_id, target_date, record_type")
          .gte("target_date", start)
          .lte("target_date", end),
        supabase
          .from("holidays")
          .select("locdate")
          .eq("is_holiday", "Y")
          .gte("locdate", padded.start)
          .lte("locdate", padded.end),
        supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position, employee_number"),
        supabase
          .from("app_settings")
          .select(
            "weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules"
          )
          .eq("id", 1)
          .maybeSingle(),
      ]);

      const scheduleData: ScheduleRecord[] = [];
      for (const rows of monthlySchedules) {
        scheduleData.push(...rows);
      }
      if (specialResult.error) throw specialResult.error;
      if (holidayResult.error) throw holidayResult.error;
      if (empResult.error) throw empResult.error;

      const settings = settingsResult.data as {
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
      } | null;
      const holidayRules = settings
        ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      const weekendHolidayTurns = settings
        ? parseTurnsText(settings.weekend_holiday_turns)
        : DEFAULT_WEEKEND_HOLIDAY_TURNS;
      const jigeunTurns = settings
        ? {
            dayTurns: parseTurnsText(settings.jigeun_day_turns),
            nightTurns: parseTurnsText(settings.jigeun_night_turns),
          }
        : DEFAULT_JIGEUN_TURNS;

      const holidays = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

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

      // staff_id → 집계 누적
      const acc = new Map<number, StaffRow>();
      const ensure = (staffId: number): StaffRow => {
        let r = acc.get(staffId);
        if (!r) {
          const emp = empMap.get(staffId);
          r = {
            staff_id: staffId,
            staff_name: emp?.staff_name ?? `(미상 ${staffId})`,
            staff_position: emp?.staff_position ?? "",
            employee_number: emp?.employee_number ?? null,
            hueCount: 0,
            weekendTurnCount: 0,
            jihyuCount: 0,
            jigeunCount: 0,
          };
          acc.set(staffId, r);
        }
        return r;
      };

      // 운휴대기 치환 맵. 분기 밖(패딩) 날짜는 짝 판정용 context 로만 쓴다 —
      // 집계에 섞이면 분기 휴무 수가 부풀려진다.
      const regularByStaff = new Map<string, string>();
      const contextByStaff = new Map<string, string>();
      for (const row of scheduleData) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const key = `${row.staff_id}|${dateStr}`;
        if (dateStr >= start && dateStr <= end) regularByStaff.set(key, row.turn);
        else contextByStaff.set(key, row.turn);
      }
      const displayByStaff = applyHolidayTurnRulesByStaffKey(
        regularByStaff,
        holidays,
        holidayRules,
        contextByStaff
      );

      // 정규 근무표: 휴무 / 운휴 집계 (user-calendar 로직 그대로).
      // 휴무는 치환 후 근무번호 기준, 운휴는 원본 기준.
      for (const row of scheduleData) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        if (dateStr < start || dateStr > end) continue; // 패딩 날짜는 집계 제외
        const r = ensure(row.staff_id);
        const key = `${row.staff_id}|${dateStr}`;
        if (isHueTurnOnDate(key, regularByStaff, displayByStaff, jigeunTurns)) {
          r.hueCount++;
        }
        const dayName = getDayName(dateStr);
        const isHoliday =
          dayName === "토" || dayName === "일" || holidays.has(dateStr);
        if (isHoliday && weekendHolidayTurns.includes(row.turn)) {
          r.weekendTurnCount++;
        }
      }

      // 지근/지휴 신청 내역
      for (const sp of (specialResult.data ?? []) as Array<{
        staff_id: number;
        target_date: string;
        record_type: RecordType;
      }>) {
        const r = ensure(sp.staff_id);
        if (sp.record_type === "지휴") r.jihyuCount++;
        else if (sp.record_type === "지근") r.jigeunCount++;
      }

      // 이름에 "결원"이 포함된 가상 직원은 검증 대상에서 제외
      setRows(
        [...acc.values()].filter((r) => !r.staff_name.includes("결원"))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [year, quarter]);

  // 합계 = 휴무 + 운휴 + 지휴 − 지근. 24 가 아닌 직원만 표시.
  const total = (r: StaffRow) =>
    r.hueCount + r.weekendTurnCount + r.jihyuCount - r.jigeunCount;

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
                      className={cn(
                        isShort
                          ? "bg-red-50 dark:bg-red-950/30"
                          : "bg-amber-50 dark:bg-amber-950/30"
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
    </div>
  );
}
