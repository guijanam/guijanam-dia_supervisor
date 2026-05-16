"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { RecordType, SpecialScheduleWithEmployee } from "@/lib/types";
import { getTodayMonthStr, getDayName } from "@/lib/schedule-utils";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, LogOut, Download, Trash2, Save } from "lucide-react";

interface Row extends SpecialScheduleWithEmployee {
  _draftDate: string;
  _draftType: RecordType;
}

export function AdminDashboard() {
  const { employee, logout } = useAuth();
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [nameFilter, setNameFilter] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const [year, month] = monthValue.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = `${year}-${String(month).padStart(2, "0")}-31`;

    try {
      const { data: schedules, error: qErr } = await supabase
        .from("special_schedules")
        .select("id, staff_id, target_date, record_type, created_at")
        .gte("target_date", start)
        .lte("target_date", end)
        .order("target_date", { ascending: true });

      if (qErr) throw qErr;

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

  const filtered = useMemo(() => {
    const f = nameFilter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        r.employee?.staff_name?.toLowerCase().includes(f) ||
        r.employee?.employee_number?.includes(f)
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

  const exportExcel = () => {
    const sheetData = filtered.map((r) => ({
      이름: r.employee?.staff_name ?? "",
      사번: r.employee?.employee_number ?? "",
      직책: r.employee?.staff_position ?? "",
      날짜: r.target_date,
      요일: getDayName(r.target_date),
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

      <div className="flex items-center gap-2 p-3 flex-wrap">
        <Input
          type="month"
          value={monthValue}
          onChange={(e) => setMonthValue(e.target.value)}
          className="w-auto"
        />
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
        <Button
          size="sm"
          variant="outline"
          onClick={exportExcel}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" /> Excel 다운로드
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
                <TableHead className="text-center">이름</TableHead>
                <TableHead className="text-center">사번</TableHead>
                <TableHead className="text-center">직책</TableHead>
                <TableHead className="text-center">날짜</TableHead>
                <TableHead className="text-center">구분</TableHead>
                <TableHead className="text-center">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    데이터가 없습니다.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.staff_name}
                  </TableCell>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.employee_number}
                  </TableCell>
                  <TableCell className="text-center text-sm whitespace-nowrap">
                    {row.employee?.staff_position}
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
