"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type {
  RecordType,
  ScheduleRecord,
  LotteryStatus,
  JigeunCaps,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  parseTurnsText,
} from "@/lib/types";
import {
  getTodayMonthStr,
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getDayName,
  getPositionCap,
} from "@/lib/schedule-utils";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnnouncementAdmin } from "@/components/announcement-admin";
import {
  Loader2,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { LoserRescheduleCalendar } from "@/components/loser-reschedule-calendar";
import { AdminEmployeeCalendarView } from "@/components/admin-employee-calendar-view";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const POSITIONS = ["기관사", "차장"] as const;
type Position = (typeof POSITIONS)[number];

interface SpecialEntry {
  id: string;
  staff_id: number;
  staff_name: string;
  staff_position: string;
  record_type: RecordType;
  regularTurn: string | null;
  lottery_status: LotteryStatus | null;
  lottery_at: string | null;
}

function countJigeun(entries: SpecialEntry[], pos: Position): number {
  return entries.filter(
    (e) => e.staff_position === pos && e.record_type === "지근"
  ).length;
}

export function AdminCalendar() {
  const { logout } = useAuth();
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [caps, setCaps] = useState<JigeunCaps>(DEFAULT_JIGEUN_CAPS);
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [reschedTarget, setReschedTarget] = useState<SpecialEntry | null>(null);

  // 선택한 날짜에 즉시 지근/지휴를 신규 등록하기 위한 인라인 폼 상태
  const [empList, setEmpList] = useState<
    Array<{ staff_id: number; staff_name: string; staff_position: string }>
  >([]);
  const [empLoading, setEmpLoading] = useState(false);
  const empFetchStarted = useRef(false);
  const [addStaffId, setAddStaffId] = useState<string>("");
  const [addType, setAddType] = useState<RecordType>("지근");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 직원 검색 → 개인 뷰 전환 상태
  const [staffSearch, setStaffSearch] = useState("");
  const [viewStaff, setViewStaff] = useState<{
    staff_id: number;
    staff_name: string;
    staff_position: string;
  } | null>(null);

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  // 날짜별 직책별 지근 정원 초과 여부 (홀리데이 비동기 로딩 의존)
  const overCapByDate = useMemo(() => {
    const m = new Map<string, { 기관사: boolean; 차장: boolean }>();
    for (const [date, entries] of specialMap) {
      const cap = getPositionCap(date, holidays, caps);
      m.set(date, {
        기관사: countJigeun(entries, "기관사") > cap,
        차장: countJigeun(entries, "차장") > cap,
      });
    }
    return m;
  }, [specialMap, holidays, caps]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");

    try {
      const [specialResult, holidayResult, scheduleResult, settingsResult] =
        await Promise.all([
          supabase
            .from("special_schedules")
            .select(
              "id, staff_id, target_date, record_type, lottery_status, lottery_at"
            )
            .gte("target_date", start)
            .lte("target_date", end)
            .order("target_date", { ascending: true }),
          supabase
            .from("holidays")
            .select("locdate")
            .eq("is_holiday", "Y")
            .gte("locdate", start)
            .lte("locdate", end),
          supabase
            .rpc("get_schedule_by_range", {
              p_start_date: start,
              p_end_date: end,
            })
            .range(0, 10000),
          supabase
            .from("app_settings")
            .select(
              "jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday, weekend_holiday_turns"
            )
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (specialResult.error) throw specialResult.error;
      if (scheduleResult.error) throw scheduleResult.error;

      const s = settingsResult.data as {
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
        weekend_holiday_turns: string | null;
      } | null;
      setCaps(
        s
          ? {
              weekday: s.jigeun_cap_weekday,
              saturday: s.jigeun_cap_saturday,
              sunday: s.jigeun_cap_sunday,
              holiday: s.jigeun_cap_holiday,
            }
          : DEFAULT_JIGEUN_CAPS
      );
      setWeekendHolidayTurns(
        s ? parseTurnsText(s.weekend_holiday_turns) : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );

      // (staff_id, 날짜) → 원래 근무(turn) 매핑 — entry.regularTurn 채우기에만 사용.
      const regularMap = new Map<string, string>();
      for (const row of (scheduleResult.data ?? []) as ScheduleRecord[]) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (dateStr) regularMap.set(`${row.staff_id}|${dateStr}`, row.turn);
      }

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
        lottery_status: LotteryStatus | null;
        lottery_at: string | null;
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
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: emp?.staff_position ?? "",
          record_type: row.record_type,
          regularTurn:
            regularMap.get(`${row.staff_id}|${row.target_date}`) ?? null,
          lottery_status: row.lottery_status ?? null,
          lottery_at: row.lottery_at ?? null,
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

  // 날짜 모달이 닫히거나 다른 날짜로 바뀌면 등록 폼도 초기화
  useEffect(() => {
    setAddStaffId("");
    setAddType("지근");
    setAddError(null);
  }, [selectedDate]);

  // 직원 목록 1회 로드. 모달 인라인 등록 폼과 직원 검색바가 함께 사용한다.
  useEffect(() => {
    if (empFetchStarted.current) return;
    empFetchStarted.current = true;
    setEmpLoading(true);
    (async () => {
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
        empFetchStarted.current = false; // 실패 시 재시도 허용
        setAddError(
          err instanceof Error ? err.message : "직원 목록 로딩 실패"
        );
      } finally {
        setEmpLoading(false);
      }
    })();
  }, []);

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

  // 정원 초과 직책에 대해 무작위 추첨 → cap 명 당첨, 나머지 탈락 (지근만)
  const runLottery = async (pos: Position) => {
    if (!selectedDate) return;
    const cap = getPositionCap(selectedDate, holidays, caps);
    const pool = (specialMap.get(selectedDate) ?? []).filter(
      (e) => e.staff_position === pos && e.record_type === "지근"
    );
    if (pool.length <= cap) return;
    if (
      !confirm(
        `${selectedDate} ${pos} 지근 ${pool.length}명 중 ${cap}명을 추첨합니다.`
      )
    )
      return;

    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const winners = new Set(shuffled.slice(0, cap).map((e) => e.id));
    const wonIds = pool.filter((e) => winners.has(e.id)).map((e) => e.id);
    const lostIds = pool.filter((e) => !winners.has(e.id)).map((e) => e.id);
    const now = new Date().toISOString();

    setBusyId(`lottery-${pos}`);
    setError(null);
    try {
      const { error: e1 } = await supabase
        .from("special_schedules")
        .update({ lottery_status: "won", lottery_at: now })
        .in("id", wonIds);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("special_schedules")
        .update({ lottery_status: "lost", lottery_at: now })
        .in("id", lostIds);
      if (e2) throw e2;
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "추첨 실패");
    } finally {
      setBusyId(null);
    }
  };

  // 선택한 날짜에 지근/지휴 신규 등록 — admin-dashboard의 submitAdd 와 동일 패턴
  const submitAdd = async () => {
    if (!selectedDate) return;
    if (!addStaffId) {
      setAddError("직원을 선택하세요.");
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
            target_date: selectedDate,
            record_type: addType,
          },
          { onConflict: "staff_id,target_date" }
        );
      if (upErr) throw upErr;
      setAddStaffId("");
      await fetchData();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "등록 실패");
    } finally {
      setAddBusy(false);
    }
  };

  // 탈락자를 다른 날짜로 이동 (lottery 필드 초기화)
  const rescheduleLoser = async (entry: SpecialEntry, newDate: string) => {
    if (!newDate || newDate === selectedDate) return;
    setBusyId(entry.id);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("special_schedules")
        .update({
          target_date: newDate,
          lottery_status: null,
          lottery_at: null,
        })
        .eq("id", entry.id);
      if (upErr) throw upErr;
      await fetchData();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "23505") {
        setError(
          `${entry.staff_name}님은 ${newDate}에 이미 신청 내역이 있어 이동할 수 없습니다.`
        );
      } else {
        setError(err instanceof Error ? err.message : "날짜 변경 실패");
      }
    } finally {
      setBusyId(null);
    }
  };

  const selectedEntries = selectedDate
    ? specialMap.get(selectedDate) ?? []
    : [];

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="text-sm">
            <span className="font-bold">관리자</span>
          </div>
          <AnnouncementAdmin />
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

      <div className="px-3 pb-3">
        <div className="relative">
          <Input
            value={staffSearch}
            onChange={(ev) => setStaffSearch(ev.target.value)}
            placeholder={
              viewStaff
                ? `${viewStaff.staff_name}(${viewStaff.staff_position}) 화면 보는 중 — 다른 직원 검색`
                : "직원 이름으로 검색해 개인 캘린더 보기"
            }
            className="h-9 text-sm pr-9"
          />
          {viewStaff && (
            <button
              type="button"
              onClick={() => {
                setViewStaff(null);
                setStaffSearch("");
              }}
              className="absolute right-1 top-1 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              title="전체 보기로 복귀"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {staffSearch.trim() && (
          <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-sm">
            {empLoading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                직원 목록 로딩 중...
              </div>
            ) : (
              (() => {
                const q = staffSearch.trim().toLowerCase();
                const matches = empList
                  .filter((e) => e.staff_name.toLowerCase().includes(q))
                  .slice(0, 12);
                if (matches.length === 0) {
                  return (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      일치하는 직원이 없습니다.
                    </div>
                  );
                }
                return matches.map((e) => (
                  <button
                    key={e.staff_id}
                    type="button"
                    onClick={() => {
                      setViewStaff({
                        staff_id: e.staff_id,
                        staff_name: e.staff_name,
                        staff_position: e.staff_position,
                      });
                      setStaffSearch("");
                    }}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                  >
                    {e.staff_name}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      ({e.staff_position})
                    </span>
                  </button>
                ));
              })()
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium text-center px-4 pb-2">
          {error}
        </p>
      )}

      {viewStaff ? (
        <AdminEmployeeCalendarView
          staff={viewStaff}
          monthValue={monthValue}
        />
      ) : (
      <>
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
            const oc = overCapByDate.get(date);
            const isOver = !!oc && (oc.기관사 || oc.차장);
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[64px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col gap-0.5",
                  !inMonth && "opacity-35",
                  isOver &&
                    "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950/40"
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
                {entries.map((e) => (
                  <span
                    key={e.id}
                    title={`${e.staff_name} (${e.staff_position}) ${e.record_type}`}
                    className={cn(
                      "text-[10px] font-bold rounded px-1 truncate",
                      e.record_type === "지휴"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                        : e.staff_position === "차장"
                          ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                          : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                    )}
                  >
                    {e.staff_name}
                  </span>
                ))}
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

          <div className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">신규 등록</span>
              {addError && (
                <span className="text-[10px] text-destructive font-medium truncate">
                  {addError}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={addStaffId}
                disabled={empLoading || addBusy}
                onChange={(ev) => setAddStaffId(ev.target.value)}
                className="h-8 flex-1 min-w-0 rounded-md border bg-background px-2 text-xs"
              >
                <option value="">
                  {empLoading ? "직원 로딩 중..." : "직원 선택"}
                </option>
                {empList.map((emp) => (
                  <option key={emp.staff_id} value={emp.staff_id}>
                    {emp.staff_name}
                    {emp.staff_position ? ` (${emp.staff_position})` : ""}
                  </option>
                ))}
              </select>
              <select
                value={addType}
                disabled={addBusy}
                onChange={(ev) => setAddType(ev.target.value as RecordType)}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="지근">지근</option>
                <option value="지휴">지휴</option>
              </select>
              <Button
                size="xs"
                onClick={submitAdd}
                disabled={addBusy || empLoading || !addStaffId}
              >
                {addBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "등록"
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              같은 직원·날짜에 기존 신청이 있으면 구분이 덮어쓰기 됩니다.
            </p>
          </div>

          {selectedEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              신청 내역이 없습니다.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-h-[60vh] overflow-auto">
              {POSITIONS.map((pos) => {
                const group = selectedEntries.filter(
                  (e) => e.staff_position === pos
                );
                const cap = selectedDate
                  ? getPositionCap(selectedDate, holidays, caps)
                  : caps.weekday;
                const jigeunCount = group.filter(
                  (e) => e.record_type === "지근"
                ).length;
                const isOver = jigeunCount > cap;
                const drawn = group.some((e) => e.lottery_status != null);
                return (
                  <div key={pos} className="flex flex-col gap-1 min-w-0">
                    <div className="px-2 py-1.5 text-xs font-semibold bg-muted/40 rounded-md sticky top-0 flex items-center justify-between gap-1">
                      <span
                        className={cn(isOver && "text-destructive font-bold")}
                      >
                        {pos} ({group.length}) · 지근 {jigeunCount}/{cap}
                      </span>
                      {isOver && (
                        <Button
                          size="sm"
                          variant="default"
                          disabled={busyId === `lottery-${pos}`}
                          onClick={() => runLottery(pos)}
                          title="지근 정원 초과 — 무작위 추첨"
                        >
                          {busyId === `lottery-${pos}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : drawn ? (
                            "재추첨"
                          ) : (
                            "추첨"
                          )}
                        </Button>
                      )}
                    </div>
                    {group.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3 text-center">
                        없음
                      </p>
                    ) : (
                      group.map((e) => (
                        <div
                          key={e.id}
                          className="flex flex-col gap-1.5 rounded-md border px-2 py-2 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-semibold">
                              {e.staff_name}
                            </span>
                            {e.lottery_status === "won" && (
                              <span className="ml-1 text-[10px] font-bold rounded px-1 bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                                당첨
                              </span>
                            )}
                            {e.lottery_status === "lost" && (
                              <span className="ml-1 text-[10px] font-bold rounded px-1 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                                탈락
                              </span>
                            )}
                            <span className="text-muted-foreground">
                              {" · "}근무:{" "}
                            </span>
                            <span className="font-medium">
                              {e.regularTurn ?? "-"}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            <select
                              value={e.record_type}
                              disabled={busyId === e.id}
                              onChange={(ev) =>
                                changeType(e.id, ev.target.value as RecordType)
                              }
                              className="h-8 flex-1 rounded-md border bg-background px-2 text-xs"
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
                          {e.lottery_status === "lost" && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="xs"
                                variant="outline"
                                className="flex-1"
                                disabled={busyId === e.id}
                                onClick={() => setReschedTarget(e)}
                                title="해당 직원의 근무달력을 열어 이동할 날짜 선택"
                              >
                                근무달력 열기
                              </Button>
                              <Input
                                type="date"
                                className="h-8 text-xs w-36"
                                disabled={busyId === e.id}
                                defaultValue={selectedDate ?? undefined}
                                onChange={(ev) =>
                                  rescheduleLoser(e, ev.target.value)
                                }
                                title="직접 날짜 입력"
                              />
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </>
      )}

      <LoserRescheduleCalendar
        open={!!reschedTarget}
        entry={reschedTarget}
        originDate={selectedDate}
        initialMonth={monthValue}
        weekendHolidayTurns={weekendHolidayTurns}
        onClose={() => setReschedTarget(null)}
        onMoved={() => {
          void fetchData();
        }}
      />
    </div>
  );
}
