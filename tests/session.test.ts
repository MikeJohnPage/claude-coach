import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/pipeline/config";
import { buildFigure, buildSequence } from "../src/pipeline/synthetic";
import { CueEngine } from "../src/pipeline/cues";
import { RepDetector } from "../src/pipeline/reps";
import type { Side } from "../src/pipeline/types";
import { CALIBRATION_MS, cueIds, hold, lift, REST, reps, run, sequence, spoken } from "./helpers";

const { phrases } = defaultConfig;
const text = (id: string): string => defaultConfig.cues.find((c) => c.id === id)!.text;
const sides: Side[] = ["left", "right"];

describe.each(sides)("session with the %s side up", (top) => {
  it("calibrates after two still seconds and records the baselines", () => {
    const { outputs, events } = run(sequence(top, 500, () => ({ abduction: REST })));
    const calibrated = events.find((e) => e.type === "calibrated");
    expect(calibrated?.type === "calibrated" && calibrated.calibration.topSide).toBe(top);
    expect(calibrated?.type === "calibrated" && calibrated.calibration.restAbduction).toBeCloseTo(REST, 3);
    expect(calibrated!.t).toBeGreaterThanOrEqual(2000);
    expect(calibrated!.t).toBeLessThan(2100);
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(outputs.at(-1)!.state).toBe("active");
    expect(outputs.at(-1)!.measurements!.abduction).toBeCloseTo(REST, 1);
  });

  it("detects each rep without announcing it", () => {
    const frames = sequence(top, 10000, (t) => ({
      abduction: Math.max(lift(t, 500, 2500, 25), lift(t, 3500, 2500, 25), lift(t, 6500, 2500, 25)),
    }));
    const { events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(cueIds(events)).toEqual([]);
    expect(reps(events)).toEqual([true, true, true]);
  });

  it("cues a rep that goes too high and marks it faulty", () => {
    const frames = sequence(top, 7000, (t) => ({ abduction: Math.max(lift(t, 500, 2500, 42), lift(t, 3500, 2500, 25)) }));
    const { events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready, text("tooHigh")]);
    expect(reps(events)).toEqual([false, true]);
  });

  it("does not cue at exactly the 30° limit", () => {
    const { events } = run(sequence(top, 4000, (t) => ({ abduction: hold(t, 500, 2000, 30) })));
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(reps(events)).toEqual([true]);
  });

  it("cues pelvis roll, forward flexion and torso movement", () => {
    for (const [pose, id] of [
      [{ pelvisRoll: 20 }, "pelvisRoll"],
      [{ flexionOut: 20 }, "flexDrift"],
      [{ shift: { x: 0.05, y: 0 } }, "torsoShift"],
      [{ shift: { x: 0, y: -0.05 } }, "torsoShift"],
    ] as const) {
      const frames = sequence(top, 4000, (t) => ({
        abduction: hold(t, 500, 2000, 22),
        ...(t > 1200 && t < 2800 ? pose : {}),
      }));
      const { events } = run(frames);
      expect(spoken(events)).toEqual([phrases.ready, text(id)]);
    }
  });

  it("treats extension and rolling forward as fine", () => {
    const frames = sequence(top, 4000, (t) => ({
      abduction: hold(t, 500, 2000, 22),
      ...(t > 1200 && t < 2800 ? { flexionOut: -20, pelvisRoll: -20 } : {}),
    }));
    const { events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(reps(events)).toEqual([true]);
  });

  it("subtracts the calibration baselines", () => {
    // Calibrated with the pelvis already rolled 10° and the thigh 10° forward: holding that is not a fault.
    const frames = buildSequence(CALIBRATION_MS + 4000, (t) => ({
      top,
      abduction: hold(t - CALIBRATION_MS, 500, 2000, 22),
      pelvisRoll: 10,
      flexionOut: 10,
    }));
    const { outputs, events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(reps(events)).toEqual([true]);
    const m = outputs.at(-1)!.measurements!;
    expect(Math.abs(m.pelvisRoll)).toBeLessThan(1);
    expect(Math.abs(m.flexDrift)).toBeLessThan(1);
  });

  it("speaks the highest-priority cue first and the next one only after the gap", () => {
    const frames = sequence(top, 8000, (t) => ({
      abduction: hold(t, 500, 6000, 42),
      ...(t > 1200 ? { pelvisRoll: 20, flexionOut: 20 } : {}),
    }));
    const cues = run(frames).events.filter((e) => e.type === "cue");
    expect(cues.map((c) => c.id)).toEqual(["tooHigh", "pelvisRoll", "flexDrift"]);
    expect(cues[1]!.t - cues[0]!.t).toBeGreaterThanOrEqual(defaultConfig.cueMinGapMs);
    expect(cues[2]!.t - cues[1]!.t).toBeGreaterThanOrEqual(defaultConfig.cueMinGapMs);
  });

  it("says it can't see me after three seconds and recalibrates when I am back", () => {
    const frames = sequence(top, 9000, (t) => (t > 500 && t < 5000 ? null : { abduction: REST }));
    const { outputs, events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready, phrases.cantSee, phrases.ready]);
    const lost = events.find((e) => e.type === "lost")!;
    expect(lost.t - CALIBRATION_MS).toBeGreaterThanOrEqual(3500 - 40);
    expect(lost.t - CALIBRATION_MS).toBeLessThan(3600);
    expect(outputs.at(-1)!.state).toBe("active");
  });

  it("ignores frames with a hidden top knee without losing the session", () => {
    const knee = defaultConfig.landmarks[top === "left" ? "leftKnee" : "rightKnee"];
    const frames = sequence(top, 5000, (t) => ({
      abduction: lift(t, 500, 3000, 25),
      hidden: t > 1500 && t < 2500 ? [knee] : [],
    }));
    const { outputs, events } = run(frames);
    expect(spoken(events)).toEqual([phrases.ready]);
    expect(reps(events)).toEqual([true]);
    expect(outputs.some((o) => !o.visible && o.measurements === null && o.state === "active")).toBe(true);
  });
});

describe("session start", () => {
  it("does not calibrate while I am moving, upright or partly hidden", () => {
    const moving = sequence("left", 0, () => null).map((f, i) => buildFigure({ top: "left", t: f.t, shift: { x: i * 0.01, y: 0 } }));
    expect(run(moving).events).toEqual([]);
    const upright = sequence("left", 0, () => null).map((f) => buildFigure({ top: "left", t: f.t, tilt: 80 }));
    expect(run(upright).events).toEqual([]);
    const hidden = sequence("left", 0, () => null).map((f) =>
      buildFigure({ top: "left", t: f.t, hidden: [defaultConfig.landmarks.rightAnkle] }),
    );
    expect(run(hidden).events).toEqual([]);
  });

  it("says it can't see me once when nobody is in frame", () => {
    const frames = sequence("left", 0, () => null).map((f) => ({ ...f, landmarks: null, world: null }));
    const more = [...frames, ...frames.map((f) => ({ ...f, t: f.t + CALIBRATION_MS + 33 })), ...frames.map((f) => ({ ...f, t: f.t + 2 * CALIBRATION_MS + 66 }))];
    const { outputs, events } = run(more);
    expect(spoken(events)).toEqual([phrases.cantSee]);
    expect(outputs.at(-1)!.state).toBe("lost");
  });
});

describe("rep detector", () => {
  it("starts above rest + 8° and ends at rest + 4°", () => {
    const reps = new RepDetector(defaultConfig);
    expect(reps.update(REST + 7.9, REST)).toBeNull();
    expect(reps.update(REST + 8.1, REST)).toBe("start");
    expect(reps.update(REST + 4.1, REST)).toBeNull();
    expect(reps.update(REST + 9, REST)).toBeNull();
    expect(reps.update(REST + 4, REST)).toBe("end");
    expect(reps.update(REST + 6, REST)).toBeNull();
  });
});

describe("cue arbitration", () => {
  const ok = { abduction: 20, pelvisRoll: 0, flexDrift: 0, torsoShift: 0 };
  const fire = (engine: CueEngine, from: number, to: number, values: typeof ok): Array<[number, string]> => {
    const fired: Array<[number, string]> = [];
    for (let t = from; t <= to; t += 10) {
      const cue = engine.update(t, values);
      if (cue) fired.push([t, cue.id]);
    }
    return fired;
  };

  it("needs the condition to persist", () => {
    const engine = new CueEngine(defaultConfig);
    expect(fire(engine, 0, 140, { ...ok, abduction: 34 })).toEqual([]);
    expect(fire(engine, 150, 160, ok)).toEqual([]);
    // The interruption restarts the clock.
    expect(fire(engine, 170, 310, { ...ok, abduction: 34 })).toEqual([]);
    expect(fire(engine, 320, 400, { ...ok, abduction: 34 })).toEqual([[320, "tooHigh"]]);
  });

  it("uses 300 ms for the slower cues and a strict threshold", () => {
    const engine = new CueEngine(defaultConfig);
    expect(fire(engine, 0, 1000, { ...ok, pelvisRoll: 12, flexDrift: 12, torsoShift: 0.06 })).toEqual([]);
    expect(fire(engine, 1010, 1400, { ...ok, torsoShift: 0.07 })).toEqual([[1310, "torsoShift"]]);
  });

  it("fires each cue once per rep", () => {
    const engine = new CueEngine(defaultConfig);
    expect(fire(engine, 0, 9000, { ...ok, abduction: 40 })).toEqual([[150, "tooHigh"]]);
    engine.startRep();
    expect(fire(engine, 9010, 9500, { ...ok, abduction: 40 })).toEqual([[9160, "tooHigh"]]);
  });

  it("holds a cue back until its cooldown has passed", () => {
    const engine = new CueEngine(defaultConfig);
    expect(fire(engine, 0, 500, { ...ok, abduction: 40 })).toEqual([[150, "tooHigh"]]);
    engine.startRep();
    expect(fire(engine, 1000, 6000, { ...ok, abduction: 40 })).toEqual([[4150, "tooHigh"]]);
  });

  it("picks by priority and never queues a cue whose condition has gone", () => {
    const engine = new CueEngine(defaultConfig);
    const all = { abduction: 40, pelvisRoll: 20, flexDrift: 20, torsoShift: 0.1 };
    expect(fire(engine, 0, 1000, all)).toEqual([[150, "tooHigh"]]);
    // Everything recovers during the gap: the lower-priority cues are dropped, not spoken late.
    expect(fire(engine, 1010, 9000, ok)).toEqual([]);
  });

  it("separates different cues by the minimum gap", () => {
    const engine = new CueEngine(defaultConfig);
    const all = { abduction: 40, pelvisRoll: 20, flexDrift: 20, torsoShift: 0.1 };
    expect(fire(engine, 0, 7000, all)).toEqual([
      [150, "tooHigh"],
      [2150, "pelvisRoll"],
      [4150, "flexDrift"],
      [6150, "torsoShift"],
    ]);
  });
});
