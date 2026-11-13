// Every threshold and every spoken phrase lives here.
// All values are provisional starting points, to be tuned from recorded traces.
// The object is plain JSON so that a trace can carry the config it was recorded with.

const ABDUCTION_LIMIT_DEG = 30;
const ABDUCTION_TOLERANCE_DEG = 3;

export type CueMeasure = "abduction" | "pelvisRoll" | "flexDrift" | "torsoShift";

export interface CueConfig {
  id: string;
  measure: CueMeasure;
  /** The cue condition is `measure > threshold`. */
  threshold: number;
  /** How long the condition must hold without interruption before the cue may fire. */
  persistMs: number;
  text: string;
}

export interface CoachConfig {
  landmarks: {
    leftShoulder: number;
    rightShoulder: number;
    leftHip: number;
    rightHip: number;
    leftKnee: number;
    rightKnee: number;
    leftAnkle: number;
    rightAnkle: number;
  };
  /** A frame is ignored when a needed landmark is less visible than this. */
  minVisibility: number;
  /** One Euro filter applied to every derived value. */
  filter: { minCutoffHz: number; beta: number; dCutoffHz: number };
  calibration: {
    /** How long the body must be visible and still. */
    stillMs: number;
    /** Largest landmark movement that still counts as still, as a fraction of torso length. */
    stillTolerance: number;
    /** The trunk must be within this angle of horizontal in the image. */
    maxTrunkTiltDeg: number;
  };
  abduction: { limitDeg: number; toleranceDeg: number };
  reps: {
    /** A rep starts when abduction exceeds rest plus this. */
    startAboveRestDeg: number;
    /** A rep ends when abduction returns to within rest plus this. */
    endAboveRestDeg: number;
  };
  /** Say "I can't see you" after this long without a usable frame. */
  lostMs: number;
  /** Cues in priority order, highest first. */
  cues: CueConfig[];
  /** A given cue fires at most this often. */
  cueCooldownMs: number;
  /** Minimum gap between any two cues, so that one is finished before the next is spoken. */
  cueMinGapMs: number;
  phrases: { start: string; ready: string; cantSee: string };
  model: { variants: string[]; defaultVariant: string };
}

export const defaultConfig: CoachConfig = {
  landmarks: {
    leftShoulder: 11,
    rightShoulder: 12,
    leftHip: 23,
    rightHip: 24,
    leftKnee: 25,
    rightKnee: 26,
    leftAnkle: 27,
    rightAnkle: 28,
  },
  minVisibility: 0.5,
  filter: { minCutoffHz: 2, beta: 0.05, dCutoffHz: 1 },
  calibration: { stillMs: 2000, stillTolerance: 0.05, maxTrunkTiltDeg: 30 },
  abduction: { limitDeg: ABDUCTION_LIMIT_DEG, toleranceDeg: ABDUCTION_TOLERANCE_DEG },
  reps: { startAboveRestDeg: 8, endAboveRestDeg: 4 },
  lostMs: 3000,
  cues: [
    {
      id: "tooHigh",
      measure: "abduction",
      threshold: ABDUCTION_LIMIT_DEG + ABDUCTION_TOLERANCE_DEG,
      persistMs: 150,
      text: "Too high. Lower a little.",
    },
    { id: "pelvisRoll", measure: "pelvisRoll", threshold: 12, persistMs: 300, text: "Stack your hips. Don't roll back." },
    { id: "flexDrift", measure: "flexDrift", threshold: 12, persistMs: 300, text: "Leg back, in line with your body." },
    { id: "torsoShift", measure: "torsoShift", threshold: 0.06, persistMs: 300, text: "Brace. Keep your trunk still." },
  ],
  cueCooldownMs: 4000,
  cueMinGapMs: 2000,
  phrases: {
    start: "Lie on your side facing the camera. Hold still.",
    ready: "Ready. Begin.",
    cantSee: "I can't see you.",
  },
  model: { variants: ["lite", "full", "heavy"], defaultVariant: "full" },
};
