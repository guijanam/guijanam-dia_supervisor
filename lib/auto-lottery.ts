// 지근 추첨 공용 로직.
//
// 추첨 알고리즘(drawIds)과 정원 초과 대상 수집(collectBulkTargets)은 원래
// admin-calendar.tsx 의 모듈 비공개 함수였다. 마감 후 자동 추첨(runAutoLottery)이
// 같은 규칙을 써야 하므로 여기로 옮겨 공유한다 — 두 벌로 두면 정원 판정이나
// '이미 추첨한 조합 제외' 규칙이 어긋나는 순간 결과가 갈린다.
//
// 관리자 화면의 개별/월 일괄 추첨은 종전과 동일하게 동작한다(로직을 옮겼을 뿐).
import { supabase } from "@/lib/supabase";
import { quarterRange } from "@/lib/quarter";
import { getPositionCap, countJigeunSlots } from "@/lib/schedule-utils";
import type { RecordType, LotteryStatus, JigeunCaps } from "@/lib/types";
import { DEFAULT_JIGEUN_CAPS } from "@/lib/types";
import { format } from "date-fns";

export const POSITIONS = ["기관사", "차장"] as const;
export type Position = (typeof POSITIONS)[number];

// 추첨 대상이 되기 위해 필요한 최소 정보. admin-calendar 의 SpecialEntry 는
// 화면용 필드(regularTurn 등)를 더 갖지만 구조적으로 이 타입을 만족한다.
export interface LotteryPoolEntry {
  id: string;
  staff_id: number;
  staff_position: string;
  record_type: RecordType;
  lottery_status: LotteryStatus | null;
}

// 추첨 한 건의 단위 = (날짜 × 직책). 정원은 직책별로 따로 적용된다.
export interface BulkTarget<T extends LotteryPoolEntry = LotteryPoolEntry> {
  date: string;
  pos: Position;
  cap: number;
  pool: T[]; // 그 날 그 직책의 지근 신청 전체
}

/**
 * pool 에서 cap 명을 무작위로 당첨시키고 나머지를 탈락으로 가른다 (Fisher-Yates).
 * 개별 추첨·월 일괄 추첨·자동 추첨이 이 하나를 공유한다.
 */
export function drawIds<T extends { id: string }>(
  pool: T[],
  cap: number
): { wonIds: string[]; lostIds: string[] } {
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const winners = new Set(shuffled.slice(0, cap).map((e) => e.id));
  return {
    wonIds: pool.filter((e) => winners.has(e.id)).map((e) => e.id),
    lostIds: pool.filter((e) => !winners.has(e.id)).map((e) => e.id),
  };
}

/**
 * '아직 추첨하지 않은' 정원 초과 (날짜 × 직책) 목록.
 *
 * 추첨 흔적(lottery_status)이 하나라도 있는 조합은 제외한다 — 일괄/자동 실행으로
 * 기존 당첨자가 뒤집히는 사고를 막기 위해서다. 재추첨이 필요하면 관리자 달력의
 * 개별 '재추첨' 버튼을 쓴다.
 */
export function collectBulkTargets<T extends LotteryPoolEntry>(
  entriesByDate: Map<string, T[]>,
  holidays: Set<string>,
  caps: JigeunCaps
): Array<BulkTarget<T>> {
  const list: Array<BulkTarget<T>> = [];
  for (const [date, entries] of entriesByDate) {
    const cap = getPositionCap(date, holidays, caps);
    for (const pos of POSITIONS) {
      const group = entries.filter((e) => e.staff_position === pos);
      if (group.some((e) => e.lottery_status != null)) continue;
      // 날짜 다이얼로그의 isOver 와 같은 기준으로 초과를 판정한다.
      if (countJigeunSlots(group) <= cap) continue;
      list.push({
        date,
        pos,
        cap,
        pool: group.filter((e) => e.record_type === "지근"),
      });
    }
  }
  // 날짜 오름차순 → 같은 날짜면 POSITIONS 순서
  list.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      POSITIONS.indexOf(a.pos) - POSITIONS.indexOf(b.pos)
  );
  return list;
}

// ------------------------------------------------------------
// 마감 후 자동 추첨
// ------------------------------------------------------------

export interface AutoLotteryResult {
  targetCount: number; // 추첨한 (날짜 × 직책) 건수
  wonCount: number;
  lostCount: number;
  documentPosted: boolean;
  /** 추첨할 것이 없어 아무 일도 하지 않은 경우 (문서도 게시하지 않는다) */
  skippedNothingToDo: boolean;
}

interface RunAutoLotteryArgs {
  year: number;
  quarter: number;
  /** 결과 문서의 created_by. 자동 실행을 트리거한 로그인 관리자. */
  adminStaffId: number;
  /** 결과 문서 말미의 추가 신청 안내에 쓴다. 없으면 안내를 넣지 않는다. */
  extraDeadline: string | null;
}

/**
 * 대상 분기 전체의 정원 초과 지근을 추첨하고 결과를 문서로 게시한다.
 *
 * 실패해도 auto_lottery_done_for 를 기록하지 않는 것은 호출부(auto-lottery-runner)
 * 의 책임이다. 여기서는 예외를 그대로 던진다.
 */
export async function runAutoLottery({
  year,
  quarter,
  adminStaffId,
  extraDeadline,
}: RunAutoLotteryArgs): Promise<AutoLotteryResult> {
  const { start, end } = quarterRange(year, quarter);

  // 1) 분기 전체 신청 + 공휴일 + 정원 설정
  const [specialResult, holidayResult, settingsResult] = await Promise.all([
    supabase
      .from("special_schedules")
      .select("id, staff_id, target_date, record_type, lottery_status")
      .gte("target_date", start)
      .lte("target_date", end)
      .order("target_date", { ascending: true }),
    supabase
      .from("holidays")
      .select("locdate")
      .eq("is_holiday", "Y")
      .gte("locdate", start)
      .lte("locdate", end),
    supabase
      .from("app_settings")
      .select(
        "jigeun_cap_weekday, jigeun_cap_saturday, jigeun_cap_sunday, jigeun_cap_holiday"
      )
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (specialResult.error) throw specialResult.error;
  if (holidayResult.error) throw holidayResult.error;
  if (settingsResult.error) throw settingsResult.error;

  const rows = (specialResult.data ?? []) as Array<{
    id: string;
    staff_id: number;
    target_date: string;
    record_type: RecordType;
    lottery_status: LotteryStatus | null;
  }>;

  if (rows.length === 0) {
    return {
      targetCount: 0,
      wonCount: 0,
      lostCount: 0,
      documentPosted: false,
      skippedNothingToDo: true,
    };
  }

  // 2) 직책·이름 — FK 임베딩 대신 별도 조회 (lottery-losers-panel 과 동일한 관례)
  const staffIds = [...new Set(rows.map((r) => r.staff_id))];
  const { data: emps, error: empErr } = await supabase
    .from("coworker_list")
    .select("staff_id, staff_name, staff_position")
    .in("staff_id", staffIds);
  if (empErr) throw empErr;

  const empMap = new Map<number, { staff_name: string; staff_position: string }>();
  for (const e of emps ?? []) {
    empMap.set(e.staff_id, {
      staff_name: e.staff_name,
      staff_position: e.staff_position,
    });
  }

  const s = settingsResult.data as {
    jigeun_cap_weekday: number;
    jigeun_cap_saturday: number;
    jigeun_cap_sunday: number;
    jigeun_cap_holiday: number;
  } | null;
  const caps: JigeunCaps = s
    ? {
        weekday: s.jigeun_cap_weekday,
        saturday: s.jigeun_cap_saturday,
        sunday: s.jigeun_cap_sunday,
        holiday: s.jigeun_cap_holiday,
      }
    : DEFAULT_JIGEUN_CAPS;

  const holidays = new Set<string>(
    (holidayResult.data ?? []).map((h: { locdate: string }) => h.locdate)
  );

  // 3) 날짜별로 묶어 대상 수집
  interface Entry extends LotteryPoolEntry {
    staff_name: string;
  }
  const byDate = new Map<string, Entry[]>();
  for (const r of rows) {
    const emp = empMap.get(r.staff_id);
    // 직책을 모르는 행(직원 명단에서 빠진 staff_id)은 정원 판정을 할 수 없다.
    // 추첨에 넣으면 어느 직책 정원을 차지하는지 알 수 없으므로 제외한다.
    if (!emp) continue;
    const entry: Entry = {
      id: r.id,
      staff_id: r.staff_id,
      staff_position: emp.staff_position,
      record_type: r.record_type,
      lottery_status: r.lottery_status,
      staff_name: emp.staff_name,
    };
    const list = byDate.get(r.target_date);
    if (list) list.push(entry);
    else byDate.set(r.target_date, [entry]);
  }

  const targets = collectBulkTargets(byDate, holidays, caps);
  if (targets.length === 0) {
    return {
      targetCount: 0,
      wonCount: 0,
      lostCount: 0,
      documentPosted: false,
      skippedNothingToDo: true,
    };
  }

  // 4) 추첨 — 날짜별로 UPDATE 를 나누지 않고 id 를 모아 두 번의 .in() 으로 보낸다
  //    (lottery_at 은 어차피 실행 시각 하나다).
  const now = new Date().toISOString();
  const allWon: string[] = [];
  const allLost: string[] = [];
  const sections: Array<{
    date: string;
    pos: Position;
    cap: number;
    won: string[];
    lost: string[];
  }> = [];

  for (const t of targets) {
    const { wonIds, lostIds } = drawIds(t.pool, t.cap);
    allWon.push(...wonIds);
    allLost.push(...lostIds);
    const nameOf = (id: string) =>
      t.pool.find((e) => e.id === id)?.staff_name ?? "(미상)";
    sections.push({
      date: t.date,
      pos: t.pos,
      cap: t.cap,
      won: wonIds.map(nameOf),
      lost: lostIds.map(nameOf),
    });
  }

  // 두 UPDATE 는 한 트랜잭션이 아니다. 뒤쪽이 실패하면 일부만 반영되므로
  // 호출부는 auto_lottery_done_for 를 기록하지 않고 관리자에게 알려야 한다.
  if (allWon.length > 0) {
    const { error: e1 } = await supabase
      .from("special_schedules")
      .update({ lottery_status: "won", lottery_at: now })
      .in("id", allWon);
    if (e1) throw e1;
  }
  if (allLost.length > 0) {
    const { error: e2 } = await supabase
      .from("special_schedules")
      .update({ lottery_status: "lost", lottery_at: now })
      .in("id", allLost);
    if (e2) throw e2;
  }

  // 5) 결과 문서 게시 — 추첨이 모두 반영된 뒤에만.
  const { title, body } = buildResultDocument({
    year,
    quarter,
    start,
    end,
    sections,
    extraDeadline,
  });
  const { error: docErr } = await supabase.from("documents").insert({
    title,
    description: body,
    file_url: null,
    file_name: null,
    is_required: false,
    created_by: adminStaffId,
  });
  if (docErr) throw docErr;

  return {
    targetCount: targets.length,
    wonCount: allWon.length,
    lostCount: allLost.length,
    documentPosted: true,
    skippedNothingToDo: false,
  };
}

interface BuildDocArgs {
  year: number;
  quarter: number;
  start: string;
  end: string;
  sections: Array<{
    date: string;
    pos: Position;
    cap: number;
    won: string[];
    lost: string[];
  }>;
  extraDeadline: string | null;
}

/**
 * 게시할 문서의 제목·본문. 첨부 파일 없이 제목+설명만으로 게시한다
 * (documents.file_url 은 NULL 허용 — migrations.sql 섹션 12).
 *
 * 당첨자·탈락자 전체 실명을 공개한다. 추첨의 투명성이 확보되고 이의 제기가
 * 쉬워지며, 관리자는 이미 신청현황 화면에서 전원을 보고 있다.
 */
export function buildResultDocument({
  year,
  quarter,
  start,
  end,
  sections,
  extraDeadline,
}: BuildDocArgs): { title: string; body: string } {
  const title = `${year}년 ${quarter}분기 지근 추첨 결과`;
  const lines: string[] = [
    `${start} ~ ${end} 지근 신청 추첨 결과입니다.`,
    `(자동 추첨 · ${format(new Date(), "yyyy-MM-dd")} 실행)`,
    "",
  ];

  for (const sec of sections) {
    lines.push(`■ ${sec.date} ${sec.pos} (정원 ${sec.cap})`);
    lines.push(`  당첨: ${sec.won.length > 0 ? sec.won.join(", ") : "-"}`);
    lines.push(`  탈락: ${sec.lost.length > 0 ? sec.lost.join(", ") : "-"}`);
    lines.push("");
  }

  if (extraDeadline) {
    lines.push(
      `※ 탈락하신 분은 추가 신청 기간(${extraDeadline}까지)에 다른 날짜로 재신청하실 수 있습니다.`
    );
    lines.push(
      "  탈락한 날짜와 정원이 찬 날짜에는 다시 신청할 수 없으니 자리가 남은 날짜를 선택해 주세요."
    );
  }

  return { title, body: lines.join("\n") };
}
