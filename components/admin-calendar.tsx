"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import { useAuth } from "@/lib/auth-context";
import type {
  RecordType,
  LotteryStatus,
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  parseHolidayTurnRulesText,
} from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getDayExcelColor,
  getDayName,
  getPositionCap,
  countJigeunSlots,
  applyHolidayTurnRulesByStaffKey,
  padDateRange,
  getTurnDisplay,
  getTurnExcelFill,
} from "@/lib/schedule-utils";
import {
  buildMonthMaps,
  buildEmployeeMonthCells,
  monthRestTotal,
} from "@/lib/schedule-excel";
import { quarterEndOf, quarterMonths } from "@/lib/quarter";
import { useMonthState } from "@/lib/use-month-state";
import { lostWarningSuffix } from "@/lib/lottery-warning";
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
  ChevronDown,
  Download,
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
  // 운휴대기(연휴 짝 치환) 대치근무. 치환이 없으면 null.
  substitutedTurn: string | null;
  lottery_status: LotteryStatus | null;
  lottery_at: string | null;
}

// 그 직책에서 정원을 차지한 지근 인원수. 추첨 탈락(lost)은 제외된다
// (countJigeunSlots 주석 참고) — 추첨을 돌리면 초과 표시가 풀린다.
function countJigeun(entries: SpecialEntry[], pos: Position): number {
  return countJigeunSlots(entries.filter((e) => e.staff_position === pos));
}

export function AdminCalendar() {
  const { logout } = useAuth();
  const [monthValue, setMonthValue] = useMonthState("admin-calendar");
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
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
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
  const [exportBusy, setExportBusy] = useState(false);
  const [quarterExportBusy, setQuarterExportBusy] = useState(false);
  // 분기 마지막 달(3·6·9·12월)에만 분기 병합 엑셀 버튼을 노출한다.
  const quarterInfo = useMemo(() => quarterEndOf(monthValue), [monthValue]);

  // 직원 검색 → 개인 뷰 전환 상태
  const [staffSearch, setStaffSearch] = useState("");
  // 검색어 없이도 목록을 펼쳐 고를 수 있게 하는 드롭다운 열림 상태
  const [staffListOpen, setStaffListOpen] = useState(false);
  const [staffFilter, setStaffFilter] = useState<Position | "전체">("전체");
  const staffPickerRef = useRef<HTMLDivElement | null>(null);
  const [viewStaff, setViewStaff] = useState<{
    staff_id: number;
    staff_name: string;
    staff_position: string;
  } | null>(null);

  // 직책 필터 + 이름 검색을 함께 적용한 드롭다운 목록
  const staffOptions = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    return empList.filter(
      (e) =>
        (staffFilter === "전체" || e.staff_position === staffFilter) &&
        (q === "" || e.staff_name.toLowerCase().includes(q))
    );
  }, [empList, staffFilter, staffSearch]);

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
    // 월 경계에 걸친 연휴 짝을 판정하려면 앞뒤 하루가 더 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [specialResult, holidayResult, scheduleRows, settingsResult] =
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
            .gte("locdate", padded.start)
            .lte("locdate", padded.end),
          fetchScheduleByRange(padded.start, padded.end),
          supabase
            .from("app_settings")
            .select(
              "jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday, weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules"
            )
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (specialResult.error) throw specialResult.error;

      const s = settingsResult.data as {
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
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
      setJigeunTurns(
        s
          ? {
              dayTurns: parseTurnsText(s.jigeun_day_turns),
              nightTurns: parseTurnsText(s.jigeun_night_turns),
            }
          : DEFAULT_JIGEUN_TURNS
      );
      const holidayRules = s
        ? parseHolidayTurnRulesText(s.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      setHolidayTurnRules(holidayRules);

      // 연휴 짝 치환 판정에 필요 — holidays state 반영 전이라 로컬 Set 을 먼저 만든다.
      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

      // (staff_id, 날짜) → 원래 근무(turn) 매핑 — entry.regularTurn 채우기에만 사용.
      // 월 밖(앞뒤 하루)의 근무는 짝 판정용 context 로만 쓰고 맵에는 넣지 않는다.
      const regularMap = new Map<string, string>();
      const contextMap = new Map<string, string>();
      for (const row of scheduleRows) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const key = `${row.staff_id}|${dateStr}`;
        if (dateStr >= start && dateStr <= end) regularMap.set(key, row.turn);
        else contextMap.set(key, row.turn);
      }
      // 표시용 치환 맵 (연휴 짝 규칙 적용)
      const displayRegularMap = applyHolidayTurnRulesByStaffKey(
        regularMap,
        holidaySet,
        holidayRules,
        contextMap
      );

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
          substitutedTurn:
            getTurnDisplay(
              `${row.staff_id}|${row.target_date}`,
              regularMap,
              displayRegularMap
            )?.substituted ?? null,
          lottery_status: row.lottery_status ?? null,
          lottery_at: row.lottery_at ?? null,
        };
        const arr = sMap.get(row.target_date);
        if (arr) arr.push(entry);
        else sMap.set(row.target_date, [entry]);
      }
      setSpecialMap(sMap);

      setHolidays(holidaySet);
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
        // 기관사/차장 직책만 등록·검색 대상 (관리자·vip 등 제외)
        const { data, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position")
          .in("staff_position", [...POSITIONS])
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

  // 드롭다운 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!staffListOpen) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (!staffPickerRef.current?.contains(ev.target as Node)) {
        setStaffListOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [staffListOpen]);

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
        `${entry.staff_name}님의 ${selectedDate} ${entry.record_type} 신청을 삭제할까요?` +
          lostWarningSuffix(entry, "삭제하면")
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
    if (
      !confirm(
        `${entry.staff_name}님의 지근을 ${newDate}로 옮길까요?` +
          lostWarningSuffix(entry, "옮기면")
      )
    )
      return;
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

  // 근무표 대상 직원(기관사·차장) 명단. 월간·분기 엑셀이 공유한다.
  const fetchExportEmployees = async () => {
    const { data, error } = await supabase
      .from("coworker_list")
      .select("staff_id, staff_name, staff_position, employee_number")
      .in("staff_position", [...POSITIONS])
      .order("staff_name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{
      staff_id: number;
      staff_name: string;
      staff_position: string;
      employee_number: string | null;
    }>;
  };

  // 완성된 워크북을 파일로 내려받는다.
  const downloadWorkbook = async (wb: ExcelJS.Workbook, filename: string) => {
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 월간 근무표 엑셀: 직책별 시트, 행=직원, 열=해당 월 날짜.
  // 셀 텍스트·집계 규칙은 lib/schedule-excel 에서 분기 엑셀과 공유한다.
  const exportExcel = async () => {
    const [maps, employees] = await Promise.all([
      buildMonthMaps(monthValue, holidayTurnRules),
      fetchExportEmployees(),
    ]);
    const { dates: allDates, holidaySet } = maps;

    const wb = new ExcelJS.Workbook();

    for (const pos of POSITIONS) {
      const ws = wb.addWorksheet(pos);
      ws.columns = [
        { width: 12 },
        { width: 12 },
        { width: 11 },
        ...allDates.map(() => ({ width: 9 })),
      ];

      const headerRow = ws.addRow([
        "사번",
        "이름",
        "총휴무갯수",
        ...allDates.map((d) => `${Number(d.slice(8, 10))}일(${getDayName(d)})`),
      ]);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };
      // 화면(getDayColorClass)과 동일한 규칙: 공휴일·일요일 빨강, 토요일 파랑.
      allDates.forEach((date, i) => {
        const color = getDayExcelColor(date, holidaySet);
        if (color)
          headerRow.getCell(i + 4).font = { bold: true, color: { argb: color } };
      });

      for (const emp of employees.filter((e) => e.staff_position === pos)) {
        // 총휴무 = 휴무 + 운휴 + 지휴 − 지근 (user-calendar 의 '총휴'와 동일 공식).
        const { cells, totals } = buildEmployeeMonthCells({
          staffId: emp.staff_id,
          maps,
          jigeunTurns,
          weekendHolidayTurns,
        });

        const row = ws.addRow([
          emp.employee_number ?? "",
          emp.staff_name,
          monthRestTotal(totals),
          ...cells.map((c) => c.text),
        ]);
        // 운휴대기 칸은 두 줄이라 줄바꿈을 켠다.
        row.alignment = { horizontal: "center", wrapText: true };
        row.getCell(2).alignment = { horizontal: "left" };
        // 배경색 규칙은 getTurnExcelFill 에 모아둔다.
        // 신청한 지근(진한 파랑)·지휴(진한 빨강)가 최우선, 그 다음 휴무·운휴(옅은 빨강),
        // 운휴대기 치환과 지정근무(옅은 하늘색).
        // isRest 는 이미 치환 후 값 기준이라 휴77 등은 빨강이 된다.
        cells.forEach((c, i) => {
          const argb = getTurnExcelFill(
            c.turn,
            c.isRest,
            c.isSubstituted,
            jigeunTurns,
            c.special
          );
          if (argb) {
            row.getCell(i + 4).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb },
            };
          }
        });
      }

      ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
    }

    await downloadWorkbook(wb, `월간근무표_${monthValue}.xlsx`);
  };

  // 분기 병합 근무표 엑셀: 직책별 시트, 직원 1명 = 6행(월별 요일행 3 + 데이터행 3).
  // 사번·이름·분기 총휴무는 그 6행에 걸쳐 세로 병합한다.
  //
  // 달마다 날짜 수·요일이 다르므로 1~31일 열을 공유하되 월 블록마다 요일 행을
  // 따로 둔다. 30일까지인 달은 31일 칸이 빈칸이 된다.
  const exportQuarterExcel = async () => {
    if (!quarterInfo) return;
    const { year, quarter } = quarterInfo;

    // 분기 전체를 한 번에 부르면 RPC 행 수 한도에 걸리므로 월 단위로 나눠 받는다
    // (lib/quarter.ts 의 quarterMonths 주석 참고).
    const monthValues = quarterMonths(year, quarter).map((m) =>
      m.start.slice(0, 7)
    );
    const [monthMaps, employees] = await Promise.all([
      Promise.all(monthValues.map((mv) => buildMonthMaps(mv, holidayTurnRules))),
      fetchExportEmployees(),
    ]);

    // 열은 1~31일로 고정한다. 달마다 말일이 달라도 같은 열에 같은 '일' 이 온다.
    const maxDays = Math.max(...monthMaps.map((m) => m.dates.length));
    const dayNumbers = Array.from({ length: maxDays }, (_, i) => i + 1);
    // 앞 5열: 사번·이름·총휴무갯수·월·월휴무
    const FIXED_COLS = 5;

    const wb = new ExcelJS.Workbook();

    for (const pos of POSITIONS) {
      const ws = wb.addWorksheet(pos);
      ws.columns = [
        { width: 12 },
        { width: 12 },
        { width: 11 },
        { width: 7 },
        { width: 8 },
        ...dayNumbers.map(() => ({ width: 9 })),
      ];

      const headerRow = ws.addRow([
        "사번",
        "이름",
        "총휴무갯수",
        "월",
        "월휴무",
        ...dayNumbers.map((n) => `${n}일`),
      ]);
      headerRow.font = { bold: true };
      headerRow.alignment = { horizontal: "center" };

      for (const emp of employees.filter((e) => e.staff_position === pos)) {
        const blockStart = ws.rowCount + 1;
        let quarterTotal = 0;

        monthMaps.forEach((maps, mi) => {
          const { cells, totals } = buildEmployeeMonthCells({
            staffId: emp.staff_id,
            maps,
            jigeunTurns,
            weekendHolidayTurns,
          });
          quarterTotal += monthRestTotal(totals);

          // 요일 행: 그 달의 실제 요일을 열 위치에 맞춰 적는다.
          const dayRow = ws.addRow([
            "",
            "",
            "",
            "",
            "",
            ...dayNumbers.map((n) => {
              const date = maps.dates[n - 1];
              return date ? `(${getDayName(date)})` : "";
            }),
          ]);
          dayRow.alignment = { horizontal: "center" };
          dayNumbers.forEach((n, i) => {
            const date = maps.dates[n - 1];
            if (!date) return;
            const color = getDayExcelColor(date, maps.holidaySet);
            dayRow.getCell(i + FIXED_COLS + 1).font = color
              ? { bold: true, color: { argb: color } }
              : { bold: true };
          });

          // 데이터 행: 월 라벨 + 그 달 휴무수 + 근무 칸.
          const monthLabel = `${Number(monthValues[mi].slice(5, 7))}월`;
          const row = ws.addRow([
            "",
            "",
            "",
            monthLabel,
            monthRestTotal(totals),
            ...dayNumbers.map((n) => cells[n - 1]?.text ?? ""),
          ]);
          row.alignment = { horizontal: "center", wrapText: true };
          dayNumbers.forEach((n, i) => {
            const c = cells[n - 1];
            if (!c) return;
            const argb = getTurnExcelFill(
              c.turn,
              c.isRest,
              c.isSubstituted,
              jigeunTurns,
              c.special
            );
            if (argb) {
              row.getCell(i + FIXED_COLS + 1).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb },
              };
            }
          });
        });

        // 사번·이름·분기 총휴무를 이 직원 블록 전체에 걸쳐 세로 병합.
        const blockEnd = ws.rowCount;
        ws.getCell(blockStart, 1).value = emp.employee_number ?? "";
        ws.getCell(blockStart, 2).value = emp.staff_name;
        // 분기 목표(QUARTER_TARGET=24)와 비교하는 값. 분기휴무 검증 화면과 같은 공식.
        ws.getCell(blockStart, 3).value = quarterTotal;
        for (let col = 1; col <= 3; col++) {
          ws.mergeCells(blockStart, col, blockEnd, col);
          ws.getCell(blockStart, col).alignment = {
            vertical: "middle",
            horizontal: col === 2 ? "left" : "center",
          };
        }
      }

      ws.views = [{ state: "frozen", xSplit: FIXED_COLS, ySplit: 1 }];
    }

    await downloadWorkbook(wb, `분기근무표_${year}_${quarter}분기.xlsx`);
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
        <Button
          size="sm"
          variant="outline"
          disabled={exportBusy}
          title="월간 근무표 엑셀 다운로드"
          onClick={() => {
            setExportBusy(true);
            setError(null);
            exportExcel()
              .catch((err) =>
                setError(err instanceof Error ? err.message : "엑셀 생성 실패")
              )
              .finally(() => setExportBusy(false));
          }}
        >
          {exportBusy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Excel
        </Button>
        {quarterInfo && (
          <Button
            size="sm"
            variant="outline"
            disabled={quarterExportBusy}
            title={`${quarterInfo.year}년 ${quarterInfo.quarter}분기 근무표 엑셀 다운로드`}
            onClick={() => {
              setQuarterExportBusy(true);
              setError(null);
              exportQuarterExcel()
                .catch((err) =>
                  setError(
                    err instanceof Error ? err.message : "분기 엑셀 생성 실패"
                  )
                )
                .finally(() => setQuarterExportBusy(false));
            }}
          >
            {quarterExportBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            분기 Excel
          </Button>
        )}
      </div>

      <div className="px-3 pb-3" ref={staffPickerRef}>
        <div className="flex gap-1 pb-2">
          {(["전체", ...POSITIONS] as const).map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={staffFilter === p ? "default" : "outline"}
              className="h-7 px-3 text-xs"
              onClick={() => {
                setStaffFilter(p);
                setStaffListOpen(true);
              }}
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="relative">
          <Input
            value={staffSearch}
            onChange={(ev) => {
              setStaffSearch(ev.target.value);
              setStaffListOpen(true);
            }}
            onFocus={() => setStaffListOpen(true)}
            placeholder={
              viewStaff
                ? `${viewStaff.staff_name}(${viewStaff.staff_position}) 화면 보는 중 — 다른 직원 검색`
                : "직원 이름으로 검색해 개인 캘린더 보기"
            }
            className="h-9 text-sm pr-16"
          />
          <button
            type="button"
            onClick={() => setStaffListOpen((v) => !v)}
            className="absolute right-1 top-1 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
            title={staffListOpen ? "목록 닫기" : "직원 목록 열기"}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                staffListOpen && "rotate-180"
              )}
            />
          </button>
          {viewStaff && (
            <button
              type="button"
              onClick={() => {
                setViewStaff(null);
                setStaffSearch("");
                setStaffListOpen(false);
              }}
              className="absolute right-8 top-1 h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
              title="전체 보기로 복귀"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {staffListOpen && (
          <div className="mt-1 max-h-56 overflow-auto rounded-md border bg-popover shadow-sm">
            {empLoading ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                직원 목록 로딩 중...
              </div>
            ) : staffOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                일치하는 직원이 없습니다.
              </div>
            ) : (
              staffOptions.map((e) => (
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
                    setStaffListOpen(false);
                  }}
                  className={cn(
                    "block w-full text-left px-3 py-2 text-sm hover:bg-accent",
                    viewStaff?.staff_id === e.staff_id && "bg-accent"
                  )}
                >
                  {e.staff_name}
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    ({e.staff_position})
                  </span>
                </button>
              ))
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
                  "min-h-[48px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col gap-0.5",
                  !inMonth && "opacity-35",
                  isOver &&
                    "ring-2 ring-amber-500 bg-amber-50 dark:bg-amber-950/40"
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
                {entries.map((e) => (
                  <span
                    key={e.id}
                    title={`${e.staff_name} (${e.staff_position}) ${e.record_type}`}
                    className={cn(
                      "text-[9px] font-bold rounded px-1 truncate",
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
                // 탈락(lost)은 자리를 비운 것으로 세므로, 추첨을 돌리면
                // 여기 숫자가 정원 이하로 내려가며 초과 표시·추첨 버튼이 사라진다.
                const jigeunCount = countJigeunSlots(group);
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
                            {e.substitutedTurn && (
                              <span className="ml-0.5 font-bold text-sky-700 dark:text-sky-300">
                                {" → "}
                                {e.substitutedTurn}
                              </span>
                            )}
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
        jigeunTurns={jigeunTurns}
        holidayTurnRules={holidayTurnRules}
        onClose={() => setReschedTarget(null)}
        onMoved={() => {
          void fetchData();
        }}
      />
    </div>
  );
}
