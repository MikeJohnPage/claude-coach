import type { CoachConfig } from "../pipeline/config";

const MIN_DEG = -10;
const MAX_DEG = 50;

/**
 * Draws abduction as a leg swinging up from horizontal around a hip at the left,
 * with the limit drawn as a fixed line. `abduction` is null when nothing is measured.
 */
export function drawGauge(canvas: HTMLCanvasElement, abduction: number | null, config: CoachConfig): void {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);
  const { limitDeg, toleranceDeg } = config.abduction;
  const pivot = { x: w * 0.06, y: h * 0.8 };
  const radius = Math.min(w * 0.88, (h * 0.72) / Math.sin((MAX_DEG * Math.PI) / 180));
  const at = (deg: number, r: number): { x: number; y: number } => ({
    x: pivot.x + r * Math.cos((deg * Math.PI) / 180),
    y: pivot.y - r * Math.sin((deg * Math.PI) / 180),
  });
  const arc = (from: number, to: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = h * 0.06;
    ctx.beginPath();
    ctx.arc(pivot.x, pivot.y, radius, (-to * Math.PI) / 180, (-from * Math.PI) / 180);
    ctx.stroke();
  };
  ctx.lineCap = "butt";
  arc(MIN_DEG, limitDeg, "#2a9d8f");
  arc(limitDeg, MAX_DEG, "#e63946");

  // The limit mark.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = h * 0.02;
  ctx.beginPath();
  ctx.moveTo(at(limitDeg, radius * 0.86).x, at(limitDeg, radius * 0.86).y);
  ctx.lineTo(at(limitDeg, radius * 1.06).x, at(limitDeg, radius * 1.06).y);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${h * 0.12}px system-ui, sans-serif`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const label = at(limitDeg, radius * 0.8);
  ctx.fillText(`${limitDeg}°`, label.x, label.y);

  if (abduction === null) return;
  const clamped = Math.min(MAX_DEG, Math.max(MIN_DEG, abduction));
  const tip = at(clamped, radius * 0.97);
  ctx.strokeStyle = abduction > limitDeg + toleranceDeg ? "#ff6b6b" : "#ffd166";
  ctx.lineWidth = h * 0.05;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pivot.x, pivot.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}
