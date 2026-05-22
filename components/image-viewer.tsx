"use client";

import { useCallback, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, RotateCcw, Download } from "lucide-react";

interface ImageViewerProps {
  src: string;
  fileName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

// fetch → blob 로 강제 다운로드. 실패 시 새 탭 폴백.
async function downloadFile(url: string, name: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("download failed");
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

export function ImageViewer({
  src,
  fileName,
  open,
  onOpenChange,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);

  // 활성 포인터 추적 (pointerId → 화면 좌표)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // 핀치 시작 시점의 두 포인터 거리
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);

  const reset = useCallback(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, []);

  // 다이얼로그 닫히면 줌/위치 초기화 후 부모에 통지
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [reset, onOpenChange]
  );

  const zoomBy = useCallback((delta: number) => {
    setScale((prev) => {
      const next = clamp(prev + delta, MIN_SCALE, MAX_SCALE);
      if (next === MIN_SCALE) {
        setTx(0);
        setTy(0);
      }
      return next;
    });
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(-e.deltaY * 0.0015);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDist.current = Math.hypot(a.x - b.x, a.y - b.y);
      pinchStartScale.current = scale;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };

    if (pointers.current.size === 2 && pinchStartDist.current != null) {
      // 핀치 줌
      pointers.current.set(e.pointerId, next);
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / pinchStartDist.current;
      setScale(clamp(pinchStartScale.current * ratio, MIN_SCALE, MAX_SCALE));
      return;
    }

    // 단일 포인터 드래그 → 팬 (확대 상태에서만)
    if (pointers.current.size === 1 && scale > 1) {
      setTx((v) => v + (next.x - prev.x));
      setTy((v) => v + (next.y - prev.y));
    }
    pointers.current.set(e.pointerId, next);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStartDist.current = null;
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      reset();
    } else {
      setScale(2.5);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-none w-screen h-dvh sm:max-w-none p-0 border-0 bg-black/95 rounded-none">
        <DialogTitle className="sr-only">{fileName}</DialogTitle>

        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={fileName}
            draggable={false}
            className="max-h-full max-w-full select-none"
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              cursor: scale > 1 ? "grab" : "default",
            }}
          />
        </div>

        {/* 하단 컨트롤 바 */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-background/90 border px-2 py-1 shadow-lg">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => zoomBy(-0.5)}
            disabled={scale <= MIN_SCALE}
            title="축소"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={reset}
            disabled={scale === MIN_SCALE && tx === 0 && ty === 0}
            title="원래대로"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => zoomBy(0.5)}
            disabled={scale >= MAX_SCALE}
            title="확대"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <span className="w-px h-5 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => downloadFile(src, fileName)}
            title="다운로드"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
