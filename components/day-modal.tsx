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
  // 이 날짜의 신청이 추첨에서 떨어졌는지. 탈락 건은 existing 으로 넘어오지
  // 않으므로(신청내역에서 뺐다) 따로 받아서 왜 사라졌는지 안내한다.
  lostOnDate?: boolean;
  allEntries: DayEntry[];
  // 신청 단계. 등록/삭제 허용 여부는 아래 두 플래그가 결정하고, phase 는
  // 안내 문구를 고르는 데 쓴다.
  phase: RequestPhase;
  canRegister: boolean;
  canDelete: boolean;
  // 그 날짜의 지근 정원 현황. 정원이 차면 지근 신청을 막는다.
  // null/미전달이면 판정하지 않는다 — 로딩 중이라 정원을 셀 수 없는 경우.
  jigeunSlot?: { cap: number; used: number } | null;
  // 정원이 찼을 때 지근 등록을 실제로 막을지. false 면 현황·경고만 보여주고
  // 버튼은 계속 눌린다 — 관리자 대리 등록 화면용.
  enforceJigeunCap?: boolean;
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
  lostOnDate = false,
  allEntries,
  phase,
  canRegister,
  canDelete,
  jigeunSlot,
  enforceJigeunCap = true,
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
  // 추첨에서 떨어진 날짜에는 지근을 다시 신청할 수 없다. 그 자리는 이미
  // 당첨자로 채워졌고, 재신청을 허용하면 정원을 넘기거나 추첨 결과를
  // 뒤집는 셈이 된다. 다른 날짜로 잡아야 한다.
  // (지휴는 정원과 무관하므로 막지 않는다.)
  const jigeunBlockedByLottery = lostOnDate;
  // 관리자 대리 등록 화면(enforceJigeunCap=false)은 정원·탈락을 '보여주되
  // 막지는' 않는다 — 관리자는 신청 마감일도 무시하는 권한이라 정원을 넘겨
  // 배치하거나 탈락자를 그 날에 되돌려야 하는 예외가 있고, 그 판단은
  // 관리자에게 맡긴다.
  const canRegisterJigeun =
    canRegister &&
    (!enforceJigeunCap || (!jigeunFull && !jigeunBlockedByLottery));

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
            // 탈락한 날짜에 덮어쓰는 경우 탈락 표시를 지운다. 사용자는
            // 애초에 여기까지 못 온다(canRegisterJigeun 이 막는다). 관리자
            // 대리 등록(enforceJigeunCap=false)으로 탈락자를 그 날에
            // 되돌리는 예외 경로에서만 도달하며, 그때는 새 신청으로 봐야
            // 한다 — 남겨 두면 upsert 된 행이 여전히 'lost' 라 곧바로
            // 신청내역에서 숨겨져 "눌러도 아무 일도 안 일어나는" 상태가 된다.
            // admin-calendar 의 rescheduleLoser 가 날짜를 옮길 때와 같은 처리.
            lottery_status: null,
            lottery_at: null,
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
            {lostOnDate && (
              <>
                {" · "}
                <span className="font-semibold text-muted-foreground">
                  추첨 탈락
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {lostOnDate && (
          <p className="rounded border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
            이 날짜는 추첨에서 탈락해 신청이 취소되었습니다.{" "}
            {enforceJigeunCap
              ? "이 날에는 지근을 다시 신청할 수 없습니다 — 다른 날짜를 선택해 주세요."
              : "사용자는 이 날에 지근을 다시 신청할 수 없습니다(관리자는 가능)."}
          </p>
        )}

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

        {/* 탈락한 날은 정원이 찬 것도 사실이지만(그래서 떨어졌다) 위의 탈락
            안내가 더 구체적인 이유다. 둘 다 띄우면 "다른 날짜를 고르세요" 가
            두 번 나오므로 정원 안내는 접는다. */}
        {jigeunFull && canRegister && !jigeunBlockedByLottery && (
          <p className="text-xs text-destructive text-center font-medium">
            이 날은 {employee.staff_position} 지근 정원({jigeunSlot?.cap}명)이
            모두 찼습니다.{" "}
            {enforceJigeunCap
              ? "정원이 남은 다른 날짜를 선택해 주세요."
              : "그래도 등록하면 정원을 초과합니다."}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={existing?.record_type === "지근" ? "default" : "outline"}
            disabled={isSaving || !canRegisterJigeun}
            onClick={() => register("지근")}
            title={
              jigeunBlockedByLottery
                ? "추첨에서 탈락한 날짜라 다시 신청할 수 없습니다"
                : jigeunFull
                  ? enforceJigeunCap
                    ? "지근 정원이 모두 찼습니다"
                    : "지근 정원이 모두 찼습니다 — 등록 시 정원 초과"
                  : undefined
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
