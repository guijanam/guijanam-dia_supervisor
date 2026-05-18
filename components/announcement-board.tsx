"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import type { Announcement } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

export function AnnouncementBoard() {
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
        if (active) setItems((data as Announcement[]) ?? []);
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
    <div className="px-4 pt-3 pb-2 flex flex-col gap-2">
      <h2 className="text-base font-bold pb-1">공지사항</h2>
      {items.map((a) => (
        <div key={a.id} className="rounded-md border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold">{a.title}</p>
            <p className="shrink-0 text-xs text-muted-foreground">
              {format(new Date(a.updated_at), "yyyy.MM.dd")}
            </p>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
            {a.content}
          </p>
        </div>
      ))}
    </div>
  );
}
