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

// 앱 설정 집합: 지근 정원 + 신청 마감일 + 운휴 번호 + 지정근무 번호 + 연휴 근무 치환.
// requestFreezeDate 가 'YYYY-MM-DD' 이고 오늘이 그 이후이면 사용자 신청·삭제 차단.
// weekendHolidayTurns 는 주말/공휴일에 운휴로 집계되는 근무번호 목록(승무소별 상이).
// jigeunTurns 는 요일/공휴일과 무관하게 지근으로 표시되는 주간/야간 근무번호 목록.
// holidayTurnRules 는 연속 이틀이 모두 휴일일 때 표시만 바꾸는 근무번호 짝 규칙.
// officeName 은 이 배포가 담당하는 승무소명(교번 목록 접두사 필터).
// extraRequest* 는 1차 마감 후 열리는 2차 신청 기간(추가 신청일) 설정 —
// 지정 분기 합계가 24 가 아닌 직원에게만 '등록' 이 다시 열린다(삭제는 불가).
export interface AppSettings {
  caps: JigeunCaps;
  requestFreezeDate: string | null;
  weekendHolidayTurns: string[];
  jigeunTurns: JigeunTurnSettings;
  holidayTurnRules: HolidayTurnRule[];
  officeName: string;
  extraRequestDeadline: string | null;
  extraRequestYear: number | null;
  extraRequestQuarter: number | null;
}

// 사용자의 지근/지휴 신청 가능 단계.
//  - open   : 1차 마감 전(또는 마감 미설정). 등록·삭제 모두 허용.
//  - extra  : 1차 마감 후 추가 신청일 이내 && 본인이 그 분기 추첨에서 탈락
//             (lottery_status='lost')한 건이 있음. 등록·삭제 모두 허용 —
//             떨어진 자리를 다른 날로 다시 잡으려면 삭제도 필요하기 때문.
//  - closed : 그 외 전부 차단.
export type RequestPhase = "open" | "extra" | "closed";

// 승무소명. 교번(work_patterns) 이름의 접두사로 쓰여 이 승무소 교번만
// 목록에 보이게 거른다. 빈 문자열이면 필터를 걸지 않고 전체를 보여준다 —
// 승무소별 Supabase 프로젝트가 분리되어 한 DB 에 한 승무소 교번만 있는
// 정상 구조에서는 비워두는 것이 맞다(migrations.sql 섹션 20 참고).
export const DEFAULT_OFFICE_NAME = "";

export const DEFAULT_WEEKEND_HOLIDAY_TURNS: string[] = [
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
];

// 지정근무(지근) 번호 설정. 요일/공휴일과 무관하게 지근으로 표시되며,
// 주간은 '지(주)', 야간은 '지(야)' 배지로 구분한다. 배경색은 둘 다 하늘색.
export type JigeunKind = "day" | "night";

export interface JigeunTurnSettings {
  dayTurns: string[];
  nightTurns: string[];
}

export const DEFAULT_JIGEUN_TURNS: JigeunTurnSettings = {
  dayTurns: [],
  nightTurns: [],
};

// 근무번호가 지정근무인지, 주간인지 야간인지 판정. 아니면 null.
// 주간/야간에 같은 번호가 중복 저장되면 주간이 이긴다
// (정상 경로에서는 validateJigeunTurns 가 저장 시점에 차단한다).
export function getJigeunKind(
  turn: string,
  s: JigeunTurnSettings
): JigeunKind | null {
  if (s.dayTurns.includes(turn)) return "day";
  if (s.nightTurns.includes(turn)) return "night";
  return null;
}

export function isJigeunTurn(turn: string, s: JigeunTurnSettings): boolean {
  return getJigeunKind(turn, s) !== null;
}

// 화면·엑셀 공통 배지 텍스트.
// 주의: 'night' 의 반환값은 requests-panel.tsx 의 DESIGNATED_NIGHT_TURN
// ('지(야)') 과 의도적으로 같은 문자열이다 — 연휴 치환 경로와 지정근무 번호
// 경로가 같은 라벨로 수렴해야 사용자에게 하나의 개념으로 보인다.
export function getJigeunBadgeLabel(kind: JigeunKind): string {
  return kind === "day" ? "지(주)" : "지(야)";
}

// 같은 근무번호가 주간·야간에 동시에 들어가면 판정이 모호해지므로 저장 시 차단.
export function validateJigeunTurns(
  dayTurns: string[],
  nightTurns: string[]
): string | null {
  const dup = dayTurns.filter((t) => nightTurns.includes(t));
  if (dup.length > 0) {
    return `주간과 야간에 중복된 근무번호가 있습니다: ${dup.join(", ")}`;
  }
  return null;
}

// 연휴에 걸린 연속 근무를 다른 코드로 '표시만' 바꾸는 규칙.
// from/to 는 길이가 같은 배열이며 2개 이상이면 된다(2일 짝, 3일 짝, …).
// 예: ('58','58~') → ('휴73','휴74')
//     ('61','61~','휴14') → ('휴79','지(야)','지(야)~')
//
// 휴일 조건: 연휴 판정은 '앞 2일'만 본다. 즉 N일·N+1일이 모두 토/일/공휴일이면
// 짝이 성립하고, 3일째부터는 휴일 여부와 무관하게 함께 치환된다
// (연휴 다음 근무일까지 이어지는 근무를 표현하기 위함).
// 표시 전용이며 통계(휴무/운휴/총휴/분기밸런스)는 항상 원래 turn 을 사용한다.
export interface HolidayTurnRule {
  from: string[]; // N일부터 연속된 원래 근무번호
  to: string[]; // 같은 순서의 표시 근무번호 (from 과 길이 동일)
}

// 연휴 판정에 요구되는 최소 연속 휴일 수. 3일 이상 짝이어도 앞 2일만 본다.
export const HOLIDAY_PAIR_REQUIRED_DAYS = 2;

export const DEFAULT_HOLIDAY_TURN_RULES: HolidayTurnRule[] = [];

// '58,58~:휴73,휴74;61,61~,휴14:휴79,지(야),지(야)~' ↔ HolidayTurnRule[]
// 각 그룹은 '원래들:표시들' 이고 양쪽 개수가 같아야 하며 2개 이상이어야 한다.
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
    if (from.length !== to.length) continue;
    if (from.length < HOLIDAY_PAIR_REQUIRED_DAYS) continue;
    if (from.some((t) => !t) || to.some((t) => !t)) continue;
    rules.push({ from, to });
  }
  return rules;
}

export function formatHolidayTurnRulesText(rules: HolidayTurnRule[]): string {
  return rules.map((r) => `${r.from.join(",")}:${r.to.join(",")}`).join(";");
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
    return "형식이 올바르지 않습니다. 원래/표시 근무번호 개수가 같아야 하며 2개 이상이어야 합니다. 예: 58,58~:휴73,휴74;61,61~,휴14:휴79,지(야),지(야)~";
  }
  const seen = new Set<string>();
  for (const r of parsed) {
    const key = r.from.join("|");
    if (seen.has(key)) return `중복된 짝이 있습니다: ${r.from.join(",")}`;
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
