"use client";

// 실행은 Supabase Cron이 담당한다. 이 컴포넌트는 저장된 상태만 표시한다.
// 관리자 접속·설정 저장·새로고침으로 추첨을 시작하지 않는다.
import { AlertTriangle, CheckCircle2, Clock3 } from "lucide-react";

interface Props {
  enabled: boolean;
  freezeDate: string | null;
  doneFor: string | null;
  targetYear: number | null;
  targetQuarter: number | null;
}

export function AutoLotteryStatus({
  enabled,
  freezeDate,
  doneFor,
  targetYear,
  targetQuarter,
}: Props) {
  if (!enabled || !freezeDate) return null;
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());

  if (doneFor === freezeDate) {
    return (
      <div className="flex items-start gap-2 border-b px-3 py-2 text-xs bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>
          마감일({freezeDate})의 자동 추첨이 완료 처리되었습니다. 결과 문서는
          문서 메뉴에서 확인하세요.
        </span>
      </div>
    );
  }

  if (targetYear == null || targetQuarter == null) {
    return (
      <div className="flex items-start gap-2 border-b px-3 py-2 text-xs bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>자동 추첨 대상 분기(년·분기)를 설정하고 저장하세요.</span>
      </div>
    );
  }

  if (today <= freezeDate) return null;
  return (
    <div className="flex items-start gap-2 border-b px-3 py-2 text-xs bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
      <Clock3 className="h-4 w-4 shrink-0" />
      <span>
        {targetYear}년 {targetQuarter}분기 자동 추첨 처리 대기 중입니다. 서버가
        매분 추첨 및 문서 게시를 확인합니다. 신청현황을 새로고침하면 완료 상태를
        확인할 수 있습니다.
      </span>
    </div>
  );
}
