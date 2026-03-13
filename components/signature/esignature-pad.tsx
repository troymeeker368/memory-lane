"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";

type EsignaturePadProps = {
  disabled?: boolean;
  onSignatureChange: (dataUrl: string | null) => void;
};

export function EsignaturePad({ disabled = false, onSignatureChange }: EsignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const strokeStartedRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  const initializeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#1f2937";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, []);

  useEffect(() => {
    initializeCanvas();
  }, [initializeCanvas]);

  const getCanvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!canvas || !context || !point) return;
    drawingRef.current = true;
    strokeStartedRef.current = false;
    context.beginPath();
    context.moveTo(point.x, point.y);
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || !drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    const point = getCanvasPoint(event);
    if (!context || !point) return;
    context.lineTo(point.x, point.y);
    context.stroke();
    strokeStartedRef.current = true;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = false;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!strokeStartedRef.current || disabled) return;
    const dataUrl = canvas.toDataURL("image/png");
    setHasSignature(true);
    onSignatureChange(dataUrl);
  };

  const clearSignature = () => {
    initializeCanvas();
    strokeStartedRef.current = false;
    setHasSignature(false);
    onSignatureChange(null);
  };

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-semibold text-muted">Draw Nurse/Admin Signature</p>
      <canvas
        ref={canvasRef}
        width={920}
        height={220}
        className="mt-2 w-full rounded-lg border border-border bg-white"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-muted">{hasSignature ? "Signature captured." : "Signature is required."}</p>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
          onClick={clearSignature}
          disabled={disabled}
        >
          Clear Signature
        </button>
      </div>
    </div>
  );
}
