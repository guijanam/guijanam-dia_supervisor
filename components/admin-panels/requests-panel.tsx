"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import type {
  RecordType,
  ScheduleRecord,
  SpecialScheduleWithEmployee,
  JigeunCaps,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  parseTurnsText,
} from "@/lib/types";
import { getTodayMonthStr, getDayName, getTurnColorClass } from "@/lib/schedule-utils";
import { cn } from "@/lib/utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  Download,
  Trash2,
  Save,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";

interface Row extends SpecialScheduleWithEmployee {
  _draftDate: string;
  _draftType: RecordType;
  regularTurn: string | null;
}

// 헤더(freezeDate 배지)·JigeunCapSettings 가 쓰는 설정 묶음
export interface SettingsSnapshot {
  caps: JigeunCaps;
  freezeDate: string | null;
  weekendHolidayTurns: string[];
}

interface RequestsPanelProps {
  // 설정(app_settings)을 새로 불러올 때마다 부모로 통지 (헤더 표시용)
  onSettingsLoaded?: (s: SettingsSnapshot) => void;
  // 패널의 재조회 함수를 부모에 등록 (JigeunCapSettings 저장 후 호출용)
  registerRefresh?: (refresh: () => void) => void;
}

export function RequestsPanel({
  onSettingsLoaded,
  registerRefresh,
}: RequestsPanelProps) {
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [nameFilter, setNameFilter] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );

  // 전체 삭제 확인 모달 상태
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllBusy, setDeleteAllBusy] = useState(false);

  // 신규 등록 모달 상태
  const [addOpen, setAddOpen] = useState(false);
  const [empList, setEmpList] = useState<
    Array<{ staff_id: number; staff_name: string; staff_position: string }>
  >([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [addStaffId, setAddStaffId] = useState<string>("");
  const [addDate, setAddDate] = useState<string>("");
  const [addType, setAddType] = useState<RecordType>("지근");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // onSettingsLoaded 를 최신값으로 유지 (fetchData 의존성에서 제외)
  const onSettingsLoadedRef = useRef(onSettingsLoaded);
  onSettingsLoadedRef.current = onSettingsLoaded;

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

    try {
      const [{ data: schedules, error: qErr }, scheduleResult, settingsResult] =
        await Promise.all([
          supabase
            .from("special_schedules")
            .select("id, staff_id, target_date, record_type, created_at")
            .gte("target_date", start)
            .lte("target_date", end)
            .order("target_date", { ascending: true }),
          supabase
            .rpc("get_schedule_by_range", {
              p_start_date: start,
              p_end_date: end,
            })
            .range(0, 10000),
          supabase
            .from("app_settings")
            .select("jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday, request_freeze_date, weekend_holiday_turns")
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (qErr) throw qErr;
      if (scheduleResult.error) throw scheduleResult.error;

      const s = settingsResult.data as {
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
        request_freeze_date: string | null;
        weekend_holiday_turns: string | null;
      } | null;
      const caps = s
        ? {
            weekday: s.jigeun_cap_weekday,
            saturday: s.jigeun_cap_saturday,
            sunday: s.jigeun_cap_sunday,
            holiday: s.jigeun_cap_holiday,
          }
        : DEFAULT_JIGEUN_CAPS;
      const freezeDate = s?.request_freeze_date ?? null;
      const turns = s
        ? parseTurnsText(s.weekend_holiday_turns)
        : DEFAULT_WEEKEND_HOLIDAY_TURNS;
      setWeekendHolidayTurns(turns);
      onSettingsLoadedRef.current?.({ caps, freezeDate, weekendHolidayTurns: turns });

      // (staff_id, 날짜) → 원래 근무(turn) 매핑
      const regularMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (dateStr) regularMap.set(`${row.staff_id}|${dateStr}`, row.turn);
      }

      const list = (schedules ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
        created_at?: string;
      }>;

      // staff_id → coworker_list 정보 매핑 (FK 임베딩 대신 별도 조회)
      const empMap = new Map<
        number,
        { staff_name: string; employee_number: string | null; staff_position: string }
      >();
      const ids = [...new Set(list.map((s) => s.staff_id))];
      if (ids.length > 0) {
        const { data: emps, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, employee_number, staff_position")
          .in("staff_id", ids);
        if (eErr) throw eErr;
        for (const e of emps ?? []) {
          empMap.set(e.staff_id, {
            staff_name: e.staff_name,
            employee_number: e.employee_number,
            staff_position: e.staff_position,
          });
        }
      }

      const mapped: Row[] = list.map((s) => ({
        ...s,
        employee: empMap.get(s.staff_id) ?? null,
        _draftDate: s.target_date,
        _draftType: s.record_type,
        regularTurn: regularMap.get(`${s.staff_id}|${s.target_date}`) ?? null,
      }));
      setRows(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [monthValue]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 부모(admin-dashboard)에 재조회 함수 등록 — JigeunCapSettings 저장 후 호출됨
  useEffect(() => {
    registerRefresh?.(fetchData);
  }, [registerRefresh, fetchData]);

  const shiftMonth = (delta: number) => {
    const [year, month] = monthValue.split("-").map(Number);
    const d = new Date(year, month - 1 + delta);
    setMonthValue(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  };

  const filtered = useMemo(() => {
    const f = nameFilter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        r.employee?.staff_name?.toLowerCase().includes(f) ||
        String(r.employee?.employee_number ?? "").toLowerCase().includes(f)
    );
  }, [rows, nameFilter]);

  const saveRow = async (row: Row) => {
    setBusyId(row.id);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("special_schedules")
        .update({
          target_date: row._draftDate,
          record_type: row._draftType,
        })
        .eq("id", row.id);
      if (upErr) throw upErr;
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "수정 실패");
    } finally {
      setBusyId(null);
    }
  };

  const deleteRow = async (row: Row) => {
    if (
      !confirm(
        `${row.employee?.staff_name ?? ""}님의 ${row.target_date} 기록을 삭제할까요?`
      )
    )
      return;
    setBusyId(row.id);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from("special_schedules")
        .delete()
        .eq("id", row.id);
      if (delErr) throw delErr;
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusyId(null);
    }
  };

  const openAddModal = async () => {
    setAddError(null);
    setAddStaffId("");
    setAddType("지근");
    setAddDate(`${monthValue}-01`);
    setAddOpen(true);
    if (empList.length === 0) {
      setEmpLoading(true);
      try {
        const { data, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position")
          .order("staff_name", { ascending: true });
        if (eErr) throw eErr;
        setEmpList(
          (data ?? []) as Array<{
            staff_id: number;
            staff_name: string;
            staff_position: string;
          }>
        );
      } catch (err) {
        setAddError(
          err instanceof Error ? err.message : "직원 목록 로딩 실패"
        );
      } finally {
        setEmpLoading(false);
      }
    }
  };

  const submitAdd = async () => {
    if (!addStaffId || !addDate) {
      setAddError("직원과 날짜를 선택하세요.");
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const { error: upErr } = await supabase
        .from("special_schedules")
        .upsert(
          {
            staff_id: Number(addStaffId),
            target_date: addDate,
            record_type: addType,
          },
          { onConflict: "staff_id,target_date" }
        );
      if (upErr) throw upErr;
      setAddOpen(false);
      // 등록한 날짜가 현재 조회 월이면 목록 새로고침
      if (addDate.slice(0, 7) === monthValue) {
        await fetchData();
      }
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setAddBusy(false);
    }
  };

  const exportExcel = () => {
    const sheetData = filtered.map((r) => ({
      사번: r.employee?.employee_number ?? "",
      직책: r.employee?.staff_position ?? "",
      이름: r.employee?.staff_name ?? "",
      날짜: r.target_date,
      요일: getDayName(r.target_date),
      "원래 근무": r.regularTurn ?? "",
      구분: r.record_type,
      신청일시: r.created_at
        ? new Date(r.created_at).toLocaleString("ko-KR")
        : "",
    }));
    const ws = XLSX.utils.json_to_sheet(sheetData);
    ws["!cols"] = [
      { wch: 10 },
      { wch: 12 },
      { wch: 8 },
      { wch: 12 },
      { wch: 6 },
      { wch: 8 },
      { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `지근지휴_${monthValue}`);
    XLSX.writeFile(wb, `지근지휴_${monthValue}.xlsx`);
  };

  const openDeleteAll = () => {
    if (
      !confirm(
        `[경고] ${monthValue} 월의 모든 신청 내역을 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`
      )
    )
      return;
    setDeleteAllOpen(true);
  };

  const confirmDeleteAll = async () => {
    setDeleteAllBusy(true);
    setError(null);
    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    try {
      const { error: delErr } = await supabase
        .from("special_schedules")
        .delete()
        .gte("target_date", start)
        .lte("target_date", end);
      if (delErr) throw delErr;
      setDeleteAllOpen(false);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "전체 삭제 실패");
    } finally {
      setDeleteAllBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col min-w-0">
      <div className="flex items-center gap-2 p-3 flex-wrap">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftMonth(-1)}
            title="이전 달"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="month"
            value={monthValue}
            onChange={(e) => setMonthValue(e.target.value)}
            className="w-auto"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => shiftMonth(1)}
            title="다음 달"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Input
          type="text"
          placeholder="이름/사번 검색"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="w-40"
        />
        <Button size="sm" onClick={fetchData} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "조회"}
        </Button>
        <Button size="sm" variant="outline" onClick={openAddModal}>
          <Plus className="h-4 w-4" /> 지근/지휴
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" /> Excel 다운로드
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={openDeleteAll}
          disabled={rows.length === 0 || isLoading}
        >
          <Trash2 className="h-4 w-4" /> 전체 삭제
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">
          총 {filtered.length}건
        </span>
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium px-4 pb-2">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-auto px-2 pb-6">
        <div className="border rounded-md overflow-auto">
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">직책</TableHead>
                <TableHead className="text-center">이름</TableHead>
                <TableHead className="text-center">날짜</TableHead>
                <TableHead className="text-center">원래 근무</TableHead>
                <TableHead className="text-center">구분</TableHead>
                <TableHead className="text-center">작업</TableHead>
                <TableHead className="text-center">사번</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    데이터가 없습니다.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.staff_position}
                  </TableCell>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.staff_name}
                  </TableCell>
                  <TableCell className="text-center">
                    <Input
                      type="date"
                      value={row._draftDate}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? { ...r, _draftDate: e.target.value }
                              : r
                          )
                        )
                      }
                      className="w-36 h-8"
                    />
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-center text-sm whitespace-nowrap",
                      row.regularTurn
                        ? getTurnColorClass(
                            row.regularTurn,
                            row.target_date,
                            undefined,
                            weekendHolidayTurns
                          )
                        : ""
                    )}
                  >
                    {row.regularTurn ?? "-"}
                  </TableCell>
                  <TableCell className="text-center">
                    <select
                      value={row._draftType}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) =>
                            r.id === row.id
                              ? {
                                  ...r,
                                  _draftType: e.target.value as RecordType,
                                }
                              : r
                          )
                        )
                      }
                      className="h-8 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="지근">지근</option>
                      <option value="지휴">지휴</option>
                    </select>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        size="icon-sm"
                        variant="outline"
                        disabled={
                          busyId === row.id ||
                          (row._draftDate === row.target_date &&
                            row._draftType === row.record_type)
                        }
                        onClick={() => saveRow(row)}
                        title="저장"
                      >
                        {busyId === row.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="destructive"
                        disabled={busyId === row.id}
                        onClick={() => deleteRow(row)}
                        title="삭제"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.employee_number}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>지근/지휴 신규 등록</DialogTitle>
            <DialogDescription>
              직원과 날짜, 구분을 선택해 등록합니다. 같은 직원·날짜에 기존
              신청이 있으면 구분이 덮어쓰기 됩니다.
            </DialogDescription>
          </DialogHeader>

          {addError && (
            <p className="text-destructive text-sm font-medium">{addError}</p>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">직원</span>
              <select
                value={addStaffId}
                disabled={empLoading || addBusy}
                onChange={(e) => setAddStaffId(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">
                  {empLoading ? "직원 목록 로딩 중..." : "직원 선택"}
                </option>
                {empList.map((emp) => (
                  <option key={emp.staff_id} value={emp.staff_id}>
                    {emp.staff_name}
                    {emp.staff_position ? ` (${emp.staff_position})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">날짜</span>
              <Input
                type="date"
                value={addDate}
                disabled={addBusy}
                onChange={(e) => setAddDate(e.target.value)}
                className="h-9"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">구분</span>
              <select
                value={addType}
                disabled={addBusy}
                onChange={(e) => setAddType(e.target.value as RecordType)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="지근">지근</option>
                <option value="지휴">지휴</option>
              </select>
            </label>

            <Button
              onClick={submitAdd}
              disabled={addBusy || empLoading}
              className="w-full"
            >
              {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "등록"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteAllOpen}
        onOpenChange={(open) => !deleteAllBusy && setDeleteAllOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              전체 삭제 최종 확인
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">
                {monthValue}
              </span>{" "}
              월의 신청 내역{" "}
              <span className="font-semibold text-foreground">
                {rows.length}건
              </span>
              이 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 정말
              삭제하시겠습니까?
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={deleteAllBusy}
              onClick={() => setDeleteAllOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={deleteAllBusy}
              onClick={confirmDeleteAll}
            >
              {deleteAllBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "전체 삭제"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
