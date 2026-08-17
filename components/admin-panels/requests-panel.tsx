"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import type {
  RecordType,
  ScheduleRecord,
  SpecialScheduleWithEmployee,
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
  JigeunKind,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_OFFICE_NAME,
  parseTurnsText,
  parseHolidayTurnRulesText,
  getJigeunKind,
  getJigeunBadgeLabel,
} from "@/lib/types";
import {
  getDayName,
  getDayExcelColor,
  getTurnColorClass,
  applyHolidayTurnRulesByStaffKey,
  padDateRange,
  getTurnDisplay,
} from "@/lib/schedule-utils";
import { useMonthState } from "@/lib/use-month-state";
import { lostWarningSuffix, lostBulkWarning } from "@/lib/lottery-warning";
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
  // regularTurn 은 치환 전 원본, substitutedTurn 은 운휴대기 대치근무(없으면 null).
  regularTurn: string | null;
  substitutedTurn: string | null;
}

// 지정근무 번호(turn)로 지정되어 special_schedules 신청 없이 자동으로 지근 처리되는 근무.
// exportExcel 에서 기존 신청 건과 같은 행 포맷으로 합쳐 내보내기 위한 용도.
// kind 는 주간/야간 구분 — 엑셀에 '이름(41/주)*' / '이름(58/야)*' 로 찍는다.
// 연휴 치환 '지(야)' 경로(designatedNightRows)는 kind 없이 항상 야간으로 취급한다.
interface JigeunNumberRow {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  employee_number: string | null;
  target_date: string;
  // regularTurn 은 치환 전 원본, substitutedTurn 은 운휴대기 대치근무(없으면 null).
  regularTurn: string;
  substitutedTurn: string | null;
  kind?: JigeunKind;
}

// 연휴 짝 치환(holiday_turn_rules) 결과가 '지(야)' 인 근무.
// 신청 없이 자동으로 지근에 포함되며, JigeunNumberRow 와 같은 행 포맷을 쓴다.
const DESIGNATED_NIGHT_TURN = "지(야)";

// 엑셀에서 제외할 근무번호. 해당 근무인 사람은 지근/지휴 어느 칸에도 표시하지 않는다.
const EXCLUDED_EXPORT_TURNS = ["휴72"];

// 헤더(freezeDate 배지)·JigeunCapSettings 가 쓰는 설정 묶음
export interface SettingsSnapshot {
  caps: JigeunCaps;
  freezeDate: string | null;
  weekendHolidayTurns: string[];
  jigeunTurns: JigeunTurnSettings;
  holidayTurnRules: HolidayTurnRule[];
  officeName: string;
  extraRequestDeadline: string | null;
  extraRequestYear: number | null;
  extraRequestQuarter: number | null;
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
  const [monthValue, setMonthValue] = useMonthState("requests-panel");
  const [nameFilter, setNameFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState<
    "전체" | "기관사" | "차장"
  >("전체");
  const [rows, setRows] = useState<Row[]>([]);
  const [jigeunNumberRows, setJigeunNumberRows] = useState<JigeunNumberRow[]>([]);
  const [designatedNightRows, setDesignatedNightRows] = useState<
    JigeunNumberRow[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());

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
    // 월 경계에 걸친 연휴 짝을 판정하려면 앞뒤 하루가 더 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [
        { data: schedules, error: qErr },
        fetchedScheduleRows,
        settingsResult,
        holidayResult,
      ] = await Promise.all([
        supabase
          .from("special_schedules")
          // lottery_status 는 탈락 건 삭제 시 경고를 띄우는 데 쓴다.
          .select("id, staff_id, target_date, record_type, created_at, lottery_status")
          .gte("target_date", start)
          .lte("target_date", end)
          .order("target_date", { ascending: true }),
        fetchScheduleByRange(padded.start, padded.end),
        supabase
          .from("app_settings")
          .select("jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday, request_freeze_date, weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules, office_name, extra_request_deadline, extra_request_year, extra_request_quarter")
          .eq("id", 1)
          .maybeSingle(),
        supabase
          .from("holidays")
          .select("locdate")
          .eq("is_holiday", "Y")
          .gte("locdate", padded.start)
          .lte("locdate", padded.end),
      ]);

      if (qErr) throw qErr;

      const s = settingsResult.data as {
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
        request_freeze_date: string | null;
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
        office_name: string | null;
        extra_request_deadline: string | null;
        extra_request_year: number | null;
        extra_request_quarter: number | null;
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
      // state 반영 전에 아래 자동 지근 판정에서 바로 써야 하므로 로컬 변수로 먼저 만든다.
      const loadedJigeunTurns: JigeunTurnSettings = s
        ? {
            dayTurns: parseTurnsText(s.jigeun_day_turns),
            nightTurns: parseTurnsText(s.jigeun_night_turns),
          }
        : DEFAULT_JIGEUN_TURNS;
      const holidayRules = s
        ? parseHolidayTurnRulesText(s.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      setWeekendHolidayTurns(turns);
      setJigeunTurns(loadedJigeunTurns);
      onSettingsLoadedRef.current?.({
        caps,
        freezeDate,
        weekendHolidayTurns: turns,
        jigeunTurns: loadedJigeunTurns,
        holidayTurnRules: holidayRules,
        officeName: s?.office_name ?? DEFAULT_OFFICE_NAME,
        extraRequestDeadline: s?.extra_request_deadline ?? null,
        extraRequestYear: s?.extra_request_year ?? null,
        extraRequestQuarter: s?.extra_request_quarter ?? null,
      });

      // 연휴 짝 치환 판정에 필요 — state 반영 전에 로컬 Set 으로 먼저 사용
      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );
      setHolidays(holidaySet);

      // (staff_id, 날짜) → 원래 근무(turn) 매핑.
      // 조회는 앞뒤 하루를 더 받지만, 월 밖의 날짜는 짝 판정용 context 로만 쓰고
      // regularMap 에는 넣지 않는다 — 아래 자동 지근 판정·행 생성이 이 맵을 그대로
      // 순회하므로 월 밖 근무가 섞이면 없는 신청이 생긴다.
      const scheduleRows = fetchedScheduleRows;
      const regularMap = new Map<string, string>();
      const contextMap = new Map<string, string>();
      const inMonthRows: ScheduleRecord[] = [];
      for (const row of scheduleRows) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const key = `${row.staff_id}|${dateStr}`;
        if (dateStr >= start && dateStr <= end) {
          regularMap.set(key, row.turn);
          inMonthRows.push(row);
        } else {
          contextMap.set(key, row.turn);
        }
      }
      // 표시·엑셀용 치환 맵. 자동 지근 판정(아래)은 반드시 원본 turn 을 써야 하므로
      // regularMap 은 그대로 두고 별도 맵으로 분리한다.
      const displayRegularMap = applyHolidayTurnRulesByStaffKey(
        regularMap,
        holidaySet,
        holidayRules,
        contextMap
      );

      const list = (schedules ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
        created_at?: string;
      }>;

      // 지정근무 번호(turn)로 자동 지정된 (staff_id, 날짜) — special_schedules 신청과 중복 제외용
      const jigeunNumberEntries: Array<{
        staff_id: number;
        target_date: string;
        turn: string;
        kind: JigeunKind;
      }> = [];
      const requestedKeys = new Set(
        list.map((s) => `${s.staff_id}|${s.target_date}`)
      );
      // 주의: 지정근무 번호 판정은 연휴 치환 전의 '원래' turn 으로 해야 한다.
      // 치환된 코드(휴73 등)로 매칭하면 자동 지근 대상이 달라진다.
      for (const row of inMonthRows) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const kind = getJigeunKind(row.turn, loadedJigeunTurns);
        if (!kind) continue;
        if (requestedKeys.has(`${row.staff_id}|${dateStr}`)) continue;
        jigeunNumberEntries.push({
          staff_id: row.staff_id,
          target_date: dateStr,
          turn: row.turn,
          kind,
        });
      }

      // 연휴 짝 치환 결과가 '지(야)' 인 (staff_id, 날짜).
      // 치환 후 값이라 displayRegularMap 을 봐야 하며, 신청/자동 지근과 겹치면 제외.
      const designatedEntries: Array<{
        staff_id: number;
        target_date: string;
        turn: string;
      }> = [];
      const jigeunNumberKeys = new Set(
        jigeunNumberEntries.map((e) => `${e.staff_id}|${e.target_date}`)
      );
      for (const [key, turn] of displayRegularMap) {
        if (turn !== DESIGNATED_NIGHT_TURN) continue;
        if (requestedKeys.has(key) || jigeunNumberKeys.has(key)) continue;
        const i = key.indexOf("|");
        if (i < 0) continue;
        designatedEntries.push({
          staff_id: Number(key.slice(0, i)),
          target_date: key.slice(i + 1),
          // 치환 전 원래 근무번호(58 등). regularMap 은 치환하지 않은 원본이다.
          turn: regularMap.get(key) ?? turn,
        });
      }

      // staff_id → coworker_list 정보 매핑 (FK 임베딩 대신 별도 조회)
      const empMap = new Map<
        number,
        {
          staff_name: string;
          employee_number: string | null;
          staff_position: string;
          phone_number: string | null;
        }
      >();
      const ids = [
        ...new Set([
          ...list.map((s) => s.staff_id),
          ...jigeunNumberEntries.map((e) => e.staff_id),
          ...designatedEntries.map((e) => e.staff_id),
        ]),
      ];
      if (ids.length > 0) {
        const { data: emps, error: eErr } = await supabase
          .from("coworker_list")
          .select(
            "staff_id, staff_name, employee_number, staff_position, phone_number"
          )
          .in("staff_id", ids);
        if (eErr) throw eErr;
        for (const e of emps ?? []) {
          empMap.set(e.staff_id, {
            staff_name: e.staff_name,
            employee_number: e.employee_number,
            staff_position: e.staff_position,
            phone_number: e.phone_number,
          });
        }
      }

      setJigeunNumberRows(
        jigeunNumberEntries.map((e) => {
          const emp = empMap.get(e.staff_id);
          return {
            staff_id: e.staff_id,
            staff_name: emp?.staff_name ?? `(미상 ${e.staff_id})`,
            staff_position: emp?.staff_position ?? "",
            employee_number: emp?.employee_number ?? null,
            target_date: e.target_date,
            // regularTurn 은 항상 치환 전 원본. 대치근무는 substitutedTurn 으로 따로 준다.
            regularTurn: e.turn,
            substitutedTurn:
              getTurnDisplay(
                `${e.staff_id}|${e.target_date}`,
                regularMap,
                displayRegularMap
              )?.substituted ?? null,
            kind: e.kind,
          };
        })
      );

      setDesignatedNightRows(
        designatedEntries.map((e) => {
          const emp = empMap.get(e.staff_id);
          return {
            staff_id: e.staff_id,
            staff_name: emp?.staff_name ?? `(미상 ${e.staff_id})`,
            staff_position: emp?.staff_position ?? "",
            employee_number: emp?.employee_number ?? null,
            target_date: e.target_date,
            // e.turn 은 이미 치환 전 원본(위 designatedEntries 참고).
            regularTurn: e.turn,
            substitutedTurn:
              getTurnDisplay(
                `${e.staff_id}|${e.target_date}`,
                regularMap,
                displayRegularMap
              )?.substituted ?? null,
          };
        })
      );

      const mapped: Row[] = list.map((s) => ({
        ...s,
        employee: empMap.get(s.staff_id) ?? null,
        _draftDate: s.target_date,
        _draftType: s.record_type,
        regularTurn: regularMap.get(`${s.staff_id}|${s.target_date}`) ?? null,
        substitutedTurn:
          getTurnDisplay(
            `${s.staff_id}|${s.target_date}`,
            regularMap,
            displayRegularMap
          )?.substituted ?? null,
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
    return rows.filter((r) => {
      if (
        positionFilter !== "전체" &&
        r.employee?.staff_position !== positionFilter
      )
        return false;
      if (!f) return true;
      return (
        r.employee?.staff_name?.toLowerCase().includes(f) ||
        String(r.employee?.employee_number ?? "").toLowerCase().includes(f)
      );
    });
  }, [rows, nameFilter, positionFilter]);

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
        `${row.employee?.staff_name ?? ""}님의 ${row.target_date} 기록을 삭제할까요?` +
          lostWarningSuffix(row, "삭제하면")
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
        // 기관사/차장 직책만 등록 대상 (관리자·vip 등 제외)
        const { data, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position")
          .in("staff_position", ["기관사", "차장"])
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

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();

    const f = nameFilter.trim().toLowerCase();
    const matchesFilter = (r: JigeunNumberRow) => {
      if (positionFilter !== "전체" && r.staff_position !== positionFilter)
        return false;
      return (
        !f ||
        r.staff_name.toLowerCase().includes(f) ||
        String(r.employee_number ?? "").toLowerCase().includes(f)
      );
    };
    const filteredJigeunNumberRows = jigeunNumberRows.filter(matchesFilter);
    const filteredDesignatedRows = designatedNightRows.filter(matchesFilter);

    type ExportEntry = {
      employee_number: string | null;
      staff_position: string;
      staff_name: string;
      target_date: string;
      // regularTurn 은 치환 전 원본, substitutedTurn 은 운휴대기 대치근무(없으면 null).
      regularTurn: string | null;
      substitutedTurn: string | null;
      record_type: string;
      created_at?: string;
      // 자동 지근 행의 주간/야간 구분. 신청 건(지근/지휴)에는 없다.
      kind?: JigeunKind;
    };

    const combined: ExportEntry[] = [
      ...filtered.map((r) => ({
        employee_number: r.employee?.employee_number ?? null,
        staff_position: r.employee?.staff_position ?? "",
        staff_name: r.employee?.staff_name ?? "",
        target_date: r.target_date,
        regularTurn: r.regularTurn,
        substitutedTurn: r.substitutedTurn,
        record_type: r.record_type,
        created_at: r.created_at,
      })),
      ...filteredJigeunNumberRows.map((r) => ({
        employee_number: r.employee_number,
        staff_position: r.staff_position,
        staff_name: r.staff_name,
        target_date: r.target_date,
        regularTurn: r.regularTurn,
        substitutedTurn: r.substitutedTurn,
        record_type: "지근(번호)",
        kind: r.kind,
      })),
      ...filteredDesignatedRows.map((r) => ({
        employee_number: r.employee_number,
        staff_position: r.staff_position,
        staff_name: r.staff_name,
        target_date: r.target_date,
        regularTurn: r.regularTurn,
        substitutedTurn: r.substitutedTurn,
        record_type: DESIGNATED_NIGHT_TURN,
        // 연휴 치환 '지(야)' 경로는 정의상 항상 야간이다.
        kind: "night" as JigeunKind,
      })),
    ].filter((r) => !EXCLUDED_EXPORT_TURNS.includes(r.regularTurn ?? ""));

    // 조회 월의 1일~말일 전체를 오름차순으로. 신청이 없는 날도 빈 행으로 남긴다.
    const monthStart = startOfMonth(new Date(`${monthValue}-01T00:00:00`));
    const monthEnd = endOfMonth(monthStart);
    const allDates: string[] = [];
    for (
      let d = monthStart;
      d <= monthEnd;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    ) {
      allDates.push(format(d, "yyyy-MM-dd"));
    }

    // 한 셀에 들어갈 신청자 표기: 이름(근무번호). 근무번호가 없으면 이름만.
    // 운휴대기 치환 건은 원래근무→대치근무를 함께 적는다: 이름(58→휴73).
    const formatTurn = (r: ExportEntry) =>
      r.substitutedTurn ? `${r.regularTurn}→${r.substitutedTurn}` : r.regularTurn;
    const formatEntry = (r: ExportEntry) =>
      r.regularTurn ? `${r.staff_name}(${formatTurn(r)})` : r.staff_name;

    for (const pos of ["기관사", "차장"] as const) {
      const byDate = new Map<string, { 지근: string[]; 지휴: string[] }>();
      for (const r of combined) {
        if (r.staff_position !== pos) continue;
        let slot = byDate.get(r.target_date);
        if (!slot) {
          slot = { 지근: [], 지휴: [] };
          byDate.set(r.target_date, slot);
        }
        // 자동 지근(지정근무 번호·연휴 치환 '지(야)')도 지근 칸에 넣되 * 로 구분 표시.
        // 주/야 구분을 붙인다: 이름(41/주)* · 이름(58/야)*.
        // 연휴 치환 건은 regularTurn 에 치환 전 원래 근무번호가 들어있다.
        if (r.record_type === "지휴") slot.지휴.push(formatEntry(r));
        else if (
          r.record_type === "지근(번호)" ||
          r.record_type === DESIGNATED_NIGHT_TURN
        ) {
          const suffix = r.kind === "night" ? "야" : "주";
          slot.지근.push(
            r.regularTurn
              ? `${r.staff_name}(${formatTurn(r)}/${suffix})*`
              : `${r.staff_name}(${suffix})*`
          );
        } else slot.지근.push(formatEntry(r));
      }

      // 날짜를 열로: 1열은 구분 라벨, 2열부터 날짜가 오름차순으로 이어진다.
      const ws = wb.addWorksheet(pos);
      ws.columns = [
        { width: 8 },
        ...allDates.map(() => ({ width: 14 })),
      ];

      const headerRow = ws.addRow([
        "구분",
        ...allDates.map((d) => `${d.slice(5)}(${getDayName(d)})`),
      ]);
      headerRow.font = { bold: true };
      // 화면(getDayColorClass)과 동일한 규칙: 공휴일·일요일 빨강, 토요일 파랑.
      allDates.forEach((date, i) => {
        const color = getDayExcelColor(date, holidays);
        if (color)
          headerRow.getCell(i + 2).font = { bold: true, color: { argb: color } };
      });

      for (const type of ["지근", "지휴"] as const) {
        const row = ws.addRow([
          type,
          ...allDates.map((d) => byDate.get(d)?.[type].join("\n") ?? ""),
        ]);
        row.getCell(1).font = { bold: true };
        row.alignment = { wrapText: true, vertical: "top" };
      }

      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    }

    // 직원정보 시트 — 신청 건별 사번·전화번호·신청일시(special_schedules.created_at).
    // 자동 지근(지근 번호·지정(야))은 신청 기록이 없어 created_at 이 없으므로 제외한다.
    const infoSheet = wb.addWorksheet("직원정보");
    infoSheet.columns = [
      { header: "사번", width: 12 },
      { header: "직책", width: 10 },
      { header: "이름", width: 10 },
      { header: "전화번호", width: 16 },
      { header: "날짜", width: 14 },
      { header: "구분", width: 8 },
      { header: "신청일시", width: 22 },
    ];
    infoSheet.getRow(1).font = { bold: true };

    const infoRows = filtered
      .filter(
        (r) =>
          !EXCLUDED_EXPORT_TURNS.includes(r.regularTurn ?? "")
      )
      .slice()
      .sort(
        (a, b) =>
          a.target_date.localeCompare(b.target_date) ||
          (a.employee?.staff_name ?? "").localeCompare(
            b.employee?.staff_name ?? ""
          )
      );

    for (const r of infoRows) {
      const row = infoSheet.addRow([
        r.employee?.employee_number ?? "",
        r.employee?.staff_position ?? "",
        r.employee?.staff_name ?? "",
        r.employee?.phone_number ?? "",
        `${r.target_date}(${getDayName(r.target_date)})`,
        r.record_type,
        r.created_at ? new Date(r.created_at).toLocaleString("ko-KR") : "",
      ]);
      const color = getDayExcelColor(r.target_date, holidays);
      if (color) row.getCell(5).font = { color: { argb: color } };
    }

    infoSheet.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `지근지휴_${monthValue}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openDeleteAll = () => {
    const lostCount = rows.filter((r) => r.lottery_status === "lost").length;
    if (
      !confirm(
        `[경고] ${monthValue} 월의 모든 신청 내역을 삭제합니다.\n이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?` +
          lostBulkWarning(lostCount)
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
        <div className="flex items-center rounded-md border p-0.5">
          {(["전체", "기관사", "차장"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPositionFilter(p)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                positionFilter === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={fetchData} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "조회"}
        </Button>
        <Button size="sm" variant="outline" onClick={openAddModal}>
          <Plus className="h-4 w-4" /> 지근/지휴
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            exportExcel().catch((err) =>
              setError(
                err instanceof Error ? err.message : "엑셀 생성 실패"
              )
            );
          }}
          disabled={
            filtered.length === 0 &&
            jigeunNumberRows.length === 0 &&
            designatedNightRows.length === 0
          }
        >
          <Download className="h-4 w-4" /> Excel 다운로드
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">
          총 {filtered.length}건
        </span>
      </div>

      <div className="flex justify-end px-3 pb-3 sm:-mt-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={openDeleteAll}
          disabled={rows.length === 0 || isLoading}
        >
          <Trash2 className="h-4 w-4" /> 전체 삭제
        </Button>
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
                <TableHead className="text-center">근무</TableHead>
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
                            row.substitutedTurn ?? row.regularTurn,
                            row.target_date,
                            holidays,
                            weekendHolidayTurns,
                            jigeunTurns,
                            row.substitutedTurn != null
                          )
                        : ""
                    )}
                  >
                    {row.substitutedTurn ? (
                      // 운휴대기 칸은 원래근무(위)/대치근무(아래) 두 줄로 보여준다.
                      <span className="flex flex-col leading-tight">
                        <span>{row.regularTurn}</span>
                        <span className="text-[10px] font-bold text-sky-700 dark:text-sky-300">
                          {row.substitutedTurn}
                        </span>
                      </span>
                    ) : (
                      row.regularTurn ?? "-"
                    )}
                    {(() => {
                      // 지근 배지는 치환 후 값 기준(치환이 없으면 원본과 같다).
                      const turn = row.substitutedTurn ?? row.regularTurn;
                      const kind = turn ? getJigeunKind(turn, jigeunTurns) : null;
                      return kind ? (
                        <span className="ml-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                          {getJigeunBadgeLabel(kind)}
                        </span>
                      ) : null;
                    })()}
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
