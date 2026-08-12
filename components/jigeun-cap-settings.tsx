"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type {
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  parseTurnsText,
  formatTurnsText,
  parseHolidayTurnRulesText,
  formatHolidayTurnRulesText,
  validateHolidayTurnRulesText,
  validateJigeunTurns,
} from "@/lib/types";
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
  onSaved: () => void;
}

export function JigeunCapSettings({
  caps,
  freezeDate,
  weekendHolidayTurns,
  jigeunTurns,
  holidayTurnRules,
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
      setError(null);
    }
  }, [
    open,
    caps,
    freezeDate,
    weekendHolidayTurns,
    jigeunTurns,
    holidayTurnRules,
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>설정</DialogTitle>
            <DialogDescription>
              요일/공휴일 구분별 지근 정원입니다. 기관사·차장 공통으로
              적용되며, 우선순위는 공휴일 &gt; 토 &gt; 일 &gt; 평일입니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

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

          <div className="grid grid-cols-3 gap-2">
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
