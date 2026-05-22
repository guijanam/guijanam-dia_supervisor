"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type {
  Document,
  DocumentRead,
  DocumentOption,
  DocumentVote,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageViewer } from "@/components/image-viewer";
import {
  FileText,
  Paperclip,
  Check,
  Loader2,
  ExternalLink,
  Download,
} from "lucide-react";
import { cn, isImageFile } from "@/lib/utils";
import { format } from "date-fns";

interface DocumentBoardProps {
  // 미확인 문서 수를 부모(헤더 뱃지 등)로 전달
  onUnreadCountChange?: (count: number) => void;
}

// 한 번에 불러오는 문서 수 (커서 기반 페이지네이션)
const PAGE_SIZE = 20;

// 목록 렌더에 필요한 문서 컬럼 (select("*") 대신 명시)
const DOC_COLUMNS =
  "id,title,description,file_url,file_name,is_required,expires_at,created_by,created_at,updated_at";

export function DocumentBoard({ onUnreadCountChange }: DocumentBoardProps) {
  const { employee } = useAuth();

  const [docs, setDocs] = useState<Document[]>([]);
  // 본인이 확인한 document_id 집합
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // document_id → 선택지 목록 (선택지 있으면 투표 문서)
  const [optionsByDoc, setOptionsByDoc] = useState<
    Map<string, DocumentOption[]>
  >(new Map());
  // document_id → 본인이 선택한 option_id
  const [myVotes, setMyVotes] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 확인 처리 중인 document_id
  const [confirming, setConfirming] = useState<string | null>(null);
  // 투표 처리 중인 document_id
  const [voting, setVoting] = useState<string | null>(null);
  // 전체화면 이미지 뷰어 (열려 있으면 src/name 보유)
  const [viewer, setViewer] = useState<{ src: string; name: string } | null>(
    null
  );
  // 페이지네이션: 마지막 문서 created_at(커서), 다음 페이지 존재 여부, 추가 로딩 중
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // 한 페이지(PAGE_SIZE) 만큼 문서 + 해당 문서들의 선택지/투표를 불러온다.
  // reset=true 면 첫 페이지(커서 무시 + 상태 교체), false 면 다음 페이지(append).
  const loadPage = useCallback(
    async (reset: boolean) => {
      if (!employee) return;
      if (reset) setIsLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        // 다음 페이지 존재 판단을 위해 PAGE_SIZE+1 건 조회
        let q = supabase
          .from("documents")
          .select(DOC_COLUMNS)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE + 1);
        if (!reset && cursor) q = q.lt("created_at", cursor);
        const { data: docData, error: dErr } = await q;
        if (dErr) throw dErr;

        const fetched = (docData as Document[]) ?? [];
        const more = fetched.length > PAGE_SIZE;
        const pageDocs = more ? fetched.slice(0, PAGE_SIZE) : fetched;
        const pageIds = pageDocs.map((d) => d.id);

        // 이번 페이지 문서들의 선택지 / 본인 투표만 한정 조회
        const [optRes, voteRes] = await Promise.all([
          pageIds.length
            ? supabase
                .from("document_options")
                .select("*")
                .in("document_id", pageIds)
                .order("sort_order", { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          pageIds.length
            ? supabase
                .from("document_votes")
                .select("document_id, option_id")
                .eq("staff_id", employee.staff_id)
                .in("document_id", pageIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (optRes.error) throw optRes.error;
        if (voteRes.error) throw voteRes.error;

        // 본인 확인 기록은 첫 페이지 로드 시에만 전체 조회 (1인당 적음)
        let readSet: Set<string> | null = null;
        if (reset) {
          const { data: readData, error: rErr } = await supabase
            .from("document_reads")
            .select("document_id")
            .eq("staff_id", employee.staff_id);
          if (rErr) throw rErr;
          readSet = new Set(
            ((readData as Pick<DocumentRead, "document_id">[]) ?? []).map(
              (r) => r.document_id
            )
          );
        }

        // 상태 머지: reset 이면 교체, 아니면 기존에 append
        setDocs((prev) => (reset ? pageDocs : [...prev, ...pageDocs]));
        if (readSet) setReadIds(readSet);

        setOptionsByDoc((prev) => {
          const optMap = reset
            ? new Map<string, DocumentOption[]>()
            : new Map(prev);
          for (const o of (optRes.data as DocumentOption[]) ?? []) {
            const arr = optMap.get(o.document_id) ?? [];
            arr.push(o);
            optMap.set(o.document_id, arr);
          }
          return optMap;
        });

        setMyVotes((prev) => {
          const vMap = reset ? new Map<string, string>() : new Map(prev);
          for (const v of (voteRes.data as Pick<
            DocumentVote,
            "document_id" | "option_id"
          >[]) ?? []) {
            vMap.set(v.document_id, v.option_id);
          }
          return vMap;
        });

        setHasMore(more);
        setCursor(pageDocs.at(-1)?.created_at ?? cursor);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "문서를 불러오지 못했습니다."
        );
      } finally {
        if (reset) setIsLoading(false);
        else setLoadingMore(false);
      }
    },
    [employee, cursor]
  );

  // 최초(또는 직원 변경 시) 첫 페이지 로드
  useEffect(() => {
    if (!employee) return;
    loadPage(true);
    // loadPage 는 cursor 에도 의존하지만, 첫 로드는 employee 변경 시에만 실행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee]);

  // 미확인 수 계산 후 부모에 통지
  useEffect(() => {
    if (!onUnreadCountChange) return;
    const unread = docs.filter((d) => !readIds.has(d.id)).length;
    onUnreadCountChange(unread);
  }, [docs, readIds, onUnreadCountChange]);

  // 마감일이 지났는지 — 지나면 확인·투표 모두 잠금
  const isExpired = (d: Document): boolean =>
    d.expires_at != null &&
    format(new Date(), "yyyy-MM-dd") > d.expires_at.slice(0, 10);

  // 열람 확인 — 본인 staff_id 로만 insert (대리확인 불가)
  const confirm = async (doc: Document) => {
    if (!employee) return;
    setConfirming(doc.id);
    setError(null);
    try {
      const { error: insErr } = await supabase.from("document_reads").insert({
        document_id: doc.id,
        staff_id: employee.staff_id,
      });
      // 유니크 제약 위반(이미 확인)은 정상 처리로 간주
      if (insErr && insErr.code !== "23505") throw insErr;
      setReadIds((prev) => new Set(prev).add(doc.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "확인 처리에 실패했습니다.");
    } finally {
      setConfirming(null);
    }
  };

  // 투표 — 본인 staff_id 로만. 재투표는 기존 표를 update.
  const vote = async (doc: Document, optionId: string) => {
    if (!employee) return;
    if (myVotes.get(doc.id) === optionId) return; // 같은 선택지면 무시
    setVoting(doc.id);
    setError(null);
    try {
      const existing = myVotes.get(doc.id);
      if (existing) {
        // 재투표: option_id 갱신
        const { error: upErr } = await supabase
          .from("document_votes")
          .update({ option_id: optionId, voted_at: new Date().toISOString() })
          .eq("document_id", doc.id)
          .eq("staff_id", employee.staff_id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase
          .from("document_votes")
          .insert({
            document_id: doc.id,
            option_id: optionId,
            staff_id: employee.staff_id,
          });
        if (insErr) throw insErr;
      }
      setMyVotes((prev) => new Map(prev).set(doc.id, optionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "투표에 실패했습니다.");
    } finally {
      setVoting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
        <h2 className="text-base font-bold pb-1">문서함</h2>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-base font-bold pb-1">문서함</h2>
        <p className="text-destructive text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (docs.length === 0) return null;

  const unreadCount = docs.filter((d) => !readIds.has(d.id)).length;

  return (
    <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
      <h2 className="text-base font-bold pb-1 flex items-center gap-2">
        문서함
        {unreadCount > 0 && (
          <span className="text-[11px] font-bold rounded-full bg-red-500 text-white px-2 py-0.5">
            미확인 {unreadCount}
          </span>
        )}
      </h2>

      {docs.map((d) => {
        const isRead = readIds.has(d.id);
        const expired = isExpired(d);
        const options = optionsByDoc.get(d.id) ?? [];
        const isVoteDoc = options.length > 0;
        const myOption = myVotes.get(d.id);
        return (
          <div
            key={d.id}
            className="rounded-md border p-3 flex flex-col gap-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {d.is_required && (
                    <span className="shrink-0 text-[10px] font-bold rounded bg-red-100 text-red-700 px-1.5 py-0.5 dark:bg-red-900/50 dark:text-red-300">
                      필독
                    </span>
                  )}
                  {isVoteDoc && (
                    <span className="shrink-0 text-[10px] font-bold rounded bg-blue-100 text-blue-700 px-1.5 py-0.5 dark:bg-blue-900/50 dark:text-blue-300">
                      투표
                    </span>
                  )}
                  <p className="font-semibold">{d.title}</p>
                </div>
                {d.description && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {d.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {format(new Date(d.created_at), "yyyy.MM.dd")}
                  {d.expires_at && (
                    <span
                      className={expired ? "text-destructive ml-1" : "ml-1"}
                    >
                      · {isVoteDoc ? "투표" : "확인"} 마감{" "}
                      {format(new Date(d.expires_at), "yyyy.MM.dd")}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* 투표 선택지 */}
            {isVoteDoc && (
              <div className="flex flex-col gap-1.5">
                {options.map((o) => {
                  const selected = myOption === o.id;
                  return (
                    <button
                      key={o.id}
                      onClick={() => vote(d, o.id)}
                      disabled={expired || voting === d.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        selected
                          ? "border-primary bg-accent font-medium"
                          : "hover:bg-accent/50",
                        (expired || voting === d.id) &&
                          "opacity-60 cursor-not-allowed"
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          selected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground"
                        )}
                      >
                        {selected && (
                          <Check className="h-3 w-3 text-primary-foreground" />
                        )}
                      </span>
                      {o.label}
                    </button>
                  );
                })}
                {myOption && !expired && (
                  <p className="text-[11px] text-muted-foreground">
                    다른 항목을 누르면 투표를 변경할 수 있습니다.
                  </p>
                )}
                {expired && (
                  <p className="text-[11px] text-destructive">
                    투표가 마감되었습니다.
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {d.file_url && isImageFile(d.file_name) ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setViewer({
                        src: d.file_url!,
                        name: d.file_name ?? "image",
                      })
                    }
                    title="이미지 크게 보기"
                    className="rounded-md border overflow-hidden transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={d.file_url}
                      alt={d.file_name ?? "첨부 이미지"}
                      loading="lazy"
                      className="h-20 w-20 object-cover"
                    />
                  </button>
                  <Button variant="outline" size="xs" asChild>
                    <a href={d.file_url} download={d.file_name ?? undefined}>
                      <Download className="h-3.5 w-3.5 mr-1" />
                      다운로드
                    </a>
                  </Button>
                </div>
              ) : (
                d.file_url && (
                  <Button variant="outline" size="xs" asChild>
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Paperclip className="h-3.5 w-3.5 mr-1" />
                      파일 열기
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                )
              )}

              {isRead ? (
                <span className="ml-auto flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  확인 완료
                </span>
              ) : (
                <Button
                  size="xs"
                  className="ml-auto"
                  onClick={() => confirm(d)}
                  disabled={confirming === d.id || expired}
                >
                  {confirming === d.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      확인하기
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        );
      })}

      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          onClick={() => loadPage(false)}
          disabled={loadingMore}
        >
          {loadingMore ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "더 보기"
          )}
        </Button>
      )}

      {viewer && (
        <ImageViewer
          src={viewer.src}
          fileName={viewer.name}
          open={!!viewer}
          onOpenChange={(o) => !o && setViewer(null)}
        />
      )}
    </div>
  );
}
