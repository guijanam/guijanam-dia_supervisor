"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { fetchScheduleByRange } from "@/lib/fetch-schedule";
import { useAuth } from "@/lib/auth-context";
import type {
  RecordType,
  SpecialSchedule,
  HolidayTurnRule,
  JigeunTurnSettings,
  RequestPhase,
  JigeunCaps,
  LotteryStatus,
} from "@/lib/types";
import { QUARTER_TARGET } from "@/lib/quarter";
import {
  fetchQuarterTotals,
  quarterTotal,
  emptyQuarterTotals,
} from "@/lib/quarter-balance-calc";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_JIGEUN_CAPS,
  parseTurnsText,
  parseHolidayTurnRulesText,
  getJigeunKind,
  getJigeunBadgeLabel,
  isDesignatedJigeunDisplay,
} from "@/lib/types";
import {
  getCalendarGrid,
  isSameMonth,
  getDayColorClass,
  getTurnColorClass,
  getDayName,
  getPositionCap,
  countJigeunSlots,
  applyHolidayTurnRules,
  applyHolidayTurnRulesByStaffKey,
  padDateRange,
  getTurnDisplay,
  isHueTurnOnDate,
} from "@/lib/schedule-utils";
import { useMonthState } from "@/lib/use-month-state";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, LogOut, ChevronLeft, ChevronRight } from "lucide-react";
import { DayModal } from "@/components/day-modal";
import { AnnouncementBoard } from "@/components/announcement-board";
import { DocumentBoard } from "@/components/document-board";
import { ReferenceEditor } from "@/components/reference-editor";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type UserView = "notice" | "calendar";

export interface DayEntry {
  id: string;
  staff_id: number;
  staff_name: string;
  staff_position: string;
  record_type: RecordType;
  regularTurn: string | null;
  // 지근 정원 카운트에서 탈락 건을 빼기 위해 필요하다(countJigeunSlots).
  lottery_status: LotteryStatus | null;
}

export function UserCalendar() {
  const { employee, logout } = useAuth();
  const [view, setView] = useState<UserView>("calendar");
  const [monthValue, setMonthValue] = useMonthState("user-calendar");
  const [regularMap, setRegularMap] = useState<Map<string, string>>(new Map());
  // 월 밖(전월 말일·익월 1일) 근무. 연휴 짝 판정에만 쓰고 집계·표시에는 쓰지 않는다.
  const [regularContext, setRegularContext] = useState<Map<string, string>>(
    new Map()
  );
  const [specialMap, setSpecialMap] = useState<Map<string, SpecialSchedule>>(
    new Map()
  );
  // 본인이 추첨에서 떨어진 날짜. specialMap 에서는 빼되(신청내역·월집계에
  // 잡히지 않게) 달력에 "추첨 탈락" 표시는 남기려고 따로 들고 있는다.
  const [lostDates, setLostDates] = useState<Set<string>>(new Set());
  const [allEntriesMap, setAllEntriesMap] = useState<Map<string, DayEntry[]>>(
    new Map()
  );
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  // 요일/공휴일별 지근 정원. 정원이 찬 날은 지근 신청을 막는다.
  const [caps, setCaps] = useState<JigeunCaps>(DEFAULT_JIGEUN_CAPS);
  const [requestFreezeDate, setRequestFreezeDate] = useState<string | null>(
    null
  );
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [extraDeadline, setExtraDeadline] = useState<string | null>(null);
  const [extraYear, setExtraYear] = useState<number | null>(null);
  const [extraQuarter, setExtraQuarter] = useState<number | null>(null);
  // 추가 신청 대상 여부 판정 결과. null = 아직 계산 전(또는 계산 불필요).
  const [extraEligible, setExtraEligible] = useState<boolean | null>(null);
  const [extraTotal, setExtraTotal] = useState<number | null>(null);
  // 해당 분기의 추첨 탈락 건수. 추가 신청 대상 판정 기준.
  const [extraLost, setExtraLost] = useState<number | null>(null);
  const [isCheckingExtra, setIsCheckingExtra] = useState(false);
  // 신청·삭제가 실제로 일어났을 때만 올린다. 달을 넘길 때마다 분기 합계를
  // 다시 계산하지 않으려고 specialMap 대신 이 값을 의존성으로 쓴다.
  const [writeSeq, setWriteSeq] = useState(0);

  // 1차 마감이 지났는지. 마감 미설정이면 항상 열려 있다.
  const isPastFreeze = useMemo(() => {
    if (!requestFreezeDate) return false;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    return todayStr > requestFreezeDate;
  }, [requestFreezeDate]);

  // 추가 신청 기간(달력상)에 들어와 있는지. 대상자인지는 별도 계산이 필요하다.
  const inExtraWindow = useMemo(() => {
    if (!isPastFreeze) return false;
    if (!extraDeadline || extraYear == null || extraQuarter == null)
      return false;
    return format(new Date(), "yyyy-MM-dd") <= extraDeadline;
  }, [isPastFreeze, extraDeadline, extraYear, extraQuarter]);

  // 추가 신청 기간일 때만 본인 분기 합계를 계산한다. 평상시에는 분기 RPC(3회)를
  // 부르지 않는다. 판정 전에는 닫힌 것으로 취급해 신청이 새지 않게 한다.
  useEffect(() => {
    if (!inExtraWindow || !employee || extraYear == null || extraQuarter == null) {
      setExtraEligible(null);
      setExtraTotal(null);
      setExtraLost(null);
      return;
    }
    let cancelled = false;
    setIsCheckingExtra(true);
    fetchQuarterTotals(extraYear, extraQuarter, employee.staff_id)
      .then((totals) => {
        if (cancelled) return;
        const mine = totals.get(employee.staff_id) ?? emptyQuarterTotals();
        setExtraTotal(quarterTotal(mine));
        setExtraLost(mine.lostCount);
        // 추첨에서 떨어진 직원만 대상이다. 합계가 24 가 아니어도 탈락 이력이
        // 없으면(애초에 덜 신청한 경우 등) 추가 기간에 열어주지 않는다.
        setExtraEligible(mine.lostCount > 0);
      })
      .catch(() => {
        if (cancelled) return;
        // 계산에 실패하면 열어주지 않는다(닫힌 쪽이 안전).
        setExtraEligible(false);
        setExtraTotal(null);
        setExtraLost(null);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingExtra(false);
      });
    return () => {
      cancelled = true;
    };
    // writeSeq 가 오르면(신청·삭제 직후) 합계를 다시 계산해야
    // 24 를 채운 즉시 닫힌다.
  }, [inExtraWindow, employee, extraYear, extraQuarter, writeSeq]);

  const phase: RequestPhase = useMemo(() => {
    if (!isPastFreeze) return "open";
    if (!inExtraWindow) return "closed";
    return extraEligible === true ? "extra" : "closed";
  }, [isPastFreeze, inExtraWindow, extraEligible]);

  // 선택한 날짜의 지근 정원 현황(본인 직책 기준).
  //
  // 정원 차단은 추가 신청 기간(extra)에만 건다. 1차 신청(open)은 종전대로
  // 정원을 넘겨 신청할 수 있어야 한다 — 초과분을 관리자가 추첨으로 거르는
  // 것이 기존 운영이고, 여기서 막으면 추첨이 무의미해지고 선착순이 된다.
  // 추가 기간에는 이미 추첨이 끝나 자리가 확정된 상태라 막는 것이 맞다.
  //
  // allEntriesMap 은 이미 본인과 같은 직책만 담고 있어(아래 fetchData 참고)
  // 그대로 세면 그 직책의 정원 카운트가 된다.
  // isLoading 중에는 holidays 가 아직 비어 있어 공휴일이 평일 정원으로
  // 잘못 계산되므로 판정을 보류한다(null → 막지 않음).
  const jigeunSlot = useMemo(() => {
    if (!selectedDate || isLoading) return null;
    if (phase !== "extra") return null;
    return {
      cap: getPositionCap(selectedDate, holidays, caps),
      used: countJigeunSlots(allEntriesMap.get(selectedDate) ?? []),
    };
  }, [selectedDate, isLoading, phase, holidays, caps, allEntriesMap]);

  // 추첨에서 떨어진 직원은 추가 기간에 신청·삭제를 자유롭게 한다 —
  // 떨어진 자리를 다시 잡는 과정에서 날짜를 바꿔야 하기 때문이다.
  const canRegister = phase === "open" || phase === "extra";
  const canDelete = phase === "open" || phase === "extra";

  const grid = useMemo(() => getCalendarGrid(monthValue), [monthValue]);

  // 화면 표시용 근무 맵(운휴대기 치환 적용). 아래 monthStats 의 휴무 판정에도 쓴다.
  const displayTurnMap = useMemo(
    () =>
      applyHolidayTurnRules(
        regularMap,
        holidays,
        holidayTurnRules,
        regularContext
      ),
    [regularMap, holidays, holidayTurnRules, regularContext]
  );

  // 휴무는 치환 후 근무번호로 세고(화면 표시와 일치), 운휴·지근·지휴는 원본 기준.
  const monthStats = useMemo(() => {
    let hueCount = 0;
    let weekendTurnCount = 0;
    for (const [date, turn] of regularMap) {
      if (!isSameMonth(date, monthValue)) continue;
      // 휴무는 운휴대기 치환 후 값으로 판정한다(화면 표시와 일치).
      if (isHueTurnOnDate(date, regularMap, displayTurnMap, jigeunTurns)) {
        hueCount++;
      }
      // 운휴는 계속 원본 근무번호 기준.
      const dayName = getDayName(date);
      const isHoliday =
        dayName === "토" || dayName === "일" || holidays.has(date);
      if (isHoliday && weekendHolidayTurns.includes(turn)) weekendTurnCount++;
    }

    let jigeunCount = 0;
    let jihyuCount = 0;
    for (const [date, sp] of specialMap) {
      if (!isSameMonth(date, monthValue)) continue;
      if (sp.record_type === "지근") jigeunCount++;
      else if (sp.record_type === "지휴") jihyuCount++;
    }

    const totalRest = hueCount + weekendTurnCount + jihyuCount - jigeunCount;
    return { hueCount, weekendTurnCount, jigeunCount, jihyuCount, totalRest };
  }, [
    regularMap,
    displayTurnMap,
    specialMap,
    holidays,
    monthValue,
    weekendHolidayTurns,
    jigeunTurns,
  ]);

  const fetchData = useCallback(async () => {
    if (!employee) return;
    setIsLoading(true);
    setError(null);

    const [year, month] = monthValue.split("-").map(Number);
    const start = format(startOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    const end = format(endOfMonth(new Date(year, month - 1)), "yyyy-MM-dd");
    // 월 경계에 걸친 연휴 짝을 판정하려면 앞뒤 하루가 더 필요하다.
    const padded = padDateRange(start, end);

    try {
      const [scheduleRows, specialResult, holidayResult, settingsResult] =
        await Promise.all([
          fetchScheduleByRange(padded.start, padded.end),
          supabase
            .from("special_schedules")
            // created_at 은 추가 신청 기간의 삭제 허용 판정에 쓴다
            // (1차 마감 후 새로 넣은 신청만 지울 수 있다).
            // lottery_status 는 지근 정원 카운트에서 탈락 건을 빼는 데 쓴다.
            .select(
              "id, staff_id, target_date, record_type, created_at, lottery_status"
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
          supabase
            .from("app_settings")
            .select("request_freeze_date, weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules, extra_request_deadline, extra_request_year, extra_request_quarter, jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday")
            .eq("id", 1)
            .maybeSingle(),
        ]);

      if (specialResult.error) throw specialResult.error;

      const settings = settingsResult.data as {
        request_freeze_date: string | null;
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
        extra_request_deadline: string | null;
        extra_request_year: number | null;
        extra_request_quarter: number | null;
        jigeun_cap_weekday: number;
        jigeun_cap_saturday: number;
        jigeun_cap_sunday: number;
        jigeun_cap_holiday: number;
      } | null;
      setCaps(
        settings
          ? {
              weekday: settings.jigeun_cap_weekday,
              saturday: settings.jigeun_cap_saturday,
              sunday: settings.jigeun_cap_sunday,
              holiday: settings.jigeun_cap_holiday,
            }
          : DEFAULT_JIGEUN_CAPS
      );
      setRequestFreezeDate(settings?.request_freeze_date ?? null);
      setExtraDeadline(settings?.extra_request_deadline ?? null);
      setExtraYear(settings?.extra_request_year ?? null);
      setExtraQuarter(settings?.extra_request_quarter ?? null);
      setWeekendHolidayTurns(
        settings ? parseTurnsText(settings.weekend_holiday_turns) : DEFAULT_WEEKEND_HOLIDAY_TURNS
      );
      setJigeunTurns(
        settings
          ? {
              dayTurns: parseTurnsText(settings.jigeun_day_turns),
              nightTurns: parseTurnsText(settings.jigeun_night_turns),
            }
          : DEFAULT_JIGEUN_TURNS
      );
      const holidayRules = settings
        ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
        : DEFAULT_HOLIDAY_TURN_RULES;
      setHolidayTurnRules(holidayRules);

      // 연휴 짝 치환 판정에 필요 — holidays state 반영 전이라 로컬 Set 을 먼저 만든다.
      const holidaySet = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );

      // (staff_id, 날짜) → 원래 근무(turn) 매핑 (전 직원).
      // 조회는 앞뒤 하루를 더 받지만, 월 밖의 날짜는 짝 판정용 context 로만 쓰고
      // 화면·집계용 맵에는 넣지 않는다.
      const regularByStaff = new Map<string, string>();
      const contextByStaff = new Map<string, string>();
      const rMap = new Map<string, string>();
      const rContext = new Map<string, string>();
      for (const row of scheduleRows) {
        const dateStr = row.date
          ? format(new Date(row.date), "yyyy-MM-dd")
          : "";
        if (!dateStr) continue;
        const inMonth = dateStr >= start && dateStr <= end;
        const key = `${row.staff_id}|${dateStr}`;
        if (inMonth) regularByStaff.set(key, row.turn);
        else contextByStaff.set(key, row.turn);
        if (row.staff_id === employee.staff_id) {
          if (inMonth) rMap.set(dateStr, row.turn);
          else rContext.set(dateStr, row.turn);
        }
      }
      setRegularMap(rMap);
      setRegularContext(rContext);

      // 동료 신청 내역에 표시되는 근무도 동일하게 치환한다.
      const displayByStaff = applyHolidayTurnRulesByStaffKey(
        regularByStaff,
        holidaySet,
        holidayRules,
        contextByStaff
      );

      const list = (specialResult.data ?? []) as Array<{
        id: string;
        staff_id: number;
        target_date: string;
        record_type: RecordType;
        lottery_status: LotteryStatus | null;
      }>;

      // 본인 신청 내역 맵 (기존 기능 유지)
      //
      // 추첨 탈락 건은 여기서 뺀다. DB 행은 남아 있지만(추첨 탈락자 목록과
      // 추가 신청 자격의 유일한 근거라 지울 수 없다) 사용자 입장에서는 이미
      // 취소된 신청이다. 남겨 두면 달력에 본인 지근이 그대로 떠서 아직
      // 자기 자리인 줄 알고, 다른 날짜를 다시 잡을 때 혼동한다.
      // 대신 날짜만 lostDates 에 모아 "추첨 탈락" 표시를 남긴다.
      const sMap = new Map<string, SpecialSchedule>();
      const lostSet = new Set<string>();
      for (const row of list) {
        if (row.staff_id !== employee.staff_id) continue;
        if (row.lottery_status === "lost") {
          lostSet.add(row.target_date);
          continue;
        }
        sMap.set(row.target_date, {
          id: row.id,
          staff_id: row.staff_id,
          target_date: row.target_date,
          record_type: row.record_type,
        });
      }
      setSpecialMap(sMap);
      setLostDates(lostSet);

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

      // 본인과 같은 직책(기관사/차장)의 신청만 노출.
      const aMap = new Map<string, DayEntry[]>();
      for (const row of list) {
        const emp = empMap.get(row.staff_id);
        const position = emp?.staff_position ?? "";
        if (position !== employee.staff_position) continue;
        // 본인 탈락 건은 신청내역에서 뺐으므로 칩도 띄우지 않는다. 동료의
        // 탈락 건은 그대로 둔다 — 그 날 자리가 어떻게 찼는지 보이는 편이 낫다.
        if (row.staff_id === employee.staff_id && row.lottery_status === "lost")
          continue;
        const entry: DayEntry = {
          id: row.id,
          staff_id: row.staff_id,
          staff_name: emp?.staff_name ?? `(미상 ${row.staff_id})`,
          staff_position: position,
          record_type: row.record_type,
          regularTurn:
            displayByStaff.get(`${row.staff_id}|${row.target_date}`) ?? null,
          lottery_status: row.lottery_status ?? null,
        };
        const arr = aMap.get(row.target_date);
        if (arr) arr.push(entry);
        else aMap.set(row.target_date, [entry]);
      }
      setAllEntriesMap(aMap);

      setHolidays(holidaySet);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [employee, monthValue]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shiftMonth = (delta: number) => {
    const [year, month] = monthValue.split("-").map(Number);
    const d = new Date(year, month - 1 + delta);
    setMonthValue(format(d, "yyyy-MM"));
  };

  if (!employee) return null;

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="text-sm">
          <span className="font-bold">{employee.staff_name}</span>
          <span className="text-muted-foreground">
            {" "}
            ({employee.staff_position})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ReferenceEditor />
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={logout} title="로그아웃">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 pb-14">
        {view === "notice" && <DocumentBoard />}

        {view === "calendar" && (
          <>
            <AnnouncementBoard />

            <p className="mx-2 mt-3 rounded border border-blue-300 bg-blue-50 px-3 py-2 text-center text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
              교번 순서가 다르면 오른쪽 상단의 *나의정보 수정*을 통해 수정하시면 됩니다.
            </p>

            <div className="flex items-center justify-center gap-4 py-3">
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="font-bold text-xl tabular-nums">{monthValue}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => shiftMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2 flex-wrap pb-2 text-base font-bold">
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          휴무 {monthStats.hueCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          운휴 {monthStats.weekendTurnCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300">
          지근 {monthStats.jigeunCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          지휴 {monthStats.jihyuCount}
        </span>
        <span className="rounded px-2 py-0.5 bg-primary/10 text-primary border border-primary/30">
          총휴 {monthStats.totalRest}
        </span>
      </div>

      {isPastFreeze && isCheckingExtra && (
        <p className="mx-2 mb-2 rounded border bg-muted/50 px-3 py-2 text-center text-xs font-medium text-muted-foreground">
          추가 신청 대상 여부를 확인하는 중입니다…
        </p>
      )}

      {phase === "extra" && (
        <p className="mx-2 mb-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          추가 신청 기간입니다(~{extraDeadline}). {extraYear}년 {extraQuarter}
          분기 추첨에서 <b>{extraLost}건</b>이 탈락해 신청이 다시 열려
          있습니다. 떨어진 날짜 대신 다른 날로 <b>신청·삭제를 자유롭게</b> 하실
          수 있습니다
          {extraTotal != null && (
            <>
              {" "}
              (현재 분기 휴무 합계 {extraTotal}개 / 목표 {QUARTER_TARGET}개)
            </>
          )}
          .
        </p>
      )}

      {phase === "closed" && !isCheckingExtra && (
        <p className="mx-2 mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          관리자가 지정한 신청 마감일({requestFreezeDate})이 지났습니다.
          지근/지휴 신청·삭제가 제한됩니다.
        </p>
      )}

      {error && (
        <p className="text-destructive text-sm font-medium text-center px-4 pb-2">
          {error}
        </p>
      )}

      <div className="relative px-2 pb-6">
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
            // 운휴대기 치환 칸은 원래근무(위)/대치근무(아래)를 함께 보여준다.
            const display = getTurnDisplay(date, regularMap, displayTurnMap);
            const turn = displayTurnMap.get(date);
            const entries = allEntriesMap.get(date) ?? [];
            const turnBgClass = turn
              ? getTurnColorClass(
                  turn,
                  date,
                  holidays,
                  weekendHolidayTurns,
                  jigeunTurns,
                  display?.substituted != null
                )
              : "";
            // 배경색과 같은 값(연휴 치환 후 turn)으로 판정해야 색과 배지가 어긋나지 않는다.
            const jigeunKind = turn ? getJigeunKind(turn, jigeunTurns) : null;
            return (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={cn(
                  "min-h-[48px] rounded-md border p-1 text-left transition-colors hover:bg-accent flex flex-col",
                  !inMonth && "opacity-35",
                  turnBgClass.includes("bg-red") &&
                    "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-800",
                  turnBgClass.includes("bg-sky") &&
                    "bg-sky-100 dark:bg-sky-900/40 border-sky-300 dark:border-sky-800"
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
                {display && (
                  <span className="text-sm font-semibold truncate text-center text-foreground">
                    {display.original}
                  </span>
                )}
                {display?.substituted && (
                  <span className="text-[10px] font-bold leading-none text-center text-sky-700 dark:text-sky-300 truncate">
                    {display.substituted}
                  </span>
                )}
                {jigeunKind && (
                  <span className="text-[9px] font-bold leading-none text-center text-sky-700 dark:text-sky-300">
                    {getJigeunBadgeLabel(jigeunKind)}
                  </span>
                )}
                {lostDates.has(date) && (
                  <span className="text-[9px] font-bold leading-none text-center text-muted-foreground line-through">
                    추첨 탈락
                  </span>
                )}
                <div className="mt-auto flex flex-col gap-0.5">
                  {entries.map((e) => {
                    const isSelf = e.staff_id === employee.staff_id;
                    return (
                      <span
                        key={e.id}
                        title={
                          isSelf
                            ? `${e.staff_name} ${e.record_type}`
                            : e.record_type
                        }
                        className={cn(
                          "text-[9px] font-bold rounded px-1 truncate",
                          e.record_type === "지휴"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                            : e.staff_position === "차장"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                              : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
                          isSelf && "ring-1 ring-primary"
                        )}
                      >
                        {isSelf ? e.staff_name : e.record_type}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
          </>
        )}
      </div>

      <nav className="fixed bottom-0 left-0 w-full z-50 flex border-t bg-background">
        {(
          [
            { label: "근무 달력", value: "calendar" },
            { label: "문서", value: "notice" },
          ] as { label: string; value: UserView }[]
        ).map((tab) => (
          <button
            key={tab.value}
            className={cn(
              "flex-1 py-3 font-bold text-sm transition-colors",
              view === tab.value
                ? "border-b-2 border-primary bg-accent"
                : "text-muted-foreground"
            )}
            onClick={() => setView(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <DayModal
        employee={employee}
        date={selectedDate}
        regularTurn={
          selectedDate
            ? getTurnDisplay(selectedDate, regularMap, displayTurnMap)
                ?.original ?? null
            : null
        }
        substitutedTurn={
          selectedDate
            ? getTurnDisplay(selectedDate, regularMap, displayTurnMap)
                ?.substituted ?? null
            : null
        }
        existing={selectedDate ? specialMap.get(selectedDate) ?? null : null}
        lostOnDate={selectedDate ? lostDates.has(selectedDate) : false}
        // 셀의 지정근무 배지와 같은 값(치환 후 displayTurnMap)으로 판정한다.
        designatedJigeun={
          selectedDate
            ? isDesignatedJigeunDisplay(
                displayTurnMap.get(selectedDate),
                jigeunTurns
              )
            : false
        }
        allEntries={selectedDate ? allEntriesMap.get(selectedDate) ?? [] : []}
        phase={phase}
        canRegister={canRegister}
        canDelete={canDelete}
        jigeunSlot={jigeunSlot}
        freezeDate={requestFreezeDate}
        extraDeadline={extraDeadline}
        onClose={() => setSelectedDate(null)}
        onChanged={() => {
          fetchData();
          // 분기 합계가 바뀌었으므로 추가 신청 대상 판정을 다시 돌린다.
          setWriteSeq((n) => n + 1);
        }}
      />
    </div>
  );
}
