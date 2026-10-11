import type { RecordType, RequestSource } from "@/lib/types";

// 화면용 메타데이터이며 관리자 권한 판단에는 사용하지 않는다.
export function getRequestBadgeClass(entry: {
  record_type: RecordType;
  staff_position: string;
  request_source?: RequestSource | null;
}): string {
  if (entry.record_type === "지휴") return "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  if (entry.request_source === "admin") return "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200";
  return entry.staff_position === "차장"
    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
    : "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300";
}

// 미적용 DB는 기존 등록 기능을 유지한다. 출처 컬럼 누락이 명확할 때만
// 필드를 제외하고 한 번 재시도하며 권한/중복/네트워크 오류는 그대로 반환한다.
export async function writeWithRequestSource<T extends object, R extends {
  error: { code?: string; message?: string } | null;
}>(write: (payload: T & { request_source?: RequestSource }) => PromiseLike<R>, payload: T, source: RequestSource) {
  const result = await write({ ...payload, request_source: source });
  const missingColumn = result.error &&
    (result.error.code === "PGRST204" || result.error.code === "42703") &&
    /request_source/.test(result.error.message ?? "") &&
    /column/i.test(result.error.message ?? "");
  if (missingColumn) {
    return { ...await write(payload), sourceTracked: false };
  }
  return { ...result, sourceTracked: !result.error };
}
