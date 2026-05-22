"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface Employee {
  staff_id: number;
  staff_name: string;
  staff_position: string;
}

export function PinResetPanel() {
  const [empList, setEmpList] = useState<Employee[]>([]);
  const [empLoading, setEmpLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setEmpLoading(true);
      try {
        const { data, error: eErr } = await supabase
          .from("coworker_list")
          .select("staff_id, staff_name, staff_position")
          .order("staff_name", { ascending: true });
        if (eErr) throw eErr;
        if (active) setEmpList((data ?? []) as Employee[]);
      } catch (err) {
        if (active)
          setError(
            err instanceof Error ? err.message : "직원 목록 로딩 실패"
          );
      } finally {
        if (active) setEmpLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resetPin = async (staffId: number, staffName: string) => {
    if (
      !confirm(
        `${staffName}님의 PIN 을 초기화할까요?\n초기화하면 해당 직원이 다음 로그인 시 PIN 을 다시 설정합니다.`
      )
    )
      return;
    setBusyId(staffId);
    setError(null);
    setDone(null);
    try {
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ pin_hash: null })
        .eq("staff_id", staffId);
      if (upErr) throw upErr;
      setDone(`${staffName}님의 PIN 이 초기화되었습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN 초기화 실패");
    } finally {
      setBusyId(null);
    }
  };

  const q = search.trim().toLowerCase();
  const list = q
    ? empList.filter((e) => e.staff_name.toLowerCase().includes(q))
    : empList;

  return (
    <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
      <div>
        <h2 className="text-base font-bold">PIN 초기화</h2>
        <p className="text-sm text-muted-foreground">
          PIN 을 잊은 직원을 검색해 초기화합니다. 초기화된 직원은 다음 로그인
          시 PIN 을 새로 설정합니다.
        </p>
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium">{error}</p>
      )}
      {done && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400">
          {done}
        </p>
      )}

      <Input
        type="text"
        placeholder="이름 검색"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 max-w-sm"
      />

      <div className="border rounded-md divide-y max-w-2xl">
        {empLoading && (
          <p className="text-muted-foreground text-sm text-center py-6">
            직원 목록 로딩 중...
          </p>
        )}
        {!empLoading && list.length === 0 && (
          <p className="text-muted-foreground text-sm text-center py-6">
            검색 결과가 없습니다.
          </p>
        )}
        {!empLoading &&
          list.map((emp) => (
            <div
              key={emp.staff_id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="text-sm">
                {emp.staff_name}
                {emp.staff_position ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ({emp.staff_position})
                  </span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === emp.staff_id}
                onClick={() => resetPin(emp.staff_id, emp.staff_name)}
              >
                {busyId === emp.staff_id ? (
                  <Loader2 className={cn("h-4 w-4 animate-spin")} />
                ) : (
                  "초기화"
                )}
              </Button>
            </div>
          ))}
      </div>
    </div>
  );
}
