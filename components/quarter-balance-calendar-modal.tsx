"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminEmployeeCalendarView } from "@/components/admin-employee-calendar-view";
import { QUARTERS } from "@/components/quarter-balance";
import { cn } from "@/lib/utils";

interface QuarterBalanceCalendarModalProps {
  staff: {
    staff_id: number;
    staff_name: string;
    staff_position: string;
    employee_number: string | null;
  } | null;
  year: number;
  quarter: number; // 1..4
  onClose: () => void;
  // 지근/지휴가 변경된 채로 모달이 닫혔을 때만 호출된다.
  // 분기 조회는 무거우므로(월 3회 RPC) 변경이 있을 때 닫으면서 한 번만 재조회한다.
  onChanged?: () => void;
}

// 분기 첫 달부터 3개월치 "yyyy-MM" 배열.
function quarterMonthValues(year: number, quarter: number): string[] {
  const q = QUARTERS.find((x) => x.value === quarter) ?? QUARTERS[0];
  return [0, 1, 2].map((offset) => {
    const d = new Date(year, q.startMonth - 1 + offset, 1);
    // 분기는 연 경계를 넘지 않으므로 year 는 그대로지만, Date 로 계산해 두면 안전하다.
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// 분기 휴무 검증 목록에서 직원 행을 클릭했을 때 뜨는 캘린더 팝업.
// 내 캘린더와 동일한 화면·기능을 제공하되, 이동 범위는 해당 분기 3개월로 제한한다.
export function QuarterBalanceCalendarModal({
  staff,
  year,
  quarter,
  onClose,
  onChanged,
}: QuarterBalanceCalendarModalProps) {
  return (
    <Dialog
      open={!!staff}
      onOpenChange={(open) => {
        // 목록 재조회는 ModalBody 의 언마운트 cleanup 이 담당한다.
        // 여기서는 팝업을 닫기만 하면 된다.
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        {staff && (
          // key 로 직원·분기가 바뀔 때 통째로 remount 시킨다. 그래야 선택 월과
          // 변경 플래그가 effect 없이 초기화된다.
          <ModalBody
            key={`${staff.staff_id}-${year}-${quarter}`}
            staff={staff}
            year={year}
            quarter={quarter}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModalBody({
  staff,
  year,
  quarter,
  onChanged,
}: {
  staff: NonNullable<QuarterBalanceCalendarModalProps["staff"]>;
  year: number;
  quarter: number;
  onChanged?: () => void;
}) {
  const months = useMemo(
    () => quarterMonthValues(year, quarter),
    [year, quarter]
  );
  const [monthValue, setMonthValue] = useState(months[0]);
  // 팝업 안에서 지근/지휴가 바뀌었는지. 닫을 때 목록 재조회 여부를 결정한다.
  // state 가 아니라 ref 인 이유: 이 값이 바뀐다고 다시 그릴 필요가 없고,
  // 언마운트 cleanup 에서 최신 값을 읽어야 하기 때문.
  const isDirtyRef = useRef(false);
  // onChanged 도 ref 로 잡아둬야 cleanup 이 매번 재등록되지 않는다.
  // 렌더 중 ref 를 건드리면 안 되므로 동기화는 effect 안에서 한다.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  // 변경이 있었을 때만 목록을 재조회한다. 언마운트 시점에 호출해야
  // Dialog 의 어떤 닫기 경로(X·ESC·바깥 클릭)에서도 누락되지 않는다.
  useEffect(() => {
    return () => {
      if (isDirtyRef.current) onChangedRef.current?.();
    };
  }, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {staff.staff_name} ({staff.staff_position})
        </DialogTitle>
        <DialogDescription>
          사번 {staff.employee_number ?? "-"} · {year}년 {quarter}분기 · 날짜를
          누르면 지근/지휴를 등록·삭제할 수 있습니다. (신청 마감일 무시)
        </DialogDescription>
      </DialogHeader>

      <div className="flex border-b">
        {months.map((m) => (
          <button
            key={m}
            type="button"
            className={cn(
              "flex-1 py-2 font-bold text-sm transition-colors",
              monthValue === m
                ? "border-b-2 border-primary bg-accent"
                : "text-muted-foreground"
            )}
            onClick={() => setMonthValue(m)}
          >
            {Number(m.slice(5, 7))}월
          </button>
        ))}
      </div>

      <AdminEmployeeCalendarView
        staff={staff}
        monthValue={monthValue}
        showAdminNotice={false}
        onDataChanged={() => {
          isDirtyRef.current = true;
        }}
      />
    </>
  );
}
