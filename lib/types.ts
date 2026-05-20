export interface ScheduleRecord {
  staff_id: number;
  name: string;
  staff_position: string;
  pattern_name: string;
  date: string;
  turn: string;
  phone_number: string;
}

export type PositionTab = "기관사" | "차장";

export type UserRole = "user" | "admin";

export type RecordType = "지근" | "지휴";

export type LotteryStatus = "won" | "lost";

// 직원 마스터: 기존 coworker_list 테이블을 재활용
export interface Employee {
  staff_id: number;
  staff_name: string;
  staff_position: string;
  employee_number: string | null;
  phone_number: string | null;
  role: UserRole;
  // 근무순서 RPC 계산의 기준점(앵커). 잘못되면 본인 근무표 전체가 어긋남.
  reference_date: string | null;
  reference_shift: string | null;
}

export interface SpecialSchedule {
  id: string;
  staff_id: number;
  target_date: string;
  record_type: RecordType;
  lottery_status?: LotteryStatus | null;
  lottery_at?: string | null;
  created_at?: string;
}

// 관리자 대시보드에서 coworker_list 와 join 한 결과
export interface SpecialScheduleWithEmployee extends SpecialSchedule {
  employee: Pick<
    Employee,
    "staff_name" | "employee_number" | "staff_position"
  > | null;
}

// 앱 설정: 요일/공휴일 구분별 지근 정원 (직책 공통, 단일 행 id=1)
export interface JigeunCaps {
  weekday: number;
  saturday: number;
  sunday: number;
  holiday: number;
}

export const DEFAULT_JIGEUN_CAPS: JigeunCaps = {
  weekday: 4,
  saturday: 2,
  sunday: 4,
  holiday: 4,
};

// 앱 설정 집합: 지근 정원 + 신청 마감일 + 운휴 번호.
// requestFreezeDate 가 'YYYY-MM-DD' 이고 오늘이 그 이후이면 사용자 신청·삭제 차단.
// weekendHolidayTurns 는 주말/공휴일에 운휴로 집계되는 근무번호 목록(승무소별 상이).
export interface AppSettings {
  caps: JigeunCaps;
  requestFreezeDate: string | null;
  weekendHolidayTurns: string[];
}

export const DEFAULT_WEEKEND_HOLIDAY_TURNS: string[] = [
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
];

// 쉼표 텍스트('31,32,33') ↔ 배열 변환 유틸. 공백/빈 토큰은 제거.
export function parseTurnsText(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function formatTurnsText(turns: string[]): string {
  return turns.join(",");
}

// 공지사항: 관리자가 작성, 일반 직원은 읽기 전용
export interface Announcement {
  id: string;
  title: string;
  content: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}
