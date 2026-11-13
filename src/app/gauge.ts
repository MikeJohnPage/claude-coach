import type { CoachConfig } from "../pipeline/config";

const MIN_DEG = 0;
const MAX_DEG = 45;
// The ring is open at the bottom: it runs clockwise from lower left to lower right.
const START = 0.75 * Math.PI;
const SWEEP = 1.5 * Math.PI;

const TRACK = "rgba(255, 255, 255, 0.08)";
const VALUE = "#8fd3c4";
const OVER = "#f2a391";
const MARK = "rgba(255, 255, 255, 0.7)";

/** Draws abduction as a thin ring with a tick at the limit. `abduction` is null when nothing is measured. */
export function drawGauge(canvas: HTMLCanvasElement, abduction: number | null, config: CoachConfig): void {
  const ctx = canvas.getContext("2d")!;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  const { limitDeg, toleranceDeg } = config.abduction;
  const centre = size / 2;
  const radius = size * 0.43;
  const angleOf = (deg: number): number =>
    START + (SWEEP * (Math.min(MAX_DEG, Math.max(MIN_DEG, deg)) - MIN_DEG)) / (MAX_DEG - MIN_DEG);
  const arc = (to: number, color: string): void => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(centre, centre, radius, START, to);
    ctx.stroke();
  };
  ctx.lineCap = "round";
  ctx.lineWidth = size * 0.022;
  arc(START + SWEEP, TRACK);
  if (abduction !== null && abduction > MIN_DEG) arc(angleOf(abduction), abduction > limitDeg + toleranceDeg ? OVER : VALUE);

  const a = angleOf(limitDeg);
  const at = (r: number): [number, number] => [centre + r * Math.cos(a), centre + r * Math.sin(a)];
  ctx.strokeStyle = MARK;
  ctx.lineWidth = size * 0.008;
  ctx.beginPath();
  ctx.moveTo(...at(radius - size * 0.035));
  ctx.lineTo(...at(radius + size * 0.035));
  ctx.stroke();
  ctx.fillStyle = MARK;
  ctx.font = `500 ${size * 0.045}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${limitDeg}°`, ...at(radius - size * 0.09));
}
