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
  // 기기 식별값(check_device_vip RPC 에서 VIP 여부 판별에 사용). unique, NULL 허용.
  device_id: string | null;
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
    "staff_name" | "employee_number" | "staff_position" | "phone_number"
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

// 앱 설정 집합: 지근 정원 + 신청 마감일 + 운휴 번호 + 지근 번호 + 연휴 근무 치환.
// requestFreezeDate 가 'YYYY-MM-DD' 이고 오늘이 그 이후이면 사용자 신청·삭제 차단.
// weekendHolidayTurns 는 주말/공휴일에 운휴로 집계되는 근무번호 목록(승무소별 상이).
// jigeunNumberTurns 는 요일/공휴일과 무관하게 지근으로 표시되는 근무번호 목록.
// holidayTurnRules 는 연속 이틀이 모두 휴일일 때 표시만 바꾸는 근무번호 짝 규칙.
export interface AppSettings {
  caps: JigeunCaps;
  requestFreezeDate: string | null;
  weekendHolidayTurns: string[];
  jigeunNumberTurns: string[];
  holidayTurnRules: HolidayTurnRule[];
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

export const DEFAULT_JIGEUN_NUMBER_TURNS: string[] = [];

// 연휴(토/일/공휴일) 이틀 연속일 때만 치환되는 근무번호 짝.
// 예: ('58','58~') 가 연속 이틀 모두 휴일이면 그 이틀을 ('휴73','휴74') 로 표시.
// 표시 전용이며 통계(휴무/운휴/총휴/분기밸런스)는 항상 원래 turn 을 사용한다.
export interface HolidayTurnRule {
  fromA: string; // N일 원래 근무번호
  fromB: string; // N+1일 원래 근무번호
  toA: string; // N일 표시 근무번호
  toB: string; // N+1일 표시 근무번호
}

export const DEFAULT_HOLIDAY_TURN_RULES: HolidayTurnRule[] = [];

// '58,58~:휴73,휴74;62,62~:휴75,휴76' ↔ HolidayTurnRule[]
// 형식이 깨진 그룹은 조용히 버린다(전체 실패 금지 — 잘못 저장된 설정 하나가
// 전 직원 근무표를 못 그리게 만들면 안 됨). 저장 시점 검증은 validate 쪽에서.
export function parseHolidayTurnRulesText(
  raw: string | null | undefined
): HolidayTurnRule[] {
  if (!raw) return [];
  const rules: HolidayTurnRule[] = [];
  for (const group of raw.split(";")) {
    const g = group.trim();
    if (!g) continue;
    const parts = g.split(":");
    if (parts.length !== 2) continue;
    const from = parts[0].split(",").map((t) => t.trim());
    const to = parts[1].split(",").map((t) => t.trim());
    if (from.length !== 2 || to.length !== 2) continue;
    if (from.some((t) => !t) || to.some((t) => !t)) continue;
    rules.push({ fromA: from[0], fromB: from[1], toA: to[0], toB: to[1] });
  }
  return rules;
}

export function formatHolidayTurnRulesText(rules: HolidayTurnRule[]): string {
  return rules.map((r) => `${r.fromA},${r.fromB}:${r.toA},${r.toB}`).join(";");
}

// 관리자 저장 시 보여줄 검증 메시지. null 이면 통과.
// parse 가 버린 그룹 수를 세어 조용한 데이터 손실을 알린다.
export function validateHolidayTurnRulesText(raw: string): string | null {
  const groups = raw
    .split(";")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
  const parsed = parseHolidayTurnRulesText(raw);
  if (groups.length !== parsed.length) {
    return "형식이 올바르지 않습니다. 예: 58,58~:휴73,휴74;62,62~:휴75,휴76";
  }
  const seen = new Set<string>();
  for (const r of parsed) {
    const key = `${r.fromA}|${r.fromB}`;
    if (seen.has(key)) return `중복된 짝이 있습니다: ${r.fromA},${r.fromB}`;
    seen.add(key);
  }
  return null;
}

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

// 문서: 관리자가 업로드, 직원이 열람 후 확인(서명).
// file_url/file_name 은 Supabase Storage 'documents' 버킷 첨부(없으면 null).
export interface Document {
  id: string;
  title: string;
  description: string | null;
  file_url: string | null;
  file_name: string | null;
  is_required: boolean;
  expires_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

// 문서 열람 확인 기록: 직원 본인의 staff_id 로만 생성(대리확인 불가).
export interface DocumentRead {
  id: string;
  document_id: string;
  staff_id: number;
  confirmed_at: string;
}

// 관리자 확인자 명단 화면: document_reads 와 coworker_list 를 join 한 결과
export interface DocumentReadWithEmployee extends DocumentRead {
  employee: Pick<Employee, "staff_name" | "staff_position"> | null;
}

// 문서 투표 선택지: 선택지가 1개 이상 있으면 그 문서는 '투표 문서'.
export interface DocumentOption {
  id: string;
  document_id: string;
  label: string;
  sort_order: number;
  created_at: string;
}

// 직원 투표 기록: 1인 1표(단일 선택), 마감 전까지 option_id 변경 가능.
export interface DocumentVote {
  id: string;
  document_id: string;
  option_id: string;
  staff_id: number;
  voted_at: string;
}

// 관리자 투표 집계 화면: 투표 + 직원 정보 결합
export interface DocumentVoteWithEmployee extends DocumentVote {
  employee: Pick<Employee, "staff_name" | "staff_position"> | null;
}

// 교번(근무순서) 패턴. work_patterns 테이블.
// shift_types 는 순서가 의미를 갖는 배열이다: get_schedule_by_range RPC 가
// 직원의 기준 근무번호(reference_shift)가 이 배열의 어느 인덱스인지 찾아,
// 하루에 한 칸씩 전진하며 순환시켜 근무표를 만든다.
// → 원소 삽입/삭제/이동은 이 교번을 쓰는 전 직원의 근무표를 밀어버린다.
export interface WorkPattern {
  id: string;
  pattern_name: string;
  shift_types: string[];
  created_at: string;
}
