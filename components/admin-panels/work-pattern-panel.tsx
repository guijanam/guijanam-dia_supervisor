"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { WorkPattern } from "@/lib/types";
import {
  type ElementOp,
  type PatternAnchor,
  applyElementOp,
  isDestructiveOp,
  describeOp,
  validateElementValue,
  shiftFormatWarning,
  findBrokenAnchors,
} from "@/lib/work-pattern";
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
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  Pencil,
  Trash2,
  Plus,
  Copy,
} from "lucide-react";

interface PatternRow extends WorkPattern {
  userCount: number;
}

interface AnchorRow extends PatternAnchor {
  staff_position: string;
}

const MAX_NAMES = 10;

// 이 배포본은 동대문승무소 전용이라 해당 승무소 교번만 다룬다.
// 다른 승무소 교번(같은 DB 에 함께 있음)을 실수로 편집하면 그 승무소
// 직원들의 근무표가 밀리므로, 표시가 아니라 조회 단계에서 걸러낸다.
const OFFICE_PREFIX = "동대문승무소";

// 앵커 소실 경고 문구: 이름 10명까지 + 외 N명
function formatNames(names: string[]): string {
  if (names.length <= MAX_NAMES) return names.join(", ");
  return `${names.slice(0, MAX_NAMES).join(", ")} 외 ${names.length - MAX_NAMES}명`;
}

export function WorkPatternPanel() {
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [usedFilter, setUsedFilter] = useState<"전체" | "사용중" | "미사용">(
    "전체"
  );
  const [sortBy, setSortBy] = useState<"name" | "count">("name");
  const [sortAsc, setSortAsc] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchors, setAnchors] = useState<AnchorRow[]>([]);
  const [anchorsLoading, setAnchorsLoading] = useState(false);
  // 낙관적 동시성 기준: 화면에 띄운 시점의 서버 배열
  const [snapshot, setSnapshot] = useState<string[] | null>(null);

  const [pendingOp, setPendingOp] = useState<ElementOp | null>(null);
  const [draftOp, setDraftOp] = useState<ElementOp | null>(null);
  const [elementDraft, setElementDraft] = useState("");
  const [nameDialog, setNameDialog] = useState<{
    mode: "create" | "rename";
    value: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PatternRow | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const selected = patterns.find((p) => p.id === selectedId) ?? null;

  // 교번 목록 + 교번별 사용 직원 수.
  // coworker_list 전체(약 284행)를 한 번 읽어 클라이언트에서 집계한다.
  // 교번마다 count 를 왕복하는 것보다 싸고 새 RPC/뷰가 필요 없다.
  const loadPatterns = useCallback(async () => {
    const [patRes, cwRes] = await Promise.all([
      supabase
        .from("work_patterns")
        .select("id, pattern_name, shift_types, created_at")
        .like("pattern_name", `${OFFICE_PREFIX}%`)
        .order("pattern_name", { ascending: true }),
      supabase.from("coworker_list").select("pattern_id"),
    ]);
    if (patRes.error) throw patRes.error;
    if (cwRes.error) throw cwRes.error;

    const counts = new Map<string, number>();
    for (const row of (cwRes.data ?? []) as { pattern_id: string | null }[]) {
      if (!row.pattern_id) continue;
      counts.set(row.pattern_id, (counts.get(row.pattern_id) ?? 0) + 1);
    }
    return ((patRes.data ?? []) as WorkPattern[]).map<PatternRow>((p) => ({
      ...p,
      shift_types: p.shift_types ?? [],
      userCount: counts.get(p.id) ?? 0,
    }));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setListLoading(true);
      try {
        const rows = await loadPatterns();
        if (active) setPatterns(rows);
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "교번 목록 로딩 실패");
      } finally {
        if (active) setListLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadPatterns]);

  // 선택한 교번을 쓰는 직원의 앵커(기준 근무번호) 목록
  useEffect(() => {
    if (!selectedId) {
      setAnchors([]);
      return;
    }
    let active = true;
    (async () => {
      setAnchorsLoading(true);
      try {
        const { data, error: aErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position, reference_shift")
          .eq("pattern_id", selectedId);
        if (aErr) throw aErr;
        if (active) setAnchors((data ?? []) as AnchorRow[]);
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "직원 앵커 로딩 실패");
      } finally {
        if (active) setAnchorsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selectPattern = (id: string) => {
    const p = patterns.find((x) => x.id === id);
    if (!p) return;
    setSelectedId(id);
    setSnapshot(p.shift_types);
    setError(null);
    setDone(null);
  };

  // 편집 전에 이미 깨져 있는 앵커(기존 파손도 노출할 가치가 있다)
  const preBroken = useMemo(() => {
    if (!selected) return [];
    return findBrokenAnchors(selected.shift_types, anchors);
  }, [selected, anchors]);

  // 확인 대기 중인 연산의 결과 미리보기
  const preview = useMemo(() => {
    if (!pendingOp || !selected) return null;
    const nextArr = applyElementOp(selected.shift_types, pendingOp);
    return { nextArr, broken: findBrokenAnchors(nextArr, anchors) };
  }, [pendingOp, selected, anchors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return patterns
      .filter((p) => {
        if (q && !p.pattern_name.toLowerCase().includes(q)) return false;
        if (usedFilter === "사용중" && p.userCount === 0) return false;
        if (usedFilter === "미사용" && p.userCount > 0) return false;
        return true;
      })
      .sort((a, b) => {
        const cmp =
          sortBy === "name"
            ? a.pattern_name.localeCompare(b.pattern_name, "ko")
            : a.userCount - b.userCount;
        return sortAsc ? cmp : -cmp;
      });
  }, [patterns, search, usedFilter, sortBy, sortAsc]);

  // ---- 원소 연산 실행 (쓰기 직전 재조회 + 스냅샷 비교) ----
  const doApplyOp = async (op: ElementOp) => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const { data: fresh, error: rErr } = await supabase
        .from("work_patterns")
        .select("shift_types")
        .eq("id", selectedId)
        .single();
      if (rErr) throw rErr;

      const freshArr = ((fresh?.shift_types ?? []) as string[]).map(String);
      // 다른 관리자가 먼저 수정했으면 덮어쓰지 않는다
      if (snapshot === null || freshArr.join("\u0000") !== snapshot.join("\u0000")) {
        setPatterns((prev) =>
          prev.map((p) =>
            p.id === selectedId ? { ...p, shift_types: freshArr } : p
          )
        );
        setSnapshot(freshArr);
        setPendingOp(null);
        setError(
          "다른 관리자가 이 교번을 먼저 수정했습니다. 최신 순서로 새로 불러왔으니 다시 시도하세요."
        );
        return;
      }

      // 화면 사본이 아니라 서버에서 방금 읽은 배열에 연산을 적용해 쓴다
      const nextArr = applyElementOp(freshArr, op);
      const { error: uErr } = await supabase
        .from("work_patterns")
        .update({ shift_types: nextArr })
        .eq("id", selectedId);
      if (uErr) throw uErr;

      setPatterns((prev) =>
        prev.map((p) =>
          p.id === selectedId ? { ...p, shift_types: nextArr } : p
        )
      );
      setSnapshot(nextArr);
      setPendingOp(null);
      const shiftNote = isDestructiveOp(op)
        ? " 이후 근무표가 한 칸씩 밀립니다."
        : "";
      setDone(`${describeOp(op, freshArr)}${shiftNote}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  // 연산 요청 → 파괴적이거나 앵커가 깨지면 확인 모달, 아니면 즉시 저장
  const requestOp = (op: ElementOp) => {
    if (!selected) return;
    setError(null);
    setDone(null);
    const nextArr = applyElementOp(selected.shift_types, op);
    const broken = findBrokenAnchors(nextArr, anchors);
    // 앵커 소실 없는 순수 rename 은 확인 없이 저장한다.
    // 130칸 순환의 한 칸 변경까지 모달로 막으면 경고를 무시하는 습관이 생긴다.
    if (!isDestructiveOp(op) && broken.length === 0) {
      void doApplyOp(op);
      return;
    }
    setPendingOp(op);
  };

  // rename/insert 는 값 입력 모달을 먼저 띄운다
  const openDraft = (op: ElementOp) => {
    setError(null);
    setDone(null);
    setDraftOp(op);
    setElementDraft(op.kind === "rename" ? (selected?.shift_types[op.index] ?? "") : "");
  };

  const draftError = validateElementValue(elementDraft);
  const draftWarning = draftError ? null : shiftFormatWarning(elementDraft);

  const confirmDraft = () => {
    if (!draftOp || draftError) return;
    const value = elementDraft.trim();
    const op: ElementOp =
      draftOp.kind === "rename"
        ? { kind: "rename", index: draftOp.index, value }
        : { kind: "insert", index: draftOp.index, value };
    setDraftOp(null);
    requestOp(op);
  };

  // ---- 교번 단위 CRUD ----
  const nameTrimmed = nameDialog?.value.trim() ?? "";
  const nameError = (() => {
    if (!nameDialog) return null;
    if (!nameTrimmed) return "교번 이름을 입력하세요.";
    // 목록은 동대문승무소 교번만 보여준다. 접두사가 없으면 저장 직후
    // 목록에서 사라져 다시 편집할 수 없게 되므로 미리 막는다.
    if (!nameTrimmed.startsWith(OFFICE_PREFIX))
      return `교번 이름은 "${OFFICE_PREFIX}" 으로 시작해야 합니다.`;
    const dup = patterns.some(
      (p) =>
        p.pattern_name.trim().toLowerCase() === nameTrimmed.toLowerCase() &&
        !(nameDialog.mode === "rename" && p.id === selectedId)
    );
    if (dup) return "같은 이름의 교번이 이미 있습니다.";
    return null;
  })();

  const saveName = async () => {
    if (!nameDialog || nameError) return;
    setBusy(true);
    setError(null);
    try {
      if (nameDialog.mode === "create") {
        const { data, error: iErr } = await supabase
          .from("work_patterns")
          .insert({ pattern_name: nameTrimmed, shift_types: [] })
          .select("id, pattern_name, shift_types, created_at")
          .single();
        if (iErr) throw iErr;
        const row: PatternRow = {
          ...(data as WorkPattern),
          shift_types: (data as WorkPattern).shift_types ?? [],
          userCount: 0,
        };
        setPatterns((prev) => [row, ...prev]);
        setSelectedId(row.id);
        setSnapshot(row.shift_types);
        setDone(`교번 "${nameTrimmed}" 을 만들었습니다. 근무순서를 추가하세요.`);
      } else {
        if (!selectedId) return;
        const { error: uErr } = await supabase
          .from("work_patterns")
          .update({ pattern_name: nameTrimmed })
          .eq("id", selectedId);
        if (uErr) throw uErr;
        setPatterns((prev) =>
          prev.map((p) =>
            p.id === selectedId ? { ...p, pattern_name: nameTrimmed } : p
          )
        );
        setDone(`교번 이름을 "${nameTrimmed}" 으로 변경했습니다.`);
      }
      setNameDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const doDeletePattern = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      // 캐시된 사용 직원 수가 낡을 수 있으니 삭제 직전 서버에서 재확인
      const { count, error: cErr } = await supabase
        .from("coworker_list")
        .select("staff_id", { count: "exact", head: true })
        .eq("pattern_id", deleteTarget.id);
      if (cErr) throw cErr;
      if ((count ?? 0) > 0) {
        setError(
          `이 교번을 사용하는 직원이 ${count}명 있어 삭제할 수 없습니다. 직원을 다른 교번으로 먼저 옮기세요.`
        );
        setDeleteTarget(null);
        return;
      }
      const { error: dErr } = await supabase
        .from("work_patterns")
        .delete()
        .eq("id", deleteTarget.id);
      if (dErr) throw dErr;
      const name = deleteTarget.pattern_name;
      setPatterns((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setSnapshot(null);
      }
      setDeleteTarget(null);
      setDone(`교번 "${name}" 을 삭제했습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  };

  const copyOrder = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.shift_types.join(", "));
      setDone("현재 근무순서를 클립보드에 복사했습니다.");
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  };

  return (
    <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
      <div>
        <h2 className="text-base font-bold">교번 관리</h2>
        <p className="text-sm text-muted-foreground">
          {OFFICE_PREFIX} 기관사·차장의 근무순서(교번)를 관리합니다. 근무순서는{" "}
          <b>순서 자체가 근무표를 만듭니다</b> — 칸을 삽입·삭제·이동하면 이 교번을
          쓰는 직원 전원의 근무표가 이후로 한 칸씩 밀립니다. 되돌리기가 없으니
          위험한 편집 전에는 &quot;현재 순서 복사&quot;로 백업하세요.
        </p>
      </div>

      {done && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          {done}
        </p>
      )}
      {error && <p className="text-destructive text-sm font-medium">{error}</p>}

      {/* 컨트롤 */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="text"
          placeholder="교번 이름 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-xs flex-1 min-w-[140px]"
        />
        <div className="flex items-center rounded-md border p-0.5">
          {(["전체", "사용중", "미사용"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setUsedFilter(f)}
              className={cn(
                "rounded px-3 py-1 text-sm font-medium transition-colors",
                usedFilter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => {
            if (sortBy === "name") setSortAsc((v) => !v);
            else {
              setSortBy("name");
              setSortAsc(true);
            }
          }}
        >
          이름 {sortBy === "name" ? (sortAsc ? "↑" : "↓") : ""}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => {
            if (sortBy === "count") setSortAsc((v) => !v);
            else {
              setSortBy("count");
              setSortAsc(false);
            }
          }}
        >
          인원 {sortBy === "count" ? (sortAsc ? "↑" : "↓") : ""}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-9 gap-1"
          onClick={() =>
            setNameDialog({ mode: "create", value: `${OFFICE_PREFIX}(` })
          }
        >
          <Plus className="h-4 w-4" />새 교번
        </Button>
      </div>

      {/* 교번 목록 */}
      <div className="border rounded-md divide-y max-w-2xl">
        {listLoading && (
          <p className="text-muted-foreground text-sm text-center py-6">
            교번 목록 로딩 중...
          </p>
        )}
        {!listLoading && filtered.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-6">
            검색 결과가 없습니다.
          </p>
        )}
        {!listLoading &&
          filtered.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => selectPattern(p.id)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm",
                selectedId === p.id ? "bg-accent" : "hover:bg-accent/50"
              )}
            >
              <span className="font-medium">{p.pattern_name}</span>
              <span className="text-muted-foreground text-xs whitespace-nowrap">
                {p.shift_types.length}칸 ·{" "}
                {p.userCount > 0 ? (
                  <span className="text-foreground font-medium">
                    {p.userCount}명 사용중
                  </span>
                ) : (
                  "미사용"
                )}
              </span>
            </button>
          ))}
      </div>

      {/* 선택한 교번 상세 */}
      {selected && (
        <div className="flex flex-col gap-3 border rounded-md p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold">{selected.pattern_name}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.shift_types.length}칸 ·{" "}
                {anchorsLoading ? "직원 확인 중..." : `직원 ${selected.userCount}명`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={copyOrder}
              >
                <Copy className="h-3.5 w-3.5" />
                현재 순서 복사
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setNameDialog({
                    mode: "rename",
                    value: selected.pattern_name,
                  })
                }
              >
                이름 변경
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  setDone(null);
                  setDeleteTarget(selected);
                }}
              >
                삭제
              </Button>
            </div>
          </div>

          {preBroken.length > 0 && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
              <p className="font-semibold text-destructive">
                기준 근무번호가 이 교번에 없는 직원이 있습니다 (근무표 계산 불가)
              </p>
              {preBroken.map((b) => (
                <p key={b.shift} className="text-destructive">
                  {b.shift}: {formatNames(b.names)}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => openDraft({ kind: "insert", index: 0, value: "" })}
            >
              맨 앞에 삽입
            </Button>
          </div>

          {selected.shift_types.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-6">
              근무순서가 비어 있습니다. &quot;맨 앞에 삽입&quot;으로 첫 칸을
              추가하세요.
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {selected.shift_types.map((v, i) => (
                <div
                  key={`${i}-${v}`}
                  className="rounded-md border p-1.5 flex flex-col gap-1"
                >
                  <span className="text-xs text-muted-foreground">#{i}</span>
                  <span className="font-mono text-sm truncate" title={v}>
                    {v}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="한 칸 앞으로"
                      disabled={i === 0 || busy}
                      onClick={() =>
                        requestOp({ kind: "move", index: i, delta: -1 })
                      }
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="한 칸 뒤로"
                      disabled={i === selected.shift_types.length - 1 || busy}
                      onClick={() =>
                        requestOp({ kind: "move", index: i, delta: 1 })
                      }
                    >
                      <ChevronDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="근무번호 수정"
                      disabled={busy}
                      onClick={() =>
                        openDraft({ kind: "rename", index: i, value: v })
                      }
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="이 칸 뒤에 삽입"
                      disabled={busy}
                      onClick={() =>
                        openDraft({ kind: "insert", index: i + 1, value: "" })
                      }
                    >
                      <Plus />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      title="삭제"
                      disabled={busy}
                      onClick={() => requestOp({ kind: "delete", index: i })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 값 입력 모달 (rename / insert) */}
      <Dialog
        open={draftOp !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setDraftOp(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {draftOp?.kind === "rename" ? "근무번호 수정" : "근무번호 삽입"}
            </DialogTitle>
            <DialogDescription>
              {draftOp && selected
                ? draftOp.kind === "rename"
                  ? `#${draftOp.index} 의 근무번호를 바꿉니다. 순환 중 이 한 칸만 바뀝니다.`
                  : draftOp.index === 0
                    ? "맨 앞에 새 칸을 넣습니다. 이후 근무표가 한 칸씩 밀립니다."
                    : `#${draftOp.index - 1} 뒤에 새 칸을 넣습니다. 이후 근무표가 한 칸씩 밀립니다.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">근무번호</span>
              <Input
                type="text"
                autoFocus
                value={elementDraft}
                placeholder="예) 56, 52~, 휴22, 대11~"
                onChange={(e) => setElementDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !draftError) confirmDraft();
                }}
                className="h-9 font-mono"
              />
            </label>
            {draftError && elementDraft.length > 0 && (
              <p className="text-destructive text-xs font-medium">
                {draftError}
              </p>
            )}
            {draftWarning && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {draftWarning}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" onClick={() => setDraftOp(null)}>
                취소
              </Button>
              <Button onClick={confirmDraft} disabled={draftError !== null}>
                확인
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 파괴적 연산 확인 모달 */}
      <Dialog
        open={pendingOp !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setPendingOp(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              근무표 변경 확인
            </DialogTitle>
            <DialogDescription>
              {pendingOp && selected
                ? describeOp(pendingOp, selected.shift_types)
                : null}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            {selected && selected.userCount > 0 && pendingOp && isDestructiveOp(pendingOp) && (
              <p>
                이 교번을 사용하는{" "}
                <span className="font-semibold text-foreground">
                  {selected.userCount}명
                </span>
                의 근무표가 이후로 한 칸씩 밀립니다. 되돌리기는 없습니다.
              </p>
            )}
            {preview && preview.broken.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
                <p className="font-semibold text-destructive">
                  이 직원들의 기준 근무번호가 배열에서 사라져 근무표가 계산되지
                  않습니다
                </p>
                {preview.broken.map((b) => (
                  <p key={b.shift} className="text-destructive">
                    {b.shift}: {formatNames(b.names)}
                  </p>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setPendingOp(null)}
              >
                취소
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => pendingOp && doApplyOp(pendingOp)}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "변경"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 교번 이름 모달 (생성 / 이름변경) */}
      <Dialog
        open={nameDialog !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setNameDialog(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {nameDialog?.mode === "create" ? "새 교번 만들기" : "교번 이름 변경"}
            </DialogTitle>
            <DialogDescription>
              {nameDialog?.mode === "create"
                ? "빈 근무순서로 교번을 만듭니다. 만든 뒤 칸을 추가하세요."
                : "이름만 바꿉니다. 근무표 계산에는 영향이 없습니다."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">교번 이름</span>
              <Input
                type="text"
                autoFocus
                value={nameDialog?.value ?? ""}
                disabled={busy}
                placeholder="예) 동대문승무소(기관사)"
                onChange={(e) =>
                  setNameDialog((prev) =>
                    prev ? { ...prev, value: e.target.value } : prev
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !nameError) void saveName();
                }}
                className="h-9"
              />
            </label>
            {nameError && nameTrimmed.length > 0 && (
              <p className="text-destructive text-xs font-medium">{nameError}</p>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setNameDialog(null)}
              >
                취소
              </Button>
              <Button
                onClick={saveName}
                disabled={busy || nameError !== null}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 교번 삭제 모달 — 사용 중이면 파괴 버튼을 아예 렌더하지 않는다 */}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">교번 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">
                {deleteTarget?.pattern_name}
              </span>
              {deleteTarget && deleteTarget.userCount > 0
                ? " 을 삭제할 수 없습니다."
                : " 을 삭제합니다. 되돌릴 수 없습니다."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            {deleteTarget && deleteTarget.userCount > 0 ? (
              <>
                <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs">
                  <p className="font-semibold text-destructive">
                    이 교번을 사용하는 직원 {deleteTarget.userCount}명
                  </p>
                  {anchors.length > 0 && (
                    <p className="text-destructive">
                      {formatNames(anchors.map((a) => a.staff_name))}
                    </p>
                  )}
                </div>
                <p className="text-muted-foreground">
                  직원을 다른 교번으로 먼저 옮긴 뒤 삭제하세요.
                </p>
                <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                  닫기
                </Button>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDeleteTarget(null)}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={doDeletePattern}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "삭제"}
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
