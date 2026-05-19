"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { isValidShift, isValidRefDate } from "@/lib/reference";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, CalendarCog } from "lucide-react";

// 직원 본인이 자신의 기준일/기준 근무번호를 수정한다.
// 이 값은 근무순서 RPC 계산의 앵커라, 저장 전 확인 단계를 강제한다.
export function ReferenceEditor() {
  const { employee, login } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refDate, setRefDate] = useState("");
  const [refShift, setRefShift] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!employee) return null;

  const openModal = () => {
    setError(null);
    setRefDate(employee.reference_date ?? "");
    setRefShift(employee.reference_shift ?? "");
    setOpen(true);
  };

  const requestSave = () => {
    setError(null);
    const date = refDate.trim();
    const shift = refShift.trim();
    if (date && !isValidRefDate(date)) {
      setError("기준일 형식이 올바르지 않습니다. (YYYY-MM-DD)");
      return;
    }
    if (shift && !isValidShift(shift)) {
      setError(
        "기준 근무번호 형식이 올바르지 않습니다. 예) 56, 52~, 휴22, 대11~"
      );
      return;
    }
    setConfirmOpen(true);
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    const nextDate = refDate.trim() || null;
    const nextShift = refShift.trim() || null;
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ reference_date: nextDate, reference_shift: nextShift })
        .eq("staff_id", employee.staff_id);
      if (upErr) throw upErr;
      login({
        ...employee,
        reference_date: nextDate,
        reference_shift: nextShift,
      });
      setConfirmOpen(false);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">근무순서 수정</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openModal}
          title="기준 근무 수정"
        >
          <CalendarCog className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>기준 근무 수정</DialogTitle>
            <DialogDescription>
              기준일과 기준 근무번호는 근무표 계산의 기준점입니다. 잘못 바꾸면
              본인 근무표 전체가 어긋나니 신중히 입력하세요.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">기준일</span>
              <Input
                type="date"
                value={refDate}
                disabled={busy}
                onChange={(e) => setRefDate(e.target.value)}
                className="h-9"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">기준 근무번호</span>
              <Input
                type="text"
                value={refShift}
                disabled={busy}
                placeholder="예) 56, 52~, 휴22, 대11~"
                onChange={(e) => setRefShift(e.target.value)}
                className="h-9"
              />
            </label>

            <Button onClick={requestSave} disabled={busy} className="w-full">
              저장
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => !busy && setConfirmOpen(o)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              근무표 변경 확인
            </DialogTitle>
            <DialogDescription>
              기준 근무 정보를 바꾸면{" "}
              <span className="font-semibold text-foreground">
                본인 근무표 전체가 다시 계산
              </span>
              되어 달라집니다. 정말 저장하시겠습니까?
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </Button>
            <Button variant="destructive" disabled={busy} onClick={doSave}>
              {busy ? (
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
