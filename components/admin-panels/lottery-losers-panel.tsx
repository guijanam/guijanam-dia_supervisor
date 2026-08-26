"use client";

// 추첨 탈락자 연락처.
//
// 추첨에서 떨어진(lottery_status='lost') 직원에게만 추가 신청 기간이 열리므로
// (user-calendar.tsx 의 extraEligible 판정) 관리자가 "누구에게 다시 신청하라고
// 연락해야 하는지" 를 한 화면에서 보고 바로 전화/문자할 수 있게 한다.
//
// 집계 범위는 분기다 — 추가 신청 자격이 분기 단위로 판정되기 때문이다.
// 기본 분기는 app_settings 의 추가 신청 대상 분기를 따라간다.
import { useState, useEffect, useCallback, useMemo } from "react";
import ExcelJS from "exceljs";
import { supabase } from "@/lib/supabase";
import { quarterRange, QUARTERS } from "@/lib/quarter";
import { getDayName } from "@/lib/schedule-utils";
import type { RecordType } from "@/lib/types";
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
  Phone,
  MessageSquare,
  Copy,
  Download,
  Users,
  Trash2,
} from "lucide-react";

const POSITIONS = ["전체", "기관사", "차장"] as const;
type PositionFilter = (typeof POSITIONS)[number];

interface LostDate {
  target_date: string;
  record_type: RecordType;
}

interface LoserRow {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  employee_number: string | null;
  phone_number: string | null;
  dates: LostDate[];
}

/** tel:/sms: 링크에 넣을 번호. 하이픈·공백 등을 걷어낸다. */
function toDialable(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

/** 목록에 표시할 날짜 라벨 — 8/15(금) 형태. */
function shortDateLabel(dateString: string): string {
  const [, m, d] = dateString.split("-");
  return `${Number(m)}/${Number(d)}(${getDayName(dateString)})`;
}

export function LotteryLosersPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  // 기본 분기를 app_settings 에서 받아오기 전에는 조회하지 않는다.
  // 그렇지 않으면 오늘 기준 분기로 한 번 조회한 뒤 대상 분기로 또 조회한다.
  const [defaultsLoaded, setDefaultsLoaded] = useState(false);
  const [rows, setRows] = useState<LoserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("전체");
  // 분기 전체 탈락 건 삭제(과거 분기 정리용) 확인창.
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeBusy, setPurgeBusy] = useState(false);

  // 첫 화면이 빈 목록이 되지 않도록 기본 분기를 고른다.
  //
  // app_settings 의 추가 신청 대상 분기를 우선 쓰되, 그 분기에 탈락자가 없으면
  // 실제로 탈락자가 있는 가장 최근 분기로 내려간다. 관리자가 다음 분기를 미리
  // 설정해 둔 상태(설정=Q4, 탈락자=Q3)에서 그대로 따르면 정작 연락해야 할
  // 사람이 화면에 안 나온다.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [settings, lost] = await Promise.all([
          supabase
            .from("app_settings")
            .select("extra_request_year, extra_request_quarter")
            .eq("id", 1)
            .maybeSingle(),
          supabase
            .from("special_schedules")
            .select("target_date")
            .eq("lottery_status", "lost")
            .order("target_date", { ascending: false })
            .limit(1000),
        ]);
        if (!active) return;

        const quartersWithLosers = new Set(
          ((lost.data ?? []) as Array<{ target_date: string }>).map((r) => {
            const [y, m] = r.target_date.split("-").map(Number);
            return `${y}-${Math.floor((m - 1) / 3) + 1}`;
          })
        );

        const settingsYear = settings.data?.extra_request_year ?? null;
        const settingsQuarter = settings.data?.extra_request_quarter ?? null;

        if (
          settingsYear &&
          settingsQuarter &&
          quartersWithLosers.has(`${settingsYear}-${settingsQuarter}`)
        ) {
          setYear(settingsYear);
          setQuarter(settingsQuarter);
        } else if (lost.data && lost.data.length > 0) {
          // target_date 내림차순이라 첫 행이 가장 최근 탈락 건이다.
          const [y, m] = (lost.data[0] as { target_date: string }).target_date
            .split("-")
            .map(Number);
          setYear(y);
          setQuarter(Math.floor((m - 1) / 3) + 1);
        } else if (settingsYear && settingsQuarter) {
          setYear(settingsYear);
          setQuarter(settingsQuarter);
        }
      } catch {
        // 실패해도 오늘 기준 분기로 동작하면 된다.
      } finally {
        if (active) setDefaultsLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setDone(null);
    try {
      const { start, end } = quarterRange(year, quarter);

      // 탈락 건만 뽑는다. 분기 휴무 집계(fetchQuarterTotals)는 근무표 전체를
      // 끌어오므로 여기서는 쓰지 않는다 — 필요한 건 탈락 건과 연락처뿐이다.
      const { data: lost, error: lostErr } = await supabase
        .from("special_schedules")
        .select("staff_id, target_date, record_type")
        .eq("lottery_status", "lost")
        .gte("target_date", start)
        .lte("target_date", end)
        .order("target_date", { ascending: true });
      if (lostErr) throw lostErr;

      const lostRows = (lost ?? []) as Array<{
        staff_id: number;
        target_date: string;
        record_type: RecordType;
      }>;

      const ids = [...new Set(lostRows.map((r) => r.staff_id))];
      if (ids.length === 0) {
        setRows([]);
        return;
      }

      // FK 임베딩 대신 별도 조회 (requests-panel 과 동일한 관례)
      const { data: emps, error: empErr } = await supabase
        .from("coworker_list")
        .select(
          "staff_id, staff_name, staff_position, employee_number, phone_number"
        )
        .in("staff_id", ids);
      if (empErr) throw empErr;

      const empMap = new Map<
        number,
        {
          staff_name: string;
          staff_position: string;
          employee_number: string | null;
          phone_number: string | null;
        }
      >();
      for (const e of emps ?? []) {
        empMap.set(e.staff_id, {
          staff_name: e.staff_name,
          staff_position: e.staff_position,
          employee_number: e.employee_number,
          phone_number: e.phone_number,
        });
      }

      // 한 직원이 여러 날 탈락해도 한 줄로 묶는다 — 연락은 사람 단위로 한 번이면 된다.
      const byStaff = new Map<number, LoserRow>();
      for (const r of lostRows) {
        let row = byStaff.get(r.staff_id);
        if (!row) {
          const emp = empMap.get(r.staff_id);
          row = {
            staff_id: r.staff_id,
            staff_name: emp?.staff_name ?? `(미상 ${r.staff_id})`,
            staff_position: emp?.staff_position ?? "",
            employee_number: emp?.employee_number ?? null,
            phone_number: emp?.phone_number ?? null,
            dates: [],
          };
          byStaff.set(r.staff_id, row);
        }
        row.dates.push({
          target_date: r.target_date,
          record_type: r.record_type,
        });
      }

      const merged = [...byStaff.values()];
      for (const row of merged) {
        row.dates.sort((a, b) => a.target_date.localeCompare(b.target_date));
      }
      merged.sort(
        (a, b) =>
          a.staff_position.localeCompare(b.staff_position) ||
          a.staff_name.localeCompare(b.staff_name)
      );
      setRows(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "데이터 로딩 실패");
    } finally {
      setIsLoading(false);
    }
  }, [year, quarter]);

  useEffect(() => {
    if (!defaultsLoaded) return;
    fetchData();
  }, [defaultsLoaded, fetchData]);

  const filtered = useMemo(() => {
    const f = nameFilter.trim().toLowerCase();
    return rows.filter((r) => {
      if (positionFilter !== "전체" && r.staff_position !== positionFilter)
        return false;
      if (!f) return true;
      return (
        r.staff_name.toLowerCase().includes(f) ||
        String(r.employee_number ?? "")
          .toLowerCase()
          .includes(f)
      );
    });
  }, [rows, nameFilter, positionFilter]);

  const missingPhoneCount = useMemo(
    () => filtered.filter((r) => !r.phone_number).length,
    [filtered]
  );
  const totalLostEntries = useMemo(
    () => filtered.reduce((sum, r) => sum + r.dates.length, 0),
    [filtered]
  );

  // 클립보드는 보안 컨텍스트(HTTPS/localhost)에서만 쓸 수 있다.
  // LAN 으로 http 접속하면 undefined 라 조용히 실패하므로 안내를 띄운다.
  const copyText = async (text: string, message: string) => {
    setError(null);
    setDone(null);
    if (!navigator.clipboard) {
      setError("복사는 HTTPS(또는 localhost) 접속에서만 가능합니다.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setDone(message);
    } catch {
      setError("클립보드 복사에 실패했습니다.");
    }
  };

  const copyAllPhones = () => {
    const phones = filtered
      .map((r) => r.phone_number)
      .filter((p): p is string => !!p)
      .map(toDialable);
    if (phones.length === 0) {
      setError("복사할 전화번호가 없습니다.");
      setDone(null);
      return;
    }
    copyText(phones.join(","), `${phones.length}개 번호를 복사했습니다.`);
  };

  // 선택한 분기가 아직 진행 중인지. 지나간 분기를 정리하는 것이 이 기능의
  // 목적이라, 진행 중인 분기를 지우려 하면 확인창에서 경고한다(막지는 않는다).
  const isCurrentOrFutureQuarter =
    year > now.getFullYear() ||
    (year === now.getFullYear() &&
      quarter >= Math.floor(now.getMonth() / 3) + 1);

  // 분기 전체의 탈락 건을 DB 에서 지운다.
  //
  // 지나간 분기의 탈락 기록은 과거 데이터라 계속 쌓이면 조회만 무거워진다.
  // 지워도 분기 휴무 합계(24)는 달라지지 않는다 — 탈락 건은 애초에 지근/지휴
  // 카운트에서 빠져 lostCount 로만 세기 때문이다(quarter-balance-calc 참고).
  // 대신 그 분기의 '탈락' 기록과 추가 신청 자격 판정 근거는 영구히 사라진다.
  //
  // 화면 필터(이름/직책)와 무관하게 분기 전체를 지운다 — 필터를 걸어둔 걸
  // 잊고 눌렀을 때 일부만 지워져 헷갈리는 것보다, 범위가 예측 가능한 편이 낫다.
  const purgeQuarter = async () => {
    setPurgeBusy(true);
    setError(null);
    setDone(null);
    try {
      const { start, end } = quarterRange(year, quarter);
      const { error: delErr, count } = await supabase
        .from("special_schedules")
        .delete({ count: "exact" })
        .eq("lottery_status", "lost")
        .gte("target_date", start)
        .lte("target_date", end);
      if (delErr) throw delErr;
      setPurgeOpen(false);
      // fetchData 가 done 을 비우므로 재조회 뒤에 안내를 띄운다.
      await fetchData();
      setDone(`${year}년 ${quarter}분기 탈락 건 ${count ?? 0}건을 삭제했습니다.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    } finally {
      setPurgeBusy(false);
    }
  };

  const exportExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("추첨 탈락자");
    ws.columns = [
      { header: "사번", width: 12 },
      { header: "직책", width: 10 },
      { header: "이름", width: 10 },
      { header: "전화번호", width: 16 },
      { header: "탈락건수", width: 10 },
      { header: "탈락날짜", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };

    for (const r of filtered) {
      const row = ws.addRow([
        r.employee_number ?? "",
        r.staff_position,
        r.staff_name,
        r.phone_number ?? "",
        r.dates.length,
        r.dates
          .map((d) => `${shortDateLabel(d.target_date)} ${d.record_type}`)
          .join(", "),
      ]);
      // 전화번호는 선행 0 이 살아야 하므로 문자열로 강제한다.
      row.getCell(4).numFmt = "@";
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(
      new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `추첨탈락자_${year}Q${quarter}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-1 flex-col min-w-0 overflow-auto">
      <div className="p-4 pb-0">
        <h2 className="text-base font-bold">추첨 탈락자</h2>
        <p className="text-sm text-muted-foreground">
          추첨에서 탈락한 직원 목록입니다. 이 직원들만 추가 신청 기간에 다시
          신청할 수 있으므로, 아래 연락처로 안내하세요.
        </p>
      </div>

      <div className="flex items-center gap-2 p-3 flex-wrap">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map(
            (y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            )
          )}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          {QUARTERS.map((q) => (
            <option key={q.value} value={q.value}>
              {q.label}
            </option>
          ))}
        </select>
        <Input
          type="text"
          placeholder="이름/사번 검색"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="w-40"
        />
        <div className="flex items-center rounded-md border p-0.5">
          {POSITIONS.map((p) => (
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
        <Button size="sm" onClick={fetchData} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "조회"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={copyAllPhones}
          disabled={filtered.length === 0}
        >
          <Copy className="h-4 w-4" /> 전체 번호 복사
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            exportExcel().catch((err) =>
              setError(err instanceof Error ? err.message : "엑셀 생성 실패")
            );
          }}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" /> Excel 다운로드
        </Button>
        {/* 필터와 무관하게 분기 전체를 지우므로 활성 조건도 rows(필터 전) 기준. */}
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setPurgeOpen(true)}
          disabled={isLoading || rows.length === 0}
          title="이 분기의 탈락 기록을 모두 삭제합니다"
        >
          <Trash2 className="h-4 w-4" /> 분기 전체 삭제
        </Button>
      </div>

      <div className="px-3 pb-2 text-sm text-muted-foreground">
        <Users className="inline h-4 w-4 mr-1 -mt-0.5" />
        탈락 직원{" "}
        <span className="font-semibold text-foreground">
          {filtered.length}명
        </span>
        {" · "}탈락 신청{" "}
        <span className="font-semibold text-foreground">
          {totalLostEntries}건
        </span>
        {missingPhoneCount > 0 && (
          <>
            {" · "}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              전화번호 미등록 {missingPhoneCount}명
            </span>
          </>
        )}
      </div>

      {error && (
        <p className="text-destructive text-sm font-medium px-4 pb-2">
          {error}
        </p>
      )}
      {done && (
        <p className="text-sm font-medium text-green-600 dark:text-green-400 px-4 pb-2">
          {done}
        </p>
      )}

      <div className="flex-1 px-3 pb-6">
        <div className="border rounded-md divide-y">
          {isLoading && (
            <p className="text-muted-foreground text-sm text-center py-8">
              불러오는 중...
            </p>
          )}
          {!isLoading && filtered.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-8">
              해당 분기에 추첨 탈락자가 없습니다.
            </p>
          )}
          {!isLoading &&
            filtered.map((row) => {
              const dialable = row.phone_number
                ? toDialable(row.phone_number)
                : null;
              return (
                <div
                  key={row.staff_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 flex-wrap"
                >
                  <div className="min-w-0 flex flex-col gap-1">
                    <span className="text-sm">
                      <span className="font-semibold">{row.staff_name}</span>
                      {row.staff_position && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({row.staff_position})
                        </span>
                      )}
                      {row.employee_number && (
                        <span className="text-muted-foreground text-xs">
                          {" "}
                          · {row.employee_number}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1 flex-wrap">
                      {row.dates.map((d) => (
                        <span
                          key={`${d.target_date}-${d.record_type}`}
                          className="text-xs rounded px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300"
                        >
                          {shortDateLabel(d.target_date)} {d.record_type}
                        </span>
                      ))}
                    </span>
                  </div>

                  {dialable ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-sm tabular-nums text-muted-foreground mr-1 hidden sm:inline">
                        {row.phone_number}
                      </span>
                      <Button
                        asChild
                        size="icon-sm"
                        variant="outline"
                        title={`${row.staff_name}님에게 전화`}
                      >
                        <a href={`tel:${dialable}`}>
                          <Phone className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        asChild
                        size="icon-sm"
                        variant="outline"
                        title={`${row.staff_name}님에게 문자`}
                      >
                        <a href={`sms:${dialable}`}>
                          <MessageSquare className="h-4 w-4" />
                        </a>
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        title="번호 복사"
                        onClick={() =>
                          copyText(
                            dialable,
                            `${row.staff_name}님의 번호를 복사했습니다.`
                          )
                        }
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground shrink-0">
                      번호 미등록
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <Dialog
        open={purgeOpen}
        onOpenChange={(open) => !purgeBusy && setPurgeOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>분기 탈락 기록 전체 삭제</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">
                {year}년 {quarter}분기
              </span>
              의 추첨 탈락 기록{" "}
              <span className="font-semibold text-foreground">
                {rows.reduce((sum, r) => sum + r.dates.length, 0)}건
              </span>
              ({rows.length}명)을 삭제합니다. 화면의 이름·직책 필터와 무관하게
              이 분기 전체가 대상이며, <b>되돌릴 수 없습니다.</b>
            </DialogDescription>
          </DialogHeader>

          <div className="rounded border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            삭제해도 분기 휴무 합계(24)는 달라지지 않습니다 — 탈락 건은 원래
            지근/지휴 집계에서 빠져 있기 때문입니다. 다만 이 분기의{" "}
            <b>탈락 기록과 추가 신청 자격 판정 근거</b>가 사라지므로, 아직
            추가 신청을 진행 중인 분기라면 지우지 마세요.
          </div>

          <p className="text-xs text-amber-700 dark:text-amber-300">
            먼저 <b>Excel 다운로드</b>로 목록을 받아두시길 권합니다 — 삭제 후에는
            복구할 방법이 없습니다.
          </p>

          {isCurrentOrFutureQuarter && (
            <p className="rounded border border-destructive/50 px-3 py-2 text-xs font-medium text-destructive">
              이 분기는 아직 진행 중이거나 미래 분기입니다. 지나간 분기를
              정리하려던 것이 맞는지 확인해 주세요.
            </p>
          )}

          {error && (
            <p className="text-destructive text-sm font-medium">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              onClick={() => setPurgeOpen(false)}
              disabled={purgeBusy}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={purgeQuarter}
              disabled={purgeBusy}
            >
              {purgeBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "삭제"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
