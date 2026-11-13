import type { CoachConfig } from "../pipeline/config";
import { sideIndices } from "../pipeline/measurements";
import type { PoseFrame, Side } from "../pipeline/types";

const BONES: Array<[number, number]> = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [11, 13], [13, 15], [12, 14], [14, 16],
];

/** Draws the skeleton over the video, with the trunk line and the top thigh highlighted once the top side is known. */
export function drawOverlay(canvas: HTMLCanvasElement, frame: PoseFrame, top: Side | null, config: CoachConfig): void {
  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const lm = frame.landmarks;
  if (!lm) return;
  const unit = Math.max(2, frame.width / 320);
  const point = (i: number): { x: number; y: number; v: number } => ({
    x: lm[i]!.x * frame.width,
    y: lm[i]!.y * frame.height,
    v: lm[i]!.visibility,
  });
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  ctx.lineCap = "round";
  for (const [a, b] of BONES) {
    const p = point(a);
    const q = point(b);
    const seen = Math.min(p.v, q.v) >= config.minVisibility;
    line(p, q, seen ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)", unit);
  }
  if (top) {
    const l = config.landmarks;
    const t = sideIndices(config, top);
    const mid = (i: number, j: number): { x: number; y: number } => ({
      x: (point(i).x + point(j).x) / 2,
      y: (point(i).y + point(j).y) / 2,
    });
    line(mid(l.leftShoulder, l.rightShoulder), mid(l.leftHip, l.rightHip), "#4cc9f0", unit * 1.6);
    line(point(t.hip), point(t.knee), "#ffd166", unit * 1.6);
  }
  for (const i of Object.values(config.landmarks)) {
    const p = point(i);
    ctx.fillStyle = p.v >= config.minVisibility ? "#06d6a0" : "#ef476f";
    ctx.beginPath();
    ctx.arc(p.x, p.y, unit * 1.5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

export function clearOverlay(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
}
