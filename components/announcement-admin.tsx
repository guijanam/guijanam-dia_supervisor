"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { Announcement } from "@/lib/types";
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
import { Megaphone, Pencil, Trash2, Loader2, Plus } from "lucide-react";
import { format } from "date-fns";

interface Props {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

export function AnnouncementAdmin({
  open: openProp,
  onOpenChange,
  hideTrigger,
}: Props = {}) {
  const { employee, isAdmin } = useAuth();

  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [items, setItems] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchList = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("announcements")
        .select("*")
        .order("created_at", { ascending: false });
      if (qErr) throw qErr;
      setItems((data as Announcement[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "공지를 불러오지 못했습니다.");
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
    setContent("");
    setError(null);
    setIsFormOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setTitle(a.title);
    setContent(a.content);
    setError(null);
    setIsFormOpen(true);
  };

  const save = async () => {
    const t = title.trim();
    const c = content.trim();
    if (!t || !c) return;
    setIsSaving(true);
    setError(null);
    try {
      if (editing) {
        const { error: upErr } = await supabase
          .from("announcements")
          .update({
            title: t,
            content: c,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editing.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await supabase.from("announcements").insert({
          title: t,
          content: c,
          created_by: employee.staff_id,
        });
        if (insErr) throw insErr;
      }
      await fetchList();
      setIsFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (a: Announcement) => {
    if (!window.confirm("이 공지를 삭제할까요?")) return;
    setIsSaving(true);
    setError(null);
    try {
      const { error: delErr } = await supabase
        .from("announcements")
        .delete()
        .eq("id", a.id);
      if (delErr) throw delErr;
      await fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {!hideTrigger && (
        <Button
          variant="outline"
          size="xs"
          onClick={() => setOpen(true)}
          title="공지사항 관리"
        >
          <Megaphone className="h-3.5 w-3.5 mr-1" />
          공지
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>공지사항 관리</DialogTitle>
            <DialogDescription>
              직원 캘린더 하단에 표시되는 공지를 작성·수정·삭제합니다.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <Button onClick={openCreate} className="w-full">
            <Plus className="h-4 w-4 mr-1" />새 공지
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
                등록된 공지가 없습니다.
              </p>
            ) : (
              items.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{a.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(a.updated_at), "yyyy.MM.dd HH:mm")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEdit(a)}
                      disabled={isSaving}
                      title="수정"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => remove(a)}
                      disabled={isSaving}
                      title="삭제"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "공지 수정" : "새 공지"}</DialogTitle>
            <DialogDescription>제목과 내용을 입력하세요.</DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <div className="flex flex-col gap-3">
            <Input
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
            />
            <Textarea
              placeholder="내용"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={isSaving}
              className="min-h-32"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setIsFormOpen(false)}
              disabled={isSaving}
            >
              취소
            </Button>
            <Button
              onClick={save}
              disabled={isSaving || !title.trim() || !content.trim()}
            >
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
