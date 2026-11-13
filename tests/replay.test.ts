import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/pipeline/config";
import { CoachSession } from "../src/pipeline/session";
import { encodeFrame, replay, TRACE_VERSION, type Trace } from "../src/pipeline/trace";
import { cueIds, lift, sequence, spoken } from "./helpers";

function recordTrace(): { trace: Trace; liveEvents: ReturnType<CoachSession["process"]>["events"] } {
  const frames = sequence("right", 7000, (t) => ({ abduction: Math.max(lift(t, 500, 2500, 25), lift(t, 3500, 2500, 42)) }));
  const session = new CoachSession(defaultConfig);
  const trace: Trace = { version: TRACE_VERSION, meta: { source: "synthetic" }, config: defaultConfig, frames: [] };
  const liveEvents = [];
  for (const frame of frames) {
    const output = session.process(frame);
    liveEvents.push(...output.events);
    trace.frames.push(encodeFrame(frame, output));
  }
  return { trace, liveEvents };
}

describe("trace replay", () => {
  it("reproduces the live session from a trace file", () => {
    const { trace, liveEvents } = recordTrace();
    const file = join(mkdtempSync(join(tmpdir(), "coach-trace-")), "session.trace.json");
    writeFileSync(file, JSON.stringify(trace));

    const loaded = JSON.parse(readFileSync(file, "utf8")) as Trace;
    const { outputs, events } = replay(loaded);
    expect(outputs).toHaveLength(trace.frames.length);
    expect(spoken(events)).toEqual(["Ready. Begin.", "1", "Too high. Lower a little."]);
    expect(events.map((e) => [e.type, e.t])).toEqual(liveEvents.map((e) => [e.type, Math.round(e.t * 100) / 100]));
    // Replayed measurements match the recorded ones up to the rounding of stored landmarks.
    const last = loaded.frames.at(-1)!;
    expect(outputs.at(-1)!.measurements!.abduction).toBeCloseTo(last.m!.abduction, 1);
  });

  it("can replay with different thresholds", () => {
    const { trace } = recordTrace();
    const strict = structuredClone(defaultConfig);
    strict.abduction.limitDeg = 20;
    strict.cues[0]!.threshold = 23;
    // The first rep, clean at the default limit, is now too high.
    // The second starts inside the cue's cooldown, so it passes without a second cue.
    const { events } = replay(trace, strict);
    expect(cueIds(events)).toEqual(["tooHigh"]);
    expect(spoken(events)).toEqual(["Ready. Begin.", "Too high. Lower a little.", "1"]);
  });

  it("rejects an unknown trace version", () => {
    const { trace } = recordTrace();
    expect(() => replay({ ...trace, version: 99 })).toThrow(/version/);
  });

  // Tuning aid: TRACE=path/to/file.trace.json npx vitest run tests/replay.test.ts
  it.runIf(process.env.TRACE)("prints the events of the trace named by TRACE", () => {
    const trace = JSON.parse(readFileSync(process.env.TRACE!, "utf8")) as Trace;
    for (const e of replay(trace, defaultConfig).events) console.log(JSON.stringify(e));
  });
});
