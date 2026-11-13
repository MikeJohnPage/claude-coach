import type { CoachConfig } from "./config";
import { CoachSession } from "./session";
import type { CoachEvent, FrameOutput, Landmark, Measurements, PoseFrame } from "./types";

export const TRACE_VERSION = 1;

/** One landmark as `[x, y, z, visibility]`. */
export type PackedLandmark = [number, number, number, number];

export interface TraceFrame {
  t: number;
  w: number;
  h: number;
  /** Normalised image landmarks, or null when no pose was found. */
  lm: PackedLandmark[] | null;
  /** World landmarks in metres. */
  wl: PackedLandmark[] | null;
  /** What the live session computed, for reference. Replay recomputes these. */
  state?: string;
  m?: Measurements | null;
  ev?: CoachEvent[];
}

export interface Trace {
  version: number;
  meta: Record<string, unknown>;
  /** The config the trace was recorded with. */
  config: CoachConfig;
  frames: TraceFrame[];
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

const pack = (lms: Landmark[] | null): PackedLandmark[] | null =>
  lms ? lms.map((l) => [round(l.x, 5), round(l.y, 5), round(l.z, 5), round(l.visibility, 3)]) : null;

const unpack = (lms: PackedLandmark[] | null): Landmark[] | null =>
  lms ? lms.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null;

export function encodeFrame(frame: PoseFrame, output?: FrameOutput): TraceFrame {
  const tf: TraceFrame = { t: round(frame.t, 2), w: frame.width, h: frame.height, lm: pack(frame.landmarks), wl: pack(frame.world) };
  if (output) {
    tf.state = output.state;
    tf.m = output.measurements;
    if (output.events.length) tf.ev = output.events;
  }
  return tf;
}

export function decodeFrame(tf: TraceFrame): PoseFrame {
  return { t: tf.t, width: tf.w, height: tf.h, landmarks: unpack(tf.lm), world: unpack(tf.wl) };
}

export interface ReplayResult {
  outputs: FrameOutput[];
  events: CoachEvent[];
}

/** Runs the recorded landmarks through a fresh session, by default with the config stored in the trace. */
export function replay(trace: Trace, config: CoachConfig = trace.config): ReplayResult {
  if (trace.version !== TRACE_VERSION) throw new Error(`Unsupported trace version ${trace.version}`);
  const session = new CoachSession(config);
  const outputs = trace.frames.map((tf) => session.process(decodeFrame(tf)));
  return { outputs, events: outputs.flatMap((o) => o.events) };
}
