// 추첨 탈락 표시(lottery_status='lost') 를 지우는 작업에 대한 경고.
//
// [왜 필요한가]
// 추가 신청 기간(app_settings.extra_request_*)은 "그 분기에 탈락 건을 가진
// 직원" 에게만 열린다. 판정 근거가 lottery_status='lost' 하나뿐이라,
// 관리자가 탈락 건을 삭제하거나 다른 날짜로 옮기면(이때 lottery_status 가
// NULL 로 초기화된다) 그 직원은 조용히 추가 신청 대상에서 빠진다.
// 화면에는 아무 표시도 나지 않아 나중에 원인을 찾기 어렵다.
//
// 그래서 '탈락 건' 을 건드릴 때만 확인창에 한 줄을 덧붙인다. 모든 삭제에
// 붙이면 관리자가 문구를 읽지 않고 넘기게 되므로 대상을 좁힌다.

/** 탈락 건인지. lottery_status 가 'lost' 일 때만 참. */
export function isLostEntry(
  entry: { lottery_status?: string | null } | null | undefined
): boolean {
  return entry?.lottery_status === "lost";
}

/**
 * 확인창 문구에 덧붙일 경고. 탈락 건이 아니면 빈 문자열.
 *
 * @param action 이 작업이 탈락 표시에 하는 일 (예: "삭제하면", "옮기면")
 */
export function lostWarningSuffix(
  entry: { lottery_status?: string | null } | null | undefined,
  action: string
): string {
  if (!isLostEntry(entry)) return "";
  return (
    `\n\n⚠ 이 건은 추첨 탈락(lost) 상태입니다.\n` +
    `${action} 탈락 표시가 사라져, 이 직원은 추가 신청 기간에\n` +
    `신청 대상에서 빠집니다. 추가 신청을 열어 둘 계획이면 그대로 두세요.`
  );
}

/** 여러 건을 한 번에 지울 때(월 전체 삭제 등) 쓰는 경고. */
export function lostBulkWarning(lostCount: number): string {
  if (lostCount <= 0) return "";
  return (
    `\n\n⚠ 이 범위에 추첨 탈락(lost) 건이 ${lostCount}건 있습니다.\n` +
    `삭제하면 해당 직원들이 추가 신청 기간의 대상에서 빠집니다.`
  );
}
