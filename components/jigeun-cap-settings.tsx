"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type {
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
  ExcelFillColors,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_EXCEL_FILL_COLORS,
  EXCEL_FILL_COLOR_FIELDS,
  parseTurnsText,
  formatTurnsText,
  parseHolidayTurnRulesText,
  formatHolidayTurnRulesText,
  formatExcelFillColorsText,
  validateHolidayTurnRulesText,
  validateJigeunTurns,
  validateExcelFillColors,
  normalizeHexColor,
  toHtmlColor,
} from "@/lib/types";
import { QUARTERS } from "@/lib/quarter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Settings2, Loader2 } from "lucide-react";

const FIELDS: { key: keyof JigeunCaps; label: string }[] = [
  { key: "weekday", label: "평일" },
  { key: "saturday", label: "토요일" },
  { key: "sunday", label: "일요일" },
  { key: "holiday", label: "공휴일" },
];

interface Props {
  caps: JigeunCaps;
  freezeDate: string | null;
  weekendHolidayTurns: string[];
  jigeunTurns: JigeunTurnSettings;
  holidayTurnRules: HolidayTurnRule[];
  excelColors: ExcelFillColors;
  officeName: string;
  extraDeadline: string | null;
  extraYear: number | null;
  extraQuarter: number | null;
  autoLotteryEnabled: boolean;
  onSaved: () => void;
}

export function JigeunCapSettings({
  caps,
  freezeDate,
  weekendHolidayTurns,
  jigeunTurns,
  holidayTurnRules,
  excelColors,
  officeName,
  extraDeadline,
  extraYear,
  extraQuarter,
  autoLotteryEnabled,
  onSaved,
}: Props) {
  const { isAdmin, employee } = useAuth();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JigeunCaps>(caps);
  const [draftFreezeDate, setDraftFreezeDate] = useState<string>(
    freezeDate ?? ""
  );
  const [draftTurnsText, setDraftTurnsText] = useState<string>(
    formatTurnsText(weekendHolidayTurns)
  );
  const [draftDayTurnsText, setDraftDayTurnsText] = useState<string>(
    formatTurnsText(jigeunTurns.dayTurns)
  );
  const [draftNightTurnsText, setDraftNightTurnsText] = useState<string>(
    formatTurnsText(jigeunTurns.nightTurns)
  );
  const [draftHolidayRulesText, setDraftHolidayRulesText] = useState<string>(
    formatHolidayTurnRulesText(holidayTurnRules)
  );
  const [draftExcelColors, setDraftExcelColors] =
    useState<ExcelFillColors>(excelColors);
  const [draftOfficeName, setDraftOfficeName] = useState<string>(officeName);
  const [draftExtraDeadline, setDraftExtraDeadline] = useState<string>(
    extraDeadline ?? ""
  );
  const [draftExtraYear, setDraftExtraYear] = useState<string>(
    extraYear != null ? String(extraYear) : ""
  );
  const [draftExtraQuarter, setDraftExtraQuarter] = useState<string>(
    extraQuarter != null ? String(extraQuarter) : ""
  );
  const [draftAutoLottery, setDraftAutoLottery] =
    useState<boolean>(autoLotteryEnabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다이얼로그 열 때마다 최신 설정으로 초기화
  useEffect(() => {
    if (open) {
      setDraft(caps);
      setDraftFreezeDate(freezeDate ?? "");
      setDraftTurnsText(formatTurnsText(weekendHolidayTurns));
      setDraftDayTurnsText(formatTurnsText(jigeunTurns.dayTurns));
      setDraftNightTurnsText(formatTurnsText(jigeunTurns.nightTurns));
      setDraftHolidayRulesText(formatHolidayTurnRulesText(holidayTurnRules));
      setDraftExcelColors(excelColors);
      setDraftOfficeName(officeName);
      setDraftExtraDeadline(extraDeadline ?? "");
      setDraftExtraYear(extraYear != null ? String(extraYear) : "");
      setDraftExtraQuarter(extraQuarter != null ? String(extraQuarter) : "");
      setDraftAutoLottery(autoLotteryEnabled);
      setError(null);
    }
  }, [
    open,
    caps,
    freezeDate,
    weekendHolidayTurns,
    jigeunTurns,
    holidayTurnRules,
    excelColors,
    officeName,
    extraDeadline,
    extraYear,
    extraQuarter,
    autoLotteryEnabled,
  ]);

  if (!isAdmin || !employee) return null;

  const setField = (key: keyof JigeunCaps, raw: string) => {
    const n = Number(raw);
    setDraft((d) => ({
      ...d,
      [key]: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
    }));
  };

  const save = async () => {
    // 연휴 근무 규칙은 형식이 깨지면 조용히 버려지므로 저장 전에 먼저 알린다.
    const ruleError = validateHolidayTurnRulesText(draftHolidayRulesText);
    if (ruleError) {
      setError(ruleError);
      return;
    }

    // 같은 번호가 주간·야간에 동시에 들어가면 지(주)/지(야) 판정이 모호해진다.
    const normalizedDayTurns = parseTurnsText(draftDayTurnsText);
    const normalizedNightTurns = parseTurnsText(draftNightTurnsText);
    const jigeunError = validateJigeunTurns(
      normalizedDayTurns,
      normalizedNightTurns
    );
    if (jigeunError) {
      setError(jigeunError);
      return;
    }

    // 색 형식이 깨지면 parse 가 조용히 기본색으로 되돌린다 —
    // "저장했는데 색이 안 바뀐다" 가 되므로 저장 전에 막는다.
    const colorError = validateExcelFillColors(draftExcelColors);
    if (colorError) {
      setError(colorError);
      return;
    }

    // 대상 분기(년·분기)는 추가 신청 자격 판정과 자동 추첨이 함께 쓴다.
    // 추가 신청일이 있으면 판정에 필요하므로 년·분기가 반드시 있어야 하지만,
    // 반대는 강제하지 않는다 — 추가 신청을 운영하지 않는 분기에도 대상 분기만
    // 지정해 두면 자동 추첨이 동작해야 하기 때문이다.
    const extraYearNum = draftExtraYear ? Number(draftExtraYear) : null;
    const extraQuarterNum = draftExtraQuarter ? Number(draftExtraQuarter) : null;
    if (extraYearNum && !extraQuarterNum) {
      setError("대상 분기의 분기를 선택하세요.");
      return;
    }
    if (extraQuarterNum && !extraYearNum) {
      setError("대상 분기의 년도를 입력하세요.");
      return;
    }
    if (draftExtraDeadline) {
      if (!extraYearNum || !extraQuarterNum) {
        setError("추가 신청일을 쓰려면 대상 분기의 년·분기도 함께 지정하세요.");
        return;
      }
      // 1차 마감 다음날부터 열리는 기간이므로 마감일보다 뒤여야 한다.
      if (!draftFreezeDate) {
        setError("추가 신청일은 신청 마감일이 있어야 의미가 있습니다.");
        return;
      }
      if (draftExtraDeadline <= draftFreezeDate) {
        setError("추가 신청일은 신청 마감일보다 뒤여야 합니다.");
        return;
      }
    }
    // 자동 추첨은 대상 분기 없이는 실행되지 않는다. 저장은 막지 않되,
    // 켜 두고도 아무 일이 없는 상태가 되지 않도록 여기서 알려 준다.
    if (draftAutoLottery && (!extraYearNum || !extraQuarterNum)) {
      setError(
        "자동 추첨을 켜려면 대상 분기(년·분기)를 지정하세요. 마감일에서 분기를 추론하지 않습니다."
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const normalizedTurns = parseTurnsText(draftTurnsText);
      const normalizedHolidayRules = parseHolidayTurnRulesText(
        draftHolidayRulesText
      );
      const { error: upErr } = await supabase
        .from("app_settings")
        .update({
          jigeun_cap_weekday: draft.weekday,
          jigeun_cap_saturday: draft.saturday,
          jigeun_cap_sunday: draft.sunday,
          jigeun_cap_holiday: draft.holiday,
          request_freeze_date: draftFreezeDate ? draftFreezeDate : null,
          weekend_holiday_turns: formatTurnsText(normalizedTurns),
          jigeun_day_turns: formatTurnsText(normalizedDayTurns),
          jigeun_night_turns: formatTurnsText(normalizedNightTurns),
          holiday_turn_rules: formatHolidayTurnRulesText(
            normalizedHolidayRules
          ),
          excel_fill_colors: formatExcelFillColorsText(draftExcelColors),
          office_name: draftOfficeName.trim(),
          extra_request_deadline: draftExtraDeadline ? draftExtraDeadline : null,
          // 대상 분기는 추가 신청일과 독립이다. 날짜를 비워도 남겨 두어야
          // 추가 신청을 운영하지 않는 분기에서도 자동 추첨이 동작한다.
          extra_request_year: extraYearNum,
          extra_request_quarter: extraQuarterNum,
          auto_lottery_enabled: draftAutoLottery,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);
      if (upErr) throw upErr;
      onSaved();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => setOpen(true)}
        title="설정"
      >
        <Settings2 className="h-3.5 w-3.5 mr-1" />
        설정
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* 설정 항목이 많아 세로로 길다. 화면 높이 안에 가두고 가운데 영역만
            스크롤시켜, 하단 저장 버튼이 항상 보이게 한다. */}
        <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0">
          <DialogHeader className="pb-4">
            <DialogTitle>설정</DialogTitle>
            <DialogDescription>
              요일/공휴일 구분별 지근 정원입니다. 기관사·차장 공통으로
              적용되며, 우선순위는 공휴일 &gt; 토 &gt; 일 &gt; 평일입니다.
            </DialogDescription>
          </DialogHeader>

          {/* 좌우 음수 마진은 스크롤바가 다이얼로그 안쪽 여백에 붙게 한다. */}
          <div className="flex flex-col gap-4 overflow-y-auto -mx-6 px-6">
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}

            <div className="flex flex-col gap-1 pb-2 border-b">
              <div className="flex items-start gap-3">
                <label className="w-16 text-sm font-medium pt-2">승무소</label>
                <Input
                  type="text"
                  className="h-9"
                  placeholder="예: 동대문승무소"
                  value={draftOfficeName}
                  disabled={isSaving}
                  onChange={(e) => setDraftOfficeName(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                교번 관리에서 이 승무소 교번만 보이도록 거르는 이름 접두사입니다.
                한 DB 에 여러 승무소 교번이 섞여 있을 때만 입력하세요.{" "}
                <b>비우면 전체 교번이 보입니다.</b>
              </p>
            </div>

            <div className="flex flex-col gap-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex items-center gap-3">
                  <label className="w-16 text-sm font-medium">{f.label}</label>
                  <Input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="h-9"
                    value={String(draft[f.key])}
                    disabled={isSaving}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                  <span className="text-xs text-muted-foreground shrink-0">
                    명
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-center gap-3">
                <label className="w-16 text-sm font-medium">신청 마감일</label>
                <Input
                  type="date"
                  className="h-9"
                  value={draftFreezeDate}
                  disabled={isSaving}
                  onChange={(e) => setDraftFreezeDate(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDraftFreezeDate("")}
                  disabled={isSaving || !draftFreezeDate}
                  title="마감일 해제"
                >
                  해제
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                비우면 마감 없음. 마감일 다음날 0시부터 사용자의 지근/지휴
                신청·삭제가 차단됩니다.
              </p>

              <label className="flex items-start gap-2 pl-[4.75rem] pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  checked={draftAutoLottery}
                  disabled={isSaving}
                  onChange={(e) => setDraftAutoLottery(e.target.checked)}
                />
                <span className="text-xs">
                  <b>
                    마감일이 지나면 추첨을 자동 실행하고 결과를 문서로 게시
                  </b>
                  <br />
                  <span className="text-muted-foreground">
                    관리자가 앱에 접속한 시점에 1회 실행됩니다. 아래{" "}
                    <b>대상 분기</b>를 추첨하며, 이미 추첨한 날짜는 건드리지
                    않습니다.
                  </span>
                </span>
              </label>
            </div>

            {/* 대상 분기는 추가 신청 자격 판정과 자동 추첨이 함께 쓰는 값이라
                추가 신청일과 분리해 위에 둔다. 마감일에서 추론하지 않는다 —
                신청은 대상 분기보다 한두 달 앞서 받으므로 마감일은 항상 다른
                분기에 속한다. */}
            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-center gap-3">
                <label className="w-16 text-sm font-medium">대상 분기</label>
                <Input
                  type="number"
                  inputMode="numeric"
                  className="h-9 w-28"
                  placeholder="년"
                  value={draftExtraYear}
                  disabled={isSaving}
                  onChange={(e) => setDraftExtraYear(e.target.value)}
                />
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={draftExtraQuarter}
                  disabled={isSaving}
                  onChange={(e) => setDraftExtraQuarter(e.target.value)}
                >
                  <option value="">분기 선택</option>
                  {QUARTERS.map((q) => (
                    <option key={q.value} value={String(q.value)}>
                      {q.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setDraftExtraYear("");
                    setDraftExtraQuarter("");
                  }}
                  disabled={isSaving || (!draftExtraYear && !draftExtraQuarter)}
                  title="대상 분기 해제"
                >
                  해제
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                지금 신청받아 처리 중인 분기입니다. <b>추가 신청</b> 자격 판정과{" "}
                <b>자동 추첨</b>이 이 분기를 대상으로 합니다. 추가 신청을
                운영하지 않아도 지정해 두면 자동 추첨이 동작합니다.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-center gap-3">
                <label className="w-16 text-sm font-medium">추가 신청일</label>
                <Input
                  type="date"
                  className="h-9"
                  value={draftExtraDeadline}
                  disabled={isSaving}
                  onChange={(e) => setDraftExtraDeadline(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setDraftExtraDeadline("")}
                  disabled={isSaving || !draftExtraDeadline}
                  title="추가 신청 기간 해제"
                >
                  해제
                </Button>
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                1차 마감 이후 이 날짜까지, 위 <b>대상 분기</b>에서{" "}
                <b>추첨에 떨어진(탈락) 직원에게만</b> 지근/지휴 신청이 다시
                열립니다. 떨어진 자리를 스스로 다시 잡게 하는 용도라 이 기간에는{" "}
                <b>신청·삭제가 모두 가능</b>합니다. 비우면 추가 신청 기간 없음.
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 pl-[4.75rem]">
                ⚠ 탈락 판정은 <code>lottery_status=&apos;lost&apos;</code> 로
                합니다. 탈락자를 <b>삭제하거나 다른 날짜로 옮기면</b> 이 표시가
                사라져 대상에서 빠지니, 추첨 후 탈락 건은 그대로 두세요.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-start gap-3">
                <label className="w-16 text-sm font-medium pt-2">운휴 번호</label>
                <Input
                  type="text"
                  className="h-9"
                  placeholder="예: 31,32,33,34,35,36,37"
                  value={draftTurnsText}
                  disabled={isSaving}
                  onChange={(e) => setDraftTurnsText(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                주말/공휴일에 운휴로 집계할 근무번호를 쉼표로 구분해 입력하세요.
                승무소마다 다르며, 비우면 운휴 집계가 되지 않습니다.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-start gap-3">
                <label className="w-24 text-sm font-medium pt-2 shrink-0">
                  주간 지정근무
                </label>
                <Input
                  type="text"
                  className="h-9"
                  placeholder="예: 41,42,43"
                  value={draftDayTurnsText}
                  disabled={isSaving}
                  onChange={(e) => setDraftDayTurnsText(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pl-[6.75rem]">
                주간 지정근무로 표시할 근무번호를 쉼표로 구분해 입력하세요.
                달력·엑셀에 <b>지(주)</b> 로 표시됩니다.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-start gap-3">
                <label className="w-24 text-sm font-medium pt-2 shrink-0">
                  야간 지정근무
                </label>
                <Input
                  type="text"
                  className="h-9"
                  placeholder="예: 58,59"
                  value={draftNightTurnsText}
                  disabled={isSaving}
                  onChange={(e) => setDraftNightTurnsText(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pl-[6.75rem]">
                야간 지정근무로 표시할 근무번호를 쉼표로 구분해 입력하세요.
                달력·엑셀에 <b>지(야)</b> 로 표시됩니다. 두 칸 모두 요일/공휴일과
                무관하게 적용되며, 같은 번호를 주간·야간에 함께 넣을 수 없습니다.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-start gap-3">
                <label className="w-16 text-sm font-medium pt-2">운휴대기</label>
                <Input
                  type="text"
                  className="h-9"
                  placeholder="예: 58,58~:휴73,휴74;61,61~,휴14:휴79,지(야),지(야)~"
                  value={draftHolidayRulesText}
                  disabled={isSaving}
                  onChange={(e) => setDraftHolidayRulesText(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground pl-[4.75rem]">
                연속된 <b>앞 이틀</b>이 모두 토/일/공휴일일 때만 표시가 바뀝니다.
                형식은 <code>원래들:표시들</code> 이며 양쪽 개수가 같아야 합니다
                (2개 이상). 여러 짝은 <code>;</code> 로 구분합니다. 3개 이상으로
                적으면 셋째 날부터는 휴일 여부와 무관하게 함께 치환됩니다 — 연휴
                다음 근무일까지 이어지는 근무에 쓰세요. 예:{" "}
                <code>61,61~,휴14:휴79,지(야),지(야)~</code>. 앞 이틀 중 한쪽만
                휴일이면 치환되지 않습니다. 표시만 바뀔 뿐 휴무/운휴/총휴 집계는
                원래 근무번호 기준 그대로입니다.
              </p>
            </div>

            <div className="flex flex-col gap-1 pt-2 border-t">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">엑셀 배경색</label>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={isSaving}
                  onClick={() => setDraftExcelColors(DEFAULT_EXCEL_FILL_COLORS)}
                >
                  기본색으로
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
                {EXCEL_FILL_COLOR_FIELDS.map((f) => (
                  <label
                    key={f.key}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="color"
                      className="h-8 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5 disabled:cursor-not-allowed"
                      value={toHtmlColor(draftExcelColors[f.key])}
                      disabled={isSaving}
                      onChange={(e) => {
                        const argb = normalizeHexColor(e.target.value);
                        if (!argb) return;
                        setDraftExcelColors((c) => ({ ...c, [f.key]: argb }));
                      }}
                    />
                    <span className="truncate">{f.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                월간·분기 <b>엑셀 다운로드</b>의 셀 배경색입니다(달력 화면 색은
                바뀌지 않습니다). 한 칸이 여러 조건에 해당하면 위 목록의 순서대로
                앞선 색이 적용됩니다 — 예를 들어 지정근무인 날에 지근을 신청하면
                <b> 신청 지근</b> 색으로 칠해집니다. 글씨가 검정이므로 너무 어두운
                색은 피하세요.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-4 border-t">
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(DEFAULT_JIGEUN_CAPS);
                setDraftTurnsText(formatTurnsText(DEFAULT_WEEKEND_HOLIDAY_TURNS));
                setDraftDayTurnsText("");
                setDraftNightTurnsText("");
                setDraftHolidayRulesText(
                  formatHolidayTurnRulesText(DEFAULT_HOLIDAY_TURN_RULES)
                );
                setDraftExcelColors(DEFAULT_EXCEL_FILL_COLORS);
              }}
              disabled={isSaving}
              title="기본값(정원 4/2/4/4, 운휴 31~37)으로 되돌리기"
            >
              기본값
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button onClick={save} disabled={isSaving}>
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "저장"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
