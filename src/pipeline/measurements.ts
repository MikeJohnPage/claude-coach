import type { CoachConfig } from "./config";
import type { Landmark, PoseFrame, RawMeasurements, Side, Vec2, Vec3 } from "./types";

const DEG = 180 / Math.PI;

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit3 = (a: Vec3): Vec3 => scale3(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const mid3 = (a: Vec3, b: Vec3): Vec3 => scale3(add3(a, b), 0.5);

const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const mid2 = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export interface SideIndices {
  shoulder: number;
  hip: number;
  knee: number;
  ankle: number;
}

export function sideIndices(config: CoachConfig, side: Side): SideIndices {
  const l = config.landmarks;
  return side === "left"
    ? { shoulder: l.leftShoulder, hip: l.leftHip, knee: l.leftKnee, ankle: l.leftAnkle }
    : { shoulder: l.rightShoulder, hip: l.rightHip, knee: l.rightKnee, ankle: l.rightAnkle };
}

export const otherSide = (side: Side): Side => (side === "left" ? "right" : "left");

/** Landmarks needed to calibrate: both shoulders, hips, knees and ankles. */
export function calibrationIndices(config: CoachConfig): number[] {
  return Object.values(config.landmarks);
}

/** Landmarks needed once the top side is locked: both shoulders, both hips and the top knee. */
export function trackingIndices(config: CoachConfig, top: Side): number[] {
  const l = config.landmarks;
  return [l.leftShoulder, l.rightShoulder, l.leftHip, l.rightHip, sideIndices(config, top).knee];
}

export function allVisible(frame: PoseFrame, indices: number[], minVisibility: number): boolean {
  const { landmarks, world } = frame;
  if (!landmarks || !world) return false;
  return indices.every((i) => {
    const lm = landmarks[i];
    return lm !== undefined && world[i] !== undefined && lm.visibility >= minVisibility;
  });
}

/** Image landmark in pixels, so that angles respect the aspect ratio. */
export function toPixels(lm: Landmark, frame: PoseFrame): Vec2 {
  return { x: lm.x * frame.width, y: lm.y * frame.height };
}

/**
 * The top side is the one whose hip and ankle are both higher in the image (smaller y).
 * Returns null when hip and ankle disagree.
 */
export function detectTopSide(frame: PoseFrame, config: CoachConfig): Side | null {
  const lm = frame.landmarks;
  if (!lm) return null;
  const l = config.landmarks;
  const hip = lm[l.rightHip]!.y - lm[l.leftHip]!.y;
  const ankle = lm[l.rightAnkle]!.y - lm[l.leftAnkle]!.y;
  if (hip > 0 && ankle > 0) return "left";
  if (hip < 0 && ankle < 0) return "right";
  return null;
}

/**
 * Signed angle in degrees from `reference` to `v` in the image plane (y down),
 * positive when `v` is rotated from `reference` towards the top of the image.
 */
function angleTowardsUp(reference: Vec2, v: Vec2): number {
  const cross = reference.x * v.y - reference.y * v.x;
  const dot = reference.x * v.x + reference.y * v.y;
  const upSign = reference.x > 0 ? -1 : 1;
  return upSign * Math.atan2(cross, dot) * DEG;
}

/** Trunk direction (mid-shoulder to mid-hip) relative to horizontal in the image, in degrees, 0 to 90. */
export function trunkTiltDeg(frame: PoseFrame, config: CoachConfig): number {
  const lm = frame.landmarks!;
  const l = config.landmarks;
  const sh = mid2(toPixels(lm[l.leftShoulder]!, frame), toPixels(lm[l.rightShoulder]!, frame));
  const hip = mid2(toPixels(lm[l.leftHip]!, frame), toPixels(lm[l.rightHip]!, frame));
  const u = sub2(hip, sh);
  return Math.atan2(Math.abs(u.y), Math.abs(u.x)) * DEG;
}

/** Angle of `d` out of the image plane, positive when it points away from the camera (larger z). */
function outOfPlaneDeg(d: Vec3): number {
  return Math.atan2(d.z, Math.hypot(d.x, d.y)) * DEG;
}

/**
 * Computes every per-frame value for a known top side.
 * The caller must have checked that the needed landmarks are present.
 */
export function measure(frame: PoseFrame, top: Side, config: CoachConfig): RawMeasurements {
  const lm = frame.landmarks!;
  const w = frame.world!;
  const l = config.landmarks;
  const topIdx = sideIndices(config, top);
  const bottomIdx = sideIndices(config, otherSide(top));

  // In-plane angles from image landmarks.
  const midShoulderPx = mid2(toPixels(lm[l.leftShoulder]!, frame), toPixels(lm[l.rightShoulder]!, frame));
  const midHipPx = mid2(toPixels(lm[l.leftHip]!, frame), toPixels(lm[l.rightHip]!, frame));
  const trunk = sub2(midHipPx, midShoulderPx);
  const topHipPx = toPixels(lm[topIdx.hip]!, frame);
  const thigh = sub2(toPixels(lm[topIdx.knee]!, frame), topHipPx);
  const abduction = angleTowardsUp(trunk, thigh);

  const hipLine = sub2(topHipPx, toPixels(lm[bottomIdx.hip]!, frame));
  let pelvisAxis: Vec2 = { x: -hipLine.y, y: hipLine.x };
  if (pelvisAxis.x * trunk.x + pelvisAxis.y * trunk.y < 0) pelvisAxis = { x: -pelvisAxis.x, y: -pelvisAxis.y };
  const abductionPelvis = angleTowardsUp(pelvisAxis, thigh);

  // Depth from world landmarks, through a body frame: L down the trunk, Lt to the body's left, A anterior.
  const lSh = w[l.leftShoulder]!;
  const rSh = w[l.rightShoulder]!;
  const lHip = w[l.leftHip]!;
  const rHip = w[l.rightHip]!;
  const L = unit3(sub3(mid3(lHip, rHip), mid3(lSh, rSh)));
  const across = add3(sub3(lHip, rHip), sub3(lSh, rSh));
  const Lt = unit3(sub3(across, scale3(L, dot3(across, L))));
  const A = unit3(cross3(Lt, scale3(L, -1)));
  const t = sub3(w[topIdx.knee]!, w[topIdx.hip]!);
  const flexion = Math.atan2(dot3(t, A), dot3(t, L)) * DEG;

  const pelvisRoll = outOfPlaneDeg(sub3(w[topIdx.hip]!, w[bottomIdx.hip]!));
  const trunkRoll = outOfPlaneDeg(sub3(w[topIdx.shoulder]!, w[bottomIdx.shoulder]!));

  return {
    abduction,
    abductionPelvis,
    flexion,
    pelvisRoll,
    trunkRoll,
    // Smaller world z is closer to the camera.
    anteriorTowardCamera: A.z < 0,
    midHipPx,
    midShoulderPx,
    torsoLenPx: Math.hypot(trunk.x, trunk.y),
  };
}
