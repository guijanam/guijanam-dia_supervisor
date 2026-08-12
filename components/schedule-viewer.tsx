"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type {
  ScheduleRecord,
  PositionTab,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import {
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  parseHolidayTurnRulesText,
} from "@/lib/types";
import {
  getTodayMonthStr,
  generateDateRange,
  computeScheduleRange,
  computeInitialRange,
  buildScheduleMap,
  padDateRange,
  applyHolidayTurnRules,
} from "@/lib/schedule-utils";
import { ScheduleControls } from "@/components/schedule-controls";
import { ScheduleTable } from "@/components/schedule-table";
import { BottomTabs } from "@/components/bottom-tabs";

export function ScheduleViewer() {
  const [selectedTab, setSelectedTab] = useState<PositionTab>("기관사");
  const [monthValue, setMonthValue] = useState(getTodayMonthStr());
  const [searchFilter, setSearchFilter] = useState("");
  const [allData, setAllData] = useState<ScheduleRecord[]>([]);
  const [dateRange, setDateRange] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Set<string>>(new Set());
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
  );
  const [maintenance, setMaintenance] = useState<{
    is_active: boolean;
    message: string;
  } | null>(null);

  const fetchSchedule = useCallback(async (start: string, end: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // 조회 범위 경계(월말 등)에 걸친 연휴 짝도 판정하려면 앞뒤 하루가 더 필요하다.
      const padded = padDateRange(start, end);
      const [scheduleResult, holidayResult, settingsResult] = await Promise.all([
        supabase
          .rpc("get_schedule_by_range", {
            p_start_date: padded.start,
            p_end_date: padded.end,
          })
          .range(0, 10000),
        supabase
          .from("holidays")
          .select("locdate")
          .eq("is_holiday", "Y")
          .gte("locdate", padded.start)
          .lte("locdate", padded.end),
        supabase
          .from("app_settings")
          .select("weekend_holiday_turns, jigeun_day_turns, jigeun_night_turns, holiday_turn_rules")
          .eq("id", 1)
          .maybeSingle(),
      ]);

      if (scheduleResult.error) throw scheduleResult.error;

      const holidayDates = new Set<string>(
        (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
      );
      setHolidays(holidayDates);

      const settings = settingsResult.data as {
        weekend_holiday_turns: string | null;
        jigeun_day_turns: string | null;
        jigeun_night_turns: string | null;
        holiday_turn_rules: string | null;
      } | null;
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
      setHolidayTurnRules(
        settings
          ? parseHolidayTurnRulesText(settings.holiday_turn_rules)
          : DEFAULT_HOLIDAY_TURN_RULES
      );

      if (!scheduleResult.data || scheduleResult.data.length === 0) {
        setAllData([]);
        setDateRange(generateDateRange(start, end));
        return;
      }

      setAllData(scheduleResult.data as ScheduleRecord[]);
      setDateRange(generateDateRange(start, end));
    } catch (err) {
      const message = err instanceof Error ? err.message : "데이터 로딩 실패";
      setError(message);
      setAllData([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase
      .from("maintenance")
      .select("is_active, message")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (data?.is_active) {
          setMaintenance(data);
        }
      });
  }, []);

  useEffect(() => {
    const { start, end } = computeInitialRange();
    fetchSchedule(start, end);
  }, [fetchSchedule]);

  const handleSearch = useCallback(() => {
    if (!monthValue) {
      setError("조회할 월을 선택해주세요.");
      return;
    }

    const range = computeScheduleRange(monthValue);
    if (!range) {
      setError(`${monthValue}월은 이미 지난 월입니다.`);
      setAllData([]);
      return;
    }

    fetchSchedule(range.start, range.end);
  }, [monthValue, fetchSchedule]);

  // 표 표시용 — 직원별 근무 맵에 연휴 짝 치환을 적용한다.
  // 조회 범위 밖(앞뒤 하루)의 근무는 dateRange 에 없어 표에 그려지지 않지만,
  // 경계에 걸친 짝을 판정할 수 있도록 context 로 넘긴다.
  // originalMap 은 치환 전 원본 — 표에서 '원래근무/대치근무' 두 줄을 그리는 데 쓴다.
  const { names, scheduleMap, originalMap } = useMemo(() => {
    const built = buildScheduleMap(allData, selectedTab, searchFilter);
    if (holidayTurnRules.length === 0) {
      return { ...built, originalMap: built.scheduleMap };
    }
    const first = dateRange[0];
    const last = dateRange[dateRange.length - 1];
    const substituted = new Map<string, Map<string, string>>();
    const originals = new Map<string, Map<string, string>>();
    for (const [name, m] of built.scheduleMap) {
      const inRange = new Map<string, string>();
      const context = new Map<string, string>();
      for (const [date, turn] of m) {
        if (first && last && (date < first || date > last)) context.set(date, turn);
        else inRange.set(date, turn);
      }
      originals.set(name, inRange);
      substituted.set(
        name,
        applyHolidayTurnRules(inRange, holidays, holidayTurnRules, context)
      );
    }
    return {
      names: built.names,
      scheduleMap: substituted,
      originalMap: originals,
    };
  }, [allData, selectedTab, searchFilter, holidays, holidayTurnRules, dateRange]);

  const emptyMessage = useMemo(() => {
    if (isLoading || error) return null;
    if (allData.length === 0) return "표시할 데이터가 없습니다. 조회를 눌러주세요.";
    if (names.length === 0 && searchFilter)
      return "검색 결과가 없습니다.";
    if (names.length === 0)
      return `"${selectedTab}" 탭의 데이터가 없습니다.`;
    return null;
  }, [isLoading, error, allData.length, names.length, searchFilter, selectedTab]);

  if (maintenance) {
    return (
      <div className="flex items-center justify-center h-dvh px-6">
        <div className="text-center space-y-4">
          <div className="text-4xl">🔧</div>
          <h1 className="text-lg font-bold text-foreground">점검 중</h1>
          <p className="text-sm text-muted-foreground">{maintenance.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh">
      <ScheduleControls
        monthValue={monthValue}
        onMonthChange={setMonthValue}
        onSearch={handleSearch}
        searchFilter={searchFilter}
        onSearchFilterChange={setSearchFilter}
        isLoading={isLoading}
      />
      <div className="flex-1 overflow-hidden pb-14 px-2">
        <ScheduleTable
          names={names}
          dateRange={dateRange}
          scheduleMap={scheduleMap}
          originalMap={originalMap}
          isLoading={isLoading}
          error={error}
          emptyMessage={emptyMessage}
          holidays={holidays}
          weekendHolidayTurns={weekendHolidayTurns}
          jigeunTurns={jigeunTurns}
        />
      </div>
      <BottomTabs selectedTab={selectedTab} onTabChange={setSelectedTab} />
    </div>
  );
}
