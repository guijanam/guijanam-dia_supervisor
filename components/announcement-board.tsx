"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Announcement } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function AnnouncementBoard() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error: qErr } = await supabase
          .from("announcements")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20);
        if (qErr) throw qErr;
        if (active) {
          const announcements = (data as Announcement[]) ?? [];
          setItems(announcements);
          setIsOpen(announcements.length > 0);
        }
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "공지를 불러오지 못했습니다."
          );
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
        <h2 className="text-base font-bold pb-1">공지사항</h2>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-base font-bold pb-1">공지사항</h2>
        <p className="text-destructive text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <div className="px-4 pt-3 pb-2">
        <DialogTrigger asChild>
          <Button variant="outline" className="w-full justify-between gap-2">
            <span className="flex items-center gap-2">
              <Megaphone className="size-4" aria-hidden="true" />
              공지사항
            </span>
            <span className="text-xs text-muted-foreground">{items.length}건 · 다시 보기</span>
          </Button>
        </DialogTrigger>
      </div>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="size-5 text-primary" aria-hidden="true" />
            공지사항
          </DialogTitle>
          <DialogDescription>중요한 안내를 확인해 주세요.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
          {items.map((a) => (
            <article key={a.id} className="rounded-md border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold">{a.title}</h3>
                <time dateTime={a.updated_at} className="shrink-0 text-xs text-muted-foreground">
                  {format(new Date(a.updated_at), "yyyy.MM.dd")}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {a.content}
              </p>
            </article>
          ))}
        </div>
        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button>확인</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
