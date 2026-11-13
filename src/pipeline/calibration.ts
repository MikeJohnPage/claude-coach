import type { CoachConfig } from "./config";
import { allVisible, calibrationIndices, detectTopSide, measure, toPixels, trunkTiltDeg } from "./measurements";
import type { Calibration, PoseFrame, Side, Vec2 } from "./types";

export interface CalibrationStep {
  calibration: Calibration | null;
  /** 0 to 1, how much of the still period has elapsed. */
  progress: number;
  /** Whether all landmarks needed for calibration were visible. */
  visible: boolean;
  detail: string;
}

/**
 * Waits until every needed landmark is visible and still for `stillMs`,
 * then returns the top side and the baselines averaged over that period.
 */
export class Calibrator {
  private anchor: Vec2[] | null = null;
  private topSide: Side | null = null;
  private startT = 0;
  private n = 0;
  private sums = { abduction: 0, flexion: 0, pelvisRoll: 0, trunkRoll: 0 };

  constructor(private readonly config: CoachConfig) {}

  reset(): void {
    this.anchor = null;
    this.topSide = null;
    this.n = 0;
    this.sums = { abduction: 0, flexion: 0, pelvisRoll: 0, trunkRoll: 0 };
  }

  private fail(visible: boolean, detail: string): CalibrationStep {
    this.reset();
    return { calibration: null, progress: 0, visible, detail };
  }

  update(frame: PoseFrame): CalibrationStep {
    const { config } = this;
    const indices = calibrationIndices(config);
    if (!allVisible(frame, indices, config.minVisibility)) {
      return this.fail(false, "Waiting for shoulders, hips, knees and ankles to be visible");
    }
    if (trunkTiltDeg(frame, config) > config.calibration.maxTrunkTiltDeg) {
      return this.fail(true, "Lie down so that your body is horizontal in the picture");
    }
    const top = detectTopSide(frame, config);
    if (!top) return this.fail(true, "Can't tell which side is on top");

    const raw = measure(frame, top, config);
    const points = indices.map((i) => toPixels(frame.landmarks![i]!, frame));
    const tolerance = config.calibration.stillTolerance * raw.torsoLenPx;
    const moved =
      this.anchor !== null && points.some((p, i) => Math.hypot(p.x - this.anchor![i]!.x, p.y - this.anchor![i]!.y) > tolerance);

    if (this.anchor === null || moved || top !== this.topSide) {
      this.reset();
      this.anchor = points;
      this.topSide = top;
      this.startT = frame.t;
    }
    this.n += 1;
    this.sums.abduction += raw.abduction;
    this.sums.flexion += raw.flexion;
    this.sums.pelvisRoll += raw.pelvisRoll;
    this.sums.trunkRoll += raw.trunkRoll;

    const elapsed = frame.t - this.startT;
    const progress = Math.min(1, elapsed / config.calibration.stillMs);
    if (elapsed < config.calibration.stillMs) {
      return { calibration: null, progress, visible: true, detail: "Hold still" };
    }
    const calibration: Calibration = {
      t: frame.t,
      topSide: top,
      restAbduction: this.sums.abduction / this.n,
      flexion: this.sums.flexion / this.n,
      pelvisRoll: this.sums.pelvisRoll / this.n,
      trunkRoll: this.sums.trunkRoll / this.n,
    };
    this.reset();
    return { calibration, progress: 1, visible: true, detail: "" };
  }
}
