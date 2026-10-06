import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|svg)$/i

// 파일명 확장자로 이미지 파일 여부 판별 (Document 에는 MIME 필드가 없음)
export function isImageFile(fileName: string | null | undefined): boolean {
  return !!fileName && IMAGE_EXT.test(fileName)
}

// 교육기간 표시(yyyy.MM.dd). 하루짜리는 날짜 하나만, 기간이 없으면 null.
// 날짜 문자열을 그대로 잘라 써서 시간대 변환으로 하루 밀리는 일을 막는다.
export function formatTrainingPeriod(d: {
  training_start: string | null
  training_end: string | null
}): string | null {
  if (!d.training_start) return null
  const fmt = (v: string) => v.slice(0, 10).replaceAll("-", ".")
  const start = fmt(d.training_start)
  if (!d.training_end || d.training_end === d.training_start) return start
  return `${start} ~ ${fmt(d.training_end)}`
}
