export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

/** One pose result. `landmarks` are normalised image coordinates, `world` is metres with the hip midpoint as origin. */
export interface PoseFrame {
  /** Milliseconds, monotonic within a session. */
  t: number;
  width: number;
  height: number;
  landmarks: Landmark[] | null;
  world: Landmark[] | null;
}

export type Side = "left" | "right";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 extends Vec2 {
  z: number;
}

/** Unsmoothed values computed from a single frame, before any baseline is subtracted. */
export interface RawMeasurements {
  abduction: number;
  abductionPelvis: number;
  flexion: number;
  pelvisRoll: number;
  trunkRoll: number;
  /** True when the anterior axis `A` of the body frame points towards the camera. */
  anteriorTowardCamera: boolean;
  midHipPx: Vec2;
  midShoulderPx: Vec2;
  torsoLenPx: number;
}

/** Smoothed values the rep counter and the cues work on, all in degrees except `torsoShift`. */
export interface Measurements {
  abduction: number;
  abductionPelvis: number;
  flexion: number;
  flexDrift: number;
  pelvisRoll: number;
  trunkRoll: number;
  torsoShift: number;
  anteriorTowardCamera: boolean;
}

export interface Calibration {
  t: number;
  topSide: Side;
  restAbduction: number;
  flexion: number;
  pelvisRoll: number;
  trunkRoll: number;
}

export type SessionState = "calibrating" | "active" | "lost";

export type CoachEvent =
  | { type: "speak"; t: number; kind: "prompt" | "cue" | "rep"; id: string; text: string }
  | { type: "calibrated"; t: number; calibration: Calibration }
  | { type: "lost"; t: number }
  | { type: "repStart"; t: number }
  | { type: "repEnd"; t: number; clean: boolean; cleanCount: number; totalCount: number }
  | { type: "cue"; t: number; id: string; value: number };

export interface FrameOutput {
  t: number;
  state: SessionState;
  /** Whether every landmark the current state needs was visible in this frame. */
  visible: boolean;
  /** Short human-readable reason while the session is not active. */
  detail: string;
  calibrationProgress: number;
  calibration: Calibration | null;
  topSide: Side | null;
  measurements: Measurements | null;
  repPhase: "rest" | "up";
  cleanReps: number;
  totalReps: number;
  events: CoachEvent[];
}
