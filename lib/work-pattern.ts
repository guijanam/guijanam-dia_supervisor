// 교번(work_patterns.shift_types) 배열 편집 유틸.
//
// shift_types 는 순서가 의미를 갖는다. get_schedule_by_range RPC 는 직원의
// 기준 근무번호(reference_shift)가 배열의 어느 인덱스인지 찾아, 기준일부터
// 하루에 한 칸씩 전진·순환시켜 근무표를 만든다. 따라서
//   - 원소 삽입/삭제/이동 → 그 교번을 쓰는 전 직원의 근무표가 이후로 밀린다.
//   - 원소 이름만 변경    → 순환 중 그 한 칸만 바뀐다.
//   - 어떤 직원의 reference_shift 가 배열에서 사라지면 그 직원의 근무표는
//     계산 불가가 된다(앵커 소실).
// 이 파일은 순수 함수만 둔다(React·Supabase 의존 없음).

import { isValidShift } from "@/lib/reference";

export type ElementOp =
  | { kind: "rename"; index: number; value: string }
  | { kind: "insert"; index: number; value: string }
  | { kind: "delete"; index: number }
  | { kind: "move"; index: number; delta: -1 | 1 };

// insert 의 index 는 '삽입될 위치'(0 이면 맨 앞). 나머지는 대상 원소의 위치.
export function applyElementOp(arr: string[], op: ElementOp): string[] {
  const next = [...arr];
  switch (op.kind) {
    case "rename":
      if (op.index < 0 || op.index >= next.length) return next;
      next[op.index] = op.value;
      return next;
    case "insert": {
      const at = Math.max(0, Math.min(op.index, next.length));
      next.splice(at, 0, op.value);
      return next;
    }
    case "delete":
      if (op.index < 0 || op.index >= next.length) return next;
      next.splice(op.index, 1);
      return next;
    case "move": {
      const to = op.index + op.delta;
      if (op.index < 0 || op.index >= next.length) return next;
      if (to < 0 || to >= next.length) return next;
      [next[op.index], next[to]] = [next[to], next[op.index]];
      return next;
    }
  }
}

// 근무표를 밀어버리는 연산인가. rename 만 순환 길이/순서를 바꾸지 않는다.
export function isDestructiveOp(op: ElementOp): boolean {
  return op.kind !== "rename";
}

// 확인 모달에 쓸 사람 말 문구.
export function describeOp(op: ElementOp, arr: string[]): string {
  switch (op.kind) {
    case "rename":
      return `#${op.index} 의 근무번호를 ${arr[op.index] ?? "-"} → ${op.value} 로 변경합니다.`;
    case "insert":
      return op.index === 0
        ? `맨 앞에 ${op.value} 를 삽입합니다.`
        : `#${op.index - 1} (${arr[op.index - 1] ?? "-"}) 뒤에 ${op.value} 를 삽입합니다.`;
    case "delete":
      return `#${op.index} (${arr[op.index] ?? "-"}) 을 삭제합니다.`;
    case "move":
      return op.delta === -1
        ? `#${op.index} (${arr[op.index] ?? "-"}) 을 한 칸 앞으로 이동합니다.`
        : `#${op.index} (${arr[op.index] ?? "-"}) 을 한 칸 뒤로 이동합니다.`;
  }
}

// 차단 검증(하드 에러). null 이면 통과.
export function validateElementValue(value: string): string | null {
  const v = value.trim();
  if (!v) return "근무번호를 입력하세요.";
  if (/\s/.test(v)) return "근무번호에 공백을 쓸 수 없습니다.";
  if (v.length > 10) return "근무번호가 너무 깁니다. (최대 10자)";
  return null;
}

// 형식 경고(차단 아님). 승무소 교번은 (휴|대)?숫자~? 형식이지만
// 4조2교대(주야비휴) 같은 일반 교번은 주/야/비/휴 를 그대로 쓴다.
export function shiftFormatWarning(value: string): string | null {
  const v = value.trim();
  if (!v || isValidShift(v)) return null;
  return "형식이 일반적이지 않습니다. (예: 56, 52~, 휴22) 저장은 가능합니다.";
}

export interface PatternAnchor {
  staff_id: number;
  staff_name: string;
  reference_shift: string | null;
}

// 편집 후 배열에서 사라지는 기준 근무번호와, 그 값을 쓰는 직원들.
// delete/rename 만 값 집합을 줄일 수 있다(insert/move 는 항상 빈 배열).
export function findBrokenAnchors(
  next: string[],
  anchors: PatternAnchor[]
): { shift: string; names: string[] }[] {
  const present = new Set(next.map((s) => s.trim()));
  const broken = new Map<string, string[]>();
  for (const a of anchors) {
    const shift = (a.reference_shift ?? "").trim();
    if (!shift) continue; // 앵커 미설정 직원은 이 편집으로 깨지지 않는다
    if (present.has(shift)) continue;
    const names = broken.get(shift);
    if (names) names.push(a.staff_name);
    else broken.set(shift, [a.staff_name]);
  }
  return [...broken.entries()].map(([shift, names]) => ({ shift, names }));
}
