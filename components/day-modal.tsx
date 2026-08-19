"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type {
  Employee,
  RecordType,
  SpecialSchedule,
  RequestPhase,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getDayName } from "@/lib/schedule-utils";
import { cn } from "@/lib/utils";
import type { DayEntry } from "@/components/user-calendar";

interface DayModalProps {
  employee: Employee;
  date: string | null;
  regularTurn: string | null;
  // 운휴대기(연휴 짝 치환) 대치근무. 치환이 없으면 null.
  substitutedTurn?: string | null;
  existing: SpecialSchedule | null;
  allEntries: DayEntry[];
  // 신청 단계. 등록/삭제 허용 여부는 아래 두 플래그가 결정하고, phase 는
  // 안내 문구를 고르는 데 쓴다.
  phase: RequestPhase;
  canRegister: boolean;
  canDelete: boolean;
  // 그 날짜의 지근 정원 현황. 정원이 차면 지근 신청을 막는다.
  // null/미전달이면 판정하지 않는다 — 로딩 중이거나, 관리자 대리 등록
  // 화면처럼 전체 신청 내역이 없어 정원을 셀 수 없는 경우.
  jigeunSlot?: { cap: number; used: number } | null;
  freezeDate: string | null;
  extraDeadline: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export function DayModal({
  employee,
  date,
  regularTurn,
  substitutedTurn,
  existing,
  allEntries,
  phase,
  canRegister,
  canDelete,
  jigeunSlot,
  freezeDate,
  extraDeadline,
  onClose,
  onChanged,
}: DayModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!date) return null;

  // 이미 이 날 지근인 사람은 본인이 카운트에 포함되어 있으므로 정원 판정에서
  // 뺀다 — upsert 라 다시 눌러도 인원이 늘지 않는데, 빼지 않으면 자기 자신
  // 때문에 자기가 막힌다. 반대로 지휴에서 지근으로 바꾸는 경우는 인원이
  // +1 되므로 정상적으로 막혀야 한다.
  const alreadyJigeun = existing?.record_type === "지근";
  const jigeunFull =
    !!jigeunSlot && !alreadyJigeun && jigeunSlot.used >= jigeunSlot.cap;
  const canRegisterJigeun = canRegister && !jigeunFull;

  const register = async (recordType: RecordType) => {
    if (!canRegister) return;
    if (recordType === "지근" && !canRegisterJigeun) return;
    setIsSaving(true);
    setError(null);
    try {
      const { error: upsertError } = await supabase
        .from("special_schedules")
        .upsert(
          {
            staff_id: employee.staff_id,
            target_date: date,
            record_type: recordType,
          },
          { onConflict: "staff_id,target_date" }
        );
      if (upsertError) throw upsertError;
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    if (!canDelete) return;
    setIsSaving(true);
    setError(null);
    try {
      const { error: deleteError } = await supabase
        .from("special_schedules")
        .delete()
        .eq("id", existing.id);
      if (deleteError) throw deleteError;
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={!!date} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {date} ({getDayName(date)})
          </DialogTitle>
          <DialogDescription>
            정규 근무: <span className="font-semibold">{regularTurn ?? "-"}</span>
            {substitutedTurn && (
              <>
                {" → "}
                <span className="font-semibold text-sky-700 dark:text-sky-300">
                  {substitutedTurn}
                </span>
              </>
            )}
            {existing && (
              <>
                {" · "}현재 신청:{" "}
                <span className="font-semibold text-primary">
                  {existing.record_type}
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-destructive text-sm font-medium">{error}</p>
        )}

        <div className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
            <span className="text-sm font-semibold">전체 신청 내역</span>
            <span className="text-xs text-muted-foreground">
              지근{" "}
              {jigeunSlot ? (
                <span className={cn(jigeunFull && "text-destructive font-bold")}>
                  {jigeunSlot.used}/{jigeunSlot.cap}
                </span>
              ) : (
                allEntries.filter((e) => e.record_type === "지근").length
              )}
              {" · "}
              지휴 {allEntries.filter((e) => e.record_type === "지휴").length}
              {" · "}총 {allEntries.length}건
            </span>
          </div>
          {allEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              신청 내역이 없습니다.
            </p>
          ) : (
            <div className="flex flex-col divide-y max-h-[40vh] overflow-auto">
              {allEntries.map((e) => {
                const isSelf = e.staff_id === employee.staff_id;
                return (
                  <div
                    key={e.id}
                    className={cn(
                      "flex items-center justify-between gap-1.5 px-2 py-2 text-sm",
                      isSelf && "bg-accent"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-semibold">
                        {isSelf ? e.staff_name : "동료"}
                      </span>
                      {isSelf && (
                        <span className="text-primary font-medium">
                          {" "}
                          · 본인
                        </span>
                      )}
                      <span className="text-muted-foreground">
                        {" · "}근무:{" "}
                      </span>
                      <span className="font-medium">
                        {e.regularTurn ?? "-"}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-bold rounded px-1.5 py-0.5",
                        e.record_type === "지근"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                      )}
                    >
                      {e.record_type}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {phase === "extra" && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300 text-center">
            추첨 탈락으로 열린 <b>추가 신청 기간</b>({extraDeadline}까지)입니다.
            신청·삭제를 자유롭게 하실 수 있습니다.
          </p>
        )}

        {phase === "closed" && (
          <p className="text-xs text-amber-700 dark:text-amber-300 text-center">
            관리자가 지정한 신청 마감일({freezeDate})이 지나
            지근/지휴 신청·삭제가 제한됩니다.
          </p>
        )}

        {jigeunFull && canRegister && (
          <p className="text-xs text-destructive text-center font-medium">
            이 날은 {employee.staff_position} 지근 정원({jigeunSlot?.cap}명)이
            모두 찼습니다. 정원이 남은 다른 날짜를 선택해 주세요.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={existing?.record_type === "지근" ? "default" : "outline"}
            disabled={isSaving || !canRegisterJigeun}
            onClick={() => register("지근")}
            title={
              jigeunFull ? "지근 정원이 모두 찼습니다" : undefined
            }
          >
            지근 신청
          </Button>
          <Button
            variant={existing?.record_type === "지휴" ? "default" : "outline"}
            disabled={isSaving || !canRegister}
            onClick={() => register("지휴")}
          >
            지휴 신청
          </Button>
        </div>

        {existing && (
          <Button
            variant="destructive"
            disabled={isSaving || !canDelete}
            onClick={remove}
            className="w-full"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "신청 삭제"
            )}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
