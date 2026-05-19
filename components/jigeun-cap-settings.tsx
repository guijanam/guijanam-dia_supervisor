"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { JigeunCaps } from "@/lib/types";
import { DEFAULT_JIGEUN_CAPS } from "@/lib/types";
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
  onSaved: () => void;
}

export function JigeunCapSettings({ caps, onSaved }: Props) {
  const { isAdmin, employee } = useAuth();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<JigeunCaps>(caps);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 다이얼로그 열 때마다 최신 caps 로 초기화
  useEffect(() => {
    if (open) {
      setDraft(caps);
      setError(null);
    }
  }, [open, caps]);

  if (!isAdmin || !employee) return null;

  const setField = (key: keyof JigeunCaps, raw: string) => {
    const n = Number(raw);
    setDraft((d) => ({
      ...d,
      [key]: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
    }));
  };

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const { error: upErr } = await supabase
        .from("app_settings")
        .update({
          jigeun_cap_weekday: draft.weekday,
          jigeun_cap_saturday: draft.saturday,
          jigeun_cap_sunday: draft.sunday,
          jigeun_cap_holiday: draft.holiday,
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
        title="지근 정원 설정"
      >
        <Settings2 className="h-3.5 w-3.5 mr-1" />
        정원
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>지근 정원 설정</DialogTitle>
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

          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="ghost"
              onClick={() => setDraft(DEFAULT_JIGEUN_CAPS)}
              disabled={isSaving}
              title="기본값(4/2/4/4)으로 되돌리기"
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
