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
