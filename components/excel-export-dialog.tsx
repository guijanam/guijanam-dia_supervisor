"use client";

import { useRef, useState } from "react";
import type { ExcelTurnVisibility } from "@/lib/schedule-excel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OPTIONS = [
  { key: "hideDayTurn", label: "주간 지정근무", example: "60~ 지(주) → 지(주)" },
  { key: "hideNightTurn", label: "야간 지정근무", example: "휴72 지(야)비 → 지(야)비" },
  { key: "hideOriginalHolidayTurn", label: "운휴대기", example: "60 / 휴77 → 휴77" },
] as const;

interface Props {
  title: string;
  onClose: () => void;
  onDownload: (visibility: ExcelTurnVisibility) => Promise<void>;
  returnFocus?: () => void;
}

// 열 때마다 마운트하여 이전 다운로드의 숨김 선택을 이어받지 않는다.
export function ExcelExportDialog({ title, onClose, onDownload, returnFocus }: Props) {
  const [visibility, setVisibility] = useState<ExcelTurnVisibility>({
    hideDayTurn: false,
    hideNightTurn: false,
    hideOriginalHolidayTurn: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const download = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onDownload(visibility);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "엑셀 생성 실패");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting.current) onClose(); }}>
      <DialogContent
        className="max-h-[85dvh] overflow-y-auto"
        onCloseAutoFocus={returnFocus ? (event) => { event.preventDefault(); returnFocus(); } : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title} Excel 다운로드</DialogTitle>
          <DialogDescription>
            기본값은 원래 근무번호 보임입니다. ‘안보임’을 체크하면 해당 번호만 숨기고
            지정근무 표기·운휴대기 대치근무는 남깁니다. 휴무 합계와 배경색은 바뀌지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {OPTIONS.map(({ key, label, example }) => (
            <div key={key} className="rounded-md border p-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(visibility[key])}
                    disabled={busy}
                    onChange={(event) => setVisibility((current) => ({ ...current, [key]: event.target.checked }))}
                    className="size-4 accent-primary"
                  />
                  안보임
                </span>
              </label>
              <p className="mt-2 text-xs text-muted-foreground">체크 시 예: {example}</p>
            </div>
          ))}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>취소</Button>
          <Button disabled={busy} onClick={() => { void download(); }}>
            {busy ? "생성 중…" : "다운로드"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
