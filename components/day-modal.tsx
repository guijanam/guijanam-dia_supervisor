"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Employee, RecordType, SpecialSchedule } from "@/lib/types";
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

interface DayModalProps {
  employee: Employee;
  date: string | null;
  regularTurn: string | null;
  existing: SpecialSchedule | null;
  onClose: () => void;
  onChanged: () => void;
}

export function DayModal({
  employee,
  date,
  regularTurn,
  existing,
  onClose,
  onChanged,
}: DayModalProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!date) return null;

  const register = async (recordType: RecordType) => {
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

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={existing?.record_type === "지근" ? "default" : "outline"}
            disabled={isSaving}
            onClick={() => register("지근")}
          >
            지근 신청
          </Button>
          <Button
            variant={existing?.record_type === "지휴" ? "default" : "outline"}
            disabled={isSaving}
            onClick={() => register("지휴")}
          >
            지휴 신청
          </Button>
        </div>

        {existing && (
          <Button
            variant="destructive"
            disabled={isSaving}
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
