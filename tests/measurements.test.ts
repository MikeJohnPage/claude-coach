import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/pipeline/config";
import { allVisible, calibrationIndices, detectTopSide, measure, trackingIndices } from "../src/pipeline/measurements";
import { unrotateImageLandmark, unrotateWorldLandmark, type Rotation } from "../src/pipeline/rotate";
import { buildFigure, expectedFlexion } from "../src/pipeline/synthetic";
import type { Side } from "../src/pipeline/types";

const sides: Side[] = ["left", "right"];
const within1 = (actual: number, expected: number): void => expect(Math.abs(actual - expected)).toBeLessThan(1);

describe.each(sides)("stick figure with the %s side up", (top) => {
  it("detects the top side", () => {
    expect(detectTopSide(buildFigure({ top }), defaultConfig)).toBe(top);
    expect(detectTopSide(buildFigure({ top, abduction: 30, tilt: 8 }), defaultConfig)).toBe(top);
  });

  it("has its anterior axis pointing towards the camera", () => {
    expect(measure(buildFigure({ top }), top, defaultConfig).anteriorTowardCamera).toBe(true);
  });

  it.each([-3, 0, 12, 30, 45])("measures abduction of %d°", (abduction) => {
    for (const tilt of [0, 10, -10]) {
      const m = measure(buildFigure({ top, abduction, tilt }), top, defaultConfig);
      within1(m.abduction, abduction);
      within1(m.abductionPelvis, abduction);
      within1(m.flexion, 0);
      within1(m.pelvisRoll, 0);
    }
  });

  it("measures abduction regardless of pelvis roll and image size", () => {
    const m = measure(buildFigure({ top, abduction: 25, pelvisRoll: 15, width: 640, height: 480 }), top, defaultConfig);
    within1(m.abduction, 25);
    within1(m.abductionPelvis, 25);
  });

  it.each([
    [0, 15],
    [0, -10],
    [20, 15],
    [30, 25],
  ])("measures flexion with abduction %d° and the thigh %d° out of plane", (abduction, flexionOut) => {
    const m = measure(buildFigure({ top, abduction, flexionOut, tilt: 5 }), top, defaultConfig);
    within1(m.flexion, expectedFlexion(abduction, flexionOut));
    within1(m.abduction, abduction);
  });

  it.each([-8, 0, 10, 20])("measures pelvis roll of %d°", (pelvisRoll) => {
    const m = measure(buildFigure({ top, pelvisRoll, abduction: 20, tilt: -5 }), top, defaultConfig);
    within1(m.pelvisRoll, pelvisRoll);
    within1(m.trunkRoll, 0);
  });

  it.each([-8, 10, 20])("measures trunk roll of %d°", (trunkRoll) => {
    const m = measure(buildFigure({ top, trunkRoll }), top, defaultConfig);
    within1(m.trunkRoll, trunkRoll);
    within1(m.pelvisRoll, 0);
  });

  it("reports torso position and length in pixels", () => {
    const m = measure(buildFigure({ top, pixelsPerMetre: 200, shift: { x: 0.1, y: 0 } }), top, defaultConfig);
    expect(m.torsoLenPx).toBeCloseTo(100, 3);
    expect(m.midHipPx.x).toBeCloseTo(640 + 20, 3);
    expect(m.midHipPx.y).toBeCloseTo(360, 3);
  });

  it("applies the visibility threshold to the needed landmarks only", () => {
    const { leftAnkle, leftKnee, rightKnee } = defaultConfig.landmarks;
    const topKnee = top === "left" ? leftKnee : rightKnee;
    const noAnkle = buildFigure({ top, hidden: [leftAnkle] });
    expect(allVisible(noAnkle, calibrationIndices(defaultConfig), 0.5)).toBe(false);
    expect(allVisible(noAnkle, trackingIndices(defaultConfig, top), 0.5)).toBe(true);
    expect(allVisible(buildFigure({ top, hidden: [topKnee] }), trackingIndices(defaultConfig, top), 0.5)).toBe(false);
  });
});

describe("top side", () => {
  it("is undecided when hip and ankle disagree", () => {
    // The left hip is up, but a 60° adducted top leg puts the left ankle below the right one.
    expect(detectTopSide(buildFigure({ top: "left", abduction: -60 }), defaultConfig)).toBeNull();
  });
});

describe("input rotation", () => {
  it.each([90, -90] as Rotation[])("maps landmarks found in a frame rotated %d° back to the original", (rotation) => {
    const original = { x: 0.2, y: 0.7, z: 0.1, visibility: 1 };
    // Forward mapping as stated in rotate.ts.
    const rotated =
      rotation === 90 ? { ...original, x: 1 - original.y, y: original.x } : { ...original, x: original.y, y: 1 - original.x };
    const back = unrotateImageLandmark(rotated, rotation);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);

    const world = { x: 0.3, y: -0.1, z: 0.2, visibility: 1 };
    const rotatedWorld = rotation === 90 ? { ...world, x: -world.y, y: world.x } : { ...world, x: world.y, y: -world.x };
    const backWorld = unrotateWorldLandmark(rotatedWorld, rotation);
    expect(backWorld.x).toBeCloseTo(world.x);
    expect(backWorld.y).toBeCloseTo(world.y);
  });

  it("gives the same measurements for a figure seen upright and mapped back", () => {
    const frame = buildFigure({ top: "left", abduction: 22, flexionOut: 10, pelvisRoll: 8 });
    // Rotate the scene 90° clockwise, as the app does before inference, then undo it.
    const turned = {
      ...frame,
      width: frame.height,
      height: frame.width,
      landmarks: frame.landmarks!.map((l) => ({ ...l, x: 1 - l.y, y: l.x })),
      world: frame.world!.map((l) => ({ ...l, x: -l.y, y: l.x })),
    };
    const restored = {
      ...frame,
      landmarks: turned.landmarks.map((l) => unrotateImageLandmark(l, 90)),
      world: turned.world.map((l) => unrotateWorldLandmark(l, 90)),
    };
    const a = measure(frame, "left", defaultConfig);
    const b = measure(restored, "left", defaultConfig);
    expect(b.abduction).toBeCloseTo(a.abduction, 6);
    expect(b.flexion).toBeCloseTo(a.flexion, 6);
    expect(b.pelvisRoll).toBeCloseTo(a.pelvisRoll, 6);
  });
});
