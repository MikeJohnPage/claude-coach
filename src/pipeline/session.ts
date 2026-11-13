import { Calibrator } from "./calibration";
import type { CoachConfig } from "./config";
import { CueEngine } from "./cues";
import { allVisible, measure, trackingIndices } from "./measurements";
import { OneEuroFilter } from "./oneEuro";
import { RepDetector } from "./reps";
import type { Calibration, CoachEvent, FrameOutput, Measurements, PoseFrame, SessionState, Vec2 } from "./types";

const FILTERED = ["abduction", "abductionPelvis", "flexion", "pelvisRoll", "trunkRoll", "hipX", "hipY", "shoulderX", "shoulderY"] as const;
type FilterKey = (typeof FILTERED)[number];

/**
 * The whole coaching pipeline for one session: landmarks in, state, measurements and events out.
 * It has no DOM or MediaPipe dependency, so a recorded trace can be replayed through it.
 */
export class CoachSession {
  private state: SessionState = "calibrating";
  private calibration: Calibration | null = null;
  private readonly calibrator: Calibrator;
  private readonly reps: RepDetector;
  private readonly cues: CueEngine;
  private readonly filters: Record<FilterKey, OneEuroFilter>;
  private lastVisibleT: number | null = null;
  private torsoRef: { hip: Vec2; shoulder: Vec2; len: number } | null = null;
  private repHadCue = false;
  private cleanReps = 0;
  private totalReps = 0;

  constructor(private readonly config: CoachConfig) {
    this.calibrator = new Calibrator(config);
    this.reps = new RepDetector(config);
    this.cues = new CueEngine(config);
    this.filters = Object.fromEntries(FILTERED.map((k) => [k, new OneEuroFilter(config.filter)])) as Record<
      FilterKey,
      OneEuroFilter
    >;
  }

  /** Drops the calibration and waits for the next still period. The rep count is kept. */
  recalibrate(): void {
    this.state = "calibrating";
    this.dropCalibration();
  }

  private dropCalibration(): void {
    this.calibration = null;
    this.calibrator.reset();
    this.reps.reset();
    this.cues.reset();
    this.torsoRef = null;
    this.repHadCue = false;
    for (const f of Object.values(this.filters)) f.reset();
  }

  process(frame: PoseFrame): FrameOutput {
    const { config } = this;
    const events: CoachEvent[] = [];
    const t = frame.t;
    if (this.lastVisibleT === null) this.lastVisibleT = t;

    let visible: boolean;
    let detail = "";
    let progress = 0;
    let measurements: Measurements | null = null;

    if (this.state === "active" && this.calibration) {
      visible = allVisible(frame, trackingIndices(config, this.calibration.topSide), config.minVisibility);
      if (visible) measurements = this.track(frame, this.calibration, events);
    } else {
      const step = this.calibrator.update(frame);
      visible = step.visible;
      detail = step.detail;
      progress = step.progress;
      if (visible && this.state === "lost") this.state = "calibrating";
      if (step.calibration) {
        this.calibration = step.calibration;
        this.state = "active";
        events.push({ type: "calibrated", t, calibration: step.calibration });
        events.push({ type: "speak", t, kind: "prompt", id: "ready", text: config.phrases.ready });
      }
    }

    if (visible) {
      this.lastVisibleT = t;
    } else if (this.state !== "lost" && t - this.lastVisibleT >= config.lostMs) {
      this.state = "lost";
      this.dropCalibration();
      events.push({ type: "lost", t });
      events.push({ type: "speak", t, kind: "prompt", id: "cantSee", text: config.phrases.cantSee });
    }
    if (this.state === "lost") detail = config.phrases.cantSee;

    return {
      t,
      state: this.state,
      visible,
      detail,
      calibrationProgress: progress,
      calibration: this.calibration,
      topSide: this.calibration?.topSide ?? null,
      measurements,
      repPhase: this.reps.phase,
      cleanReps: this.cleanReps,
      totalReps: this.totalReps,
      events,
    };
  }

  private track(frame: PoseFrame, cal: Calibration, events: CoachEvent[]): Measurements {
    const { config } = this;
    const t = frame.t;
    const raw = measure(frame, cal.topSide, config);
    const f = (key: FilterKey, value: number): number => this.filters[key].filter(value, t);

    const abduction = f("abduction", raw.abduction);
    const flexion = f("flexion", raw.flexion);
    const hip = { x: f("hipX", raw.midHipPx.x), y: f("hipY", raw.midHipPx.y) };
    const shoulder = { x: f("shoulderX", raw.midShoulderPx.x), y: f("shoulderY", raw.midShoulderPx.y) };

    // The torso reference follows the body while the leg is down and freezes once it lifts,
    // so the shift is measured from where the trunk was when the rep began.
    const resting = this.reps.phase === "rest" && abduction <= cal.restAbduction + config.reps.endAboveRestDeg;
    if (resting || !this.torsoRef) this.torsoRef = { hip, shoulder, len: raw.torsoLenPx };
    const ref = this.torsoRef;
    const torsoShift =
      Math.max(Math.hypot(hip.x - ref.hip.x, hip.y - ref.hip.y), Math.hypot(shoulder.x - ref.shoulder.x, shoulder.y - ref.shoulder.y)) /
      (ref.len || 1);

    const m: Measurements = {
      abduction,
      abductionPelvis: f("abductionPelvis", raw.abductionPelvis),
      flexion,
      flexDrift: flexion - cal.flexion,
      pelvisRoll: f("pelvisRoll", raw.pelvisRoll) - cal.pelvisRoll,
      trunkRoll: f("trunkRoll", raw.trunkRoll) - cal.trunkRoll,
      torsoShift,
      anteriorTowardCamera: raw.anteriorTowardCamera,
    };

    const transition = this.reps.update(abduction, cal.restAbduction);
    if (transition === "start") {
      this.repHadCue = false;
      this.cues.startRep();
      events.push({ type: "repStart", t });
    }

    if (this.reps.phase === "up") {
      const cue = this.cues.update(t, m);
      if (cue) {
        this.repHadCue = true;
        events.push({ type: "cue", t, id: cue.id, value: m[cue.measure] });
        events.push({ type: "speak", t, kind: "cue", id: cue.id, text: cue.text });
      }
    }

    if (transition === "end") {
      this.cues.endRep();
      this.totalReps += 1;
      const clean = !this.repHadCue;
      if (clean) this.cleanReps += 1;
      events.push({ type: "repEnd", t, clean, cleanCount: this.cleanReps, totalCount: this.totalReps });
      if (clean) events.push({ type: "speak", t, kind: "rep", id: "rep", text: String(this.cleanReps) });
    }
    return m;
  }
}
