"use client";

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ComponentType,
} from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
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
import { isValidShift, isValidRefDate } from "@/lib/reference";
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
import { ThemeToggle } from "@/components/theme-toggle";
import { STAFF_EDIT_URL } from "@/components/staff-list-link";
import { AnnouncementAdmin } from "@/components/announcement-admin";
import { DocumentAdmin } from "@/components/document-admin";
import { JigeunCapSettings } from "@/components/jigeun-cap-settings";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  LogOut,
  Download,
  Trash2,
  Save,
  ChevronLeft,
  ChevronRight,
  Plus,
  KeyRound,
  CalendarCog,
  Megaphone,
  FileText,
  Users,
} from "lucide-react";

interface Row extends SpecialScheduleWithEmployee {
  _draftDate: string;
  _draftType: RecordType;
  regularTurn: string | null;
}

function SidebarItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [nameFilter, setNameFilter] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [caps, setCaps] = useState<JigeunCaps>(DEFAULT_JIGEUN_CAPS);
  const [freezeDate, setFreezeDate] = useState<string | null>(null);
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

  // 사이드바에서 여는 공지/문서 모달 상태
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);

  // PIN 초기화 모달 상태
  const [pinOpen, setPinOpen] = useState(false);
  const [pinSearch, setPinSearch] = useState("");
  const [pinBusyId, setPinBusyId] = useState<number | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinDone, setPinDone] = useState<string | null>(null);

  // 기준 근무 수정 모달 상태
  const [refOpen, setRefOpen] = useState(false);
  const [refSearch, setRefSearch] = useState("");
  const [refList, setRefList] = useState<
    Array<{
      staff_id: number;
      staff_name: string;
      staff_position: string;
      reference_date: string | null;
      reference_shift: string | null;
    }>
  >([]);
  const [refListLoading, setRefListLoading] = useState(false);
  const [refSelectedId, setRefSelectedId] = useState<number | null>(null);
  const [refDate, setRefDate] = useState("");
  const [refShift, setRefShift] = useState("");
  const [refConfirmOpen, setRefConfirmOpen] = useState(false);
  const [refBusy, setRefBusy] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [refDone, setRefDone] = useState<string | null>(null);

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
      setCaps(s ? {
        weekday: s.jigeun_cap_weekday,
        saturday: s.jigeun_cap_saturday,
        sunday: s.jigeun_cap_sunday,
        holiday: s.jigeun_cap_holiday,
      } : DEFAULT_JIGEUN_CAPS);
      setFreezeDate(s?.request_freeze_date ?? null);
      setWeekendHolidayTurns(
        s ? parseTurnsText(s.weekend_holiday_turns) : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );

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

  const openPinModal = async () => {
    setPinError(null);
    setPinDone(null);
    setPinSearch("");
    setPinOpen(true);
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
        setPinError(
          err instanceof Error ? err.message : "직원 목록 로딩 실패"
        );
      } finally {
        setEmpLoading(false);
      }
    }
  };

  const resetPin = async (staffId: number, staffName: string) => {
    if (
      !confirm(
        `${staffName}님의 PIN 을 초기화할까요?\n초기화하면 해당 직원이 다음 로그인 시 PIN 을 다시 설정합니다.`
      )
    )
      return;
    setPinBusyId(staffId);
    setPinError(null);
    setPinDone(null);
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ pin_hash: null })
        .eq("staff_id", staffId);
      if (upErr) throw upErr;
      setPinDone(`${staffName}님의 PIN 이 초기화되었습니다.`);
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "PIN 초기화 실패");
    } finally {
      setPinBusyId(null);
    }
  };

  const openRefModal = async () => {
    setRefError(null);
    setRefDone(null);
    setRefSearch("");
    setRefSelectedId(null);
    setRefDate("");
    setRefShift("");
    setRefOpen(true);
    setRefListLoading(true);
    try {
      const { data, error: eErr } = await supabase
        .from("coworker_list")
        .select("staff_id, staff_name, staff_position, reference_date, reference_shift")
        .order("staff_name", { ascending: true });
      if (eErr) throw eErr;
      setRefList(
        (data ?? []) as Array<{
          staff_id: number;
          staff_name: string;
          staff_position: string;
          reference_date: string | null;
          reference_shift: string | null;
        }>
      );
    } catch (err) {
      setRefError(err instanceof Error ? err.message : "직원 목록 로딩 실패");
    } finally {
      setRefListLoading(false);
    }
  };

  const selectRefEmployee = (staffId: number) => {
    const emp = refList.find((e) => e.staff_id === staffId);
    if (!emp) return;
    setRefSelectedId(staffId);
    setRefDate(emp.reference_date ?? "");
    setRefShift(emp.reference_shift ?? "");
    setRefError(null);
    setRefDone(null);
  };

  const requestRefSave = () => {
    setRefError(null);
    const date = refDate.trim();
    const shift = refShift.trim();
    if (date && !isValidRefDate(date)) {
      setRefError("기준일 형식이 올바르지 않습니다. (YYYY-MM-DD)");
      return;
    }
    if (shift && !isValidShift(shift)) {
      setRefError(
        "기준 근무번호 형식이 올바르지 않습니다. 예) 56, 52~, 휴22, 대11~"
      );
      return;
    }
    setRefConfirmOpen(true);
  };

  const doRefSave = async () => {
    if (refSelectedId == null) return;
    setRefBusy(true);
    setRefError(null);
    const nextDate = refDate.trim() || null;
    const nextShift = refShift.trim() || null;
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ reference_date: nextDate, reference_shift: nextShift })
        .eq("staff_id", refSelectedId);
      if (upErr) throw upErr;
      setRefList((prev) =>
        prev.map((e) =>
          e.staff_id === refSelectedId
            ? { ...e, reference_date: nextDate, reference_shift: nextShift }
            : e
        )
      );
      const name =
        refList.find((e) => e.staff_id === refSelectedId)?.staff_name ?? "";
      setRefDone(`${name}님의 기준 근무 정보가 저장되었습니다.`);
      setRefConfirmOpen(false);
    } catch (err) {
      setRefError(err instanceof Error ? err.message : "저장 실패");
      setRefConfirmOpen(false);
    } finally {
      setRefBusy(false);
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
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="text-sm">
            <span className="font-bold">관리자</span>
          </div>
          <span
            className={cn(
              "text-xs rounded px-1.5 py-0.5 border",
              freezeDate
                ? format(new Date(), "yyyy-MM-dd") > freezeDate
                  ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/50 dark:text-red-300"
                  : "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300"
                : "text-muted-foreground"
            )}
            title="사용자 지근/지휴 신청 마감일"
          >
            {freezeDate
              ? `마감 ${freezeDate}${
                  format(new Date(), "yyyy-MM-dd") > freezeDate
                    ? " (잠김)"
                    : ""
                }`
              : "마감 미설정"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <JigeunCapSettings
            caps={caps}
            freezeDate={freezeDate}
            weekendHolidayTurns={weekendHolidayTurns}
            onSaved={fetchData}
          />
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

      <div className="flex flex-1 min-h-0">
        <aside className="w-12 sm:w-48 shrink-0 border-r p-2 flex flex-col gap-1 overflow-y-auto">
          <p className="hidden sm:block px-3 pt-1 pb-2 text-xs font-semibold text-muted-foreground">
            대시보드
          </p>
          <SidebarItem
            icon={Megaphone}
            label="공지"
            onClick={() => setAnnounceOpen(true)}
          />
          <SidebarItem
            icon={FileText}
            label="문서"
            onClick={() => setDocumentOpen(true)}
          />
          <SidebarItem
            icon={KeyRound}
            label="PIN 초기화"
            onClick={openPinModal}
          />
          <SidebarItem
            icon={CalendarCog}
            label="기준근무 수정"
            onClick={openRefModal}
          />
          <SidebarItem
            icon={Users}
            label="직원명단"
            onClick={() =>
              window.open(STAFF_EDIT_URL, "_blank", "noopener")
            }
          />
        </aside>

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
              {addBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "등록"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={refOpen} onOpenChange={setRefOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>기준 근무 수정</DialogTitle>
            <DialogDescription>
              직원의 기준일/기준 근무번호를 수정합니다. 이 값은 근무표 계산의
              기준점이라, 바꾸면 해당 직원의 근무표 전체가 다시 계산됩니다.
            </DialogDescription>
          </DialogHeader>

          {refError && (
            <p className="text-destructive text-sm font-medium">{refError}</p>
          )}
          {refDone && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              {refDone}
            </p>
          )}

          <Input
            type="text"
            placeholder="이름 검색"
            value={refSearch}
            onChange={(e) => setRefSearch(e.target.value)}
            className="h-9"
          />

          <div className="max-h-52 overflow-auto border rounded-md divide-y">
            {refListLoading && (
              <p className="text-muted-foreground text-sm text-center py-6">
                직원 목록 로딩 중...
              </p>
            )}
            {!refListLoading &&
              (() => {
                const q = refSearch.trim().toLowerCase();
                const list = q
                  ? refList.filter((e) =>
                      e.staff_name.toLowerCase().includes(q)
                    )
                  : refList;
                if (list.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm text-center py-6">
                      검색 결과가 없습니다.
                    </p>
                  );
                }
                return list.map((emp) => (
                  <button
                    type="button"
                    key={emp.staff_id}
                    onClick={() => selectRefEmployee(emp.staff_id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                      refSelectedId === emp.staff_id
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <span>
                      {emp.staff_name}
                      {emp.staff_position ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({emp.staff_position})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {emp.reference_date ?? "-"} / {emp.reference_shift ?? "-"}
                    </span>
                  </button>
                ));
              })()}
          </div>

          {refSelectedId != null && (
            <div className="flex flex-col gap-3 border-t pt-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">기준일</span>
                <Input
                  type="date"
                  value={refDate}
                  disabled={refBusy}
                  onChange={(e) => setRefDate(e.target.value)}
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">기준 근무번호</span>
                <Input
                  type="text"
                  value={refShift}
                  disabled={refBusy}
                  placeholder="예) 56, 52~, 휴22, 대11~"
                  onChange={(e) => setRefShift(e.target.value)}
                  className="h-9"
                />
              </label>
              <Button
                onClick={requestRefSave}
                disabled={refBusy}
                className="w-full"
              >
                저장
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={refConfirmOpen}
        onOpenChange={(o) => !refBusy && setRefConfirmOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              근무표 변경 확인
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">
                {refList.find((e) => e.staff_id === refSelectedId)?.staff_name}
              </span>
              님의 기준 근무 정보를 바꾸면 해당 직원 근무표 전체가 다시
              계산됩니다. 정말 저장하시겠습니까?
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={refBusy}
              onClick={() => setRefConfirmOpen(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={refBusy}
              onClick={doRefSave}
            >
              {refBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "저장"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN 초기화</DialogTitle>
            <DialogDescription>
              PIN 을 잊은 직원을 검색해 초기화합니다. 초기화된 직원은 다음
              로그인 시 PIN 을 새로 설정합니다.
            </DialogDescription>
          </DialogHeader>

          {pinError && (
            <p className="text-destructive text-sm font-medium">{pinError}</p>
          )}
          {pinDone && (
            <p className="text-sm font-medium text-green-600 dark:text-green-400">
              {pinDone}
            </p>
          )}

          <Input
            type="text"
            placeholder="이름 검색"
            value={pinSearch}
            onChange={(e) => setPinSearch(e.target.value)}
            className="h-9"
          />

          <div className="max-h-72 overflow-auto border rounded-md divide-y">
            {empLoading && (
              <p className="text-muted-foreground text-sm text-center py-6">
                직원 목록 로딩 중...
              </p>
            )}
            {!empLoading &&
              (() => {
                const q = pinSearch.trim().toLowerCase();
                const list = q
                  ? empList.filter((e) =>
                      e.staff_name.toLowerCase().includes(q)
                    )
                  : empList;
                if (list.length === 0) {
                  return (
                    <p className="text-muted-foreground text-sm text-center py-6">
                      검색 결과가 없습니다.
                    </p>
                  );
                }
                return list.map((emp) => (
                  <div
                    key={emp.staff_id}
                    className="flex items-center justify-between gap-2 px-3 py-2"
                  >
                    <span className="text-sm">
                      {emp.staff_name}
                      {emp.staff_position ? (
                        <span className="text-muted-foreground">
                          {" "}
                          ({emp.staff_position})
                        </span>
                      ) : null}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pinBusyId === emp.staff_id}
                      onClick={() => resetPin(emp.staff_id, emp.staff_name)}
                    >
                      {pinBusyId === emp.staff_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "초기화"
                      )}
                    </Button>
                  </div>
                ));
              })()}
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

      <AnnouncementAdmin
        open={announceOpen}
        onOpenChange={setAnnounceOpen}
        hideTrigger
      />
      <DocumentAdmin
        open={documentOpen}
        onOpenChange={setDocumentOpen}
        hideTrigger
      />
    </div>
  );
}
