import { defaultConfig } from "../src/pipeline/config";
import { CoachSession } from "../src/pipeline/session";
import { buildSequence, type FigureOptions } from "../src/pipeline/synthetic";
import type { CoachEvent, FrameOutput, PoseFrame, Side } from "../src/pipeline/types";

export const REST = -3;
export const CALIBRATION_MS = 2500;

type Pose = Omit<FigureOptions, "t" | "top">;

/** Raised-cosine lift from rest to `peak` and back, lasting `durationMs` from `startMs`. */
export function lift(t: number, startMs: number, durationMs: number, peak: number): number {
  if (t < startMs || t > startMs + durationMs) return REST;
  const phase = (t - startMs) / durationMs;
  return REST + ((peak - REST) * (1 - Math.cos(2 * Math.PI * phase))) / 2;
}

/** Trapezoid: ramps to `peak` in 500 ms, holds, ramps back in 500 ms. */
export function hold(t: number, startMs: number, holdMs: number, peak: number): number {
  const up = Math.min(1, Math.max(0, (t - startMs) / 500));
  const down = Math.min(1, Math.max(0, (t - startMs - 500 - holdMs) / 500));
  return REST + (peak - REST) * (up - down);
}

/** A still calibration period followed by whatever `pose` describes; `pose` gets time since calibration ended. */
export function sequence(top: Side, durationMs: number, pose: (t: number) => Pose | null): PoseFrame[] {
  return buildSequence(CALIBRATION_MS + durationMs, (t) => {
    if (t < CALIBRATION_MS) return { top, abduction: REST };
    const p = pose(t - CALIBRATION_MS);
    return p ? { top, ...p } : null;
  });
}

export function run(frames: PoseFrame[], config = defaultConfig): { outputs: FrameOutput[]; events: CoachEvent[] } {
  const session = new CoachSession(config);
  const outputs = frames.map((f) => session.process(f));
  return { outputs, events: outputs.flatMap((o) => o.events) };
}

export const spoken = (events: CoachEvent[]): string[] => events.flatMap((e) => (e.type === "speak" ? [e.text] : []));
/** The `clean` flag of each finished rep, in order. */
export const reps = (events: CoachEvent[]): boolean[] => events.flatMap((e) => (e.type === "repEnd" ? [e.clean] : []));
export const cueIds = (events: CoachEvent[]): string[] => events.flatMap((e) => (e.type === "cue" ? [e.id] : []));
