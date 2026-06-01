"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { isValidShift, isValidRefDate } from "@/lib/reference";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface RefEmployee {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  reference_date: string | null;
  reference_shift: string | null;
}

export function ReferenceEditPanel() {
  const [list, setList] = useState<RefEmployee[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [positionFilter, setPositionFilter] = useState<"전체" | "기관사" | "차장">("전체");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [refDate, setRefDate] = useState("");
  const [refShift, setRefShift] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setListLoading(true);
      try {
        const { data, error: eErr } = await supabase
          .from("coworker_list")
          .select(
            "staff_id, staff_name, staff_position, reference_date, reference_shift"
          )
          .order("staff_name", { ascending: true });
        if (eErr) throw eErr;
        if (active) setList((data ?? []) as RefEmployee[]);
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "직원 목록 로딩 실패"
          );
      } finally {
        if (active) setListLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectEmployee = (staffId: number) => {
    const emp = list.find((e) => e.staff_id === staffId);
    if (!emp) return;
    setSelectedId(staffId);
    setRefDate(emp.reference_date ?? "");
    setRefShift(emp.reference_shift ?? "");
    setError(null);
    setDone(null);
    setEditOpen(true);
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
    if (selectedId == null) return;
    setBusy(true);
    setError(null);
    const nextDate = refDate.trim() || null;
    const nextShift = refShift.trim() || null;
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ reference_date: nextDate, reference_shift: nextShift })
        .eq("staff_id", selectedId);
      if (upErr) throw upErr;
      setList((prev) =>
        prev.map((e) =>
          e.staff_id === selectedId
            ? { ...e, reference_date: nextDate, reference_shift: nextShift }
            : e
        )
      );
      const name = list.find((e) => e.staff_id === selectedId)?.staff_name ?? "";
      setDone(`${name}님의 기준 근무 정보가 저장되었습니다.`);
      setConfirmOpen(false);
      setEditOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = list
    .filter((e) => {
      const name = (e.staff_name ?? "").trim();
      const lower = name.toLowerCase();
      // 관리자/vip로 시작하는 이름 제외
      if (name.startsWith("관리자") || lower.startsWith("vip")) return false;
      // 직책 분류
      if (positionFilter !== "전체" && e.staff_position !== positionFilter)
        return false;
      // 이름 검색
      if (q && !lower.includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      const cmp = (a.staff_name ?? "").localeCompare(b.staff_name ?? "", "ko");
      return sortAsc ? cmp : -cmp;
    });

  return (
    <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
      <div>
        <h2 className="text-base font-bold">기준 근무 수정</h2>
        <p className="text-sm text-muted-foreground">
          직원의 기준일/기준 근무번호를 수정합니다. 이 값은 근무표 계산의
          기준점이라, 바꾸면 해당 직원의 근무표 전체가 다시 계산됩니다.
        </p>
      </div>

      {done && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          {done}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 max-w-2xl">
        <Input
          type="text"
          placeholder="이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-xs flex-1 min-w-[140px]"
        />
        <div className="flex items-center rounded-md border p-0.5">
          {(["전체", "기관사", "차장"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPositionFilter(p)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                positionFilter === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {p}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1"
          onClick={() => setSortAsc((v) => !v)}
        >
          이름 {sortAsc ? "↑ 오름차순" : "↓ 내림차순"}
        </Button>
      </div>

      <div className="border rounded-md divide-y max-w-2xl">
        {listLoading && (
          <p className="text-muted-foreground text-sm text-center py-6">
            직원 목록 로딩 중...
          </p>
        )}
        {!listLoading && filtered.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-6">
            검색 결과가 없습니다.
          </p>
        )}
        {!listLoading &&
          filtered.map((emp) => (
            <button
              type="button"
              key={emp.staff_id}
              onClick={() => selectEmployee(emp.staff_id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                selectedId === emp.staff_id
                  ? "bg-accent"
                  : "hover:bg-accent/50"
              )}
            >
              <span>
                {emp.staff_name}
                {emp.staff_position ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ({emp.staff_position})
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {emp.reference_date ?? "-"} / {emp.reference_shift ?? "-"}
              </span>
            </button>
          ))}
      </div>

      {/* 수정 모달 */}
      <Dialog
        open={editOpen}
        onOpenChange={(o) => {
          if (!busy && !confirmOpen) setEditOpen(o);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>교번순서 수정</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">
                {list.find((e) => e.staff_id === selectedId)?.staff_name}
              </span>
              {(() => {
                const pos = list.find((e) => e.staff_id === selectedId)?.staff_position;
                return pos ? ` (${pos})` : "";
              })()}
              님의 기준일 · 기준 근무번호를 수정합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
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
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setEditOpen(false)}
              >
                취소
              </Button>
              <Button onClick={requestSave} disabled={busy}>
                저장
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 저장 확인 모달 */}
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
              <span className="font-semibold text-foreground">
                {list.find((e) => e.staff_id === selectedId)?.staff_name}
              </span>
              님의 기준 근무 정보를 바꾸면 해당 직원 근무표 전체가 다시
              계산됩니다. 정말 저장하시겠습니까?
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
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
