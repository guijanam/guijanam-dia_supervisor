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
import { cn } from "@/lib/utils";
import type { DayEntry } from "@/components/user-calendar";

interface DayModalProps {
  employee: Employee;
  date: string | null;
  regularTurn: string | null;
  existing: SpecialSchedule | null;
  allEntries: DayEntry[];
  onClose: () => void;
  onChanged: () => void;
}

export function DayModal({
  employee,
  date,
  regularTurn,
  existing,
  allEntries,
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

        <div className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
            <span className="text-sm font-semibold">전체 신청 내역</span>
            <span className="text-xs text-muted-foreground">
              지근 {allEntries.filter((e) => e.record_type === "지근").length}
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
