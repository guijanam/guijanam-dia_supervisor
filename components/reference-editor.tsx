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

// 직원 본인이 자신의 기준일/기준 근무번호 + 전화번호/기기ID 를 수정한다.
// 기준일/기준 근무번호는 근무순서 RPC 계산의 앵커라, 그 값이 바뀐 경우에만
// 저장 전 확인 단계를 강제한다.
export function ReferenceEditor() {
  const { employee, login } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [refDate, setRefDate] = useState("");
  const [refShift, setRefShift] = useState("");
  const [phone, setPhone] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!employee) return null;

  const openModal = () => {
    setError(null);
    setRefDate(employee.reference_date ?? "");
    setRefShift(employee.reference_shift ?? "");
    setPhone(employee.phone_number ?? "");
    setDeviceId(employee.device_id ?? "");
    setOpen(true);
  };

  const refChanged = () => {
    const nextDate = refDate.trim() || null;
    const nextShift = refShift.trim() || null;
    return (
      nextDate !== (employee.reference_date ?? null) ||
      nextShift !== (employee.reference_shift ?? null)
    );
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
    // 기준일/기준 근무번호가 실제로 변경된 경우에만 빨간 확인 다이얼로그.
    if (refChanged()) {
      setConfirmOpen(true);
    } else {
      void doSave();
    }
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    const nextDate = refDate.trim() || null;
    const nextShift = refShift.trim() || null;
    const nextPhone = phone.trim() || null;
    const nextDevice = deviceId.trim() || null;
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({
          reference_date: nextDate,
          reference_shift: nextShift,
          phone_number: nextPhone,
          device_id: nextDevice,
        })
        .eq("staff_id", employee.staff_id);
      if (upErr) throw upErr;
      login({
        ...employee,
        reference_date: nextDate,
        reference_shift: nextShift,
        phone_number: nextPhone,
        device_id: nextDevice,
      });
      setConfirmOpen(false);
      setOpen(false);
    } catch (err) {
      // device_id unique 위반(23505) 은 친화적 메시지로 변환.
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code?: unknown }).code ?? "")
          : "";
      if (code === "23505") {
        setError("이미 다른 계정에 등록된 기기 ID 입니다.");
      } else {
        setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
      }
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">나의정보 수정</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={openModal}
          title="나의정보 수정"
        >
          <CalendarCog className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>나의정보 수정</DialogTitle>
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

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">전화번호</span>
              <Input
                type="tel"
                value={phone}
                disabled={busy}
                placeholder="010-0000-0000"
                onChange={(e) => setPhone(e.target.value)}
                className="h-9"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">기기 ID</span>
              <Input
                type="text"
                value={deviceId}
                disabled={busy}
                placeholder="기기 식별값"
                onChange={(e) => setDeviceId(e.target.value)}
                className="h-9"
              />
            </label>

            <Button onClick={requestSave} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
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
