"use client";

import { useState, useEffect, useCallback } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type {
  Document,
  DocumentRead,
  DocumentReadWithEmployee,
  DocumentOption,
  DocumentVote,
  Employee,
} from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  Pencil,
  Trash2,
  Loader2,
  Plus,
  Users,
  Paperclip,
  Check,
  BarChart3,
  X,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const STORAGE_BUCKET = "documents";

// getPublicUrl 이 만든 공개 URL(.../object/public/documents/<경로>)에서
// Storage 내부 경로만 추출한다. 추출 실패 시 null → 삭제를 건너뛴다.
function storagePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${STORAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

export function DocumentAdmin() {
  const { employee, isAdmin } = useAuth();

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Document[]>([]);
  // document_id → 선택지 수 (투표 문서 여부 판별)
  const [optionCounts, setOptionCounts] = useState<Map<string, number>>(
    new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 등록/수정 폼
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Document | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // 투표 선택지 텍스트 목록 (빈 문자열 항목은 저장 시 제거)
  const [options, setOptions] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // 확인자 명단 / 투표 집계
  const [readsDoc, setReadsDoc] = useState<Document | null>(null);
  const [voteDoc, setVoteDoc] = useState<Document | null>(null);

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (qErr) throw qErr;
      const docs = (data as Document[]) ?? [];
      setItems(docs);

      // 각 문서의 선택지 수 — 투표 문서 배지/버튼 표시에 사용
      const { data: optData, error: oErr } = await supabase
        .from("document_options")
        .select("document_id");
      if (oErr) throw oErr;
      const counts = new Map<string, number>();
      for (const o of (optData as Pick<DocumentOption, "document_id">[]) ??
        []) {
        counts.set(o.document_id, (counts.get(o.document_id) ?? 0) + 1);
      }
      setOptionCounts(counts);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "문서를 불러오지 못했습니다."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchList();
  }, [open, fetchList]);

  if (!isAdmin || !employee) return null;

  const openCreate = () => {
    setEditing(null);
    setTitle("");
    setDescription("");
    setIsRequired(false);
    setExpiresAt("");
    setFile(null);
    setOptions([]);
    setError(null);
    setIsFormOpen(true);
  };

  const openEdit = async (d: Document) => {
    setEditing(d);
    setTitle(d.title);
    setDescription(d.description ?? "");
    setIsRequired(d.is_required);
    setExpiresAt(d.expires_at ? d.expires_at.slice(0, 10) : "");
    setFile(null);
    setError(null);
    // 기존 선택지 로드
    try {
      const { data, error: oErr } = await supabase
        .from("document_options")
        .select("*")
        .eq("document_id", d.id)
        .order("sort_order", { ascending: true });
      if (oErr) throw oErr;
      setOptions(
        ((data as DocumentOption[]) ?? []).map((o) => o.label)
      );
    } catch {
      setOptions([]);
    }
    setIsFormOpen(true);
  };

  // 투표 선택지 편집 헬퍼
  const addOption = () => setOptions((prev) => [...prev, ""]);
  const updateOption = (i: number, val: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? val : o)));
  const removeOption = (i: number) =>
    setOptions((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    setIsSaving(true);
    setError(null);
    try {
      // 새 파일이 선택되었으면 Storage 에 업로드
      let fileUrl = editing?.file_url ?? null;
      let fileName = editing?.file_name ?? null;
      if (file) {
        const safeName = file.name.replace(/[^\w.\-가-힣]/g, "_");
        const path = `${Date.now()}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(path);
        fileUrl = pub.publicUrl;
        fileName = file.name;
      }

      const payload = {
        title: t,
        description: description.trim() || null,
        file_url: fileUrl,
        file_name: fileName,
        is_required: isRequired,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      };

      // 저장할 문서 id 확보
      let docId: string;
      if (editing) {
        const { error: upErr } = await supabase
          .from("documents")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editing.id);
        if (upErr) throw upErr;
        docId = editing.id;

        // 파일을 새로 교체했으면 기존 첨부 파일을 Storage 에서 제거(고아 방지).
        if (file && editing.file_url && editing.file_url !== fileUrl) {
          const oldPath = storagePathFromUrl(editing.file_url);
          if (oldPath) {
            await supabase.storage.from(STORAGE_BUCKET).remove([oldPath]);
          }
        }
      } else {
        const { data: insData, error: insErr } = await supabase
          .from("documents")
          .insert({ ...payload, created_by: employee.staff_id })
          .select("id")
          .single();
        if (insErr) throw insErr;
        docId = (insData as { id: string }).id;
      }

      // 투표 선택지 동기화 — 빈 항목 제거 후 전체 교체.
      // (수정 시 기존 선택지를 지우고 다시 넣는다. 기존 투표는 cascade 로
      //  삭제되므로, 이미 투표가 진행된 문서의 선택지 변경은 신중해야 함.)
      const cleanOptions = options
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
      if (editing) {
        const { error: delErr } = await supabase
          .from("document_options")
          .delete()
          .eq("document_id", docId);
        if (delErr) throw delErr;
      }
      if (cleanOptions.length > 0) {
        const { error: optErr } = await supabase
          .from("document_options")
          .insert(
            cleanOptions.map((label, idx) => ({
              document_id: docId,
              label,
              sort_order: idx,
            }))
          );
        if (optErr) throw optErr;
      }

      await fetchList();
      setIsFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (d: Document) => {
    if (
      !window.confirm(
        "이 문서를 삭제할까요? 확인 기록·투표 결과도 함께 삭제됩니다."
      )
    ) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      // 1) DB 행 삭제 (document_reads/options/votes 는 on delete cascade)
      const { error: delErr } = await supabase
        .from("documents")
        .delete()
        .eq("id", d.id);
      if (delErr) throw delErr;

      // 2) Storage 첨부 파일도 함께 삭제 — 고아 파일 방지.
      //    파일 삭제 실패는 DB 삭제를 되돌리지 않고 무시(고아 파일만 남음).
      const path = storagePathFromUrl(d.file_url);
      if (path) {
        await supabase.storage.from(STORAGE_BUCKET).remove([path]);
      }

      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
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
        title="문서 관리"
      >
        <FileText className="h-3.5 w-3.5 mr-1" />
        문서
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>문서 관리</DialogTitle>
            <DialogDescription>
              직원에게 배포할 문서를 등록하고, 열람 확인·투표 현황을 조회합니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <Button onClick={openCreate} className="w-full">
            <Plus className="h-4 w-4 mr-1" />새 문서
          </Button>

          <div className="flex flex-col gap-2 max-h-[50vh] overflow-auto">
            {isLoading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                등록된 문서가 없습니다.
              </p>
            ) : (
              items.map((d) => {
                const isVote = (optionCounts.get(d.id) ?? 0) > 0;
                return (
                  <div
                    key={d.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {d.is_required && (
                          <span className="shrink-0 text-[10px] font-bold rounded bg-red-100 text-red-700 px-1.5 py-0.5 dark:bg-red-900/50 dark:text-red-300">
                            필독
                          </span>
                        )}
                        {isVote && (
                          <span className="shrink-0 text-[10px] font-bold rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 dark:bg-blue-900/50 dark:text-blue-300">
                            투표
                          </span>
                        )}
                        <p className="font-semibold truncate">{d.title}</p>
                      </div>
                      {d.file_name && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground truncate">
                          <Paperclip className="h-3 w-3 shrink-0" />
                          {d.file_name}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {format(new Date(d.updated_at), "yyyy.MM.dd HH:mm")}
                        {d.expires_at &&
                          ` · 마감 ${format(
                            new Date(d.expires_at),
                            "yyyy.MM.dd"
                          )}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => setReadsDoc(d)}
                        disabled={isSaving}
                      >
                        <Users className="h-3.5 w-3.5 mr-1" />
                        확인 현황
                      </Button>
                      {isVote && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={() => setVoteDoc(d)}
                          disabled={isSaving}
                        >
                          <BarChart3 className="h-3.5 w-3.5 mr-1" />
                          투표 집계
                        </Button>
                      )}
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEdit(d)}
                          disabled={isSaving}
                          title="수정"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => remove(d)}
                          disabled={isSaving}
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 등록/수정 폼 */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "문서 수정" : "새 문서"}</DialogTitle>
            <DialogDescription>
              제목·설명·파일·투표 선택지를 설정하세요. 선택지를 추가하면 투표
              문서가 됩니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <div className="flex flex-col gap-3 max-h-[60vh] overflow-auto">
            <Input
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
            />
            <Textarea
              placeholder="설명 (선택)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSaving}
              className="min-h-24"
            />

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                파일 첨부 (선택)
              </label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={isSaving}
                className="text-sm file:mr-2 file:rounded-md file:border file:bg-background file:px-2 file:py-1 file:text-xs"
              />
              {editing?.file_name && !file && (
                <p className="text-xs text-muted-foreground">
                  현재 파일: {editing.file_name} (새 파일 선택 시 교체)
                </p>
              )}
            </div>

            {/* 투표 선택지 */}
            <div className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  투표 선택지 (선택)
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={addOption}
                  disabled={isSaving}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  항목 추가
                </Button>
              </div>
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  선택지를 추가하면 직원이 투표할 수 있습니다. 비워두면 일반
                  확인 문서입니다.
                </p>
              ) : (
                options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      placeholder={`선택지 ${i + 1}`}
                      value={opt}
                      onChange={(e) => updateOption(i, e.target.value)}
                      disabled={isSaving}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeOption(i)}
                      disabled={isSaving}
                      title="삭제"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
              {editing && options.length > 0 && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  ⚠ 이미 투표가 진행된 문서의 선택지를 수정하면 기존 투표 결과가
                  모두 삭제됩니다.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">필독 문서로 표시</span>
              <Button
                type="button"
                variant={isRequired ? "default" : "outline"}
                size="xs"
                onClick={() => setIsRequired((v) => !v)}
                disabled={isSaving}
              >
                {isRequired && <Check className="h-3.5 w-3.5 mr-1" />}
                {isRequired ? "필독" : "일반"}
              </Button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                확인·투표 마감일 (선택)
              </label>
              <Input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setIsFormOpen(false)}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button onClick={save} disabled={isSaving || !title.trim()}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "저장"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 확인자 명단 */}
      {readsDoc && (
        <DocumentReadsDialog
          document={readsDoc}
          onClose={() => setReadsDoc(null)}
        />
      )}

      {/* 투표 집계 */}
      {voteDoc && (
        <DocumentVotesDialog
          document={voteDoc}
          onClose={() => setVoteDoc(null)}
        />
      )}
    </>
  );
}

// ─── 확인 현황 Dialog ─────────────────────────────────────────
// 확인 / 미확인 탭으로 전체 직원 대비 열람 현황을 보여준다.
// 관리자는 조회만 가능 — 확인 기록을 생성·수정·삭제하지 않는다.
function DocumentReadsDialog({
  document,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"read" | "unread">("read");
  const [reads, setReads] = useState<DocumentReadWithEmployee[]>([]);
  const [unread, setUnread] = useState<
    Pick<Employee, "staff_id" | "staff_name" | "staff_position">[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        // 확인 기록 (FK 임베딩 미사용 — coworker_list 와 별도 조회 후 코드에서 결합)
        const { data: readData, error: rErr } = await supabase
          .from("document_reads")
          .select("*")
          .eq("document_id", document.id)
          .order("confirmed_at", { ascending: true });
        if (rErr) throw rErr;

        // 전체 직원 (role 로 관리자 제외)
        const { data: staffData, error: sErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position, role");
        if (sErr) throw sErr;

        if (!active) return;
        const rawReads = (readData as DocumentRead[]) ?? [];
        // 확인 대상에서 제외: ① 이름에 "결원" 포함된 가상 직원(quarter-balance 와 동일),
        //                    ② 관리자(role='admin') — 문서 확인 의무 없음.
        const allStaff = (
          (staffData as Pick<
            Employee,
            "staff_id" | "staff_name" | "staff_position" | "role"
          >[]) ?? []
        ).filter(
          (s) => !s.staff_name.includes("결원") && s.role !== "admin"
        );

        // staff_id → 직원 정보 매핑
        const empMap = new Map(allStaff.map((s) => [s.staff_id, s]));

        // 확인 기록에 직원 정보 결합
        const readList: DocumentReadWithEmployee[] = rawReads.map((r) => {
          const emp = empMap.get(r.staff_id);
          return {
            ...r,
            employee: emp
              ? {
                  staff_name: emp.staff_name,
                  staff_position: emp.staff_position,
                }
              : null,
          };
        });
        setReads(readList);

        const readIds = new Set(rawReads.map((r) => r.staff_id));
        setUnread(allStaff.filter((s) => !readIds.has(s.staff_id)));
      } catch (err) {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "확인 현황을 불러오지 못했습니다."
          );
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [document.id]);

  const total = reads.length + unread.length;

  // 엑셀 출력 — 시트1: 확인자 명단, 시트2: 미확인자 명단.
  const exportExcel = () => {
    const readSheet = reads.map((r) => ({
      이름: r.employee?.staff_name ?? `#${r.staff_id}`,
      직책: r.employee?.staff_position ?? "",
      확인시각: format(new Date(r.confirmed_at), "yyyy-MM-dd HH:mm"),
    }));
    const unreadSheet = unread.map((s) => ({
      이름: s.staff_name,
      직책: s.staff_position,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        readSheet.length > 0
          ? readSheet
          : [{ 이름: "", 직책: "", 확인시각: "" }]
      ),
      `확인 ${reads.length}`
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        unreadSheet.length > 0 ? unreadSheet : [{ 이름: "", 직책: "" }]
      ),
      `미확인 ${unread.length}`
    );
    const safeTitle = document.title.replace(/[\\/:*?"<>|]/g, "_");
    XLSX.writeFile(wb, `확인현황_${safeTitle}.xlsx`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">{document.title}</DialogTitle>
          <DialogDescription>
            {isLoading
              ? "확인 현황을 불러오는 중…"
              : `${reads.length} / ${total}명 확인 (${
                  total > 0
                    ? Math.round((reads.length / total) * 100)
                    : 0
                }%)`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-destructive text-sm font-medium">{error}</p>
        )}

        {!isLoading && (
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={total === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            엑셀 다운로드
          </Button>
        )}

        <div className="flex border-b">
          {(
            [
              { key: "read", label: `확인 ${reads.length}` },
              { key: "unread", label: `미확인 ${unread.length}` },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex-1 py-2 text-sm font-bold transition-colors",
                tab === t.key
                  ? "border-b-2 border-primary"
                  : "text-muted-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 max-h-[50vh] overflow-auto">
          {isLoading ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </>
          ) : tab === "read" ? (
            reads.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                아직 확인한 직원이 없습니다.
              </p>
            ) : (
              reads.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="text-sm font-medium">
                    {r.employee?.staff_name ?? `#${r.staff_id}`}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {r.employee?.staff_position ?? ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {format(new Date(r.confirmed_at), "MM.dd HH:mm")}
                  </span>
                </div>
              ))
            )
          ) : unread.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              모든 직원이 확인했습니다.
            </p>
          ) : (
            unread.map((s) => (
              <div
                key={s.staff_id}
                className="flex items-center gap-2 rounded-md border px-3 py-2"
              >
                <span className="text-sm font-medium">
                  {s.staff_name}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {s.staff_position}
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </DialogContent>
    </Dialog>
  );
}

// ─── 투표 집계 Dialog ─────────────────────────────────────────
// 선택지별 득표수/비율 + 직원별 선택 내역. 엑셀로 출력 가능.
// 관리자는 조회만 — 투표를 대신 하거나 수정하지 않는다.
function DocumentVotesDialog({
  document,
  onClose,
}: {
  document: Document;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<DocumentOption[]>([]);
  const [votes, setVotes] = useState<DocumentVote[]>([]);
  // staff_id → 직원 정보
  const [empMap, setEmpMap] = useState<
    Map<number, Pick<Employee, "staff_name" | "staff_position">>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { data: optData, error: oErr } = await supabase
          .from("document_options")
          .select("*")
          .eq("document_id", document.id)
          .order("sort_order", { ascending: true });
        if (oErr) throw oErr;

        const { data: voteData, error: vErr } = await supabase
          .from("document_votes")
          .select("*")
          .eq("document_id", document.id);
        if (vErr) throw vErr;

        const { data: staffData, error: sErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position");
        if (sErr) throw sErr;

        if (!active) return;
        setOptions((optData as DocumentOption[]) ?? []);
        setVotes((voteData as DocumentVote[]) ?? []);
        const m = new Map<
          number,
          Pick<Employee, "staff_name" | "staff_position">
        >();
        for (const s of (staffData as Pick<
          Employee,
          "staff_id" | "staff_name" | "staff_position"
        >[]) ?? []) {
          m.set(s.staff_id, {
            staff_name: s.staff_name,
            staff_position: s.staff_position,
          });
        }
        setEmpMap(m);
      } catch (err) {
        if (active)
          setError(
            err instanceof Error
              ? err.message
              : "투표 집계를 불러오지 못했습니다."
          );
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [document.id]);

  // 선택지별 득표수
  const countByOption = new Map<string, number>();
  for (const v of votes) {
    countByOption.set(
      v.option_id,
      (countByOption.get(v.option_id) ?? 0) + 1
    );
  }
  const totalVotes = votes.length;
  const optLabel = new Map(options.map((o) => [o.id, o.label]));

  // 엑셀 출력 — 시트1: 선택지 집계, 시트2: 직원별 내역
  const exportExcel = () => {
    const summary = options.map((o) => ({
      선택지: o.label,
      득표수: countByOption.get(o.id) ?? 0,
      비율:
        totalVotes > 0
          ? `${Math.round(
              ((countByOption.get(o.id) ?? 0) / totalVotes) * 100
            )}%`
          : "0%",
    }));
    summary.push({ 선택지: "합계", 득표수: totalVotes, 비율: "" });

    const detail = votes
      .map((v) => {
        const emp = empMap.get(v.staff_id);
        return {
          이름: emp?.staff_name ?? `#${v.staff_id}`,
          직책: emp?.staff_position ?? "",
          선택: optLabel.get(v.option_id) ?? "(삭제된 선택지)",
          투표시각: format(new Date(v.voted_at), "yyyy-MM-dd HH:mm"),
        };
      })
      .sort((a, b) => a.이름.localeCompare(b.이름, "ko"));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(summary),
      "집계"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        detail.length > 0
          ? detail
          : [{ 이름: "", 직책: "", 선택: "", 투표시각: "" }]
      ),
      "직원별 내역"
    );
    const safeTitle = document.title.replace(/[\\/:*?"<>|]/g, "_");
    XLSX.writeFile(wb, `투표결과_${safeTitle}.xlsx`);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">
            {document.title} — 투표 집계
          </DialogTitle>
          <DialogDescription>
            {isLoading
              ? "투표 집계를 불러오는 중…"
              : `총 ${totalVotes}표`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="text-destructive text-sm font-medium">{error}</p>
        )}

        {!isLoading && (
          <Button
            variant="outline"
            onClick={exportExcel}
            disabled={totalVotes === 0}
          >
            <Download className="h-4 w-4 mr-1" />
            엑셀 다운로드
          </Button>
        )}

        <div className="flex flex-col gap-3 max-h-[55vh] overflow-auto">
          {isLoading ? (
            <>
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </>
          ) : (
            <>
              {/* 선택지별 집계 */}
              <div className="flex flex-col gap-2">
                {options.map((o) => {
                  const c = countByOption.get(o.id) ?? 0;
                  const pct =
                    totalVotes > 0
                      ? Math.round((c / totalVotes) * 100)
                      : 0;
                  return (
                    <div key={o.id} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{o.label}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {c}표 · {pct}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 직원별 내역 */}
              <div className="flex flex-col gap-1 border-t pt-2">
                <p className="text-sm font-bold pb-1">
                  직원별 내역 ({totalVotes})
                </p>
                {votes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    아직 투표한 직원이 없습니다.
                  </p>
                ) : (
                  [...votes]
                    .sort((a, b) => {
                      const an = empMap.get(a.staff_id)?.staff_name ?? "";
                      const bn = empMap.get(b.staff_id)?.staff_name ?? "";
                      return an.localeCompare(bn, "ko");
                    })
                    .map((v) => {
                      const emp = empMap.get(v.staff_id);
                      return (
                        <div
                          key={v.id}
                          className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                        >
                          <span className="text-sm font-medium">
                            {emp?.staff_name ?? `#${v.staff_id}`}
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {emp?.staff_position ?? ""}
                            </span>
                          </span>
                          <span className="text-xs font-medium text-primary truncate max-w-[45%]">
                            {optLabel.get(v.option_id) ?? "(삭제됨)"}
                          </span>
                        </div>
                      );
                    })
                )}
              </div>
            </>
          )}
        </div>

        <Button variant="outline" onClick={onClose}>
          닫기
        </Button>
      </DialogContent>
    </Dialog>
  );
}
