// A synthetic stick figure lying on its side, facing the camera, for tests and for generating traces.
// World axes follow MediaPipe: x image-right, y image-down, smaller z closer to the camera.

import { defaultConfig } from "./config";
import type { Landmark, PoseFrame, Side, Vec3 } from "./types";

const RAD = Math.PI / 180;

export interface FigureOptions {
  /** Which side of the body is up. */
  top: Side;
  /** In-plane angle of the top thigh above the trunk line, degrees. */
  abduction?: number;
  /** Angle of the top thigh out of the image plane towards anterior, degrees. */
  flexionOut?: number;
  /** Pelvis rolled back about the body's long axis, degrees. */
  pelvisRoll?: number;
  /** Shoulders rolled back about the body's long axis, degrees. */
  trunkRoll?: number;
  /** Whole body rotated in the image plane, degrees clockwise. */
  tilt?: number;
  /** Whole body translated in the image plane, metres. */
  shift?: { x: number; y: number };
  /** Landmark indices to mark as not visible. */
  hidden?: number[];
  t?: number;
  width?: number;
  height?: number;
  pixelsPerMetre?: number;
}

const HALF_SHOULDER = 0.18;
const HALF_HIP = 0.13;
const TORSO = 0.5;
const THIGH = 0.45;
const SHANK = 0.42;

/** Flexion the pipeline should report for a thigh posed with `abduction` and `flexionOut`. */
export function expectedFlexion(abduction: number, flexionOut: number): number {
  return Math.atan2(Math.sin(flexionOut * RAD), Math.cos(flexionOut * RAD) * Math.cos(abduction * RAD)) / RAD;
}

export function buildFigure(options: FigureOptions): PoseFrame {
  const {
    top,
    abduction = 0,
    flexionOut = 0,
    pelvisRoll = 0,
    trunkRoll = 0,
    tilt = 0,
    shift = { x: 0, y: 0 },
    hidden = [],
    t = 0,
    width = 1280,
    height = 720,
    pixelsPerMetre = 300,
  } = options;

  // Body axes in world coordinates. Facing the camera, the anterior axis is -z.
  // With the left side up the head is at image-left, with the right side up at image-right.
  const L: Vec3 = { x: top === "left" ? 1 : -1, y: 0, z: 0 };
  const S: Vec3 = { x: 0, y: -1, z: 0 }; // towards the top side
  const A: Vec3 = { x: 0, y: 0, z: -1 };
  const at = (l: number, s: number, a: number): Vec3 => ({
    x: l * L.x + s * S.x + a * A.x,
    y: l * L.y + s * S.y + a * A.y,
    z: l * L.z + s * S.z + a * A.z,
  });
  const plus = (p: Vec3, q: Vec3): Vec3 => ({ x: p.x + q.x, y: p.y + q.y, z: p.z + q.z });

  const rolled = (half: number, deg: number, l: number): [Vec3, Vec3] => {
    const s = half * Math.cos(deg * RAD);
    const a = -half * Math.sin(deg * RAD);
    return [at(l, s, a), at(l, -s, -a)];
  };
  const [topShoulder, bottomShoulder] = rolled(HALF_SHOULDER, trunkRoll, -TORSO);
  const [topHip, bottomHip] = rolled(HALF_HIP, pelvisRoll, 0);

  const ca = Math.cos(abduction * RAD);
  const sa = Math.sin(abduction * RAD);
  const cb = Math.cos(flexionOut * RAD);
  const sb = Math.sin(flexionOut * RAD);
  const legDir = (len: number): Vec3 => at(len * cb * ca, len * cb * sa, len * sb);
  const topKnee = plus(topHip, legDir(THIGH));
  const topAnkle = plus(topHip, legDir(THIGH + SHANK));
  const bottomKnee = plus(bottomHip, at(THIGH, 0, 0));
  const bottomAnkle = plus(bottomHip, at(THIGH + SHANK, 0, 0));

  const idx = defaultConfig.landmarks;
  const joints = new Map<number, Vec3>();
  const put = (side: Side, name: "Shoulder" | "Hip" | "Knee" | "Ankle", p: Vec3): void => {
    joints.set(idx[`${side}${name}`], p);
  };
  const bottom: Side = top === "left" ? "right" : "left";
  put(top, "Shoulder", topShoulder);
  put(top, "Hip", topHip);
  put(top, "Knee", topKnee);
  put(top, "Ankle", topAnkle);
  put(bottom, "Shoulder", bottomShoulder);
  put(bottom, "Hip", bottomHip);
  put(bottom, "Knee", bottomKnee);
  put(bottom, "Ankle", bottomAnkle);

  const ct = Math.cos(tilt * RAD);
  const st = Math.sin(tilt * RAD);
  const empty: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ ...empty }));
  const world: Landmark[] = Array.from({ length: 33 }, () => ({ ...empty }));
  for (const [i, p] of joints) {
    // Clockwise in an image with y down.
    const x = p.x * ct - p.y * st;
    const y = p.x * st + p.y * ct;
    const visibility = hidden.includes(i) ? 0.1 : 0.99;
    world[i] = { x, y, z: p.z, visibility };
    landmarks[i] = {
      x: (width / 2 + (x + shift.x) * pixelsPerMetre) / width,
      y: (height / 2 + (y + shift.y) * pixelsPerMetre) / height,
      z: p.z,
      visibility,
    };
  }
  return { t, width, height, landmarks, world };
}

/** A frame in which no pose was found. */
export function emptyFrame(t: number, width = 1280, height = 720): PoseFrame {
  return { t, width, height, landmarks: null, world: null };
}

/** Builds frames at a fixed rate, with the figure posed by `pose(t)`; return null for a frame without a person. */
export function buildSequence(
  durationMs: number,
  pose: (tMs: number) => Omit<FigureOptions, "t"> | null,
  fps = 30,
): PoseFrame[] {
  const frames: PoseFrame[] = [];
  for (let i = 0; i * (1000 / fps) <= durationMs; i++) {
    const t = i * (1000 / fps);
    const options = pose(t);
    frames.push(options ? buildFigure({ ...options, t }) : emptyFrame(t));
  }
  return frames;
}
