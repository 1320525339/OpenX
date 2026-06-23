import { useEffect, useRef } from "react";

type Props = {
  active: boolean;
  originX: number;
  originY: number;
  mode: "light" | "dark" | "geek";
  lowMemory?: boolean;
  onComplete: () => void;
};

export function ThemeRippleLayer({
  active,
  originX,
  originY,
  mode,
  lowMemory = false,
  onComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const scale = lowMemory ? 0.2 : 0.45;
    const w = Math.max(1, Math.floor(window.innerWidth * scale));
    const h = Math.max(1, Math.floor(window.innerHeight * scale));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ox = (originX / window.innerWidth) * w;
    const oy = (originY / window.innerHeight) * h;
    const maxR = Math.hypot(w, h);
    const fill =
      mode === "light"
        ? "rgba(248,250,252,0.92)"
        : mode === "geek"
          ? "rgba(8,18,14,0.94)"
          : "rgba(15,17,22,0.94)";
    const start = performance.now();
    const duration = lowMemory ? 420 : 680;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const radius = maxR * eased;
      ctx.clearRect(0, 0, w, h);
      const gradient = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
      gradient.addColorStop(0, fill);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        onComplete();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, originX, originY, mode, lowMemory, onComplete]);

  if (!active) return null;

  return <canvas ref={canvasRef} className="theme-ripple-layer" aria-hidden />;
}
