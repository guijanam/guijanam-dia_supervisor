"use client";

// 마감 후 자동 추첨 트리거.
//
// 이 앱에는 서버가 없어서(API 라우트·service_role 키 없음) 시각을 지켜보는
// 스케줄러를 둘 수 없다. 대신 관리자가 대시보드를 연 시점에 조건을 확인하고
// 1회 실행한다. 사용자 신청은 마감일에 이미 차단되므로 실무상 공백은 없다.
//
// 실행 조건 (하나라도 어긋나면 아무 일도 하지 않는다):
//   - auto_lottery_enabled = true      (관리자가 켰는가)
//   - request_freeze_date 가 지났는가
//   - auto_lottery_done_for !== request_freeze_date  (이번 마감분을 이미 돌렸는가)
//   - 대상 분기(extra_request_year/quarter)가 지정되어 있는가
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { runAutoLottery, type AutoLotteryResult } from "@/lib/auto-lottery";
import { format } from "date-fns";
import { Loader2, Shuffle, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  enabled: boolean;
  freezeDate: string | null;
  doneFor: string | null;
  targetYear: number | null;
  targetQuarter: number | null;
  extraDeadline: string | null;
  adminStaffId: number;
  /** 실행이 끝난 뒤 설정을 다시 읽게 한다(done_for 갱신 반영). */
  onFinished: () => void;
}

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: AutoLotteryResult; year: number; quarter: number }
  | { kind: "error"; message: string }
  | { kind: "no-quarter" };

export function AutoLotteryRunner({
  enabled,
  freezeDate,
  doneFor,
  targetYear,
  targetQuarter,
  extraDeadline,
  adminStaffId,
  onFinished,
}: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  // 마운트당 1회 보장 (React StrictMode 의 이중 마운트 대비).
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!enabled || !freezeDate) return;

    const today = format(new Date(), "yyyy-MM-dd");
    if (today <= freezeDate) return; // 아직 마감 전
    if (doneFor === freezeDate) return; // 이번 마감분은 이미 처리됨

    // 대상 분기는 추측하지 않는다. 마감일은 관행상 대상 분기보다 한두 달
    // 앞서 잡히므로 날짜에서 분기를 계산하면 반드시 틀린다.
    if (targetYear == null || targetQuarter == null) {
      startedRef.current = true;
      setState({ kind: "no-quarter" });
      return;
    }

    startedRef.current = true;
    setState({ kind: "running" });

    (async () => {
      try {
        const result = await runAutoLottery({
          year: targetYear,
          quarter: targetQuarter,
          adminStaffId,
          extraDeadline,
        });

        // 추첨과 문서 게시가 모두 성공한 뒤에만 완료로 표시한다.
        // 중간에 실패하면 done_for 를 남기지 않아 다음 접속에 재시도되는데,
        // 이미 추첨된 조합은 대상에서 빠지므로 재추첨 없이 문서 게시만
        // 다시 시도된다.
        const { error: upErr } = await supabase
          .from("app_settings")
          .update({
            auto_lottery_done_for: freezeDate,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
        if (upErr) throw upErr;

        setState({
          kind: "done",
          result,
          year: targetYear,
          quarter: targetQuarter,
        });
        onFinished();
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "자동 추첨 실패",
        });
      }
    })();
    // 설정이 로딩되면서 값이 채워질 수 있으므로 의존성에 둔다.
    // 실제 중복 실행은 startedRef 가 막는다.
  }, [
    enabled,
    freezeDate,
    doneFor,
    targetYear,
    targetQuarter,
    extraDeadline,
    adminStaffId,
    onFinished,
  ]);

  if (state.kind === "idle") return null;

  if (state.kind === "running") {
    return (
      <Banner tone="info">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span>마감일이 지나 지근 추첨을 자동 실행하고 있습니다…</span>
      </Banner>
    );
  }

  if (state.kind === "no-quarter") {
    return (
      <Banner tone="warn">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          마감일이 지났지만 <b>대상 분기가 지정되지 않아</b> 자동 추첨을
          건너뛰었습니다. 설정에서 대상 분기(년·분기)를 지정한 뒤 새로고침하세요.
        </span>
      </Banner>
    );
  }

  if (state.kind === "error") {
    return (
      <Banner tone="error">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          자동 추첨 실패: {state.message} — <b>일부만 반영되었을 수 있습니다.</b>{" "}
          관리자 달력에서 날짜별로 확인한 뒤 필요하면 개별 재추첨하세요. 완료로
          기록하지 않았으므로 새로고침하면 다시 시도합니다.
        </span>
      </Banner>
    );
  }

  const { result, year, quarter } = state;
  if (result.skippedNothingToDo) {
    return (
      <Banner tone="info">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          {year}년 {quarter}분기에 추첨할 정원 초과 건이 없어 자동 추첨을
          마쳤습니다.
        </span>
      </Banner>
    );
  }

  return (
    <Banner tone="ok">
      <Shuffle className="h-4 w-4 shrink-0" />
      <span>
        {year}년 {quarter}분기 자동 추첨 완료 — {result.targetCount}건 추첨 · 당첨{" "}
        {result.wonCount}명 · 탈락 {result.lostCount}명. 결과를 <b>문서</b>로
        게시했습니다. (같은 내용의 문서가 이미 있으면 문서 관리에서 삭제하세요.)
      </span>
    </Banner>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "info" | "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const toneClass = {
    info: "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-900",
    ok: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900",
    warn: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900",
    error:
      "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900",
  }[tone];

  return (
    <div
      className={`flex items-start gap-2 border-b px-3 py-2 text-xs ${toneClass}`}
    >
      {children}
    </div>
  );
}
