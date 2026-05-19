// 기준 근무 정보(reference_date / reference_shift) 검증 유틸.
// 이 두 값은 근무순서 RPC 가 회전 근무표를 계산하는 앵커라, 형식이 틀리면
// 해당 직원의 근무표가 통째로 어긋난다. 입력 단계에서 형식을 검증한다.
//
// reference_shift 실데이터(262행) 표본 형식: 56, 52~, 휴22, 대11~, 휴71.
// 패턴: (휴|대) 접두 0~1개 + 숫자 1~3자리 + ~ 접미 0~1개.
// 빈 값 허용 여부는 호출부에서 결정한다(컬럼이 nullable).

const SHIFT_PATTERN = /^(휴|대)?\d{1,3}~?$/;

export function isValidShift(value: string): boolean {
  return SHIFT_PATTERN.test(value);
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidRefDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  // new Date 가 2026-13-40 같은 값을 보정해버리므로 역포맷으로 재검증.
  return d.toISOString().slice(0, 10) === value;
}
